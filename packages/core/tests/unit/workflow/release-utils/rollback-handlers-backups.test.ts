import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../../src/context.js";
import {
  registerChangelogBackup,
  registerChangesetBackups,
  registerCommitRollback,
  registerManifestBackups,
  registerTagRollback,
} from "../../../../src/workflow/release-utils/rollback-handlers.js";

const rollbackState = vi.hoisted(() => ({
  gitCalls: [] as Array<{ name: string; args: unknown[] }>,
  status: "",
}));

vi.mock("../../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../../src/ecosystem/catalog.js", () => ({
  ecosystemCatalog: {
    get: vi.fn(() => ({
      ecosystemClass: class MockEcosystem {
        constructor(readonly packagePath: string) {}

        manifestFiles(): string[] {
          return ["package.json", "jsr.json"];
        }
      },
    })),
  },
}));

vi.mock("../../../../src/git.js", () => ({
  Git: class MockGit {
    async reset(...args: string[]): Promise<void> {
      rollbackState.gitCalls.push({ name: "reset", args });
    }

    async status(): Promise<string> {
      rollbackState.gitCalls.push({ name: "status", args: [] });
      return rollbackState.status;
    }

    async stash(): Promise<void> {
      rollbackState.gitCalls.push({ name: "stash", args: [] });
    }

    async popStash(): Promise<void> {
      rollbackState.gitCalls.push({ name: "popStash", args: [] });
    }

    async deleteTag(...args: string[]): Promise<void> {
      rollbackState.gitCalls.push({ name: "deleteTag", args });
    }
  },
}));

let root = "";

function createContext(): PubmContext & {
  rollbackItems: Array<{ label: string; fn: () => Promise<void> }>;
} {
  const rollbackItems: Array<{ label: string; fn: () => Promise<void> }> = [];
  return {
    rollbackItems,
    cwd: root,
    config: {
      packages: [
        {
          ecosystem: "js",
          name: "pkg-a",
          path: "packages/a",
          registries: ["npm"],
        },
      ],
    },
    options: {},
    runtime: {
      cleanWorkingTree: true,
      pluginRunner: {} as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: false,
      rollback: {
        add: (item: (typeof rollbackItems)[number]) => rollbackItems.push(item),
      } as unknown as PubmContext["runtime"]["rollback"],
      tag: "latest",
    },
  } as PubmContext & { rollbackItems: typeof rollbackItems };
}

beforeEach(() => {
  root = path.join(tmpdir(), `pubm-rollback-${Date.now()}`);
  mkdirSync(path.join(root, "packages/a"), { recursive: true });
  mkdirSync(path.join(root, ".pubm/changesets"), { recursive: true });
  rollbackState.gitCalls = [];
  rollbackState.status = "";
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("release rollback backup helpers", () => {
  it("backs up existing manifests and restores them through rollback", async () => {
    const manifestPath = path.join(root, "packages/a/package.json");
    const missingPath = path.join(root, "packages/a/jsr.json");
    writeFileSync(manifestPath, '{"version":"1.0.0"}');
    const ctx = createContext();

    registerManifestBackups(ctx);

    expect(ctx.rollbackItems).toHaveLength(1);
    expect(ctx.rollbackItems[0]?.label).toBe("Restore packages/a/package.json");
    writeFileSync(manifestPath, '{"version":"2.0.0"}');
    await ctx.rollbackItems[0]?.fn();
    expect(readFileSync(manifestPath, "utf-8")).toBe('{"version":"1.0.0"}');
    expect(() => readFileSync(missingPath, "utf-8")).toThrow();
  });

  it("backs up changesets and changelog files only when they exist", async () => {
    const changesetPath = path.join(root, ".pubm/changesets/one.md");
    const changelogPath = path.join(root, "CHANGELOG.md");
    writeFileSync(changesetPath, "old changeset");
    writeFileSync(changelogPath, "old changelog");
    const ctx = createContext();

    registerChangesetBackups(ctx, [{ id: "one" }, { id: "missing" }] as never);
    registerChangelogBackup(ctx, changelogPath);
    registerChangelogBackup(ctx, path.join(root, "MISSING.md"));

    expect(ctx.rollbackItems.map((item) => item.label)).toEqual([
      "Restore 1 changeset file(s)",
      "Restore CHANGELOG.md",
    ]);

    writeFileSync(changesetPath, "new changeset");
    writeFileSync(changelogPath, "new changelog");
    await ctx.rollbackItems[0]?.fn();
    await ctx.rollbackItems[1]?.fn();
    expect(readFileSync(changesetPath, "utf-8")).toBe("old changeset");
    expect(readFileSync(changelogPath, "utf-8")).toBe("old changelog");
  });

  it("resets commits with and without temporary stashing", async () => {
    const ctx = createContext();
    registerCommitRollback(ctx);

    rollbackState.status = "";
    await ctx.rollbackItems[0]?.fn();
    expect(rollbackState.gitCalls.map((call) => call.name)).toEqual([
      "reset",
      "status",
      "reset",
    ]);

    rollbackState.gitCalls = [];
    rollbackState.status = " M package.json";
    await ctx.rollbackItems[0]?.fn();
    expect(rollbackState.gitCalls.map((call) => call.name)).toEqual([
      "reset",
      "status",
      "stash",
      "reset",
      "popStash",
    ]);
  });

  it("registers local tag deletion rollback", async () => {
    const ctx = createContext();

    registerTagRollback(ctx, "v1.2.0");
    await ctx.rollbackItems[0]?.fn();

    expect(ctx.rollbackItems[0]?.label).toBe("Delete local tag v1.2.0");
    expect(rollbackState.gitCalls).toEqual([
      { name: "deleteTag", args: ["v1.2.0"] },
    ]);
  });
});
