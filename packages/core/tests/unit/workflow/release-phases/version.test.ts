import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext, VersionPlan } from "../../../../src/context.js";
import { createVersionOperation } from "../../../../src/workflow/release-phases/version.js";
import { readPinnedWorkflowVersionStepOutput } from "../../../../src/workflow/version-step-output.js";

const versionState = vi.hoisted(() => ({
  git: {
    checkTagExist: false,
    calls: [] as Array<{ name: string; args: unknown[] }>,
  },
  changesets: [] as Array<{ id: string; filePath?: string }>,
  entries: [] as string[],
  entriesByKey: new Map<string, string[]>(),
  writeVersionsResult: ["package.json"] as string[],
  writeVersionsCalls: [] as Array<Map<string, string>>,
  deletedChangesets: [] as unknown[],
  changelogs: [] as Array<{ cwd: string; content: string }>,
}));

vi.mock("../../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../../src/git.js", () => ({
  Git: class MockGit {
    async reset(...args: string[]): Promise<void> {
      versionState.git.calls.push({ name: "reset", args });
    }

    async stage(...args: string[]): Promise<void> {
      versionState.git.calls.push({ name: "stage", args });
    }

    async checkTagExist(...args: string[]): Promise<boolean> {
      versionState.git.calls.push({ name: "checkTagExist", args });
      return versionState.git.checkTagExist;
    }

    async deleteTag(...args: string[]): Promise<void> {
      versionState.git.calls.push({ name: "deleteTag", args });
    }

    async commit(...args: string[]): Promise<string> {
      versionState.git.calls.push({ name: "commit", args });
      return "commit-1";
    }

    async createTag(...args: string[]): Promise<void> {
      versionState.git.calls.push({ name: "createTag", args });
    }
  },
}));

vi.mock("../../../../src/changeset/resolve.js", () => ({
  createKeyResolver: vi.fn(() => (value: string) => value),
}));

vi.mock("../../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(() => versionState.changesets),
  deleteChangesetFiles: vi.fn((_cwd: string, changesets: unknown[]) => {
    versionState.deletedChangesets.push(...changesets);
  }),
}));

vi.mock("../../../../src/changeset/changelog.js", () => ({
  buildChangelogEntries: vi.fn(
    (_changesets: unknown[], key: string) =>
      versionState.entriesByKey.get(key) ?? versionState.entries,
  ),
  deduplicateEntries: vi.fn((entries: unknown[]) => entries),
  generateChangelog: vi.fn(
    (version: string, entries: string[]) =>
      `# ${version}\n${entries.join("\n")}`,
  ),
  writeChangelogToFile: vi.fn((cwd: string, content: string) => {
    versionState.changelogs.push({ cwd, content });
  }),
}));

vi.mock("../../../../src/workflow/release-utils/write-versions.js", () => ({
  writeVersions: vi.fn(
    async (_ctx: PubmContext, versions: Map<string, string>) => {
      versionState.writeVersionsCalls.push(new Map(versions));
      return versionState.writeVersionsResult;
    },
  ),
}));

vi.mock(
  "../../../../src/workflow/release-utils/rollback-handlers.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../src/workflow/release-utils/rollback-handlers.js")
      >();
    return {
      ...actual,
      registerChangelogBackup: vi.fn(),
      registerChangesetBackups: vi.fn(),
      registerCommitRollback: vi.fn(),
      registerManifestBackups: vi.fn(),
      registerTagRollback: vi.fn(),
    };
  },
);

function createContext(
  plan: VersionPlan,
  overrides: Partial<PubmContext> = {},
) {
  return {
    cwd: "/repo",
    options: {},
    config: {
      packages: [
        {
          ecosystem: "js",
          name: "pkg-a",
          path: "packages/a",
          registries: ["npm"],
          version: "1.0.0",
        },
        {
          ecosystem: "js",
          name: "pkg-b",
          path: "packages/b",
          registries: ["npm"],
          version: "1.0.0",
        },
      ],
    },
    runtime: {
      changesetConsumed: false,
      cleanWorkingTree: true,
      pluginRunner: {
        runHook: vi.fn(async () => undefined),
      } as unknown as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: false,
      rollback: {
        add: vi.fn(),
      } as unknown as PubmContext["runtime"]["rollback"],
      tag: "latest",
      versionPlan: plan,
    },
    ...overrides,
  } as PubmContext;
}

function createTask(promptResponses: unknown[] = []) {
  return {
    title: "",
    output: "",
    prompt: () => ({
      run: vi.fn(async () => promptResponses.shift()),
    }),
  };
}

function callNames() {
  return versionState.git.calls.map((call) => call.name);
}

beforeEach(() => {
  vi.clearAllMocks();
  versionState.git.checkTagExist = false;
  versionState.git.calls = [];
  versionState.changesets = [];
  versionState.entries = [];
  versionState.entriesByKey = new Map();
  versionState.writeVersionsResult = ["package.json"];
  versionState.writeVersionsCalls = [];
  versionState.deletedChangesets = [];
  versionState.changelogs = [];
});

