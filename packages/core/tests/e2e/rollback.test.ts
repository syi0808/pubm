import { beforeEach, describe, expect, it, vi } from "vitest";
import { RollbackTracker } from "../../src/utils/rollback.js";

type TestCtx = {
  files: Map<string, string>;
  tags: Set<string>;
  commits: string[];
  published: Map<string, string>;
  remoteTags: Set<string>;
  releases: Set<string>;
};

function createTestCtx(): TestCtx {
  return {
    files: new Map(),
    tags: new Set(),
    commits: [],
    published: new Map(),
    remoteTags: new Set(),
    releases: new Set(),
  };
}

// Helpers to simulate pipeline stages
function registerFileBackup(
  tracker: RollbackTracker<TestCtx>,
  filePath: string,
  content: string,
) {
  tracker.add({
    label: `Restore ${filePath}`,
    fn: async (ctx) => {
      ctx.files.set(filePath, content);
    },
  });
}

function registerCommitRollback(tracker: RollbackTracker<TestCtx>) {
  tracker.add({
    label: "Reset git commit",
    fn: async (ctx) => {
      ctx.commits.pop();
    },
  });
}

function registerTagRollback(tracker: RollbackTracker<TestCtx>, tag: string) {
  tracker.add({
    label: `Delete local tag ${tag}`,
    fn: async (ctx) => {
      ctx.tags.delete(tag);
    },
  });
}

function registerUnpublishRollback(
  tracker: RollbackTracker<TestCtx>,
  registry: string,
  _version: string,
) {
  tracker.add({
    label: `Unpublish from ${registry}`,
    fn: async (ctx) => {
      ctx.published.delete(registry);
    },
    confirm: true,
  });
}

function registerRemoteTagRollback(
  tracker: RollbackTracker<TestCtx>,
  tag: string,
) {
  tracker.add({
    label: `Delete remote tag ${tag}`,
    fn: async (ctx) => {
      ctx.remoteTags.delete(tag);
    },
  });
}

function registerReleaseRollback(
  tracker: RollbackTracker<TestCtx>,
  tag: string,
) {
  tracker.add({
    label: `Delete GitHub Release ${tag}`,
    fn: async (ctx) => {
      ctx.releases.delete(tag);
    },
  });
}

