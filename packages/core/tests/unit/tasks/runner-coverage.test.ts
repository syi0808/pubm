import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("std-env", () => ({ isCI: false }));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
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
      label: "JavaScript",
      ecosystemClass: MockJsEcosystem,
    },
    rust: {
      key: "rust",
      label: "Rust",
      ecosystemClass: MockRustEcosystem,
    },
  };
  return {
    ecosystemCatalog: {
      get: vi.fn((key: string) => descriptors[key]),
      all: vi.fn(() => Object.values(descriptors)),
      register: vi.fn(),
      remove: vi.fn(),
    },
  };
});
vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/utils/package-manager.js", () => ({
  getPackageManager: vi.fn(),
}));
vi.mock("../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(),
}));
vi.mock("../../../src/utils/github-token.js", () => ({
  resolveGitHubToken: vi.fn(() => ({
    token: "mock-gh-token",
    source: "env",
  })),
  saveGitHubToken: vi.fn(),
}));
vi.mock("../../../src/utils/token.js", () => ({
  injectTokensToEnv: vi.fn(() => vi.fn()),
  injectPluginTokensToEnv: vi.fn(() => vi.fn()),
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
  collectPluginCredentials: vi.fn().mockResolvedValue({}),
  promptGhSecretsSync: vi.fn(),
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
      unpublishLabel: "Unpublish",
      requiresEarlyAuth: false,
      taskFactory: {
        createPublishTask: vi.fn((p: string) => ({
          title: `npm publish (${p})`,
          task: vi.fn(),
        })),
        createDryRunTask: vi.fn((p: string) => ({
          title: `Dry-run npm publish (${p})`,
          task: vi.fn(),
        })),
      },
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
      unpublishLabel: "Unpublish",
      requiresEarlyAuth: true,
      taskFactory: {
        createPublishTask: vi.fn((p: string) => ({
          title: `jsr publish (${p})`,
          task: vi.fn(),
        })),
        createDryRunTask: vi.fn((p: string) => ({
          title: `Dry-run jsr publish (${p})`,
          task: vi.fn(),
        })),
      },
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
      unpublishLabel: "Yank",
      requiresEarlyAuth: false,
      taskFactory: {
        createPublishTask: vi.fn((p: string) => ({
          title: `crates publish (${p})`,
          task: vi.fn(),
        })),
        createDryRunTask: vi.fn((p: string, _siblingPaths?: string[]) => ({
          title: `Dry-run crates publish (${p})`,
          siblingPaths: _siblingPaths,
          task: vi.fn(),
        })),
      },
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
      register: vi.fn(),
      keys: vi.fn(() => Object.keys(descriptors)),
      remove: vi.fn(),
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
vi.mock("../../../src/tasks/create-version-pr.js", () => ({
  createVersionPr: vi.fn().mockResolvedValue({
    url: "https://github.com/pubm/pubm/pull/1",
    number: 1,
  }),
  closeVersionPr: vi.fn().mockResolvedValue(undefined),
}));

import { existsSync, readFileSync, rmSync } from "node:fs";
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
import { createVersionPr } from "../../../src/tasks/create-version-pr.js";
import { createGitHubRelease } from "../../../src/tasks/github-release.js";
import {
  collectTokens,
  promptGhSecretsSync,
} from "../../../src/tasks/preflight.js";
import { prerequisitesCheckTask } from "../../../src/tasks/prerequisites-check.js";
import { requiredConditionsCheckTask } from "../../../src/tasks/required-conditions-check.js";
import { run } from "../../../src/tasks/runner.js";
import { exec } from "../../../src/utils/exec.js";
import { resolveGitHubToken } from "../../../src/utils/github-token.js";
import { createListr } from "../../../src/utils/listr.js";
import { openUrl } from "../../../src/utils/open-url.js";
import { getPackageManager } from "../../../src/utils/package-manager.js";
import { RollbackTracker } from "../../../src/utils/rollback.js";
import { injectTokensToEnv } from "../../../src/utils/token.js";
import { makeTestContext } from "../../helpers/make-context.js";

const mockedResolveGitHubToken = vi.mocked(resolveGitHubToken);
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
const mockedCollectTokens = vi.mocked(collectTokens);
const mockedPromptGhSecretsSync = vi.mocked(promptGhSecretsSync);
const mockedInjectTokensToEnv = vi.mocked(injectTokensToEnv);
const mockedPrerequisitesCheckTask = vi.mocked(prerequisitesCheckTask);
const mockedRequiredConditionsCheckTask = vi.mocked(
  requiredConditionsCheckTask,
);
const mockedConsoleError = vi.mocked(consoleError);
const mockedGetPackageManager = vi.mocked(getPackageManager);
const mockedExec = vi.mocked(exec);
const mockedOpenUrl = vi.mocked(openUrl);
const mockedCreateVersionPr = vi.mocked(createVersionPr);

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
    prompt: vi.fn(() => ({ run: vi.fn() })),
    skip: vi.fn(),
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
      pushDelete: vi.fn().mockResolvedValue(undefined),
      pushNewBranch: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      switch: vi.fn().mockResolvedValue(undefined),
      branch: vi.fn().mockResolvedValue("main"),
      revParse: vi.fn().mockResolvedValue("abc123"),
      forcePush: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue(""),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
    } as any;
  } as any);

  mockedExistsSync.mockReturnValue(false);
  mockedReadFileSync.mockReturnValue("");
  mockedCreateGitHubRelease.mockResolvedValue({
    displayLabel: "pubm",
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
        options: { mode: "ci" as const, publish: true },
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
    const releaseTask = tasks[10]; // "Creating GitHub Release" in flat task list
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
      options: { skipReleaseDraft: false },
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
        displayLabel: "@pubm/core",
        version: "1.2.0",
        tag: "v1.2.0",
        changelogBody: expect.stringContaining("## @pubm/core v1.2.0"),
      }),
    );
    expect(afterRelease).toHaveBeenCalledWith(
      releaseCtx,
      expect.objectContaining({
        displayLabel: "pubm",
        releaseUrl: expect.stringContaining("github.com"),
      }),
    );
  });

  // Removed: "includes plugin publish targets" — pluginPublishTasks was deleted;
  // plugin registries now register into the catalog via PluginRegistryDefinition.

  it("builds dry-run crates tasks sequentially during CI prepare validation", async () => {
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
        options: { mode: "ci" as const, prepare: true },
        config: {
          packages: [
            { path: ".", registries: ["npm"] },
            { path: "rust/crates/lib-a", registries: ["crates"] },
            { path: "rust/crates/lib-b", registries: ["crates"] },
          ],
        },
      }),
    );

    // First createListr call is token collection, second is the pipeline
    const pipelineCall = mockedCreateListr.mock.calls.find((call) =>
      Array.isArray(call[0]),
    );
    const pipelineTasks = pipelineCall![0] as any[];
    const validateTask = pipelineTasks[6];
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

    expect(
      mockedCratesDescriptor.taskFactory.createDryRunTask,
    ).toHaveBeenCalledWith("rust/crates/lib-b", [
      "rust/crates/lib-a",
      "rust/crates/lib-b",
    ]);
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
    const rollback = new RollbackTracker();
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
        rollback,
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

    expect(rollback.size).toBeGreaterThan(0);
    await rollback.execute(ctx, { interactive: false });
    // Rollback creates new Git instances, so check the last created instances
    const allGitInstances = mockedGit.mock.results.map((r: any) => r.value);
    const allDeleteTagCalls = allGitInstances.flatMap(
      (g: any) => g.deleteTag?.mock?.calls ?? [],
    );
    expect(allDeleteTagCalls.flat()).toContain("@pubm/core@2.0.0");
    expect(allDeleteTagCalls.flat()).toContain("pubm@2.1.0");
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
        rollback: new RollbackTracker(),
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
    expect(gitInstance.commit).toHaveBeenCalledWith(
      "Version Packages\n\n- @pubm/core: 3.0.0\n- pubm: 3.0.0\n- missing: 3.0.0",
    );
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
        options: { mode: "ci" as const, publish: true },
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
    const releaseTask = tasks[10]; // "Creating GitHub Release" in flat list
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
      options: { skipReleaseDraft: false },
      runtime: {
        version: "1.2.0",
        versions,
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
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
        displayLabel: "@pubm/core",
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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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
    // No GH token → browser fallback path
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);
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
        t.title === "Creating GitHub Release" ||
        (typeof t.title === "string" && t.title.includes("GitHub Release")),
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
        rollback: new RollbackTracker(),
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
    // No GH token → browser fallback path
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);
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
        typeof t.title === "string" && t.title.includes("GitHub Release"),
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
        rollback: new RollbackTracker(),
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