describe("createVersionOperation", () => {
  it("pins version metadata but avoids writes in dry-run mode", async () => {
    const ctx = createContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.0",
    });

    await createVersionOperation(true, true).run?.(ctx, createTask() as never);

    expect(readPinnedWorkflowVersionStepOutput(ctx)?.summary).toBe("v1.2.0");
    expect(versionState.writeVersionsCalls).toEqual([]);
    expect(callNames()).toEqual(["reset"]);
  });

  it("writes single-package versions, consumes changesets, and replaces existing tags when confirmed", async () => {
    versionState.git.checkTagExist = true;
    versionState.changesets = [
      { id: "one", filePath: ".pubm/changesets/one.md" },
    ];
    versionState.entries = ["change"];
    const ctx = createContext(
      {
        mode: "single",
        packageKey: "packages/a::js",
        version: "1.2.0",
      },
      {
        runtime: {
          ...createContext({
            mode: "single",
            packageKey: "packages/a::js",
            version: "1.2.0",
          }).runtime,
          changesetConsumed: true,
          promptEnabled: true,
        },
      },
    );

    await createVersionOperation(true, false).run?.(
      ctx,
      createTask([true]) as never,
    );

    expect(versionState.writeVersionsCalls[0]).toEqual(
      new Map([["packages/a::js", "1.2.0"]]),
    );
    expect(versionState.changelogs).toEqual([
      { cwd: "/repo", content: "# 1.2.0\nchange" },
    ]);
    expect(versionState.deletedChangesets).toHaveLength(1);
    expect(callNames()).toEqual([
      "reset",
      "stage",
      "stage",
      "checkTagExist",
      "deleteTag",
      "commit",
      "createTag",
    ]);
  });

  it("handles consumed single-package changesets when no changesets are present", async () => {
    const ctx = createContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.0",
    });
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.changelogs).toEqual([]);
    expect(versionState.deletedChangesets).toEqual([]);
    expect(callNames()).toContain("commit");
  });

  it("falls back to an empty changelog package path when single-package config is empty", async () => {
    versionState.changesets = [{ id: "single" }];
    versionState.entries = ["single change"];
    const ctx = createContext(
      {
        mode: "single",
        packageKey: "packages/a::js",
        version: "1.2.0",
      },
      {
        config: { packages: [] },
      } as Partial<PubmContext>,
    );
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.writeVersionsCalls[0]).toEqual(new Map());
    expect(versionState.changelogs).toEqual([
      { cwd: "/repo", content: "# 1.2.0\nsingle change" },
    ]);
  });

  it("throws when an interactive user refuses to replace an existing single-package tag", async () => {
    versionState.git.checkTagExist = true;
    const ctx = createContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.0",
    });
    ctx.runtime.promptEnabled = true;

    await expect(
      createVersionOperation(true, false).run?.(
        ctx,
        createTask([false]) as never,
      ),
    ).rejects.toThrow("error.version.tagExists");

    expect(callNames()).not.toContain("deleteTag");
  });

  it("fails an existing single-package tag check in noninteractive mode", async () => {
    versionState.git.checkTagExist = true;
    const ctx = createContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.0",
    });

    await expect(
      createVersionOperation(true, false).run?.(ctx, createTask() as never),
    ).rejects.toThrow("error.version.tagExistsManual");
  });

  it("pins fixed version metadata but avoids writes in dry-run mode", async () => {
    const ctx = createContext({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });

    await createVersionOperation(true, true).run?.(ctx, createTask() as never);

    expect(readPinnedWorkflowVersionStepOutput(ctx)?.summary).toBe("v2.0.0");
    expect(versionState.writeVersionsCalls).toEqual([]);
    expect(callNames()).toEqual(["reset"]);
  });

  it("writes fixed versions and fixed changelog entries", async () => {
    versionState.changesets = [{ id: "fixed" }];
    versionState.entries = ["fixed change"];
    const ctx = createContext({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.writeVersionsCalls[0]).toEqual(
      new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    );
    expect(versionState.changelogs[0]).toEqual({
      cwd: "/repo",
      content: "# 2.0.0\nfixed change\nfixed change",
    });
    expect(callNames()).toContain("createTag");
  });

  it("handles consumed fixed changesets when no changesets are present", async () => {
    const ctx = createContext({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["packages/a::js", "2.0.0"]]),
    });
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.changelogs).toEqual([]);
    expect(versionState.deletedChangesets).toEqual([]);
    expect(callNames()).toContain("commit");
  });

  it("deletes consumed fixed changesets without writing a changelog when entries are empty", async () => {
    versionState.changesets = [{ id: "empty-fixed" }];
    versionState.entries = [];
    const ctx = createContext({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["packages/a::js", "2.0.0"]]),
    });
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.changelogs).toEqual([]);
    expect(versionState.deletedChangesets).toHaveLength(1);
  });

  it("throws when an interactive user refuses to replace an existing fixed tag", async () => {
    versionState.git.checkTagExist = true;
    const ctx = createContext({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["packages/a::js", "2.0.0"]]),
    });
    ctx.runtime.promptEnabled = true;

    await expect(
      createVersionOperation(true, false).run?.(
        ctx,
        createTask([false]) as never,
      ),
    ).rejects.toThrow("error.version.tagExists");

    expect(callNames()).not.toContain("deleteTag");
  });

  it("replaces an existing fixed tag when an interactive user confirms", async () => {
    versionState.git.checkTagExist = true;
    const ctx = createContext({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["packages/a::js", "2.0.0"]]),
    });
    ctx.runtime.promptEnabled = true;

    await createVersionOperation(true, false).run?.(
      ctx,
      createTask([true]) as never,
    );

    expect(callNames()).toContain("deleteTag");
    expect(callNames()).toContain("createTag");
  });

  it("pins independent version metadata but avoids writes in dry-run mode", async () => {
    const ctx = createContext({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "3.0.0"],
        ["packages/b::js", "4.0.0"],
      ]),
    });

    await createVersionOperation(true, true).run?.(ctx, createTask() as never);

    expect(readPinnedWorkflowVersionStepOutput(ctx)?.summary).toBe(
      "pkg-a@3.0.0, pkg-b@4.0.0",
    );
    expect(versionState.writeVersionsCalls).toEqual([]);
    expect(callNames()).toEqual(["reset"]);
  });

  it("writes independent versions, package changelogs, and per-package tags", async () => {
    versionState.changesets = [{ id: "independent" }];
    versionState.entries = ["independent change"];
    const ctx = createContext({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "3.0.0"],
        ["packages/b::js", "4.0.0"],
      ]),
    });
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.changelogs).toEqual([
      {
        cwd: path.resolve("/repo", "packages/a"),
        content: "# 3.0.0\nindependent change",
      },
      {
        cwd: path.resolve("/repo", "packages/b"),
        content: "# 4.0.0\nindependent change",
      },
    ]);
    expect(
      versionState.git.calls
        .filter((call) => call.name === "createTag")
        .map((call) => call.args[0]),
    ).toEqual(["pkg-a@3.0.0", "pkg-b@4.0.0"]);
  });

  it("handles consumed independent changesets when no changesets are present", async () => {
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "3.0.0"]]),
    });
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.changelogs).toEqual([]);
    expect(versionState.deletedChangesets).toEqual([]);
    expect(callNames()).toContain("commit");
  });

  it("skips independent changelog writes when a package has no entries", async () => {
    versionState.changesets = [{ id: "empty-independent" }];
    versionState.entries = [];
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "3.0.0"]]),
    });
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.changelogs).toEqual([]);
    expect(versionState.deletedChangesets).toHaveLength(1);
  });

  it("uses the repository changelog path for independent package keys missing from config", async () => {
    versionState.changesets = [{ id: "missing-config" }];
    versionState.entriesByKey.set("packages/c::js", ["missing config change"]);
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/c::js", "5.0.0"]]),
    });
    ctx.runtime.changesetConsumed = true;

    await createVersionOperation(true, false).run?.(ctx, createTask() as never);

    expect(versionState.changelogs).toEqual([
      { cwd: "/repo", content: "# 5.0.0\nmissing config change" },
    ]);
  });

  it("throws when an interactive user refuses to replace an existing independent tag", async () => {
    versionState.git.checkTagExist = true;
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "3.0.0"]]),
    });
    ctx.runtime.promptEnabled = true;

    await expect(
      createVersionOperation(true, false).run?.(
        ctx,
        createTask([false]) as never,
      ),
    ).rejects.toThrow("error.version.tagExists");

    expect(callNames()).not.toContain("deleteTag");
  });

  it("replaces an existing independent tag when an interactive user confirms", async () => {
    versionState.git.checkTagExist = true;
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "3.0.0"]]),
    });
    ctx.runtime.promptEnabled = true;

    await createVersionOperation(true, false).run?.(
      ctx,
      createTask([true]) as never,
    );

    expect(callNames()).toContain("deleteTag");
    expect(callNames()).toContain("createTag");
  });

  it("fails an existing independent tag check in noninteractive mode", async () => {
    versionState.git.checkTagExist = true;
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "3.0.0"]]),
    });

    await expect(
      createVersionOperation(true, false).run?.(ctx, createTask() as never),
    ).rejects.toThrow("error.version.tagExistsManual");
  });

  it("fails existing tag checks in noninteractive mode", async () => {
    versionState.git.checkTagExist = true;
    const ctx = createContext({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["packages/a::js", "2.0.0"]]),
    });

    await expect(
      createVersionOperation(true, false).run?.(ctx, createTask() as never),
    ).rejects.toThrow("error.version.tagExistsManual");
  });
});