describe("RollbackTracker E2E — pipeline failure scenarios", () => {
  let tracker: RollbackTracker<TestCtx>;
  let ctx: TestCtx;

  beforeEach(() => {
    tracker = new RollbackTracker();
    ctx = createTestCtx();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // ───── Failure Point Tests ─────

  describe("#1 beforeVersion failure", () => {
    it("no actions registered — rollback does nothing, state unchanged", async () => {
      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.manualRecovery).toEqual([]);
      expect(ctx.files.size).toBe(0);
      expect(ctx.tags.size).toBe(0);
      expect(ctx.commits).toEqual([]);
    });
  });

  describe("#2 partial version file write", () => {
    it("only successfully written files get backup — only those are restored", async () => {
      // Simulate: package.json written and backed up, jsr.json write failed before backup
      ctx.files.set("package.json", "v2.0.0");
      ctx.files.set("jsr.json", "v2.0.0");

      // Only package.json had its backup registered before failure
      registerFileBackup(tracker, "package.json", "v1.0.0");

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(1);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
      // jsr.json was never backed up, so it retains the v2.0.0 state
      expect(ctx.files.get("jsr.json")).toBe("v2.0.0");
    });
  });

  describe("#3 afterVersion failure (original bug scenario)", () => {
    it("all version files backed up and written, plugin hook fails — all files restored", async () => {
      // Simulate: both files written to v2.0.0
      ctx.files.set("package.json", "v2.0.0");
      ctx.files.set("jsr.json", "v2.0.0");

      // Both backups registered (version bump completed before plugin hook)
      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerFileBackup(tracker, "jsr.json", "v1.0.0");

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(2);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
      expect(ctx.files.get("jsr.json")).toBe("v1.0.0");
    });
  });

  describe("#4 after changeset consumption, before commit", () => {
    it("version files + changeset files both restored", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.files.set("CHANGELOG.md", "## 2.0.0\n- new stuff");
      ctx.files.set(".changeset/abc.md", "CONSUMED");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerFileBackup(tracker, "CHANGELOG.md", "## 1.0.0\n- old stuff");
      registerFileBackup(
        tracker,
        ".changeset/abc.md",
        "---\npatch\n---\nfix something",
      );

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(3);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
      expect(ctx.files.get("CHANGELOG.md")).toBe("## 1.0.0\n- old stuff");
      expect(ctx.files.get(".changeset/abc.md")).toBe(
        "---\npatch\n---\nfix something",
      );
    });
  });

  describe("#5 after commit, before tag", () => {
    it("commit is reset, files restored", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.commits.push("abc123-version-bump");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(2);
      // LIFO: commit rolled back first, then file restored
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
    });
  });

  describe("#6 after tag, before publish", () => {
    it("tag deleted, commit reset, files restored", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.commits.push("abc123-version-bump");
      ctx.tags.add("v2.0.0");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);
      registerTagRollback(tracker, "v2.0.0");

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(3);
      // LIFO: tag first, then commit, then file
      expect(ctx.tags.has("v2.0.0")).toBe(false);
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
    });
  });

  describe("#7 first registry succeeds, second fails", () => {
    it("first registry unpublished + full git rollback", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.commits.push("abc123-version-bump");
      ctx.tags.add("v2.0.0");
      ctx.published.set("npm", "2.0.0");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);
      registerTagRollback(tracker, "v2.0.0");
      registerUnpublishRollback(tracker, "npm", "2.0.0");

      // Second registry (jsr) failed, so no unpublish for it
      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(4);
      expect(ctx.published.has("npm")).toBe(false);
      expect(ctx.tags.has("v2.0.0")).toBe(false);
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
    });
  });

  describe("#8 after push, before release", () => {
    it("remote tags + local tags + commit + files all rolled back", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.commits.push("abc123-version-bump");
      ctx.tags.add("v2.0.0");
      ctx.published.set("npm", "2.0.0");
      ctx.remoteTags.add("v2.0.0");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);
      registerTagRollback(tracker, "v2.0.0");
      registerUnpublishRollback(tracker, "npm", "2.0.0");
      registerRemoteTagRollback(tracker, "v2.0.0");

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(5);
      expect(ctx.remoteTags.has("v2.0.0")).toBe(false);
      expect(ctx.published.has("npm")).toBe(false);
      expect(ctx.tags.has("v2.0.0")).toBe(false);
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
    });
  });

  describe("#9 after release creation", () => {
    it("release deleted + remote tags + local tags + commit + files all rolled back", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.commits.push("abc123-version-bump");
      ctx.tags.add("v2.0.0");
      ctx.published.set("npm", "2.0.0");
      ctx.remoteTags.add("v2.0.0");
      ctx.releases.add("v2.0.0");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);
      registerTagRollback(tracker, "v2.0.0");
      registerUnpublishRollback(tracker, "npm", "2.0.0");
      registerRemoteTagRollback(tracker, "v2.0.0");
      registerReleaseRollback(tracker, "v2.0.0");

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(6);
      expect(ctx.releases.has("v2.0.0")).toBe(false);
      expect(ctx.remoteTags.has("v2.0.0")).toBe(false);
      expect(ctx.published.has("npm")).toBe(false);
      expect(ctx.tags.has("v2.0.0")).toBe(false);
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
    });
  });

  describe("#10 plugin rollback", () => {
    it("plugin-registered action is executed during rollback", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.commits.push("abc123-version-bump");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);

      // Plugin registers its own rollback action (e.g., restore external file)
      const pluginRestored = { called: false };
      tracker.add({
        label: "Restore external version file (plugin)",
        fn: async () => {
          pluginRestored.called = true;
        },
      });

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(3);
      expect(pluginRestored.called).toBe(true);
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
    });
  });

  // ───── Edge Case Tests ─────

  describe("#11 rollback action fails", () => {
    it("one action throws — remaining continue, failure summary includes failed item", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.tags.add("v2.0.0");
      ctx.commits.push("abc123-version-bump");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);
      // Tag deletion fails
      tracker.add({
        label: "Delete local tag v2.0.0",
        fn: async () => {
          throw new Error("git tag -d failed");
        },
      });

      const result = await tracker.execute(ctx, { interactive: false });

      // LIFO: tag delete (fails) -> commit (succeeds) -> file (succeeds)
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.manualRecovery).toContain("Delete local tag v2.0.0");
      // Remaining actions still executed
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
      // Tag was not deleted because the action failed
      expect(ctx.tags.has("v2.0.0")).toBe(true);
    });
  });

  describe("#12 SIGINT rollback", () => {
    it("confirm actions skipped, non-confirm actions execute", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.commits.push("abc123-version-bump");
      ctx.tags.add("v2.0.0");
      ctx.published.set("npm", "2.0.0");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);
      registerTagRollback(tracker, "v2.0.0");
      registerUnpublishRollback(tracker, "npm", "2.0.0"); // confirm: true

      const result = await tracker.execute(ctx, {
        interactive: false,
        sigint: true,
      });

      // Unpublish skipped (confirm: true + sigint), others executed
      expect(result.succeeded).toBe(3);
      expect(result.skipped).toBe(1);
      expect(result.manualRecovery).toContain("Unpublish from npm");
      // npm publish NOT rolled back
      expect(ctx.published.has("npm")).toBe(true);
      // Git state rolled back
      expect(ctx.tags.has("v2.0.0")).toBe(false);
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
    });
  });

  describe("#13 double execution", () => {
    it("second execute() call returns immediately with zeroed result", async () => {
      ctx.files.set("package.json", "v2.0.0");
      registerFileBackup(tracker, "package.json", "v1.0.0");

      const result1 = await tracker.execute(ctx, { interactive: false });
      expect(result1.succeeded).toBe(1);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");

      // Mutate ctx again to verify second call is a no-op
      ctx.files.set("package.json", "v3.0.0");

      const result2 = await tracker.execute(ctx, { interactive: false });
      expect(result2.succeeded).toBe(0);
      expect(result2.failed).toBe(0);
      expect(result2.skipped).toBe(0);
      // The file stays at v3.0.0 because the second execute did nothing
      expect(ctx.files.get("package.json")).toBe("v3.0.0");
    });
  });

  describe("#14 unpublish fails", () => {
    it("failed unpublish logged in manual recovery", async () => {
      ctx.files.set("package.json", "v2.0.0");
      ctx.commits.push("abc123-version-bump");
      ctx.tags.add("v2.0.0");
      ctx.published.set("npm", "2.0.0");

      registerFileBackup(tracker, "package.json", "v1.0.0");
      registerCommitRollback(tracker);
      registerTagRollback(tracker, "v2.0.0");
      // Unpublish fails (e.g., network error)
      tracker.add({
        label: "Unpublish from npm",
        fn: async () => {
          throw new Error("403 Forbidden — cannot unpublish");
        },
        confirm: true,
      });

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.failed).toBe(1);
      expect(result.succeeded).toBe(3);
      expect(result.manualRecovery).toContain("Unpublish from npm");
      // Git state still rolled back despite unpublish failure
      expect(ctx.tags.has("v2.0.0")).toBe(false);
      expect(ctx.commits).toEqual([]);
      expect(ctx.files.get("package.json")).toBe("v1.0.0");
      // npm publish remains because unpublish failed
      expect(ctx.published.has("npm")).toBe(true);
    });
  });

  describe("#15 workspace protocol + version rollback", () => {
    it("both workspace protocol files and version files restored", async () => {
      // Simulate monorepo: main package + dependency with workspace: protocol
      ctx.files.set("packages/a/package.json", "v2.0.0");
      ctx.files.set(
        "packages/b/package.json",
        '{"dependencies":{"a":"2.0.0"}}',
      );

      registerFileBackup(tracker, "packages/a/package.json", "v1.0.0");
      registerFileBackup(
        tracker,
        "packages/b/package.json",
        '{"dependencies":{"a":"workspace:*"}}',
      );

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(2);
      expect(ctx.files.get("packages/a/package.json")).toBe("v1.0.0");
      expect(ctx.files.get("packages/b/package.json")).toBe(
        '{"dependencies":{"a":"workspace:*"}}',
      );
    });
  });

  describe("#16 monorepo partial publish", () => {
    it("multiple package publishes — one fails, all rolled back", async () => {
      // Three packages: a and b published, c failed
      ctx.files.set("packages/a/package.json", "v2.0.0");
      ctx.files.set("packages/b/package.json", "v2.0.0");
      ctx.files.set("packages/c/package.json", "v2.0.0");
      ctx.commits.push("monorepo-version-bump");
      ctx.tags.add("a@2.0.0");
      ctx.tags.add("b@2.0.0");
      ctx.published.set("npm:@scope/a", "2.0.0");
      ctx.published.set("npm:@scope/b", "2.0.0");

      // Register in order: files -> commit -> tags -> publishes
      registerFileBackup(tracker, "packages/a/package.json", "v1.0.0");
      registerFileBackup(tracker, "packages/b/package.json", "v1.0.0");
      registerFileBackup(tracker, "packages/c/package.json", "v1.0.0");
      registerCommitRollback(tracker);
      registerTagRollback(tracker, "a@2.0.0");
      registerTagRollback(tracker, "b@2.0.0");
      registerUnpublishRollback(tracker, "npm:@scope/a", "2.0.0");
      registerUnpublishRollback(tracker, "npm:@scope/b", "2.0.0");

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(8);
      // All publishes rolled back
      expect(ctx.published.has("npm:@scope/a")).toBe(false);
      expect(ctx.published.has("npm:@scope/b")).toBe(false);
      // All tags removed
      expect(ctx.tags.has("a@2.0.0")).toBe(false);
      expect(ctx.tags.has("b@2.0.0")).toBe(false);
      // Commit removed
      expect(ctx.commits).toEqual([]);
      // All files restored
      expect(ctx.files.get("packages/a/package.json")).toBe("v1.0.0");
      expect(ctx.files.get("packages/b/package.json")).toBe("v1.0.0");
      expect(ctx.files.get("packages/c/package.json")).toBe("v1.0.0");
    });
  });

  describe("#17 monorepo unpublish order", () => {
    it("LIFO ensures dependents unpublished before dependencies", async () => {
      // Package b depends on a. Both published. LIFO should unpublish b first.
      ctx.published.set("npm:a", "2.0.0");
      ctx.published.set("npm:b", "2.0.0"); // b depends on a

      const executionOrder: string[] = [];

      // a published first (dependency)
      tracker.add({
        label: "Unpublish npm:a",
        fn: async (c) => {
          executionOrder.push("npm:a");
          c.published.delete("npm:a");
        },
        confirm: true,
      });

      // b published second (dependent)
      tracker.add({
        label: "Unpublish npm:b",
        fn: async (c) => {
          executionOrder.push("npm:b");
          c.published.delete("npm:b");
        },
        confirm: true,
      });

      await tracker.execute(ctx, { interactive: false });

      // LIFO: b (dependent) unpublished before a (dependency)
      expect(executionOrder).toEqual(["npm:b", "npm:a"]);
      expect(ctx.published.has("npm:a")).toBe(false);
      expect(ctx.published.has("npm:b")).toBe(false);
    });
  });
});
