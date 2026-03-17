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
vi.mock("../../../src/manifest/write-versions.js", () => ({
  writeVersionsForEcosystem: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../src/ecosystem/catalog.js", () => {
  class MockJsEcosystem {
    packagePath: string;
    constructor(p: string) {
      this.packagePath = p;
    }
    manifestFiles() {
      return ["package.json"];
    }
  }
  class MockRustEcosystem {
    packagePath: string;
    constructor(p: string) {
      this.packagePath = p;
    }
    manifestFiles() {
      return ["Cargo.toml"];
    }
  }
  const descriptors: Record<string, any> = {
    js: {
      key: "js",
      label: "JavaScript ecosystem",
      ecosystemClass: MockJsEcosystem,
    },
    rust: {
      key: "rust",
      label: "Rust ecosystem",
      ecosystemClass: MockRustEcosystem,
    },
  };
  return {
    ecosystemCatalog: {
      get: vi.fn((key: string) => descriptors[key]),
      all: vi.fn(() => Object.values(descriptors)),
    },
  };
});
vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/utils/snapshot.js", () => ({
  generateSnapshotVersion: vi.fn(() => "1.0.0-snapshot-20260316"),
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
  createJsrPublishTask: vi.fn(() => ({
    title: "jsr publish",
    task: vi.fn(),
  })),
}));
vi.mock("../../../src/tasks/crates.js", () => ({
  createCratesPublishTask: vi.fn((packagePath: string) => ({
    title: `crates publish (${packagePath})`,
    task: vi.fn(),
  })),
}));
vi.mock("../../../src/tasks/dry-run-publish.js", () => ({
  createNpmDryRunPublishTask: vi.fn((packagePath: string) => ({
    title: `Dry-run npm publish (${packagePath})`,
    task: vi.fn(),
  })),
  createJsrDryRunPublishTask: vi.fn((packagePath: string) => ({
    title: `Dry-run jsr publish (${packagePath})`,
    task: vi.fn(),
  })),
  createCratesDryRunPublishTask: vi.fn(
    (packagePath: string, siblingPaths?: string[]) => ({
      title: `Dry-run crates publish (${packagePath})`,
      siblingPaths,
      task: vi.fn(),
    }),
  ),
}));
vi.mock("../../../src/utils/cli.js", () => ({
  link: vi.fn((_text: string, url: string) => url),
}));
vi.mock("../../../src/registry/catalog.js", () => {
  const mockCratesRegistry = {
    checkAvailability: vi.fn(),
  };
  const mockNpmRegistry = {
    checkAvailability: vi.fn(),
  };
  const mockJsrRegistry = {
    checkAvailability: vi.fn(),
  };
  const descriptors: Record<string, any> = {
    npm: {
      key: "npm",
      ecosystem: "js",
      label: "npm",
      needsPackageScripts: true,
      concurrentPublish: true,
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
      concurrentPublish: true,
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
      concurrentPublish: false,
      orderPackages: vi.fn((paths: string[]) => Promise.resolve(paths)),
      tokenConfig: {
        envVar: "CARGO_REGISTRY_TOKEN",
        dbKey: "cargo-token",
        ghSecretName: "CARGO_REGISTRY_TOKEN",
        promptLabel: "crates.io API token",
        tokenUrl: "https://crates.io/settings/tokens/new",
        tokenUrlLabel: "crates.io",
      },
      resolveDisplayName: vi.fn(
        async (config: any) =>
          config.packages
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
    __mockCratesDescriptor: descriptors.crates,
  };
});
vi.mock("../../../src/ecosystem/index.js", () => ({
  detectEcosystem: vi.fn(),
}));
vi.mock("../../../src/assets/pipeline.js", () => ({
  runAssetPipeline: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../src/assets/resolver.js", () => ({
  normalizeConfig: vi.fn().mockReturnValue([{ files: [] }]),
  resolveAssets: vi.fn().mockReturnValue([]),
}));
vi.mock("../../../src/registry/jsr.js", () => ({
  JsrClient: { token: undefined },
}));

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildChangelogEntries,
  generateChangelog,
  writeChangelogToFile,
} from "../../../src/changeset/changelog.js";
import { parseChangelogSection } from "../../../src/changeset/changelog-parser.js";
import {
  deleteChangesetFiles,
  readChangesets,
} from "../../../src/changeset/reader.js";
import type { PubmContext } from "../../../src/context.js";
import { detectEcosystem } from "../../../src/ecosystem/index.js";
import { consoleError } from "../../../src/error.js";
import { Git } from "../../../src/git.js";
import { writeVersionsForEcosystem } from "../../../src/manifest/write-versions.js";
import { PluginRunner } from "../../../src/plugin/runner.js";
import { JsrClient } from "../../../src/registry/jsr.js";
import { createCratesDryRunPublishTask } from "../../../src/tasks/dry-run-publish.js";
import { createGitHubRelease } from "../../../src/tasks/github-release.js";
import {
  collectTokens,
  promptGhSecretsSync,
} from "../../../src/tasks/preflight.js";
import { prerequisitesCheckTask } from "../../../src/tasks/prerequisites-check.js";
import { requiredConditionsCheckTask } from "../../../src/tasks/required-conditions-check.js";
import { run } from "../../../src/tasks/runner.js";
import { exec } from "../../../src/utils/exec.js";
import { createListr } from "../../../src/utils/listr.js";
import { openUrl } from "../../../src/utils/open-url.js";
import { getPackageManager } from "../../../src/utils/package-manager.js";
import { addRollback, rollback } from "../../../src/utils/rollback.js";
import { generateSnapshotVersion } from "../../../src/utils/snapshot.js";
import { injectTokensToEnv } from "../../../src/utils/token.js";
import { makeTestContext } from "../../helpers/make-context.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedGit = vi.mocked(Git);
const mockedCreateListr = vi.mocked(createListr);
const mockedCreateGitHubRelease = vi.mocked(createGitHubRelease);
const mockedParseChangelogSection = vi.mocked(parseChangelogSection);
const mockedReadChangesets = vi.mocked(readChangesets);
const mockedDeleteChangesetFiles = vi.mocked(deleteChangesetFiles);
const mockedBuildChangelogEntries = vi.mocked(buildChangelogEntries);
const mockedGenerateChangelog = vi.mocked(generateChangelog);
const mockedWriteChangelogToFile = vi.mocked(writeChangelogToFile);
const mockedWriteVersionsForEcosystem = vi.mocked(writeVersionsForEcosystem);
const mockedDetectEcosystem = vi.mocked(detectEcosystem);
const mockedCratesDescriptor = (
  (await import("../../../src/registry/catalog.js")) as any
).__mockCratesDescriptor;
const mockedCreateCratesDryRunPublishTask = vi.mocked(
  createCratesDryRunPublishTask,
);
const mockedAddRollback = vi.mocked(addRollback);
const mockedRollback = vi.mocked(rollback);
const mockedCollectTokens = vi.mocked(collectTokens);
const mockedPromptGhSecretsSync = vi.mocked(promptGhSecretsSync);
const mockedInjectTokensToEnv = vi.mocked(injectTokensToEnv);
const mockedPrerequisitesCheckTask = vi.mocked(prerequisitesCheckTask);
const mockedRequiredConditionsCheckTask = vi.mocked(
  requiredConditionsCheckTask,
);
const mockedConsoleError = vi.mocked(consoleError);
const mockedGenerateSnapshotVersion = vi.mocked(generateSnapshotVersion);
const mockedGetPackageManager = vi.mocked(getPackageManager);
const mockedExec = vi.mocked(exec);
const mockedOpenUrl = vi.mocked(openUrl);

function createOptions(
  overrides: {
    config?: Partial<PubmContext["config"]>;
    options?: Partial<PubmContext["options"]>;
    runtime?: Partial<PubmContext["runtime"]>;
  } = {},
): PubmContext {
  return makeTestContext({
    config: {
      packages: [
        {
          path: ".",
          name: "pubm",
          version: "1.0.0",
          ecosystem: "js",
          dependencies: [],
          registries: ["npm", "jsr"],
        },
      ],
      ...overrides.config,
    },
    options: overrides.options,
    runtime: {
      versionPlan: {
        mode: "single" as const,
        version: "1.0.0",
        packagePath: ".",
      },
      pluginRunner: new PluginRunner([]),
      ...overrides.runtime,
    },
  });
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
      checkTagExist: vi.fn().mockResolvedValue(false),
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

  mockedExistsSync.mockReturnValue(false);
  mockedReadFileSync.mockReturnValue("");
  mockedCreateGitHubRelease.mockResolvedValue({
    packageName: "pubm",
    version: "1.0.0",
    tag: "v1.0.0",
    releaseUrl: "https://github.com/pubm/pubm/releases/tag/v1.0.0",
    assets: [],
  });
  mockedReadChangesets.mockReturnValue([]);
  mockedBuildChangelogEntries.mockReturnValue([]);
  mockedGenerateChangelog.mockReturnValue("generated");
  mockedWriteVersionsForEcosystem.mockResolvedValue([]);
  mockedCratesDescriptor.orderPackages.mockImplementation((paths: string[]) =>
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
    const pathVersions = new Map([
      ["packages/core", "1.2.0"],
      ["packages/pubm", "1.2.0"],
    ]);
    mockedExistsSync.mockImplementation((filePath) =>
      String(filePath)
        .replace(/\\/g, "/")
        .endsWith("packages/core/CHANGELOG.md"),
    );
    mockedReadFileSync.mockReturnValue("# Changelog");
    mockedParseChangelogSection.mockImplementation((_content, version) =>
      version === "1.2.0" ? "Added release notes" : undefined,
    );

    await run(
      createOptions({
        options: { ci: true },
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.2.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm", "jsr"],
            },
            {
              name: "pubm",
              version: "1.2.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm", "jsr"],
            },
          ],
        },
        runtime: { pluginRunner },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks[1];
    const releaseCtx: any = {
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.2.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
          {
            name: "pubm",
            version: "1.2.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
      runtime: {
        pluginRunner,
        versionPlan: {
          mode: "fixed",
          version: "1.2.0",
          packages: pathVersions,
        },
      },
    };
    const task = createTask();

    await releaseTask.task(releaseCtx, task);

    expect(task.title).toContain("v1.2.0");
    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      releaseCtx,
      expect.objectContaining({
        packageName: "@pubm/core",
        version: "1.2.0",
        tag: "v1.2.0",
        changelogBody: expect.stringContaining("## @pubm/core v1.2.0"),
      }),
    );
    expect(afterRelease).toHaveBeenCalledWith(
      releaseCtx,
      expect.objectContaining({
        packageName: "pubm",
        releaseUrl: expect.stringContaining("github.com"),
      }),
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
        options: { ci: true },
        config: {
          packages: [{ path: ".", registries: ["custom-registry"] as any }],
        },
        runtime: { pluginRunner },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const publishTask = tasks[0];
    const parentTask = createParentTask();
    const ctx: any = {
      config: { packages: [{ path: ".", registries: ["custom-registry"] }] },
      runtime: { pluginRunner },
    };

    await publishTask.task(ctx, parentTask);

    const subtasks = parentTask.newListr.mock.calls[0][0];
    expect(parentTask.title).toBe("Publishing (2 targets)");
    expect(parentTask.output).toContain("Plugin registry > acme-release");

    const ecosystemParent = createParentTask();
    await subtasks[0].task(ctx, ecosystemParent);
    const registryWrapperTask = ecosystemParent.newListr.mock.calls[0][0][0];
    expect(registryWrapperTask.title).toBe("Running custom-registry publish");

    const innerParent = createParentTask();
    registryWrapperTask.task(ctx, innerParent);
    expect(innerParent.newListr.mock.calls[0][0][0].title).toBe(
      "Publish to custom-registry",
    );

    await subtasks[1].task();
    expect(pluginPublish).toHaveBeenCalledOnce();
  });

  it("builds dry-run crates tasks sequentially during preflight validation", async () => {
    mockedCratesDescriptor.orderPackages.mockResolvedValue([
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
        options: { preflight: true },
        config: {
          packages: [
            { path: ".", registries: ["npm"] },
            { path: "rust/crates/lib-a", registries: ["crates"] },
            { path: "rust/crates/lib-b", registries: ["crates"] },
          ],
        },
      }),
    );

    const pipelineTasks = mockedCreateListr.mock.calls[1][0] as any[];
    const validateTask = pipelineTasks[5];
    const parentTask = createParentTask();
    const ctx: any = {
      config: {
        packages: [
          { path: ".", registries: ["npm"] },
          { path: "rust/crates/lib-a", registries: ["crates"] },
          { path: "rust/crates/lib-b", registries: ["crates"] },
        ],
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
      },
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
      ["rust/crates/lib-a", "rust/crates/lib-b"],
    );
    expect(innerParent.newListr.mock.calls[0][1]).toEqual({
      concurrent: false,
    });
  });

  it("handles independent multi-package version bumps with per-package changelogs and tags", async () => {
    const pathVersions = new Map([
      ["packages/core", "2.0.0"],
      ["packages/pubm", "2.1.0"],
    ]);
    const pluginRunner = new PluginRunner([]);
    let rollbackHandler: (() => Promise<void>) | undefined;
    mockedAddRollback.mockImplementation((fn: any) => {
      rollbackHandler = fn;
    });
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);
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
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm", "jsr"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm", "jsr"],
            },
          ],
        },
        runtime: {
          changesetConsumed: true,
          pluginRunner,
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
      runtime: {
        changesetConsumed: true,
        pluginRunner,
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };
    const task = createTask();

    await versionTask.task(ctx, task);

    expect(mockedWriteVersionsForEcosystem).toHaveBeenCalled();
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join("packages", "core")),
      "core changelog",
    );
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join("packages", "pubm")),
      "pubm changelog",
    );
    expect(mockedDeleteChangesetFiles).toHaveBeenCalled();

    const gitInstance = mockedGit.mock.results.at(-1)?.value as any;
    expect(gitInstance.commit).toHaveBeenCalledWith(
      "Version Packages\n\n- @pubm/core: 2.0.0\n- pubm: 2.1.0",
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
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);
    mockedReadChangesets.mockReturnValue([{ id: "cs-2" }] as any);
    mockedBuildChangelogEntries
      .mockReturnValueOnce([
        { id: "cs-2", type: "minor", summary: "core" },
      ] as any)
      .mockReturnValueOnce([
        { id: "cs-2", type: "patch", summary: "pubm" },
      ] as any);
    mockedGenerateChangelog.mockReturnValue("root changelog");

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm", "jsr"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm", "jsr"],
            },
          ],
        },
        runtime: { versions, version: "3.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
      runtime: {
        version: "3.0.0",
        versions,
        changesetConsumed: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "fixed",
          version: "3.0.0",
          packages: versions,
        },
      },
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
    mockedExistsSync.mockReturnValue(false);

    await run(
      createOptions({
        options: { ci: true },
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.2.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm", "jsr"],
            },
          ],
        },
        runtime: { versions },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks[1];
    const releaseCtx: any = {
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.2.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
      runtime: {
        version: "1.2.0",
        versions,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "fixed",
          version: "1.2.0",
          packages: versions,
        },
      },
    };

    await releaseTask.task(releaseCtx, createTask());

    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      releaseCtx,
      expect.objectContaining({
        packageName: "@pubm/core",
        version: "1.2.0",
        tag: "v1.2.0",
        changelogBody: undefined,
      }),
    );
  });

  it("consumes single-package changesets when bumping a standalone release", async () => {
    mockedReadChangesets.mockReturnValue([{ id: "cs-3" }] as any);
    mockedBuildChangelogEntries.mockReturnValue([
      { id: "cs-3", type: "patch", summary: "bugfix" },
    ] as any);
    mockedGenerateChangelog.mockReturnValue("single changelog");

    await run(createOptions({ runtime: { version: "4.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
      runtime: {
        version: "4.0.0",
        changesetConsumed: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "single",
          version: "4.0.0",
          packageName: "pubm",
        },
      },
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
      createOptions({
        config: { packages: [{ path: ".", registries: ["crates"] }] },
      }),
    );

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("crate"));
  });
});

