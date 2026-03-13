import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("std-env", () => ({ isCI: false }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});
vi.mock("../../../src/error.js", () => ({
  AbstractError: class extends Error {
    name = "AbstractError";
  },
  consoleError: vi.fn(),
}));
vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(),
}));
vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn(),
  createCiListrOptions: vi.fn(() => ({ renderer: "ci-renderer" })),
}));
vi.mock("../../../src/tasks/github-release.js", () => ({
  createGitHubRelease: vi.fn(),
}));
vi.mock("../../../src/changeset/packages.js", () => ({
  discoverPackageInfos: vi.fn(),
}));
vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(),
  deleteChangesetFiles: vi.fn(),
}));
vi.mock("../../../src/changeset/changelog.js", () => ({
  buildChangelogEntries: vi.fn(),
  generateChangelog: vi.fn(),
  writeChangelogToFile: vi.fn(),
}));
vi.mock("../../../src/changeset/changelog-parser.js", () => ({
  parseChangelogSection: vi.fn(),
}));
vi.mock("../../../src/utils/package.js", () => ({
  getPackageJson: vi.fn(),
  getJsrJson: vi.fn(),
  replaceVersion: vi.fn(),
  replaceVersionAtPath: vi.fn(),
}));
vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/utils/package-manager.js", () => ({
  getPackageManager: vi.fn(),
}));
vi.mock("../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(),
}));
vi.mock("../../../src/utils/token.js", () => ({
  injectTokensToEnv: vi.fn(() => vi.fn()),
}));
vi.mock("../../../src/utils/rollback.js", () => ({
  rollback: vi.fn(),
  addRollback: vi.fn(),
  rollbackLog: vi.fn(),
  rollbackError: vi.fn(),
}));
vi.mock("../../../src/tasks/prerequisites-check.js", () => ({
  prerequisitesCheckTask: vi.fn(() => ({
    run: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../../../src/tasks/required-conditions-check.js", () => ({
  requiredConditionsCheckTask: vi.fn(() => ({
    run: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../../../src/tasks/preflight.js", () => ({
  collectTokens: vi.fn(),
  promptGhSecretsSync: vi.fn(),
}));
vi.mock("../../../src/tasks/npm.js", () => ({
  npmPublishTasks: {
    title: "npm publish",
    task: vi.fn(),
  },
}));
vi.mock("../../../src/tasks/jsr.js", () => ({
  jsrPublishTasks: {
    title: "jsr publish",
    task: vi.fn(),
  },
}));
vi.mock("../../../src/tasks/crates.js", () => ({
  cratesPublishTasks: {
    title: "crates publish",
    task: vi.fn(),
  },
  createCratesPublishTask: vi.fn((packagePath?: string) => ({
    title: `crates publish (${packagePath})`,
    task: vi.fn(),
  })),
}));
vi.mock("../../../src/tasks/dry-run-publish.js", () => ({
  npmDryRunPublishTask: {
    title: "Dry-run npm publish",
    task: vi.fn(),
  },
  jsrDryRunPublishTask: {
    title: "Dry-run jsr publish",
    task: vi.fn(),
  },
  cratesDryRunPublishTask: {
    title: "Dry-run crates publish",
    task: vi.fn(),
  },
  createCratesDryRunPublishTask: vi.fn(
    (packagePath?: string, siblings?: string[]) => ({
      title: `Dry-run crates publish (${packagePath})`,
      siblings,
      task: vi.fn(),
    }),
  ),
}));
vi.mock("../../../src/utils/cli.js", () => ({
  link: vi.fn((_text: string, url: string) => url),
}));
vi.mock("../../../src/registry/catalog.js", () => {
  const mockCratesRegistry = {
    concurrentPublish: false,
    orderPackages: vi.fn((paths: string[]) => Promise.resolve(paths)),
    checkAvailability: vi.fn(),
  };
  const mockNpmRegistry = {
    concurrentPublish: true,
    orderPackages: vi.fn((paths: string[]) => Promise.resolve(paths)),
    checkAvailability: vi.fn(),
  };
  const mockJsrRegistry = {
    concurrentPublish: true,
    orderPackages: vi.fn((paths: string[]) => Promise.resolve(paths)),
    checkAvailability: vi.fn(),
  };
  const descriptors: Record<string, any> = {
    npm: {
      key: "npm",
      ecosystem: "js",
      label: "npm",
      needsPackageScripts: true,
      tokenConfig: {
        envVar: "NODE_AUTH_TOKEN",
        dbKey: "npm-token",
        ghSecretName: "NODE_AUTH_TOKEN",
        promptLabel: "npm access token",
        tokenUrl:
          "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
        tokenUrlLabel: "npmjs.com",
      },
      resolveDisplayName: vi.fn(async () => ["pubm"]),
      factory: vi.fn(async () => mockNpmRegistry),
    },
    jsr: {
      key: "jsr",
      ecosystem: "js",
      label: "jsr",
      needsPackageScripts: false,
      tokenConfig: {
        envVar: "JSR_TOKEN",
        dbKey: "jsr-token",
        ghSecretName: "JSR_TOKEN",
        promptLabel: "jsr API token",
        tokenUrl: "https://jsr.io/account/tokens/create",
        tokenUrlLabel: "jsr.io",
      },
      resolveDisplayName: vi.fn(async () => ["@pubm/pubm"]),
      factory: vi.fn(async () => mockJsrRegistry),
    },
    crates: {
      key: "crates",
      ecosystem: "rust",
      label: "crates.io",
      needsPackageScripts: false,
      tokenConfig: {
        envVar: "CARGO_REGISTRY_TOKEN",
        dbKey: "cargo-token",
        ghSecretName: "CARGO_REGISTRY_TOKEN",
        promptLabel: "crates.io API token",
        tokenUrl: "https://crates.io/settings/tokens/new",
        tokenUrlLabel: "crates.io",
      },
      resolveDisplayName: vi.fn(
        async (ctx: any) =>
          ctx.packages
            ?.filter((pkg: any) => pkg.registries.includes("crates"))
            .map((pkg: any) => pkg.path) ?? ["crate"],
      ),
      factory: vi.fn(async () => mockCratesRegistry),
    },
  };
  return {
    registryCatalog: {
      get: vi.fn((key: string) => descriptors[key]),
      all: vi.fn(() => Object.values(descriptors)),
    },
    __mockCratesRegistry: mockCratesRegistry,
  };
});
vi.mock("../../../src/ecosystem/index.js", () => ({
  detectEcosystem: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import {
  buildChangelogEntries,
  generateChangelog,
  writeChangelogToFile,
} from "../../../src/changeset/changelog.js";
import { parseChangelogSection } from "../../../src/changeset/changelog-parser.js";
import { discoverPackageInfos } from "../../../src/changeset/packages.js";
import {
  deleteChangesetFiles,
  readChangesets,
} from "../../../src/changeset/reader.js";
import { detectEcosystem } from "../../../src/ecosystem/index.js";
import { Git } from "../../../src/git.js";
import { PluginRunner } from "../../../src/plugin/runner.js";
import { createCratesDryRunPublishTask } from "../../../src/tasks/dry-run-publish.js";
import { createGitHubRelease } from "../../../src/tasks/github-release.js";
import { run } from "../../../src/tasks/runner.js";
import { createListr } from "../../../src/utils/listr.js";
import {
  getJsrJson,
  getPackageJson,
  replaceVersion,
  replaceVersionAtPath,
} from "../../../src/utils/package.js";
import { addRollback } from "../../../src/utils/rollback.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedGit = vi.mocked(Git);
const mockedCreateListr = vi.mocked(createListr);
const mockedCreateGitHubRelease = vi.mocked(createGitHubRelease);
const mockedDiscoverPackageInfos = vi.mocked(discoverPackageInfos);
const mockedParseChangelogSection = vi.mocked(parseChangelogSection);
const mockedReadChangesets = vi.mocked(readChangesets);
const mockedDeleteChangesetFiles = vi.mocked(deleteChangesetFiles);
const mockedBuildChangelogEntries = vi.mocked(buildChangelogEntries);
const mockedGenerateChangelog = vi.mocked(generateChangelog);
const mockedWriteChangelogToFile = vi.mocked(writeChangelogToFile);
const mockedReplaceVersion = vi.mocked(replaceVersion);
const mockedReplaceVersionAtPath = vi.mocked(replaceVersionAtPath);
const mockedDetectEcosystem = vi.mocked(detectEcosystem);
const mockedCratesRegistry = (
  (await import("../../../src/registry/catalog.js")) as any
).__mockCratesRegistry;
const mockedCreateCratesDryRunPublishTask = vi.mocked(
  createCratesDryRunPublishTask,
);
const mockedAddRollback = vi.mocked(addRollback);
const mockedGetPackageJson = vi.mocked(getPackageJson);
const mockedGetJsrJson = vi.mocked(getJsrJson);

function createOptions(overrides: Record<string, unknown> = {}) {
  return {
    version: "1.0.0",
    testScript: "test",
    buildScript: "build",
    branch: "main",
    tag: "latest",
    saveToken: true,
    packages: [{ path: ".", registries: ["npm", "jsr"] }],
    ...overrides,
  } as any;
}

function createParentTask() {
  return {
    output: "",
    title: "",
    newListr: vi.fn((_subtasks: any[], _options?: any) => ({
      run: vi.fn(),
    })),
  };
}

function createTask() {
  return {
    output: "",
    title: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  mockedCreateListr.mockImplementation(
    (tasks: any) =>
      ({
        run: vi.fn().mockResolvedValue(undefined),
        tasks,
      }) as any,
  );

  mockedGit.mockImplementation(function () {
    return {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      latestTag: vi.fn().mockResolvedValue("v1.0.0"),
      previousTag: vi.fn().mockResolvedValue("v0.9.0"),
      firstCommit: vi.fn().mockResolvedValue("first-commit"),
      commits: vi.fn().mockResolvedValue([{ id: "head", message: "skip" }]),
      repository: vi.fn().mockResolvedValue("https://github.com/pubm/pubm"),
      push: vi.fn().mockResolvedValue(true),
      status: vi.fn().mockResolvedValue(""),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
    } as any;
  } as any);

  mockedGetPackageJson.mockResolvedValue({ name: "pubm" } as any);
  mockedGetJsrJson.mockResolvedValue({ name: "@pubm/pubm" } as any);
  mockedDiscoverPackageInfos.mockResolvedValue([]);
  mockedExistsSync.mockReturnValue(false);
  mockedReadFileSync.mockReturnValue("");
  mockedCreateGitHubRelease.mockResolvedValue({
    version: "1.0.0",
    tag: "v1.0.0",
    releaseUrl: "https://github.com/pubm/pubm/releases/tag/v1.0.0",
    assets: [],
  });
  mockedReadChangesets.mockReturnValue([]);
  mockedBuildChangelogEntries.mockReturnValue([]);
  mockedGenerateChangelog.mockReturnValue("generated");
  mockedReplaceVersion.mockResolvedValue(["package.json"]);
  mockedReplaceVersionAtPath.mockResolvedValue([]);
  mockedCratesRegistry.orderPackages.mockImplementation((paths: string[]) =>
    Promise.resolve(paths),
  );
  mockedDetectEcosystem.mockImplementation(
    async () =>
      ({
        packageName: vi.fn().mockResolvedValue("crate"),
      }) as any,
  );
});

describe("runner coverage scenarios", () => {
  it("combines per-package changelogs into a CI release and runs afterRelease hooks", async () => {
    const afterRelease = vi.fn();
    const pluginRunner = new PluginRunner([
      {
        name: "release-plugin",
        hooks: {
          afterRelease,
        },
      },
    ]);
    const versions = new Map([
      ["@pubm/core", "1.2.0"],
      ["pubm", "1.2.0"],
    ]);
    mockedDiscoverPackageInfos.mockResolvedValue([
      { name: "@pubm/core", path: "packages/core" },
      { name: "pubm", path: "packages/pubm" },
    ] as any);
    mockedExistsSync.mockImplementation((filePath) =>
      String(filePath).endsWith("packages/core/CHANGELOG.md"),
    );
    mockedReadFileSync.mockReturnValue("# Changelog");
    mockedParseChangelogSection.mockImplementation((_content, version) =>
      version === "1.2.0" ? "Added release notes" : undefined,
    );

    await run(createOptions({ ci: true, versions, pluginRunner }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks[1];
    const afterReleaseTask = tasks[2];
    const releaseCtx: any = {
      version: "1.2.0",
      versions,
      pluginRunner,
    };
    const task = createTask();

    await releaseTask.task(releaseCtx, task);

    expect(task.title).toContain("@pubm/core@1.2.0, pubm@1.2.0");
    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      releaseCtx,
      expect.stringContaining("## @pubm/core v1.2.0"),
    );
    expect(releaseCtx.releaseContext.releaseUrl).toContain("github.com");

    const afterReleaseTaskRecorder = createTask();
    await afterReleaseTask.task(releaseCtx, afterReleaseTaskRecorder);
    expect(afterRelease).toHaveBeenCalledWith(
      releaseCtx,
      releaseCtx.releaseContext,
    );
  });

  it("includes plugin publish targets and creates no-op for unknown registries", async () => {
    const pluginPublish = vi.fn().mockResolvedValue(undefined);
    const pluginRunner = new PluginRunner([
      {
        name: "custom-publisher",
        registries: [
          { packageName: "acme-release", publish: pluginPublish } as any,
        ],
      },
    ]);

    await run(
      createOptions({
        ci: true,
        packages: [{ path: ".", registries: ["custom-registry"] }],
        pluginRunner,
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const publishTask = tasks[0];
    const parentTask = createParentTask();
    const ctx: any = {
      packages: [{ path: ".", registries: ["custom-registry"] }],
      pluginRunner,
    };

    await publishTask.task(ctx, parentTask);

    const subtasks = parentTask.newListr.mock.calls[0][0];
    expect(parentTask.title).toBe("Publishing (2 targets)");
    expect(parentTask.output).toContain("Plugin registry > acme-release");

    const ecosystemParent = createParentTask();
    await subtasks[0].task(ctx, ecosystemParent);
    expect(ecosystemParent.newListr.mock.calls[0][0][0].title).toBe(
      "Publish to custom-registry",
    );

    await subtasks[1].task();
    expect(pluginPublish).toHaveBeenCalledOnce();
  });

  it("builds dry-run crates tasks sequentially during preflight validation", async () => {
    mockedCratesRegistry.orderPackages.mockResolvedValue([
      "rust/crates/lib-b",
      "rust/crates/lib-a",
    ]);
    let ecosystemCall = 0;
    mockedDetectEcosystem.mockImplementation(
      async () =>
        ({
          packageName: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(++ecosystemCall === 1 ? "lib-a" : "lib-b"),
            ),
        }) as any,
    );

    await run(
      createOptions({
        preflight: true,
        packages: [
          { path: ".", registries: ["npm"] },
          { path: "rust/crates/lib-a", registries: ["crates"] },
          { path: "rust/crates/lib-b", registries: ["crates"] },
        ],
      }),
    );

    const pipelineTasks = mockedCreateListr.mock.calls[1][0] as any[];
    const validateTask = pipelineTasks[5];
    const parentTask = createParentTask();
    const ctx: any = {
      packages: [
        { path: ".", registries: ["npm"] },
        { path: "rust/crates/lib-a", registries: ["crates"] },
        { path: "rust/crates/lib-b", registries: ["crates"] },
      ],
      pluginRunner: new PluginRunner([]),
      registries: ["npm", "crates"],
    };

    await validateTask.task(ctx, parentTask);

    const subtasks = parentTask.newListr.mock.calls[0][0];
    expect(parentTask.title).toBe("Validating publish (2 targets)");
    expect(subtasks[1].title).toBe("Rust ecosystem");

    const rustParent = createParentTask();
    await subtasks[1].task(ctx, rustParent);
    const registryTasks = rustParent.newListr.mock.calls[0][0];

    expect(registryTasks[0].title).toBe(
      "Dry-run crates.io publish (sequential)",
    );

    const innerParent = createParentTask();
    registryTasks[0].task(ctx, innerParent);

    expect(mockedCreateCratesDryRunPublishTask).toHaveBeenCalledWith(
      "rust/crates/lib-b",
      ["lib-a", "lib-b"],
    );
    expect(innerParent.newListr.mock.calls[0][1]).toEqual({
      concurrent: false,
    });
  });

  it("handles independent multi-package version bumps with per-package changelogs and tags", async () => {
    const versions = new Map([
      ["@pubm/core", "2.0.0"],
      ["pubm", "2.1.0"],
    ]);
    const pluginRunner = new PluginRunner([]);
    let rollbackHandler: (() => Promise<void>) | undefined;
    mockedAddRollback.mockImplementation((fn: any) => {
      rollbackHandler = fn;
    });
    mockedDiscoverPackageInfos.mockResolvedValue([
      { name: "@pubm/core", path: "packages/core" },
      { name: "pubm", path: "packages/pubm" },
    ] as any);
    mockedReplaceVersionAtPath
      .mockResolvedValueOnce(["/workspace/packages/core/package.json"])
      .mockResolvedValueOnce(["/workspace/packages/pubm/package.json"]);
    mockedReadChangesets.mockReturnValue([{ id: "cs-1" }] as any);
    mockedBuildChangelogEntries
      .mockReturnValueOnce([
        { id: "cs-1", type: "minor", summary: "core" },
      ] as any)
      .mockReturnValueOnce([
        { id: "cs-1", type: "patch", summary: "pubm" },
      ] as any);
    mockedGenerateChangelog
      .mockReturnValueOnce("core changelog")
      .mockReturnValueOnce("pubm changelog");

    await run(
      createOptions({
        versions,
        version: "2.0.0",
        changesetConsumed: true,
        pluginRunner,
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const ctx: any = {
      version: "2.0.0",
      versions,
      changesetConsumed: true,
      pluginRunner,
    };
    const task = createTask();

    await versionTask.task(ctx, task);

    expect(mockedReplaceVersionAtPath).toHaveBeenCalledTimes(2);
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      expect.stringContaining("packages/core"),
      "core changelog",
    );
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      expect.stringContaining("packages/pubm"),
      "pubm changelog",
    );
    expect(mockedDeleteChangesetFiles).toHaveBeenCalled();

    const gitInstance = mockedGit.mock.results.at(-1)?.value as any;
    expect(gitInstance.commit).toHaveBeenCalledWith(
      "@pubm/core@2.0.0, pubm@2.1.0",
    );
    expect(gitInstance.createTag).toHaveBeenCalledWith(
      "@pubm/core@2.0.0",
      "commit-sha",
    );
    expect(gitInstance.createTag).toHaveBeenCalledWith(
      "pubm@2.1.0",
      "commit-sha",
    );

    expect(rollbackHandler).toBeDefined();
    await rollbackHandler?.();
    expect(gitInstance.deleteTag).toHaveBeenCalledWith("@pubm/core@2.0.0");
    expect(gitInstance.deleteTag).toHaveBeenCalledWith("pubm@2.1.0");
  });

  it("handles fixed workspace version bumps and writes a root changelog", async () => {
    const versions = new Map([
      ["@pubm/core", "3.0.0"],
      ["pubm", "3.0.0"],
      ["missing", "3.0.0"],
    ]);
    mockedDiscoverPackageInfos.mockResolvedValue([
      { name: "@pubm/core", path: "packages/core" },
      { name: "pubm", path: "packages/pubm" },
    ] as any);
    mockedReplaceVersionAtPath
      .mockResolvedValueOnce(["/workspace/packages/core/package.json"])
      .mockResolvedValueOnce(["/workspace/packages/pubm/package.json"]);
    mockedReadChangesets.mockReturnValue([{ id: "cs-2" }] as any);
    mockedBuildChangelogEntries
      .mockReturnValueOnce([
        { id: "cs-2", type: "minor", summary: "core" },
      ] as any)
      .mockReturnValueOnce([
        { id: "cs-2", type: "patch", summary: "pubm" },
      ] as any);
    mockedGenerateChangelog.mockReturnValue("root changelog");

    await run(createOptions({ versions, version: "3.0.0" }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const ctx: any = {
      version: "3.0.0",
      versions,
      changesetConsumed: true,
      pluginRunner: new PluginRunner([]),
    };

    await versionTask.task(ctx, createTask());

    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      process.cwd(),
      "root changelog",
    );
    const gitInstance = mockedGit.mock.results.at(-1)?.value as any;
    expect(gitInstance.commit).toHaveBeenCalledWith("v3.0.0");
    expect(gitInstance.createTag).toHaveBeenCalledWith("v3.0.0", "commit-sha");
  });

  it("creates a CI release even when package changelog sections are missing", async () => {
    const versions = new Map([
      ["@pubm/core", "1.2.0"],
      ["missing-pkg", "1.2.0"],
    ]);
    mockedDiscoverPackageInfos.mockResolvedValue([
      { name: "@pubm/core", path: "packages/core" },
    ] as any);
    mockedExistsSync.mockReturnValue(false);

    await run(createOptions({ ci: true, versions }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks[1];
    const releaseCtx: any = {
      version: "1.2.0",
      versions,
      pluginRunner: new PluginRunner([]),
    };

    await releaseTask.task(releaseCtx, createTask());

    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      releaseCtx,
      undefined,
    );
  });

  it("consumes single-package changesets when bumping a standalone release", async () => {
    mockedReadChangesets.mockReturnValue([{ id: "cs-3" }] as any);
    mockedGetPackageJson.mockResolvedValue({ name: "pubm" } as any);
    mockedBuildChangelogEntries.mockReturnValue([
      { id: "cs-3", type: "patch", summary: "bugfix" },
    ] as any);
    mockedGenerateChangelog.mockReturnValue("single changelog");

    await run(createOptions({ version: "4.0.0" }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const ctx: any = {
      version: "4.0.0",
      changesetConsumed: true,
      pluginRunner: new PluginRunner([]),
    };

    await versionTask.task(ctx, createTask());

    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      process.cwd(),
      "single changelog",
    );
    expect(mockedDeleteChangesetFiles).toHaveBeenCalled();
  });

  it("falls back to a generic crate label when registries include crates without package metadata", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run(
      createOptions({ packages: [{ path: ".", registries: ["crates"] }] }),
    );

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("crate"));
  });
});