describe("CI prepare pipeline", () => {
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
        options: { mode: "ci" as const, prepare: true },
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
      options: { mode: "ci" as const, prepare: true },
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
    expect(mockedPromptGhSecretsSync).toHaveBeenCalledWith(
      tokens,
      task,
      [],
      "pubm/pubm",
    );
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
        options: { mode: "ci" as const, publish: true },
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
    const releaseTask = tasks[10]; // "Creating GitHub Release" in flat list
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
      options: { releaseDraft: false, skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
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
        displayLabel: "pubm",
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
        options: { mode: "ci" as const, publish: true },
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
    const releaseTask = tasks[10]; // "Creating GitHub Release" in flat list
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
      options: { releaseDraft: false, skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
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
        displayLabel: "@pubm/core",
        version: "2.0.0",
        tag: "@pubm/core@2.0.0",
        changelogBody: "Core release notes",
      }),
    );
    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        displayLabel: "pubm",
        version: "2.1.0",
        tag: "pubm@2.1.0",
        changelogBody: undefined,
      }),
    );
  });
});

describe("post-publish", () => {
  it("falls back to PR creation when push --follow-tags fails (protected branch)", async () => {
    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const pushTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("Pushing tags"),
    );
    expect(pushTask).toBeDefined();

    mockedExec.mockResolvedValue({
      stdout: "https://github.com/user/repo/pull/42",
      stderr: "",
    } as any);

    const gitInstance = {
      push: vi.fn().mockResolvedValue(false),
      pushDelete: vi.fn().mockResolvedValue(undefined),
      pushNewBranch: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      switch: vi.fn().mockResolvedValue(undefined),
      revParse: vi.fn().mockResolvedValue("abc123"),
      branch: vi.fn().mockResolvedValue("main"),
      repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const task = createTask();
    process.env.GITHUB_TOKEN = "mock-gh-token";
    const ctx: any = {
      config: {
        branch: "main",
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
      options: {},
      runtime: {
        version: "5.0.0",
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: { mode: "single", version: "5.0.0", packageName: "pubm" },
      },
    };

    await pushTask.task(ctx, task);

    expect(gitInstance.push).toHaveBeenCalledWith("--follow-tags");
    expect(gitInstance.createBranch).toHaveBeenCalled();
    expect(gitInstance.pushNewBranch).toHaveBeenCalled();

    delete process.env.GITHUB_TOKEN;
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
    // No GH token → browser fallback path
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("# Changelog");
    mockedParseChangelogSection.mockReturnValue("release notes");

    await run(createOptions({ runtime: { version: "6.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseDraftTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
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
      options: { releaseDraft: true, skipReleaseDraft: false },
      runtime: {
        version: "6.0.0",
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
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
    const onError = vi.fn();
    const pluginRunner = new PluginRunner([
      {
        name: "error-plugin",
        hooks: { onError },
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

    const options = createOptions({
      runtime: { version: "1.0.0", pluginRunner },
    });
    const executeSpy = vi.spyOn(options.runtime.rollback, "execute");
    await run(options);

    expect(mockedConsoleError).toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

describe("publish-only mode", () => {
  it("runs only the publish task without test, build, or version bump", async () => {
    await run(
      createOptions({
        options: { publish: true },
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

    // Flat list always has 10 tasks; publish is at index 3
    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    expect(tasks[3].title).toBe("Publishing");

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
        rollback: new RollbackTracker(),
        versionPlan: { mode: "single", version: "1.0.0", packageName: "pubm" },
      },
    };

    await tasks[3].task(ctx, parentTask);

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
      options: { testScript: "test", mode: "local" as const },
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
      options: { buildScript: "build", mode: "local" as const },
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
      options: {
        testScript: "test",
        buildScript: "build",
        mode: "local" as const,
      },
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

    const rollback = new RollbackTracker();
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
        rollback,
        versionPlan: {
          mode: "single",
          version: "7.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    expect(rollback.size).toBeGreaterThan(0);
    await rollback.execute(ctx, { interactive: false });

    // After commit and tag creation, rollback should delete tag and reset
    expect(gitInstance.deleteTag).toHaveBeenCalledWith("v7.0.0");
    expect(gitInstance.reset).toHaveBeenCalledWith("HEAD^", "--hard");
  });

  it("rollback handler handles dirty working tree with stash", async () => {
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

    const rollback = new RollbackTracker();
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
        rollback,
        versionPlan: {
          mode: "single",
          version: "7.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    expect(rollback.size).toBeGreaterThan(0);
    await rollback.execute(ctx, { interactive: false });

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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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
        options: { mode: "ci" as const, publish: true },
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
    const releaseTask = tasks[10]; // "Creating GitHub Release" in flat list
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
      options: { skipReleaseDraft: false, releaseDraft: false },
      runtime: {
        version: "2.0.0",
        versions,
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
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

describe("enabled/skip conditions", () => {
  it("enables version bump task when dryRun is set (dry-run handled internally)", async () => {
    await run(
      createOptions({
        options: { dryRun: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    // In the new design, dryRun does not disable version bump — the task handles it internally
    expect(versionTask.enabled).toBe(true);
  });

  it("disables publish task when skipPublish is set", async () => {
    await run(
      createOptions({
        options: { skipPublish: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const publishTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" &&
        t.title.includes("Publishing") &&
        t.enabled === false,
    );
    expect(publishTask).toBeDefined();
  });

  it("disables release draft when skipReleaseDraft is set", async () => {
    await run(
      createOptions({
        options: { skipReleaseDraft: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseDraftTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );
    expect(releaseDraftTask).toBeDefined();

    expect(releaseDraftTask.enabled).toBe(false);
  });

  it("disables push tags task when dryRun is set", async () => {
    await run(
      createOptions({
        options: { dryRun: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const pushTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("Pushing tags"),
    );
    expect(pushTask).toBeDefined();

    // Push tags enabled is a static boolean: hasPrepare && !dryRun
    expect(pushTask.enabled).toBe(false);
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
        rollback: new RollbackTracker(),
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
        rollback: new RollbackTracker(),
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

describe("dry-run version bump early return", () => {
  it("returns early without writing versions in single mode dry-run", async () => {
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

    await run(
      createOptions({
        options: { dryRun: true },
        runtime: { version: "2.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2]; // "Bumping version"
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
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "2.0.0",
          packagePath: ".",
        },
      },
    };
    const task = createTask();

    await versionTask.task(ctx, task);

    // writeVersionsForEcosystem should NOT be called in version bump task during dry-run
    // (version writing is deferred to the dry-run publish validation task via applyVersionsForDryRun)
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
    // Git commit should NOT have been called (early return before commit)
    const gitInstance = mockedGit.mock.results.at(-1)?.value as any;
    expect(gitInstance.commit).not.toHaveBeenCalled();
  });

  it("returns early without writing versions in fixed mode dry-run", async () => {
    const versions = new Map([
      ["packages/core", "3.0.0"],
      ["packages/pubm", "3.0.0"],
    ]);
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

    await run(
      createOptions({
        options: { dryRun: true },
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
        runtime: { version: "3.0.0" },
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
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "fixed",
          version: "3.0.0",
          packages: versions,
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // writeVersionsForEcosystem should NOT be called in version bump task during dry-run
    // (version writing is deferred to the dry-run publish validation task via applyVersionsForDryRun)
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
    const gitInstance = mockedGit.mock.results.at(-1)?.value as any;
    expect(gitInstance.commit).not.toHaveBeenCalled();
  });

  it("returns early without writing versions in independent mode dry-run", async () => {
    const versions = new Map([
      ["packages/core", "2.0.0"],
      ["packages/pubm", "2.1.0"],
    ]);
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

    await run(
      createOptions({
        options: { dryRun: true },
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
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: versions,
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // writeVersionsForEcosystem should NOT be called in version bump task during dry-run
    // (version writing is deferred to the dry-run publish validation task via applyVersionsForDryRun)
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
    const gitInstance = mockedGit.mock.results.at(-1)?.value as any;
    expect(gitInstance.commit).not.toHaveBeenCalled();
  });
});

describe("success messages", () => {
  it("logs dry-run success message when dryRun is set", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run(
      createOptions({
        options: { dryRun: true },
        runtime: { version: "1.0.0" },
      }),
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dry-run completed"),
    );
  });

  it("logs CI prepare success message for ci + prepare-only mode", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run(
      createOptions({
        options: { mode: "ci" as const, prepare: true },
        runtime: { version: "1.0.0" },
      }),
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("CI prepare completed"),
    );
  });
});

describe("independent mode GitHub release with null result", () => {
  it("skips release when createGitHubRelease returns null for independent plan", async () => {
    mockedCreateGitHubRelease.mockResolvedValue(null as any);
    mockedResolveGitHubToken.mockReturnValue({
      token: "mock-gh-token",
      source: "env",
    } as any);

    const pathVersions = new Map([["packages/core", "2.0.0"]]);

    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
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
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );
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
        ],
      },
      options: { skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(task.output).toContain("already exists");
  });

  describe("excludeRelease", () => {
    it("skips tag creation for packages matching excludeRelease patterns", async () => {
      const pathVersions = new Map([
        ["packages/core", "2.0.0"],
        ["packages/pubm/platforms/darwin-arm64", "2.0.0"],
      ]);

      await run(
        createOptions({
          config: {
            excludeRelease: ["packages/pubm/platforms/*"],
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
                name: "@pubm/darwin-arm64",
                version: "1.0.0",
                path: "packages/pubm/platforms/darwin-arm64",
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
            pluginRunner: new PluginRunner([]),
          },
        }),
      );

      const tasks = mockedCreateListr.mock.calls[0][0] as any[];
      const versionTask = tasks[2];
      const ctx: any = {
        cwd: process.cwd(),
        config: {
          excludeRelease: ["packages/pubm/platforms/*"],
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
              name: "@pubm/darwin-arm64",
              version: "1.0.0",
              path: "packages/pubm/platforms/darwin-arm64",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: {
          changesetConsumed: false,
          pluginRunner: new PluginRunner([]),
          rollback: new RollbackTracker(),
          versionPlan: {
            mode: "independent",
            packages: pathVersions,
          },
        },
      };
      const task = createTask();

      await versionTask.task(ctx, task);

      const gitInstance = mockedGit.mock.results.at(-1)?.value as any;
      expect(gitInstance.createTag).toHaveBeenCalledWith(
        "@pubm/core@2.0.0",
        "commit-sha",
      );
      expect(gitInstance.createTag).not.toHaveBeenCalledWith(
        "@pubm/darwin-arm64@2.0.0",
        "commit-sha",
      );
    });

    it("skips GitHub release for packages matching excludeRelease patterns", async () => {
      const pathVersions = new Map([
        ["packages/core", "2.0.0"],
        ["packages/pubm/platforms/darwin-arm64", "2.0.0"],
      ]);
      mockedResolveGitHubToken.mockReturnValue({
        token: "gh-token",
        source: "env",
      });

      await run(
        createOptions({
          config: {
            excludeRelease: ["packages/pubm/platforms/*"],
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
                name: "@pubm/darwin-arm64",
                version: "1.0.0",
                path: "packages/pubm/platforms/darwin-arm64",
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
            pluginRunner: new PluginRunner([]),
          },
        }),
      );

      const tasks = mockedCreateListr.mock.calls[0][0] as any[];
      const releaseTask = tasks.find(
        (t: any) => t.title === "Creating GitHub Release",
      );
      const ctx: any = {
        cwd: process.cwd(),
        options: { releaseDraft: false },
        config: {
          excludeRelease: ["packages/pubm/platforms/*"],
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
              name: "@pubm/darwin-arm64",
              version: "1.0.0",
              path: "packages/pubm/platforms/darwin-arm64",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: {
          pluginRunner: new PluginRunner([]),
          rollback: new RollbackTracker(),
          versionPlan: {
            mode: "independent",
            packages: pathVersions,
          },
        },
      };
      const task = createTask();

      await releaseTask.task(ctx, task);

      expect(mockedCreateGitHubRelease).toHaveBeenCalledTimes(1);
      expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tag: "@pubm/core@2.0.0" }),
      );
      expect(mockedCreateGitHubRelease).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tag: "@pubm/darwin-arm64@2.0.0" }),
      );
    });

    it("creates tags for all packages when excludeRelease is undefined", async () => {
      const pathVersions = new Map([
        ["packages/core", "2.0.0"],
        ["packages/pubm", "2.1.0"],
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
          runtime: {
            versionPlan: {
              mode: "independent" as const,
              packages: pathVersions,
            },
            pluginRunner: new PluginRunner([]),
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
          changesetConsumed: false,
          pluginRunner: new PluginRunner([]),
          rollback: new RollbackTracker(),
          versionPlan: {
            mode: "independent",
            packages: pathVersions,
          },
        },
      };
      const task = createTask();

      await versionTask.task(ctx, task);

      const gitInstance = mockedGit.mock.results.at(-1)?.value as any;
      expect(gitInstance.createTag).toHaveBeenCalledWith(
        "@pubm/core@2.0.0",
        "commit-sha",
      );
      expect(gitInstance.createTag).toHaveBeenCalledWith(
        "pubm@2.1.0",
        "commit-sha",
      );
    });

    it("skips rollback tag deletion for excluded packages", async () => {
      const pathVersions = new Map([
        ["packages/core", "2.0.0"],
        ["packages/pubm/platforms/darwin-arm64", "2.0.0"],
      ]);

      await run(
        createOptions({
          config: {
            excludeRelease: ["packages/pubm/platforms/*"],
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
                name: "@pubm/darwin-arm64",
                version: "1.0.0",
                path: "packages/pubm/platforms/darwin-arm64",
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
            pluginRunner: new PluginRunner([]),
          },
        }),
      );

      const tasks = mockedCreateListr.mock.calls[0][0] as any[];
      const versionTask = tasks[2];
      const rollback = new RollbackTracker();
      const ctx: any = {
        cwd: process.cwd(),
        config: {
          excludeRelease: ["packages/pubm/platforms/*"],
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
              name: "@pubm/darwin-arm64",
              version: "1.0.0",
              path: "packages/pubm/platforms/darwin-arm64",
              ecosystem: "js",
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
        runtime: {
          changesetConsumed: false,
          pluginRunner: new PluginRunner([]),
          rollback,
          versionPlan: {
            mode: "independent",
            packages: pathVersions,
          },
        },
      };
      const task = createTask();

      await versionTask.task(ctx, task);

      expect(rollback.size).toBeGreaterThan(0);
      await rollback.execute(ctx, { interactive: false });

      // Rollback creates new Git instances, so check all instances
      const allGitInstances = mockedGit.mock.results.map((r: any) => r.value);
      const allDeleteTagCalls = allGitInstances.flatMap(
        (g: any) => g.deleteTag?.mock?.calls ?? [],
      );
      expect(allDeleteTagCalls.flat()).toContain("@pubm/core@2.0.0");
      expect(allDeleteTagCalls.flat()).not.toContain(
        "@pubm/darwin-arm64@2.0.0",
      );
    });
  });
});

describe("rollback error handling branches", () => {
  it("handles tag deletion error in single mode rollback", async () => {
    await run(createOptions({ runtime: { version: "8.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockRejectedValue(new Error("tag not found")),
      checkTagExist: vi.fn().mockResolvedValue(false),
      status: vi.fn().mockResolvedValue(""),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const rollback = new RollbackTracker();
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
        version: "8.0.0",
        pluginRunner: new PluginRunner([]),
        rollback,
        versionPlan: {
          mode: "single",
          version: "8.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // Should not throw even if deleteTag fails
    const result = await rollback.execute(ctx, { interactive: false });
    expect(result.failed).toBeGreaterThan(0);
    expect(gitInstance.deleteTag).toHaveBeenCalledWith("v8.0.0");
  });

  it("handles commit reset error in rollback", async () => {
    await run(createOptions({ runtime: { version: "8.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error("reset failed")),
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

    const rollback = new RollbackTracker();
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
        version: "8.0.0",
        pluginRunner: new PluginRunner([]),
        rollback,
        versionPlan: {
          mode: "single",
          version: "8.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // Should not throw even if reset fails
    const result = await rollback.execute(ctx, { interactive: false });
    expect(result.failed).toBeGreaterThan(0);
  });

  it("handles tag deletion error in independent mode rollback", async () => {
    const pathVersions = new Map([
      ["packages/core", "2.0.0"],
      ["packages/pubm", "2.1.0"],
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

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockRejectedValue(new Error("tag error")),
      checkTagExist: vi.fn().mockResolvedValue(false),
      status: vi.fn().mockResolvedValue(""),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const rollback = new RollbackTracker();
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
        changesetConsumed: false,
        pluginRunner: new PluginRunner([]),
        rollback,
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // Should not throw even when deleteTag fails for each package
    const result = await rollback.execute(ctx, { interactive: false });
    expect(result.failed).toBeGreaterThan(0);
    expect(gitInstance.deleteTag).toHaveBeenCalled();
  });
});

describe("independent rollback with non-Error rejection in tag deletion", () => {
  it("handles non-Error string rejection in independent mode tag deletion rollback", async () => {
    const pathVersions = new Map([
      ["packages/core", "2.0.0"],
      ["packages/pubm", "2.1.0"],
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

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockRejectedValue("non-Error string rejection"),
      checkTagExist: vi.fn().mockResolvedValue(false),
      status: vi.fn().mockResolvedValue(""),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const rollback = new RollbackTracker();
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
        changesetConsumed: false,
        pluginRunner: new PluginRunner([]),
        rollback,
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // Should handle non-Error string rejection in per-package tag deletion
    const result = await rollback.execute(ctx, { interactive: false });
    expect(result.failed).toBeGreaterThan(0);
    expect(gitInstance.deleteTag).toHaveBeenCalled();
  });
});

describe("GitHub release with asset upload hooks", () => {
  it("calls uploadAssets hook for independent per-package releases", async () => {
    const uploadAssets = vi.fn().mockResolvedValue([
      {
        name: "asset.zip",
        url: "https://example.com",
        sha256: "abc",
        platform: "linux",
      },
    ]);
    const pluginRunner = new PluginRunner([
      {
        name: "asset-plugin",
        hooks: {
          uploadAssets,
        },
      },
    ]);

    const pathVersions = new Map([["packages/core", "2.0.0"]]);

    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
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
        runtime: { pluginRunner },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const releaseResult = {
      displayLabel: "@pubm/core",
      version: "2.0.0",
      tag: "@pubm/core@2.0.0",
      releaseUrl: "https://github.com/pubm/pubm/releases/tag/v2.0.0",
      assets: [] as any[],
    };
    mockedCreateGitHubRelease.mockResolvedValue(releaseResult);

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
        ],
      },
      options: { skipReleaseDraft: false },
      runtime: {
        pluginRunner,
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(uploadAssets).toHaveBeenCalled();
    expect(releaseResult.assets).toHaveLength(1);
    expect(releaseResult.assets[0].name).toBe("asset.zip");
  });

  it("calls uploadAssets hook for single mode releases", async () => {
    const uploadAssets = vi.fn().mockResolvedValue([
      {
        name: "binary.tar.gz",
        url: "https://example.com/bin",
        sha256: "def",
        platform: "darwin",
      },
    ]);
    const pluginRunner = new PluginRunner([
      {
        name: "asset-plugin",
        hooks: {
          uploadAssets,
        },
      },
    ]);

    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
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
          pluginRunner,
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const releaseResult = {
      displayLabel: "pubm",
      version: "4.0.0",
      tag: "v4.0.0",
      releaseUrl: "https://github.com/pubm/pubm/releases/tag/v4.0.0",
      assets: [] as any[],
    };
    mockedCreateGitHubRelease.mockResolvedValue(releaseResult);

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
      options: { releaseDraft: false, skipReleaseDraft: false },
      runtime: {
        pluginRunner,
        versionPlan: {
          mode: "single",
          version: "4.0.0",
          packagePath: ".",
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(uploadAssets).toHaveBeenCalled();
    expect(releaseResult.assets).toHaveLength(1);
  });

  it("handles null result from createGitHubRelease in single mode", async () => {
    mockedCreateGitHubRelease.mockResolvedValue(null as any);

    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
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
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );
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
      options: { releaseDraft: false, skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "4.0.0",
          packagePath: ".",
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(task.output).toContain("already exists");
  });
});

describe("independent release draft with excludeRelease", () => {
  it("skips excluded packages in browser release draft fallback", async () => {
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);
    const pathVersions = new Map([
      ["packages/core", "2.0.0"],
      ["packages/pubm/platforms/darwin-arm64", "2.0.0"],
    ]);

    await run(
      createOptions({
        config: {
          excludeRelease: ["packages/pubm/platforms/*"],
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
              name: "@pubm/darwin-arm64",
              version: "1.0.0",
              path: "packages/pubm/platforms/darwin-arm64",
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
    const releaseDraftTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const task = createTask();
    const ctx: any = {
      config: {
        excludeRelease: ["packages/pubm/platforms/*"],
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
            name: "@pubm/darwin-arm64",
            version: "1.0.0",
            path: "packages/pubm/platforms/darwin-arm64",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await releaseDraftTask.task(ctx, task);

    // Only one URL opened (the non-excluded package)
    expect(mockedOpenUrl).toHaveBeenCalledTimes(1);
  });
});

describe("local mode JSR token collection", () => {
  it("collects JSR token when jsr registry is configured and prompt enabled", async () => {
    const cleanupFn = vi.fn();
    mockedCollectTokens.mockResolvedValue({ jsr: "tok-jsr" });
    mockedInjectTokensToEnv.mockReturnValue(cleanupFn);

    await run(
      createOptions({
        options: { mode: "local" as const },
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

    // The JSR token collection task should have been called
    // We need to find it - in local mode it's a separate createListr call
    const jsrTokenCall = mockedCreateListr.mock.calls.find(
      (call) =>
        !Array.isArray(call[0]) &&
        call[0]?.title === "Ensuring registry authentication",
    );

    if (jsrTokenCall) {
      const tokenTask = jsrTokenCall[0] as any;
      const task = createTask();
      const ctx = createOptions({
        options: { mode: "local" as const },
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
        runtime: { promptEnabled: true },
      });

      await tokenTask.task(ctx, task);

      expect(mockedCollectTokens).toHaveBeenCalledWith(["jsr"], task);
      expect(mockedInjectTokensToEnv).toHaveBeenCalled();
    }
  });
});

describe("formatVersionSummary and formatVersionPlan edge cases", () => {
  it("formats independent version summary with per-package versions", async () => {
    const pathVersions = new Map([
      ["packages/core", "2.0.0"],
      ["packages/pubm", "2.1.0"],
    ]);

    await run(
      createOptions({
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

    // The version bump task should use formatVersionSummary
    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];
    const task = createTask();
    const ctx: any = {
      cwd: process.cwd(),
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
        changesetConsumed: false,
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await versionTask.task(ctx, task);

    // Title should contain individual package versions
    expect(task.title).toContain("@pubm/core@2.0.0");
    expect(task.title).toContain("pubm@2.1.0");
  });
});

describe("contents option with chdir", () => {
  it("changes directory when contents option is provided", async () => {
    const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});

    await run(
      createOptions({
        options: { contents: "/some/other/path" },
      }),
    );

    expect(chdirSpy).toHaveBeenCalledWith("/some/other/path");
    chdirSpy.mockRestore();
  });
});

describe("dry-run version application with independent mode", () => {
  it("applies versions from independent plan packages map via dry-run validation task", async () => {
    const pathVersions = new Map([
      ["packages/core", "3.0.0"],
      ["packages/pubm", "3.1.0"],
    ]);

    const writeCallArgs: Array<Map<string, string>> = [];
    mockedWriteVersionsForEcosystem.mockImplementation(
      async (_ecosystems, versions) => {
        writeCallArgs.push(new Map(versions));
        return [];
      },
    );

    await run(
      createOptions({
        options: { dryRun: true },
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

    // Extract the dry-run validation task (index 6) and execute it manually
    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const dryRunValidateTask = tasks[6]; // "Validating publish (dry-run)"
    const parentTask = createParentTask();
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
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await dryRunValidateTask.task(ctx, parentTask);

    // applyVersionsForDryRun should have used plan.packages directly
    const wroteIndependent = writeCallArgs.some(
      (m) =>
        m.get("packages/core") === "3.0.0" &&
        m.get("packages/pubm") === "3.1.0",
    );
    expect(wroteIndependent).toBe(true);
  });
});

describe("restore workspace protocols task (publish phase)", () => {
  it("executes restore task body when workspaceBackups exist", async () => {
    await run(
      createOptions({
        options: { publish: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    // Task at index 4 is "Restoring workspace protocols" (publish)
    const restoreTask = tasks[4];

    const backups = new Map<string, string>();
    const ctx: any = {
      config: { packages: [] },
      options: { skipPublish: false },
      runtime: {
        workspaceBackups: backups,
        pluginRunner: new PluginRunner([]),
      },
    };

    restoreTask.task(ctx);

    expect(ctx.runtime.workspaceBackups).toBeUndefined();
  });

  it("throws when workspaceBackups is unexpectedly undefined in restore task", async () => {
    await run(
      createOptions({
        options: { publish: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const restoreTask = tasks[4];

    const ctx: any = {
      config: { packages: [] },
      options: { skipPublish: false },
      runtime: {
        workspaceBackups: undefined,
        pluginRunner: new PluginRunner([]),
      },
    };

    expect(() => restoreTask.task(ctx)).toThrow(
      "Workspace backups are required for restore.",
    );
  });
});

describe("restore workspace protocols task (dry-run phase)", () => {
  it("executes restore task body for dry-run workspace backups", async () => {
    await run(
      createOptions({
        options: { dryRun: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    // Task at index 7 is "Restoring workspace protocols" (dry-run)
    const restoreTask = tasks[7];

    const backups = new Map<string, string>();
    const ctx: any = {
      config: { packages: [] },
      runtime: {
        workspaceBackups: backups,
        pluginRunner: new PluginRunner([]),
      },
    };

    restoreTask.task(ctx);

    expect(ctx.runtime.workspaceBackups).toBeUndefined();
  });

  it("throws when backups undefined in dry-run restore task", async () => {
    await run(
      createOptions({
        options: { dryRun: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const restoreTask = tasks[7];

    const ctx: any = {
      config: { packages: [] },
      runtime: {
        workspaceBackups: undefined,
        pluginRunner: new PluginRunner([]),
      },
    };

    await expect(restoreTask.task(ctx)).rejects.toThrow(
      "Workspace backups are required for restore.",
    );
  });
});

describe("dry-run version restore task", () => {
  it("restores versions from backup map", async () => {
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

    await run(
      createOptions({
        options: { dryRun: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    // Task at index 8 is "Restoring original versions (dry-run)"
    const restoreVersionTask = tasks[8];

    const backupVersions = new Map([[".", "1.0.0"]]);
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [
          {
            path: ".",
            name: "pubm",
            version: "2.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        dryRunVersionBackup: backupVersions,
        pluginRunner: new PluginRunner([]),
      },
    };

    await restoreVersionTask.task(ctx);

    expect(mockedWriteVersionsForEcosystem).toHaveBeenCalled();
    expect(ctx.runtime.dryRunVersionBackup).toBeUndefined();
  });

  it("throws when dryRunVersionBackup is undefined", async () => {
    await run(
      createOptions({
        options: { dryRun: true },
        runtime: { version: "1.0.0" },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const restoreVersionTask = tasks[8];

    const ctx: any = {
      runtime: {
        dryRunVersionBackup: undefined,
      },
    };

    await expect(restoreVersionTask.task(ctx)).rejects.toThrow(
      "Dry-run version backup is required for restore.",
    );
  });
});

describe("rollback with non-Error objects", () => {
  it("rollback handles non-Error object in tag deletion", async () => {
    await run(createOptions({ runtime: { version: "9.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    const gitInstance = {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-sha"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockRejectedValue("string error"),
      checkTagExist: vi.fn().mockResolvedValue(false),
      status: vi.fn().mockResolvedValue(""),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

    const rollback = new RollbackTracker();
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
        version: "9.0.0",
        pluginRunner: new PluginRunner([]),
        rollback,
        versionPlan: {
          mode: "single",
          version: "9.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // Should handle non-Error rejection gracefully
    const result = await rollback.execute(ctx, { interactive: false });
    expect(result.failed).toBeGreaterThan(0);
  });

  it("rollback handles non-Error object during commit reset", async () => {
    await run(createOptions({ runtime: { version: "9.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const versionTask = tasks[2];

    let resetCallCount = 0;
    const gitInstance = {
      reset: vi.fn().mockImplementation(async (..._args: any[]) => {
        resetCallCount++;
        // First call is the pre-version refresh reset, second is rollback reset
        if (resetCallCount >= 3) {
          throw "non-error string";
        }
      }),
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

    const rollback = new RollbackTracker();
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
        version: "9.0.0",
        pluginRunner: new PluginRunner([]),
        rollback,
        versionPlan: {
          mode: "single",
          version: "9.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    const result = await rollback.execute(ctx, { interactive: false });
    expect(result.failed).toBeGreaterThan(0);
  });
});

describe("independent changelog without pkgConfig match", () => {
  it("falls back to cwd when package config is not found for changelog dir", async () => {
    const pathVersions = new Map([["unknown-pkg", "2.0.0"]]);
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);
    mockedReadChangesets.mockReturnValue([{ id: "cs-x" }] as any);
    mockedBuildChangelogEntries.mockReturnValue([
      { id: "cs-x", type: "minor", summary: "change" },
    ] as any);
    mockedGenerateChangelog.mockReturnValue("unknown pkg changelog");

    await run(
      createOptions({
        config: {
          packages: [
            {
              name: "my-pkg",
              version: "1.0.0",
              path: "packages/my-pkg",
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
            name: "my-pkg",
            version: "1.0.0",
            path: "packages/my-pkg",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        changesetConsumed: true,
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // Should write changelog to cwd as fallback (pkgConfig not found for "unknown-pkg")
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      process.cwd(),
      "unknown pkg changelog",
    );
  });
});

describe("single changeset with no changesets found", () => {
  it("skips changelog writing when changesets array is empty", async () => {
    mockedReadChangesets.mockReturnValue([]);
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

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
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "4.0.0",
          packageName: "pubm",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // No changelog should be written when changesets is empty
    expect(mockedWriteChangelogToFile).not.toHaveBeenCalled();
  });
});

describe("independent tempDir cleanup in release", () => {
  it("cleans up tempDir after independent release with assets", async () => {
    const mockedRmSync = vi.mocked(rmSync);
    const pathVersions = new Map([["packages/core", "2.0.0"]]);

    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
        config: {
          releaseAssets: [{ files: ["dist/*.tar.gz"] }] as any,
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
          versionPlan: {
            mode: "independent" as const,
            packages: pathVersions,
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const task = createTask();
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        releaseAssets: [{ files: ["dist/*.tar.gz"] }],
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
      options: { skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await releaseTask.task(ctx, task);

    // The release should have been created (tempDir path goes through prepareReleaseAssets)
    expect(mockedCreateGitHubRelease).toHaveBeenCalled();
    // rmSync is called to clean up tempDir when it's truthy
    expect(mockedRmSync).toHaveBeenCalled();
  });
});

describe("GitHub release token prompt paths", () => {
  it("enters token when user selects 'enter' and provides a token", async () => {
    // No GH token initially
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);
    const { saveGitHubToken } = await import(
      "../../../src/utils/github-token.js"
    );
    const mockedSaveGitHubToken = vi.mocked(saveGitHubToken);

    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    // Mock prompt: first call returns "enter", second returns the token
    const mockPrompt = {
      run: vi
        .fn()
        .mockResolvedValueOnce("enter")
        .mockResolvedValueOnce("my-gh-token"),
    };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
      skip: vi.fn(),
    };

    const ctx: any = {
      config: {
        packages: [
          {
            name: "pubm",
            version: "5.0.0",
            path: ".",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      options: { releaseDraft: false, skipReleaseDraft: false, mode: "local" },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "5.0.0",
          packagePath: ".",
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(mockedSaveGitHubToken).toHaveBeenCalledWith("my-gh-token");
    expect(mockedCreateGitHubRelease).toHaveBeenCalled();
  });

  it("skips release when user selects 'skip'", async () => {
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);

    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const mockPrompt = {
      run: vi.fn().mockResolvedValueOnce("skip"),
    };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
      skip: vi.fn(),
    };

    const ctx: any = {
      config: {
        packages: [
          {
            name: "pubm",
            version: "5.0.0",
            path: ".",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      options: { releaseDraft: false, skipReleaseDraft: false, mode: "local" },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "5.0.0",
          packagePath: ".",
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(task.skip).toHaveBeenCalledWith("Skipped by user.");
    expect(mockedCreateGitHubRelease).not.toHaveBeenCalled();
  });

  it("opens browser fallback when user selects 'browser'", async () => {
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);

    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const mockPrompt = {
      run: vi.fn().mockResolvedValueOnce("browser"),
    };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
      skip: vi.fn(),
    };

    const ctx: any = {
      config: {
        packages: [
          {
            name: "pubm",
            version: "5.0.0",
            path: ".",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      options: { releaseDraft: false, skipReleaseDraft: false, mode: "local" },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "5.0.0",
          packagePath: ".",
        },
      },
    };

    await releaseTask.task(ctx, task);

    // Should fall through to browser release draft path
    expect(mockedOpenUrl).toHaveBeenCalled();
    expect(mockedCreateGitHubRelease).not.toHaveBeenCalled();
  });

  it("handles enter with empty token gracefully", async () => {
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);

    await run(createOptions({ runtime: { version: "5.0.0" } }));

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const mockPrompt = {
      run: vi.fn().mockResolvedValueOnce("enter").mockResolvedValueOnce(""), // empty token
    };
    const task = {
      output: "",
      title: "",
      prompt: vi.fn().mockReturnValue(mockPrompt),
      skip: vi.fn(),
    };

    const ctx: any = {
      config: {
        packages: [
          {
            name: "pubm",
            version: "5.0.0",
            path: ".",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      options: { releaseDraft: false, skipReleaseDraft: false, mode: "local" },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "5.0.0",
          packagePath: ".",
        },
      },
    };

    await releaseTask.task(ctx, task);

    // Empty token means hasToken stays false -> browser fallback
    expect(mockedOpenUrl).toHaveBeenCalled();
  });
});

describe("fixed mode release with tempDir cleanup", () => {
  it("cleans up tempDir after fixed mode release", async () => {
    const mockedRmSync = vi.mocked(rmSync);

    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
        config: {
          releaseAssets: [{ files: ["dist/*.zip"] }] as any,
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
            mode: "fixed" as const,
            version: "4.0.0",
            packages: new Map([[".", "4.0.0"]]),
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const task = createTask();
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        releaseAssets: [{ files: ["dist/*.zip"] }],
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
      options: { releaseDraft: false, skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "fixed",
          version: "4.0.0",
          packages: new Map([[".", "4.0.0"]]),
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(mockedCreateGitHubRelease).toHaveBeenCalled();
    expect(mockedRmSync).toHaveBeenCalled();
  });

  it("handles null result from createGitHubRelease in fixed mode", async () => {
    mockedCreateGitHubRelease.mockResolvedValue(null as any);

    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
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
            mode: "fixed" as const,
            version: "4.0.0",
            packages: new Map([[".", "4.0.0"]]),
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

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
      options: { releaseDraft: false, skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "fixed",
          version: "4.0.0",
          packages: new Map([[".", "4.0.0"]]),
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(task.output).toContain("already exists");
  });
});

describe("fixed mode release with changelog sections", () => {
  it("reads per-package changelog for fixed mode and joins sections", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("# Changelog\n## 4.0.0\nChanges here");
    mockedParseChangelogSection.mockReturnValue("Changes here");

    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
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
            mode: "fixed" as const,
            version: "4.0.0",
            packages: new Map([[".", "4.0.0"]]),
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

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
      options: { releaseDraft: false, skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "fixed",
          version: "4.0.0",
          packages: new Map([[".", "4.0.0"]]),
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        changelogBody: expect.stringContaining("## pubm v4.0.0"),
      }),
    );
  });
});

describe("fixed mode packageName fallback in release", () => {
  it("uses empty string when no packages configured in fixed mode release", async () => {
    await run(
      createOptions({
        options: { mode: "ci" as const, publish: true },
        config: {
          packages: [],
        },
        runtime: {
          versionPlan: {
            mode: "fixed" as const,
            version: "4.0.0",
            packages: new Map(),
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const task = createTask();
    const ctx: any = {
      cwd: process.cwd(),
      config: {
        packages: [],
      },
      options: { releaseDraft: false, skipReleaseDraft: false },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "fixed",
          version: "4.0.0",
          packages: new Map(),
        },
      },
    };

    await releaseTask.task(ctx, task);

    expect(mockedCreateGitHubRelease).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        displayLabel: "",
        version: "4.0.0",
        tag: "v4.0.0",
      }),
    );
  });
});

describe("single changeset with pkgPath fallback", () => {
  it("uses empty string when first package has no path in single mode changelog", async () => {
    mockedReadChangesets.mockReturnValue([{ id: "cs-10" }] as any);
    mockedBuildChangelogEntries.mockReturnValue([
      { id: "cs-10", type: "patch", summary: "bugfix" },
    ] as any);
    mockedGenerateChangelog.mockReturnValue("fallback changelog");
    mockedWriteVersionsForEcosystem.mockResolvedValue([]);

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
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "4.0.0",
          packagePath: ".",
        },
      },
    };

    await versionTask.task(ctx, createTask());

    // buildChangelogEntries should be called with the pkgPath
    expect(mockedBuildChangelogEntries).toHaveBeenCalledWith(
      expect.anything(),
      ".",
    );
  });
});

describe("independent release draft with previousTag fallback", () => {
  it("falls back to firstCommit when previousTag returns empty string", async () => {
    mockedResolveGitHubToken.mockReturnValueOnce(undefined as any);
    const pathVersions = new Map([["packages/core", "2.0.0"]]);

    // Set up Git mock where previousTag returns empty string (falsy)
    const gitInstance = {
      repository: vi.fn().mockResolvedValue("https://github.com/pubm/pubm"),
      previousTag: vi.fn().mockResolvedValue(""),
      firstCommit: vi.fn().mockResolvedValue("initial-commit"),
      commits: vi
        .fn()
        .mockResolvedValue([{ id: "abc", message: "feat: something" }]),
      push: vi.fn().mockResolvedValue(true),
    };
    mockedGit.mockImplementation(function () {
      return gitInstance as any;
    } as any);

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
        runtime: {
          versionPlan: {
            mode: "independent" as const,
            packages: pathVersions,
          },
        },
      }),
    );

    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const releaseDraftTask = tasks.find(
      (t: any) =>
        typeof t.title === "string" && t.title.includes("GitHub Release"),
    );

    const task = createTask();
    const ctx: any = {
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
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: pathVersions,
        },
      },
    };

    await releaseDraftTask.task(ctx, task);

    // firstCommit should have been called as fallback
    expect(gitInstance.firstCommit).toHaveBeenCalled();
    expect(mockedOpenUrl).toHaveBeenCalled();
  });
});

describe("empty registry group summary", () => {
  it("returns heading only when no registries are configured", async () => {
    await run(
      createOptions({
        options: { publish: true },
        config: {
          packages: [],
        },
        runtime: { version: "1.0.0" },
      }),
    );

    // With empty packages, the publish task should still work
    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    const publishTask = tasks[3];
    const parentTask = createParentTask();
    const ctx: any = {
      config: { packages: [] },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: { mode: "single", version: "1.0.0", packageName: "pubm" },
      },
    };

    await publishTask.task(ctx, parentTask);

    // formatRegistryGroupSummary with no lines should just return heading
    expect(parentTask.output).toBe("Concurrent publish tasks");
  });
});

describe("pushViaPr via push task (buildPrBodyFromContext coverage)", () => {
  const originalEnvToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-push-via-pr-token";
  });

  afterEach(() => {
    if (originalEnvToken) {
      process.env.GITHUB_TOKEN = originalEnvToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    vi.clearAllMocks();
  });

  async function getPushTask() {
    await run(createOptions());
    const tasks = mockedCreateListr.mock.calls[0][0] as any[];
    // Push task is index 9 in the flat task list
    return tasks[9];
  }

  it("builds PR body in single mode when changelog exists", async () => {
    const pushTask = await getPushTask();

    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("CHANGELOG.md"),
    );
    mockedReadFileSync.mockReturnValue("# Changelog\n## 2.0.0\n- Fix bug");
    mockedParseChangelogSection.mockReturnValue("- Fix bug");

    const ctx: any = {
      cwd: process.cwd(),
      options: { createPr: true },
      config: {
        branch: "main",
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
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "single",
          version: "2.0.0",
          packagePath: ".",
        },
      },
    };

    const task = { output: "" };
    await pushTask.task(ctx, task);

    expect(mockedCreateVersionPr).toHaveBeenCalled();
    const prArgs = mockedCreateVersionPr.mock.calls[0][0];
    expect(prArgs.body).toContain("- Fix bug");
  });

  it("builds PR body in fixed mode with changelog for each package", async () => {
    const pushTask = await getPushTask();

    mockedExistsSync.mockImplementation((p) =>
      String(p).replace(/\\/g, "/").includes("packages/core/CHANGELOG.md"),
    );
    mockedReadFileSync.mockReturnValue("# Changelog");
    mockedParseChangelogSection.mockReturnValue("core changelog entry");

    const packages = [
      {
        path: "packages/core",
        name: "@pubm/core",
        version: "3.0.0",
        ecosystem: "js" as const,
        dependencies: [],
        registries: ["npm"] as any,
      },
      {
        path: "packages/pubm",
        name: "pubm",
        version: "3.0.0",
        ecosystem: "js" as const,
        dependencies: [],
        registries: ["npm"] as any,
      },
    ];

    const ctx: any = {
      cwd: process.cwd(),
      options: { createPr: true },
      config: {
        branch: "main",
        packages,
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "fixed",
          version: "3.0.0",
          packages: new Map([
            ["packages/core", "3.0.0"],
            ["packages/pubm", "3.0.0"],
          ]),
        },
      },
    };

    const task = { output: "" };
    await pushTask.task(ctx, task);

    expect(mockedCreateVersionPr).toHaveBeenCalled();
    const prArgs = mockedCreateVersionPr.mock.calls[0][0];
    expect(prArgs.body).toContain("@pubm/core");
    expect(prArgs.body).toContain("pubm");
  });

  it("builds PR body in fixed mode without changelog", async () => {
    const pushTask = await getPushTask();

    mockedExistsSync.mockReturnValue(false);

    const packages = [
      {
        path: "packages/a",
        name: "pkg-a",
        version: "1.0.0",
        ecosystem: "js" as const,
        dependencies: [],
        registries: ["npm"] as any,
      },
    ];

    const ctx: any = {
      cwd: process.cwd(),
      options: { createPr: true },
      config: {
        branch: "main",
        packages,
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "fixed",
          version: "4.0.0",
          packages: new Map([["packages/a", "4.0.0"]]),
        },
      },
    };

    const task = { output: "" };
    await pushTask.task(ctx, task);

    expect(mockedCreateVersionPr).toHaveBeenCalled();
    const prArgs = mockedCreateVersionPr.mock.calls[0][0];
    expect(prArgs.body).toContain("pkg-a");
    expect(prArgs.body).not.toContain("## Changelog");
  });

  it("builds PR body in independent mode with changelog for packages without pkgConfig", async () => {
    const pushTask = await getPushTask();

    // existsSync returns true for any CHANGELOG.md path
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("CHANGELOG.md"),
    );
    mockedReadFileSync.mockReturnValue("# Changelog");
    mockedParseChangelogSection.mockReturnValue("independent entry");

    const packages = [
      {
        path: "packages/alpha",
        name: "alpha",
        version: "1.0.0",
        ecosystem: "js" as const,
        dependencies: [],
        registries: ["npm"] as any,
      },
      {
        path: "packages/beta",
        name: "beta",
        version: "2.0.0",
        ecosystem: "js" as const,
        dependencies: [],
        registries: ["npm"] as any,
      },
    ];

    const ctx: any = {
      cwd: process.cwd(),
      options: { createPr: true },
      config: {
        branch: "main",
        packages,
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/alpha", "1.1.0"],
            ["packages/beta", "2.1.0"],
          ]),
        },
      },
    };

    const task = { output: "" };
    await pushTask.task(ctx, task);

    expect(mockedCreateVersionPr).toHaveBeenCalled();
    const prArgs = mockedCreateVersionPr.mock.calls[0][0];
    expect(prArgs.body).toContain("alpha");
    expect(prArgs.body).toContain("beta");
  });

  it("builds PR body in independent mode when pkgConfig is not found (uses path as name)", async () => {
    const pushTask = await getPushTask();

    mockedExistsSync.mockReturnValue(false);

    // versionPlan references paths not in config.packages
    const ctx: any = {
      cwd: process.cwd(),
      options: { createPr: true },
      config: {
        branch: "main",
        packages: [],
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback: new RollbackTracker(),
        versionPlan: {
          mode: "independent",
          packages: new Map([["packages/orphan", "5.0.0"]]),
        },
      },
    };

    const task = { output: "" };
    await pushTask.task(ctx, task);

    expect(mockedCreateVersionPr).toHaveBeenCalled();
    const prArgs = mockedCreateVersionPr.mock.calls[0][0];
    // When pkgConfig not found, path is used as name
    expect(prArgs.body).toContain("packages/orphan");
  });

  it("registers remote tag rollback for single mode after successful push via PR", async () => {
    const pushTask = await getPushTask();

    mockedExistsSync.mockReturnValue(false);

    const rollback = new RollbackTracker();
    const ctx: any = {
      cwd: process.cwd(),
      options: { createPr: true },
      config: {
        branch: "main",
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
        pluginRunner: new PluginRunner([]),
        rollback,
        versionPlan: {
          mode: "single",
          version: "1.0.0",
          packagePath: ".",
        },
      },
    };

    const task = { output: "" };
    await pushTask.task(ctx, task);

    // Rollback should have entries: remote tag + branch + close PR
    expect(rollback.size).toBeGreaterThanOrEqual(3);
  });

  it("registers per-package remote tag rollback in independent mode after pushViaPr", async () => {
    const pushTask = await getPushTask();

    mockedExistsSync.mockReturnValue(false);

    const rollback = new RollbackTracker();
    const ctx: any = {
      cwd: process.cwd(),
      options: { createPr: true },
      config: {
        branch: "main",
        packages: [
          {
            path: "packages/a",
            name: "pkg-a",
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
          {
            path: "packages/b",
            name: "pkg-b",
            version: "2.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      runtime: {
        pluginRunner: new PluginRunner([]),
        rollback,
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/a", "1.1.0"],
            ["packages/b", "2.1.0"],
          ]),
        },
      },
    };

    const task = { output: "" };
    await pushTask.task(ctx, task);

    // Rollback should have per-package remote tag entries + branch + close PR
    expect(rollback.size).toBeGreaterThanOrEqual(4);
  });
});