describe("snapshot pipeline", () => {
  it("runs snapshot pipeline and logs success", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run(
      createOptions({
        options: { snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    // The snapshot pipeline calls createListr once for the inner tasks
    expect(mockedCreateListr).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("snapshot"),
    );
  });

  it("executes snapshot test task successfully", async () => {
    mockedGetPackageManager.mockResolvedValue("bun");
    mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

    await run(
      createOptions({
        options: { snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    // Extract the snapshot pipeline tasks from the createListr call
    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const testTask = snapshotTasks[0];
    const task = createTask();

    await testTask.task(
      createOptions({
        options: { testScript: "test", snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
      task,
    );

    expect(task.title).toContain("Running tests");
    expect(mockedExec).toHaveBeenCalledWith("bun", ["run", "test"], {
      throwOnError: true,
    });
  });

  it("executes snapshot build task successfully", async () => {
    mockedGetPackageManager.mockResolvedValue("bun");
    mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

    await run(
      createOptions({
        options: { snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const buildTask = snapshotTasks[1];
    const task = createTask();

    await buildTask.task(
      createOptions({
        options: { buildScript: "build", snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
      task,
    );

    expect(task.title).toContain("Building the project");
    expect(mockedExec).toHaveBeenCalledWith("bun", ["run", "build"], {
      throwOnError: true,
    });
  });

  it("throws when test script fails in snapshot mode", async () => {
    mockedGetPackageManager.mockResolvedValue("bun");
    mockedExec.mockRejectedValue(new Error("test failed"));

    await run(
      createOptions({
        options: { snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const testTask = snapshotTasks[0];

    await expect(
      testTask.task(
        createOptions({
          options: { testScript: "test", snapshot: true },
          config: {
            packages: [
              {
                path: ".",
                name: "pubm",
                version: "1.0.0",
                ecosystem: "js",
                dependencies: [],
                registries: ["npm"],
              },
            ],
          },
        }),
        createTask(),
      ),
    ).rejects.toThrow("Test script 'test' failed.");
  });

  it("throws when build script fails in snapshot mode", async () => {
    mockedGetPackageManager.mockResolvedValue("bun");
    mockedExec.mockRejectedValue(new Error("build failed"));

    await run(
      createOptions({
        options: { snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const buildTask = snapshotTasks[1];

    await expect(
      buildTask.task(
        createOptions({
          options: { buildScript: "build", snapshot: true },
          config: {
            packages: [
              {
                path: ".",
                name: "pubm",
                version: "1.0.0",
                ecosystem: "js",
                dependencies: [],
                registries: ["npm"],
              },
            ],
          },
        }),
        createTask(),
      ),
    ).rejects.toThrow("Build script 'build' failed.");
  });

  it("executes snapshot publish task with snapshot version", async () => {
    mockedGenerateSnapshotVersion.mockReturnValue("1.0.0-snapshot-20260316");
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

    await run(
      createOptions({
        options: { snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const publishTask = snapshotTasks[2];
    const task = createTask();
    const ctx = createOptions({
      options: { snapshot: true },
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
    });

    await publishTask.task(ctx, task);

    expect(task.title).toContain("1.0.0-snapshot-20260316");
    expect(ctx.runtime.versionPlan).toMatchObject({
      mode: "single",
      version: "1.0.0-snapshot-20260316",
    });
    expect(ctx.runtime.tag).toBe("snapshot");
    // writeVersions called to set then restore
    expect(mockedWriteVersionsForEcosystem).toHaveBeenCalledTimes(2);
  });

  it("uses string snapshot tag when snapshot option is a string", async () => {
    mockedGenerateSnapshotVersion.mockReturnValue("1.0.0-beta-20260316");
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

    await run(
      createOptions({
        options: { snapshot: "beta" },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const publishTask = snapshotTasks[2];
    const task = createTask();
    const ctx = createOptions({
      options: { snapshot: "beta" },
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: { version: "1.0.0" },
    });

    await publishTask.task(ctx, task);

    expect(ctx.runtime.tag).toBe("beta");
  });

  it("rejects snapshot for monorepo (multiple packages)", async () => {
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

    await run(
      createOptions({
        options: { snapshot: true },
        config: {
          packages: [
            {
              path: "pkg-a",
              name: "pkg-a",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              path: "pkg-b",
              name: "pkg-b",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const publishTask = snapshotTasks[2];

    await expect(
      publishTask.task(
        createOptions({
          options: { snapshot: true },
          config: {
            packages: [
              {
                path: "pkg-a",
                name: "pkg-a",
                version: "1.0.0",
                ecosystem: "js",
                dependencies: [],
                registries: ["npm"],
              },
              {
                path: "pkg-b",
                name: "pkg-b",
                version: "1.0.0",
                ecosystem: "js",
                dependencies: [],
                registries: ["npm"],
              },
            ],
          },
        }),
        createTask(),
      ),
    ).rejects.toThrow(
      "Snapshot publishing is only supported for single-package projects.",
    );
  });

  it("creates and pushes snapshot tag when preview is not set", async () => {
    mockedGenerateSnapshotVersion.mockReturnValue("1.0.0-snapshot-20260316");
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

    await run(
      createOptions({
        options: { snapshot: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const tagTask = snapshotTasks[3];
    const task = createTask();
    const ctx = createOptions({
      options: { snapshot: true },
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        versionPlan: {
          mode: "single" as const,
          version: "1.0.0-snapshot-20260316",
          packagePath: ".",
        },
      },
    });

    // skip should not skip when preview is not set
    expect(tagTask.skip(ctx)).toBe(false);

    // The tag task creates its own Git instance internally
    const tagGitInstance = {
      latestCommit: vi.fn().mockResolvedValue("head-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return tagGitInstance as any;
    } as any);

    await tagTask.task(ctx, task);

    expect(tagGitInstance.createTag).toHaveBeenCalledWith(
      "v1.0.0-snapshot-20260316",
      "head-sha",
    );
    expect(tagGitInstance.push).toHaveBeenCalledWith("--tags");
  });

  it("skips tag creation when preview is set", async () => {
    await run(
      createOptions({
        options: { snapshot: true, preview: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      }),
    );

    const snapshotTasks = mockedCreateListr.mock.calls[0][0] as any[];
    const tagTask = snapshotTasks[3];
    const ctx = createOptions({
      options: { snapshot: true, preview: true },
    });

    expect(tagTask.skip(ctx)).toBe(true);
  });
});

describe("tag existence check", () => {
  it("prompts to delete existing tag when promptEnabled and user confirms", async () => {
    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const mockPrompt = {
      run: vi.fn().mockResolvedValue(true),
    };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
    };

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
      runtime: {
        version: "5.0.0",
        promptEnabled: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "single",
          version: "5.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, task);

    expect(gitInstance.checkTagExist).toHaveBeenCalledWith("v5.0.0");
    expect(gitInstance.deleteTag).toHaveBeenCalledWith("v5.0.0");
  });

  it("throws when tag exists and promptEnabled but user declines deletion", async () => {
    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const mockPrompt = {
      run: vi.fn().mockResolvedValue(false),
    };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
    };

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
      runtime: {
        version: "5.0.0",
        promptEnabled: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "single",
          version: "5.0.0",
          packageName: "pubm",
        },
      },
    };

    await expect(versionTask.task(ctx, task)).rejects.toThrow(
      "Git tag 'v5.0.0' already exists.",
    );
  });

  it("throws when tag exists and promptEnabled is false", async () => {
    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
      runtime: {
        version: "5.0.0",
        promptEnabled: false,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "single",
          version: "5.0.0",
          packageName: "pubm",
        },
      },
    };

    await expect(versionTask.task(ctx, createTask())).rejects.toThrow(
      "Git tag 'v5.0.0' already exists. Remove it manually or use a different version.",
    );
  });

  it("prompts to delete existing tag in fixed mode", async () => {
    const versions = new Map([
      ["@pubm/core", "3.0.0"],
      ["pubm", "3.0.0"],
    ]);

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "3.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const mockPrompt = {
      run: vi.fn().mockResolvedValue(true),
    };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
    };

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "3.0.0",
        versions,
        promptEnabled: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "fixed",
          version: "3.0.0",
          packages: versions,
        },
      },
    };

    await versionTask.task(ctx, task);

    expect(gitInstance.checkTagExist).toHaveBeenCalledWith("v3.0.0");
    expect(gitInstance.deleteTag).toHaveBeenCalledWith("v3.0.0");
  });

  it("prompts to delete existing tag in independent mode", async () => {
    const versions = new Map([
      ["@pubm/core", "2.0.0"],
      ["pubm", "2.1.0"],
    ]);

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "2.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const mockPrompt = {
      run: vi.fn().mockResolvedValue(true),
    };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
    };

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "2.0.0",
        versions,
        changesetConsumed: true,
        promptEnabled: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "independent",
          packages: versions,
        },
      },
    };

    await versionTask.task(ctx, task);

    expect(gitInstance.checkTagExist).toHaveBeenCalledWith("@pubm/core@2.0.0");
    expect(gitInstance.deleteTag).toHaveBeenCalledWith("@pubm/core@2.0.0");
  });
});

describe("independent release draft", () => {
  it("creates per-package release URLs and opens only the first one", async () => {
    const versions = new Map([
      ["@pubm/core", "2.0.0"],
      ["pubm", "2.1.0"],
    ]);

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "2.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    // Find the release draft task (last task in the pipeline)
    const releaseDraftTask = tasks.find(
      (t: any) =>
        t.title === "Creating release draft on GitHub" ||
        (typeof t.title === "string" && t.title.includes("release draft")),
    );

    expect(releaseDraftTask).toBeDefined();

    const task = createTask();
    const ctx: any = {
      config: {
        releaseDraft: true,
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "2.0.0",
        versions,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "independent",
          packages: versions,
        },
      },
    };

    await releaseDraftTask.task(ctx, task);

    // openUrl should be called exactly once (only the first package)
    expect(mockedOpenUrl).toHaveBeenCalledTimes(1);
    expect(mockedOpenUrl).toHaveBeenCalledWith(
      expect.stringContaining("releases/new"),
    );
  });

  it("creates release draft for single/fixed mode and opens URL", async () => {
    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "pubm",
              version: "1.0.0",
              path: ".",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { version: "4.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseDraftTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("release draft"),
    );
    expect(releaseDraftTask).toBeDefined();

    const task = createTask();
    const ctx: any = {
      config: {
        releaseDraft: true,
        packages: [
          {
            name: "pubm",
            version: "1.0.0",
            path: ".",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "4.0.0",
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "single",
          version: "4.0.0",
          packageName: "pubm",
        },
      },
    };

    await releaseDraftTask.task(ctx, task);

    expect(mockedOpenUrl).toHaveBeenCalledTimes(1);
    expect(mockedOpenUrl).toHaveBeenCalledWith(
      expect.stringContaining("tag=v4.0.0"),
    );
  });
});

describe("preflight pipeline", () => {
  it("collects tokens and injects them, then runs prerequisites and conditions", async () => {
    const tokens = { npm: "tok-npm", jsr: "tok-jsr" };
    mockedCollectTokens.mockResolvedValue(tokens);
    mockedPromptGhSecretsSync.mockResolvedValue(undefined);
    const cleanupFn = vi.fn();
    mockedInjectTokensToEnv.mockReturnValue(cleanupFn);

    // The preflight token collection task is passed to createListr.
    // We need to exercise it.
    await run(
      createOptions({
        options: { preflight: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm", "jsr"],
            },
          ],
        },
      }),
    );

    // First createListr call is for token collection
    const tokenTask = mockedCreateListr.mock.calls[0][0] as any;
    const task = createTask();
    const ctx = createOptions({
      options: { preflight: true },
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm", "jsr"],
          },
        ],
      },
    });

    await tokenTask.task(ctx, task);

    expect(mockedCollectTokens).toHaveBeenCalledWith(["npm", "jsr"], task);
    expect(mockedPromptGhSecretsSync).toHaveBeenCalledWith(tokens, task);
    expect(mockedInjectTokensToEnv).toHaveBeenCalledWith(tokens);
    expect(ctx.runtime.promptEnabled).toBe(false);

    // prerequisites and conditions should have been called
    expect(mockedPrerequisitesCheckTask).toHaveBeenCalled();
    expect(mockedRequiredConditionsCheckTask).toHaveBeenCalled();
  });
});

describe("CI GitHub Release", () => {
  it("creates a single-mode release with root changelog", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("# Changelog");
    mockedParseChangelogSection.mockReturnValue("Single release notes");

    await run(
      createOptions({
        options: { ci: true },
        config: {
          packages: [
            {
              name: "pubm",
              version: "4.0.0",
              path: ".",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: {
          versionPlan: {
            mode: "single" as const,
            version: "4.0.0",
            packagePath: ".",
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks[1];
    const task = createTask();
    const ctx: any = {
      config: {
        packages: [
          {
            name: "pubm",
            version: "4.0.0",
            path: ".",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "single",
          version: "4.0.0",
          packagePath: ".",
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        packageName: "pubm",
        version: "4.0.0",
        tag: "v4.0.0",
        changelogBody: "Single release notes",
      }),
    );
  });

  it("creates independent per-package releases in CI with per-package changelog", async () => {
    const pathVersions = new Map([
      ["packages/core", "2.0.0"],
      ["packages/pubm", "2.1.0"],
    ]);
    mockedExistsSync.mockImplementation((filePath) =>
      String(filePath)
        .replace(/\\/g, "/")
        .endsWith("packages/core/CHANGELOG.md"),
    );
    mockedReadFileSync.mockReturnValue("# Changelog");
    mockedParseChangelogSection.mockImplementation((_content, version) =>
      version === "2.0.0" ? "Core release notes" : undefined,
    );

    await run(
      createOptions({
        options: { ci: true },
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "2.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              name: "pubm",
              version: "2.1.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: {
          versionPlan: {
            mode: "independent" as const,
            packages: pathVersions,
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks[1];
    const task = createTask();
    const ctx: any = {
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "2.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            name: "pubm",
            version: "2.1.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(mockedCreateGitHubRelease).toHaveBeenCalledTimes(2);
    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        packageName: "@pubm/core",
        version: "2.0.0",
        tag: "@pubm/core@2.0.0",
        changelogBody: "Core release notes",
      }),
    );
    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        packageName: "pubm",
        version: "2.1.0",
        tag: "pubm@2.1.0",
        changelogBody: undefined,
      }),
    );
  });
});

describe("post-publish", () => {
  it("falls back to --tags when push --follow-tags fails (protected branch)", async () => {
    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const pushTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("Pushing tags"),
    );
    expect(pushTask).toBeDefined();

    const gitInstance = {
      push: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const task = createTask();
    const ctx: any = {
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "5.0.0",
        pluginRunner: new PluginRunner([]),
        versionPlan: { mode: "single", version: "5.0.0", packageName: "pubm" },
      },
    };

    await pushTask.task(ctx, task);

    expect(gitInstance.push).toHaveBeenCalledWith("--follow-tags");
    expect(gitInstance.push).toHaveBeenCalledWith("--tags");
    expect(task.title).toContain("protected");
  });

  it("runs afterPublish plugin hooks in post-publish task", async () => {
    const afterPublish = vi.fn();
    const pluginRunner = new PluginRunner([
      { name: "test-plugin", hooks: { afterPublish } },
    ]);

    await run(
      createOptions({
        runtime: { version: "5.0.0", pluginRunner },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const postPublishTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("post-publish"),
    );
    expect(postPublishTask).toBeDefined();

    const task = createTask();
    const ctx: any = {
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "5.0.0",
        pluginRunner,
        versionPlan: { mode: "single", version: "5.0.0", packageName: "pubm" },
      },
    };

    await postPublishTask.task(ctx, task);

    expect(afterPublish).toHaveBeenCalledWith(ctx);
  });

  it("creates a release draft for non-independent mode with a root changelog", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("# Changelog");
    mockedParseChangelogSection.mockReturnValue("release notes");

    await run(createOptions({ runtime: { version: "6.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseDraftTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("release draft"),
    );
    expect(releaseDraftTask).toBeDefined();

    const task = createTask();
    const ctx: any = {
      config: {
        releaseDraft: true,
        packages: [
          {
            name: "pubm",
            version: "1.0.0",
            path: ".",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "6.0.0",
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "fixed",
          version: "6.0.0",
          packages: new Map([["pubm", "6.0.0"]]),
        },
      },
    };

    await releaseDraftTask.task(ctx, task);

    expect(mockedOpenUrl).toHaveBeenCalledTimes(1);
    expect(mockedOpenUrl).toHaveBeenCalledWith(
      expect.stringContaining("tag=v6.0.0"),
    );
  });
});

describe("error/catch path", () => {
  it("triggers rollback, plugin error hooks, and process.exit on error", async () => {
    const onRollback = vi.fn();
    const onError = vi.fn();
    const pluginRunner = new PluginRunner([
      {
        name: "error-plugin",
        hooks: { onRollback, onError },
      },
    ]);

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    // Make createListr.run throw an error
    mockedCreateListr.mockImplementation(
      (tasks: any) =>
        ({
          run: vi.fn().mockRejectedValue(new Error("publish failed")),
          tasks,
        }) as any,
    );

    await run(
      createOptions({
        runtime: { version: "1.0.0", pluginRunner },
      }),
    );

    expect(mockedConsoleError).toHaveBeenCalled();
    expect(mockedRollback).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

describe("publishOnly mode", () => {
  it("runs only the publish task without test, build, or version bump", async () => {
    await run(
      createOptions({
        options: { publishOnly: true },
        config: {
          packages: [
            {
              path: ".",
              name: "pubm",
              version: "1.0.0",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { version: "1.0.0" },
      }),
    );

    // publishOnly passes a single task object (not array) to createListr
    const taskDef = mockedCreateListr.mock.calls[0][0] as any;
    expect(taskDef.title).toBe("Publishing");

    const parentTask = createParentTask();
    const ctx: any = {
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "1.0.0",
        pluginRunner: new PluginRunner([]),
        versionPlan: { mode: "single", version: "1.0.0", packageName: "pubm" },
      },
    };

    await taskDef.task(ctx, parentTask);

    expect(parentTask.title).toContain("Publishing");
    expect(parentTask.newListr).toHaveBeenCalled();
  });
});

describe("normal pipeline test and build tasks", () => {
  it("runs test task with plugin hooks and throws on failure", async () => {
    const beforeTest = vi.fn();
    const pluginRunner = new PluginRunner([
      { name: "test-plugin", hooks: { beforeTest } },
    ]);
    mockedGetPackageManager.mockResolvedValue("bun");
    mockedExec.mockRejectedValue(new Error("tests failed"));

    await run(
      createOptions({
        runtime: { version: "1.0.0", pluginRunner },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const testTask = tasks[0];
    const task = createTask();
    const ctx: any = {
      options: { testScript: "test", ci: false },
      runtime: { pluginRunner },
    };

    await expect(testTask.task(ctx, task)).rejects.toThrow(
      "Test script 'test' failed.",
    );
    expect(beforeTest).toHaveBeenCalledWith(ctx);
  });

  it("runs build task with plugin hooks and throws on failure", async () => {
    const beforeBuild = vi.fn();
    const pluginRunner = new PluginRunner([
      { name: "build-plugin", hooks: { beforeBuild } },
    ]);
    mockedGetPackageManager.mockResolvedValue("bun");
    mockedExec.mockRejectedValue(new Error("build failed"));

    await run(
      createOptions({
        runtime: { version: "1.0.0", pluginRunner },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const buildTask = tasks[1];
    const task = createTask();
    const ctx: any = {
      options: { buildScript: "build", ci: false },
      runtime: { pluginRunner },
    };

    await expect(buildTask.task(ctx, task)).rejects.toThrow(
      "Build script 'build' failed.",
    );
    expect(beforeBuild).toHaveBeenCalledWith(ctx);
  });

  it("runs test and build tasks successfully with afterTest and afterBuild hooks", async () => {
    const afterTest = vi.fn();
    const afterBuild = vi.fn();
    const pluginRunner = new PluginRunner([
      { name: "hooks-plugin", hooks: { afterTest, afterBuild } },
    ]);
    mockedGetPackageManager.mockResolvedValue("bun");
    mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

    await run(
      createOptions({
        runtime: { version: "1.0.0", pluginRunner },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const testTask = tasks[0];
    const buildTask = tasks[1];
    const ctx: any = {
      options: { testScript: "test", buildScript: "build", ci: false },
      runtime: { pluginRunner },
    };

    await testTask.task(ctx, createTask());
    expect(afterTest).toHaveBeenCalledWith(ctx);

    await buildTask.task(ctx, createTask());
    expect(afterBuild).toHaveBeenCalledWith(ctx);
  });
});

describe("version bump rollback", () => {
  it("rollback handler deletes tag for single mode", async () => {
    let rollbackHandler: (() => Promise<void>) | undefined;
    mockedAddRollback.mockImplementation((fn: any) => {
      rollbackHandler = fn;
    });

    await run(createOptions({ runtime: { version: "7.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(false),
      status: vi.fn().mockResolvedValue(""),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "7.0.0",
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "single",
          version: "7.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    expect(rollbackHandler).toBeDefined();
    await rollbackHandler?.();

    // After commit and tag creation, rollback should delete tag and reset
    expect(gitInstance.deleteTag).toHaveBeenCalledWith("v7.0.0");
    expect(gitInstance.reset).toHaveBeenCalledWith("HEAD^", "--hard");
  });

  it("rollback handler handles dirty working tree with stash", async () => {
    let rollbackHandler: (() => Promise<void>) | undefined;
    mockedAddRollback.mockImplementation((fn: any) => {
      rollbackHandler = fn;
    });

    await run(createOptions({ runtime: { version: "7.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(false),
      status: vi.fn().mockResolvedValue("M package.json"),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "7.0.0",
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "single",
          version: "7.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    expect(rollbackHandler).toBeDefined();
    await rollbackHandler?.();

    expect(gitInstance.stash).toHaveBeenCalled();
    expect(gitInstance.popStash).toHaveBeenCalled();
  });
});

describe("tag existence in fixed and independent modes", () => {
  it("throws when tag exists in fixed mode and promptEnabled is false", async () => {
    const versions = new Map([
      ["@pubm/core", "3.0.0"],
      ["pubm", "3.0.0"],
    ]);

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "3.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "3.0.0",
        versions,
        promptEnabled: false,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "fixed",
          version: "3.0.0",
          packages: versions,
        },
      },
    };

    await expect(versionTask.task(ctx, createTask())).rejects.toThrow(
      "Git tag 'v3.0.0' already exists. Remove it manually or use a different version.",
    );
  });

  it("throws when tag exists in fixed mode and user declines deletion", async () => {
    const versions = new Map([
      ["@pubm/core", "3.0.0"],
      ["pubm", "3.0.0"],
    ]);

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "3.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const mockPrompt = { run: vi.fn().mockResolvedValue(false) };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
    };

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "3.0.0",
        versions,
        promptEnabled: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "fixed",
          version: "3.0.0",
          packages: versions,
        },
      },
    };

    await expect(versionTask.task(ctx, task)).rejects.toThrow(
      "Git tag 'v3.0.0' already exists.",
    );
  });

  it("throws when tag exists in independent mode and promptEnabled is false", async () => {
    const versions = new Map([
      ["@pubm/core", "2.0.0"],
      ["pubm", "2.1.0"],
    ]);

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "2.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "2.0.0",
        versions,
        promptEnabled: false,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "independent",
          packages: versions,
        },
      },
    };

    await expect(versionTask.task(ctx, createTask())).rejects.toThrow(
      "Git tag '@pubm/core@2.0.0' already exists. Remove it manually or use a different version.",
    );
  });

  it("throws when tag exists in independent mode and user declines", async () => {
    const versions = new Map([
      ["@pubm/core", "2.0.0"],
      ["pubm", "2.1.0"],
    ]);

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "2.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      checkTagExist: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const mockPrompt = { run: vi.fn().mockResolvedValue(false) };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
    };

    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "2.0.0",
        versions,
        changesetConsumed: true,
        promptEnabled: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "independent",
          packages: versions,
        },
      },
    };

    await expect(versionTask.task(ctx, task)).rejects.toThrow(
      "Git tag '@pubm/core@2.0.0' already exists.",
    );
  });
});

describe("version plan formatting fallbacks", () => {
  it("formats version summary from versions map when no versionPlan", async () => {
    const versions = new Map([
      ["@pubm/core", "2.0.0"],
      ["pubm", "2.1.0"],
    ]);

    await run(
      createOptions({
        options: { ci: true },
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "2.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "2.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks[1];
    const task = createTask();
    // No versionPlan but versions has > 1 entries
    const ctx: any = {
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "2.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "2.0.0",
        versions,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "fixed",
          version: "2.0.0",
          packages: versions,
        },
      },
    };

    await releaseTask.task(ctx, task);

    // Just verify it doesn't crash and creates a release
    expect(mockedCreateGitHubRelease).toHaveBeenCalled();
  });
});

describe("skip conditions", () => {
  it("skips version bump task when preview is set", async () => {
    await run(
      createOptions({
        options: { preview: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const ctx: any = {
      options: { preview: true },
      runtime: {
        version: "1.0.0",
        versionPlan: { mode: "single", version: "1.0.0", packageName: "pubm" },
      },
    };

    // The skip function should return true for preview mode
    expect(versionTask.skip(ctx)).toBe(true);
  });

  it("skips publish task when skipPublish is set", async () => {
    await run(
      createOptions({
        options: { skipPublish: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const publishTask = tasks.find(
      (t: any) => t.title === "Publishing" && typeof t.skip === "function",
    );
    expect(publishTask).toBeDefined();

    const ctx: any = {
      options: { skipPublish: true },
    };
    expect(publishTask.skip(ctx)).toBe(true);
  });

  it("skips release draft when skipReleaseDraft is set", async () => {
    await run(
      createOptions({
        options: { skipReleaseDraft: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseDraftTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("release draft"),
    );
    expect(releaseDraftTask).toBeDefined();

    const ctx: any = {
      options: { skipReleaseDraft: true },
    };
    expect(releaseDraftTask.skip(ctx)).toBe(true);
  });

  it("skips push tags task when preview is set", async () => {
    await run(
      createOptions({
        options: { preview: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const pushTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("Pushing tags"),
    );
    expect(pushTask).toBeDefined();

    const ctx: any = {
      options: { preview: true },
    };
    expect(pushTask.skip(ctx)).toBe(true);
  });
});

describe("fixed mode changeset with empty entries", () => {
  it("does not write changelog when no entries match in fixed mode", async () => {
    const versions = new Map([
      ["@pubm/core", "5.0.0"],
      ["pubm", "5.0.0"],
    ]);
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);
    mockedReadChangesets.mockReturnValue([{ id: "cs-5" }] as any);
    mockedBuildChangelogEntries.mockReturnValue([]);

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: { versions, version: "5.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        version: "5.0.0",
        versions,
        changesetConsumed: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "fixed",
          version: "5.0.0",
          packages: versions,
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // Since all entries are empty, changelog should not be written
    expect(mockedWriteChangelogToFile).not.toHaveBeenCalled();
    expect(mockedDeleteChangesetFiles).toHaveBeenCalled();
  });
});

describe("independent changeset with empty entries for some packages", () => {
  it("only writes changelog for packages with entries", async () => {
    const pathVersions = new Map([
      ["packages/core", "3.0.0"],
      ["packages/pubm", "3.1.0"],
    ]);
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);
    mockedReadChangesets.mockReturnValue([{ id: "cs-6" }] as any);
    mockedBuildChangelogEntries
      .mockReturnValueOnce([
        { id: "cs-6", type: "major", summary: "breaking" },
      ] as any)
      .mockReturnValueOnce([]);
    mockedGenerateChangelog.mockReturnValue("core only changelog");

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "@pubm/core",
              version: "1.0.0",
              path: "packages/core",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
            {
              name: "pubm",
              version: "1.0.0",
              path: "packages/pubm",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: {
          versionPlan: {
            mode: "independent" as const,
            packages: pathVersions,
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            name: "@pubm/core",
            version: "1.0.0",
            path: "packages/core",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            name: "pubm",
            version: "1.0.0",
            path: "packages/pubm",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        changesetConsumed: true,
        pluginRunner: new PluginRunner([]),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // Only core's changelog should be written
    expect(mockedWriteChangelogToFile).toHaveBeenCalledTimes(1);
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join("packages", "core")),
      "core only changelog",
    );
  });
});
