import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsCI = vi.hoisted(() => ({ value: false }));
vi.mock("std-env", () => ({
  get isCI() {
    return mockIsCI.value;
  },
}));
vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(),
}));
vi.mock("../../../src/error.js", () => ({
  AbstractError: class extends Error {
    name = "AbstractError";
  },
  consoleError: vi.fn(),
}));
vi.mock("../../../src/utils/package-manager.js", () => ({
  getPackageManager: vi.fn(),
}));
vi.mock("../../../src/manifest/write-versions.js", () => ({
  writeVersionsForEcosystem: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(() => [{ type: "pnpm", patterns: ["packages/*"] }]),
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
    syncLockfile() {
      return Promise.resolve(undefined);
    }
    resolveTestCommand(script: string) {
      return Promise.resolve({ cmd: "pnpm", args: ["run", script] });
    }
    resolveBuildCommand(script: string) {
      return Promise.resolve({ cmd: "pnpm", args: ["run", script] });
    }
    validateScript() {
      return Promise.resolve(null);
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
    syncLockfile() {
      return Promise.resolve(undefined);
    }
    resolveTestCommand(script: string) {
      const parts = script.split(/\s+/);
      return Promise.resolve({ cmd: "cargo", args: parts });
    }
    resolveBuildCommand(script: string) {
      const parts = script.split(/\s+/);
      return Promise.resolve({ cmd: "cargo", args: parts });
    }
    validateScript() {
      return Promise.resolve(null);
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
    },
  };
});
vi.mock("../../../src/utils/ui.js", () => ({
  ui: {
    link: vi.fn(),
    labels: { WARNING: "WARNING" },
    badges: { ERROR: "ERROR", ROLLBACK: "ROLLBACK" },
    chalk: {
      bold: (s: string) => s,
      blueBright: (s: string) => s,
      yellow: (s: string) => s,
      green: (s: string) => s,
      red: (s: string) => s,
      dim: (s: string) => s,
    },
  },
}));
vi.mock("../../../src/tasks/prerequisites-check.js", () => ({
  prerequisitesCheckTask: vi.fn(),
}));
vi.mock("../../../src/tasks/required-conditions-check.js", () => ({
  requiredConditionsCheckTask: vi.fn(),
}));

vi.mock("../../../src/tasks/preflight.js", () => ({
  collectTokens: vi.fn(),
  collectPluginCredentials: vi.fn().mockResolvedValue({}),
  promptGhSecretsSync: vi.fn(),
}));
vi.mock("../../../src/utils/token.js", () => ({
  TOKEN_CONFIG: {
    npm: {
      envVar: "NODE_AUTH_TOKEN",
      dbKey: "npm-token",
      ghSecretName: "NODE_AUTH_TOKEN",
      promptLabel: "npm access token",
    },
    jsr: {
      envVar: "JSR_TOKEN",
      dbKey: "jsr-token",
      ghSecretName: "JSR_TOKEN",
      promptLabel: "jsr API token",
    },
    crates: {
      envVar: "CARGO_REGISTRY_TOKEN",
      dbKey: "cargo-token",
      ghSecretName: "CARGO_REGISTRY_TOKEN",
      promptLabel: "crates.io API token",
    },
  },
  loadTokensFromDb: vi.fn(),
  injectTokensToEnv: vi.fn().mockReturnValue(vi.fn()),
  injectPluginTokensToEnv: vi.fn().mockReturnValue(vi.fn()),
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
vi.mock("../../../src/tasks/github-release.js", () => ({
  createGitHubRelease: vi.fn().mockResolvedValue({
    displayLabel: "my-package",
    version: "1.0.0",
    tag: "v1.0.0",
    releaseUrl: "https://github.com/user/repo/releases/tag/v1.0.0",
    assets: [],
  }),
}));
vi.mock("../../../src/assets/pipeline.js", () => ({
  runAssetPipeline: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../src/assets/resolver.js", () => ({
  normalizeConfig: vi.fn().mockReturnValue([{ files: [] }]),
  resolveAssets: vi.fn().mockReturnValue([]),
}));
vi.mock("../../../src/changeset/changelog-parser.js", () => ({
  parseChangelogSection: vi.fn(),
}));
vi.mock("../../../src/monorepo/resolve-workspace.js", () => ({
  collectWorkspaceVersions: vi.fn(() => new Map()),
  resolveWorkspaceProtocolsInManifests: vi.fn(() => new Map()),
  restoreManifests: vi.fn(),
}));
vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn().mockReturnValue([]),
  deleteChangesetFiles: vi.fn(),
}));
vi.mock("../../../src/changeset/changelog.js", () => ({
  buildChangelogEntries: vi.fn().mockReturnValue([]),
  generateChangelog: vi.fn().mockReturnValue("generated"),
  writeChangelogToFile: vi.fn(),
}));
vi.mock("../../../src/changeset/resolve.js", () => ({
  createKeyResolver: vi.fn().mockReturnValue(vi.fn()),
}));
vi.mock("../../../src/registry/catalog.js", () => {
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
      resolveDisplayName: vi.fn(async () => ["my-package"]),
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
      resolveDisplayName: vi.fn(async () => ["@scope/my-package"]),
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
          task: vi.fn(),
        })),
      },
      orderPackages: vi.fn((paths: string[]) => Promise.resolve(paths)),
      resolveDisplayName: vi.fn(
        async (config: any) =>
          config.packages
            ?.filter((pkg: any) => pkg.registries.includes("crates"))
            .map((pkg: any) => pkg.path) ?? ["crate"],
      ),
    },
  };
  return {
    registryCatalog: {
      get: vi.fn((key: string) => descriptors[key]),
      all: vi.fn(() => Object.values(descriptors)),
    },
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(""),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
});
vi.mock("../../../src/utils/crate-graph.js", () => ({
  sortCratesByDependencyOrder: vi.fn(),
}));

vi.mock("../../../src/utils/registries.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/utils/registries.js")>();
  return { ...original };
});

vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn(),
  createCiListrOptions: vi.fn(() => ({ renderer: "ci-renderer" })),
}));

vi.mock("../../../src/registry/jsr.js", () => ({
  JsrClient: { token: null },
}));

import type { PubmContext } from "../../../src/context.js";
import { ecosystemCatalog } from "../../../src/ecosystem/catalog.js";
import { consoleError } from "../../../src/error.js";
import { Git } from "../../../src/git.js";
import { writeVersionsForEcosystem } from "../../../src/manifest/write-versions.js";
import { PluginRunner } from "../../../src/plugin/runner.js";
import { JsrClient } from "../../../src/registry/jsr.js";
import {
  collectTokens,
  promptGhSecretsSync,
} from "../../../src/tasks/preflight.js";
import { prerequisitesCheckTask } from "../../../src/tasks/prerequisites-check.js";
import { requiredConditionsCheckTask } from "../../../src/tasks/required-conditions-check.js";
import { run } from "../../../src/tasks/runner.js";
import { sortCratesByDependencyOrder } from "../../../src/utils/crate-graph.js";
import { exec } from "../../../src/utils/exec.js";
import { createCiListrOptions, createListr } from "../../../src/utils/listr.js";
import { getPackageManager } from "../../../src/utils/package-manager.js";
import { injectTokensToEnv } from "../../../src/utils/token.js";
import { ui } from "../../../src/utils/ui.js";
import { makeTestContext } from "../../helpers/make-context.js";

const mockedPrerequisitesCheckTask = vi.mocked(prerequisitesCheckTask);
const mockedRequiredConditionsCheckTask = vi.mocked(
  requiredConditionsCheckTask,
);
const mockedCreateListr = vi.mocked(createListr);
const mockedCreateCiListrOptions = vi.mocked(createCiListrOptions);
const mockedConsoleError = vi.mocked(consoleError);
const mockedExec = vi.mocked(exec);
const mockedGetPackageManager = vi.mocked(getPackageManager);
const mockedWriteVersionsForEcosystem = vi.mocked(writeVersionsForEcosystem);
const mockedLink = vi.mocked(ui.link);
const mockedGit = vi.mocked(Git);
const mockedSortCrates = vi.mocked(sortCratesByDependencyOrder);
const mockedCollectTokens = vi.mocked(collectTokens);
const mockedPromptGhSecretsSync = vi.mocked(promptGhSecretsSync);
const mockedInjectTokensToEnv = vi.mocked(injectTokensToEnv);

function pkg(
  overrides: Partial<PubmContext["config"]["packages"][0]> & {
    path: string;
    registries: any;
  },
): PubmContext["config"]["packages"][0] {
  const ecosystem =
    overrides.ecosystem ??
    (overrides.registries?.includes("crates") ? "rust" : "js");
  return {
    name: overrides.name ?? overrides.path,
    version: overrides.version ?? "1.0.0",
    ecosystem,
    dependencies: overrides.dependencies ?? [],
    ...overrides,
  };
}

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
          name: "my-package",
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
      version: "1.0.0",
      versionPlan: {
        mode: "single" as const,
        version: "1.0.0",
        packageName: "my-package",
      },
      pluginRunner: new PluginRunner([]),
      ...overrides.runtime,
    },
  });
}

function setupCreateListrMock() {
  mockedCreateListr.mockImplementation((...args: any[]) => {
    const tasks = Array.isArray(args[0]) ? args[0] : [args[0]];
    return {
      run: vi.fn(async (ctx: any) => {
        for (const task of tasks) {
          if (typeof task.enabled === "function" && !task.enabled(ctx))
            continue;
          if (typeof task.enabled === "boolean" && !task.enabled) continue;
          if (typeof task.skip === "function" && task.skip(ctx)) continue;
          if (typeof task.skip === "boolean" && task.skip) continue;
          if (task.task) {
            const mockTask = {
              output: "",
              title: task.title || "",
              newListr: vi.fn((_subtasks: any[]) => ({
                run: vi.fn(),
              })),
              prompt: vi.fn(() => ({ run: vi.fn() })),
              skip: vi.fn(),
            };
            await task.task(ctx, mockTask);
          }
        }
      }),
    } as any;
  });
}

function createMockTaskRecorder() {
  const outputHistory: string[] = [];
  let output = "";

  return {
    outputHistory,
    task: {
      get output() {
        return output;
      },
      set output(value: string) {
        output = value;
        outputHistory.push(value);
      },
      title: "",
    },
  };
}

let processExitSpy: any;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let chdirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();

  processExitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});

  // Re-establish mock implementations (vi.restoreAllMocks in setup.ts clears them)
  mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);
  mockedGit.mockImplementation(function () {
    return {
      reset: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("abc123"),
      createTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(true),
      pushDelete: vi.fn().mockResolvedValue(undefined),
      pushNewBranch: vi.fn().mockResolvedValue(undefined),
      forcePush: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      switch: vi.fn().mockResolvedValue(undefined),
      latestTag: vi.fn().mockResolvedValue("v0.9.0"),
      previousTag: vi.fn().mockResolvedValue("v0.8.0"),
      firstCommit: vi.fn().mockResolvedValue("aaa"),
      commits: vi
        .fn()
        .mockResolvedValue([{ id: "abc123", message: "feat: something" }]),
      repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
      stash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue(""),
      checkTagExist: vi.fn().mockResolvedValue(false),
      revParse: vi.fn().mockResolvedValue("abc123"),
      branch: vi.fn().mockResolvedValue("main"),
    } as any;
  });
  mockedGetPackageManager.mockResolvedValue("pnpm" as any);
  mockedWriteVersionsForEcosystem.mockResolvedValue([]);
  mockedLink.mockImplementation((_text: string, url: string) => url);
  mockedPrerequisitesCheckTask.mockReturnValue({
    run: vi.fn().mockResolvedValue(undefined),
  } as any);
  mockedRequiredConditionsCheckTask.mockReturnValue({
    run: vi.fn().mockResolvedValue(undefined),
  } as any);

  mockedSortCrates.mockImplementation(async (paths) => paths);
  mockedCollectTokens.mockResolvedValue({ npm: "test-token" });
  mockedPromptGhSecretsSync.mockResolvedValue(undefined);
  mockedInjectTokensToEnv.mockReturnValue(vi.fn());
  JsrClient.token = null;
  mockedCreateCiListrOptions.mockReturnValue({
    renderer: "ci-renderer",
  } as any);

  setupCreateListrMock();
});

describe("dry-run version application", () => {
  it("writes new version to disk before dry-run publish validation (single mode)", async () => {
    const ctx = createOptions({
      options: { dryRun: true },
      runtime: {
        versionPlan: {
          mode: "single" as const,
          version: "2.0.0",
          packagePath: ".",
        },
      },
    });
    const writeCallArgs: Array<Map<string, string>> = [];
    mockedWriteVersionsForEcosystem.mockImplementation(
      async (_ecosystems, versions) => {
        writeCallArgs.push(new Map(versions));
        return [];
      },
    );

    await run(ctx);

    // dry-run publish validation 직전에 새 버전(2.0.0)으로 쓴 call이 있어야 함
    const wroteNewVersion = writeCallArgs.some((m) =>
      [...m.values()].includes("2.0.0"),
    );
    expect(wroteNewVersion).toBe(true);
  });

  it("restores original version after dry-run publish validation (single mode)", async () => {
    const ctx = createOptions({
      options: { dryRun: true },
      runtime: {
        versionPlan: {
          mode: "single" as const,
          version: "2.0.0",
          packagePath: ".",
        },
      },
    });
    const writeCallArgs: Array<Map<string, string>> = [];
    mockedWriteVersionsForEcosystem.mockImplementation(
      async (_ecosystems, versions) => {
        writeCallArgs.push(new Map(versions));
        return [];
      },
    );

    await run(ctx);

    // 마지막 write call은 원래 버전(1.0.0)으로 복원해야 함
    const lastWrite = writeCallArgs[writeCallArgs.length - 1];
    expect(lastWrite && [...lastWrite.values()][0]).toBe("1.0.0");
  });

  it("writes new version to disk for fixed mode dry-run", async () => {
    const ctx = createOptions({
      config: {
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
            version: "1.0.0",
            ecosystem: "js",
            dependencies: [],
            registries: ["npm"],
          },
        ],
      },
      options: { dryRun: true },
      runtime: {
        versionPlan: {
          mode: "fixed" as const,
          version: "2.0.0",
          packages: new Map([
            ["packages/a", "2.0.0"],
            ["packages/b", "2.0.0"],
          ]),
        },
      },
    });
    const writeCallArgs: Array<Map<string, string>> = [];
    mockedWriteVersionsForEcosystem.mockImplementation(
      async (_ecosystems, versions) => {
        writeCallArgs.push(new Map(versions));
        return [];
      },
    );

    await run(ctx);

    const wroteNewVersion = writeCallArgs.some((m) =>
      [...m.values()].every((v) => v === "2.0.0"),
    );
    expect(wroteNewVersion).toBe(true);
  });
});

describe("run", () => {
  describe("context creation", () => {
    it("sets promptEnabled to true when not CI and stdin is TTY", async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      const options = createOptions();
      await run(options);

      expect(mockedCreateListr).toHaveBeenCalled();

      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    });
  });

  describe("contents option", () => {
    it("calls process.chdir when contents is set", async () => {
      const options = createOptions({ options: { contents: "/some/path" } });
      await run(options);

      expect(chdirSpy).toHaveBeenCalledWith("/some/path");
    });

    it("does not call process.chdir when contents is not set", async () => {
      const options = createOptions();
      await run(options);

      expect(chdirSpy).not.toHaveBeenCalled();
    });
  });

  describe("publish-only mode", () => {
    it("skips prerequisites and conditions checks when publish is true (local mode)", async () => {
      const options = createOptions({ options: { publish: true } });
      await run(options);

      expect(mockedPrerequisitesCheckTask).not.toHaveBeenCalled();
      expect(mockedRequiredConditionsCheckTask).not.toHaveBeenCalled();
    });

    it("creates flat task array with publish tasks in publish-only mode", async () => {
      const options = createOptions({ options: { publish: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      expect(Array.isArray(callArgs[0])).toBe(true);
      // The flat list always has 10 tasks; prepare-phase tasks are skipped
      const tasks = callArgs[0] as any[];
      expect(tasks[3]).toHaveProperty("title", "Publishing");
      expect(tasks[4]).toHaveProperty("title", "Restoring workspace protocols");
    });
  });

  describe("CI logging", () => {
    it("passes CI renderer options to the pipeline when isCI is true", async () => {
      mockIsCI.value = true;
      try {
        const ciListrOptions = { renderer: "ci-renderer" } as any;
        mockedCreateCiListrOptions.mockReturnValue(ciListrOptions);

        const options = createOptions({
          options: { mode: "ci", prepare: true },
        });
        await run(options);

        expect(mockedCreateCiListrOptions).toHaveBeenCalled();
        // First createListr call is token collection, second is the pipeline
        const pipelineCall = mockedCreateListr.mock.calls.find((call) =>
          Array.isArray(call[0]),
        );
        expect(pipelineCall?.[1]).toBe(ciListrOptions);
      } finally {
        mockIsCI.value = false;
      }
    });

    it("does not pass CI renderer options when mode is ci but isCI is false", async () => {
      const options = createOptions({
        options: { mode: "ci", prepare: true },
      });
      await run(options);

      expect(mockedCreateCiListrOptions).not.toHaveBeenCalled();
    });
  });

  describe("normal mode (full pipeline)", () => {
    it("runs prerequisites check task", async () => {
      const options = createOptions();
      await run(options);

      expect(mockedPrerequisitesCheckTask).toHaveBeenCalledWith({
        skip: undefined,
      });
    });

    it("runs required conditions check task", async () => {
      const options = createOptions();
      await run(options);

      expect(mockedRequiredConditionsCheckTask).toHaveBeenCalledWith({
        skip: undefined,
      });
    });

    it("passes skipPrerequisitesCheck to prerequisitesCheckTask", async () => {
      const options = createOptions({
        options: { skipPrerequisitesCheck: true },
      });
      await run(options);

      expect(mockedPrerequisitesCheckTask).toHaveBeenCalledWith({
        skip: true,
      });
    });

    it("passes skipConditionsCheck to requiredConditionsCheckTask", async () => {
      const options = createOptions({ options: { skipConditionsCheck: true } });
      await run(options);

      expect(mockedRequiredConditionsCheckTask).toHaveBeenCalledWith({
        skip: true,
      });
    });

    it("creates a task list with all expected tasks", async () => {
      const options = createOptions();
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(11);
      expect(tasks[0].title).toBe("Running tests");
      expect(tasks[1].title).toBe("Building the project");
      expect(tasks[2].title).toBe("Bumping version");
      expect(tasks[3].title).toBe("Publishing");
      expect(tasks[4].title).toBe("Restoring workspace protocols");
      expect(tasks[5].title).toBe("Running post-publish hooks");
      expect(tasks[6].title).toBe("Validating publish (dry-run)");
      expect(tasks[7].title).toBe("Restoring workspace protocols");
      expect(tasks[8].title).toBe("Restoring original versions (dry-run)");
      expect(tasks[9].title).toBe("Pushing tags to GitHub");
      expect(tasks[10].title).toBe("Creating GitHub Release");
    });
  });

  describe("task skip flags", () => {
    it("disables tests when skipTests is true", async () => {
      const options = createOptions({ options: { skipTests: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[0].enabled).toBe(false);
    });

    it("disables build when skipBuild is true", async () => {
      const options = createOptions({ options: { skipBuild: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[1].enabled).toBe(false);
    });

    it("enables version bump in dryRun mode (dry-run logic is internal)", async () => {
      const options = createOptions({ options: { dryRun: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      // Version bump enabled is `hasPrepare`, which is true for full pipeline
      expect(tasks[2].enabled).toBe(true);
    });

    it("enables version bump in normal mode", async () => {
      const options = createOptions();
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[2].enabled).toBe(true);
    });

    it("disables publish when skipPublish is true", async () => {
      const options = createOptions({ options: { skipPublish: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[3].enabled).toBe(false);
    });

    it("disables publish when dryRun is set", async () => {
      const options = createOptions({ options: { dryRun: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      // dryRun causes publish to be disabled via the static `dryRun` closure
      expect(tasks[3].enabled).toBe(false);
    });

    it("disables pushing tags when dryRun is set", async () => {
      const options = createOptions({ options: { dryRun: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      // Push tags enabled is static: `hasPrepare && !dryRun`
      expect(tasks[9].enabled).toBe(false);
    });

    it("disables release draft when skipReleaseDraft is true", async () => {
      const options = createOptions({ options: { skipReleaseDraft: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[10].enabled).toBe(false);
    });

    it("disables release draft when dryRun is set", async () => {
      const options = createOptions({ options: { dryRun: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      // dryRun causes release draft to be disabled
      expect(tasks[10].enabled).toBe(false);
    });
  });

  describe("error handling", () => {
    it("calls consoleError with the thrown error", async () => {
      const error = new Error("Task failed");
      mockedPrerequisitesCheckTask.mockReturnValueOnce({
        run: vi.fn().mockRejectedValue(error),
      } as any);

      const options = createOptions();
      await run(options);

      expect(mockedConsoleError).toHaveBeenCalledWith(error);
    });

    it("calls rollback on error", async () => {
      const error = new Error("Task failed");
      mockedPrerequisitesCheckTask.mockReturnValueOnce({
        run: vi.fn().mockRejectedValue(error),
      } as any);

      const options = createOptions();
      const executeSpy = vi.spyOn(options.runtime.rollback, "execute");
      await run(options);

      expect(executeSpy).toHaveBeenCalledOnce();
    });

    it("calls process.exit(1) on error", async () => {
      const error = new Error("Task failed");
      mockedPrerequisitesCheckTask.mockReturnValueOnce({
        run: vi.fn().mockRejectedValue(error),
      } as any);

      const options = createOptions();
      await run(options);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("calls rollback before process.exit", async () => {
      const callOrder: string[] = [];
      const error = new Error("Task failed");
      mockedPrerequisitesCheckTask.mockReturnValueOnce({
        run: vi.fn().mockRejectedValue(error),
      } as any);

      const options = createOptions();
      vi.spyOn(options.runtime.rollback, "execute").mockImplementationOnce(
        async () => {
          callOrder.push("rollback");
          return { succeeded: 0, failed: 0, skipped: 0, manualRecovery: [] };
        },
      );
      processExitSpy.mockImplementation((() => {
        callOrder.push("exit");
      }) as any);

      await run(options);

      expect(callOrder).toEqual(["rollback", "exit"]);
    });
  });

  describe("inner task execution", () => {
    it("annotates the test task title and output with the exact command", async () => {
      const options = createOptions();
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const testTask = tasks[0];
      const { task: mockTask } = createMockTaskRecorder();

      await testTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockTask,
      );

      expect(mockTask.title).toBe("Running tests (pnpm run test)");
      expect(mockTask.output).toBe("Completed `pnpm run test`");
    });

    it("treats packages with ecosystem: undefined as JS", async () => {
      const options = createOptions({
        config: {
          packages: [
            {
              path: ".",
              name: "my-package",
              version: "1.0.0",
              ecosystem: undefined as any,
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const testTask = tasks[0];
      const { task: mockTask } = createMockTaskRecorder();

      await testTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockTask,
      );

      expect(mockTask.title).toBe("Running tests (pnpm run test)");
    });

    it("skips unknown ecosystems gracefully", async () => {
      const options = createOptions({
        config: {
          packages: [
            {
              path: ".",
              name: "my-package",
              version: "1.0.0",
              ecosystem: "unknown-eco" as any,
              dependencies: [],
              registries: ["npm"],
            },
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const testTask = tasks[0];
      const { task: mockTask } = createMockTaskRecorder();

      await testTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockTask,
      );

      // No commands executed, completion shows empty
      expect(mockTask.output).toBe("Completed ``");
    });

    it("shows only the latest 4 lines of live test output on local TTY", async () => {
      const originalIsTTY = process.stdout.isTTY;
      try {
        Object.defineProperty(process.stdout, "isTTY", {
          value: true,
          configurable: true,
        });

        const options = createOptions();
        await run(options);

        mockedExec.mockClear();
        mockedExec.mockImplementationOnce(
          async (_command, _args, execOptions) => {
            execOptions.onStdout?.("line 1\nline 2\n");
            execOptions.onStderr?.("warn 1\n");
            execOptions.onStdout?.("line 3\nline 4\nline 5\n");

            return {
              exitCode: 0,
              stderr: "warn 1\n",
              stdout: "line 1\nline 2\nline 3\nline 4\nline 5\n",
            };
          },
        );

        const callArgs = mockedCreateListr.mock.calls[0];
        const tasks = callArgs[0] as any[];
        const testTask = tasks[0];
        const { outputHistory, task: mockTask } = createMockTaskRecorder();

        await testTask.task(
          {
            ...options,
            options: { ...options.options, mode: "local" as const },
            runtime: { ...options.runtime, promptEnabled: true },
          },
          mockTask,
        );

        expect(outputHistory).toContain(
          "Executing `pnpm run test`\nwarn 1\nline 3\nline 4\nline 5",
        );
      } finally {
        Object.defineProperty(process.stdout, "isTTY", {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });

    it("renders trailing partial test output before the process flushes a newline", async () => {
      const originalIsTTY = process.stdout.isTTY;
      try {
        Object.defineProperty(process.stdout, "isTTY", {
          value: true,
          configurable: true,
        });

        const options = createOptions();
        await run(options);

        mockedExec.mockClear();
        mockedExec.mockImplementationOnce(
          async (_command, _args, execOptions) => {
            execOptions.onStdout?.("partial line");

            return {
              exitCode: 0,
              stderr: "",
              stdout: "partial line",
            };
          },
        );

        const callArgs = mockedCreateListr.mock.calls[0];
        const tasks = callArgs[0] as any[];
        const testTask = tasks[0];
        const { outputHistory, task: mockTask } = createMockTaskRecorder();

        await testTask.task(
          {
            ...options,
            options: { ...options.options, mode: "local" as const },
            runtime: { ...options.runtime, promptEnabled: true },
          },
          mockTask,
        );

        expect(outputHistory).toContain(
          "Executing `pnpm run test`\npartial line",
        );
      } finally {
        Object.defineProperty(process.stdout, "isTTY", {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });

    it("does not attach live output callbacks when isCI is true", async () => {
      const originalIsTTY = process.stdout.isTTY;
      mockIsCI.value = true;
      try {
        Object.defineProperty(process.stdout, "isTTY", {
          value: true,
          configurable: true,
        });

        const options = createOptions();
        await run(options);

        mockedExec.mockClear();

        const callArgs = mockedCreateListr.mock.calls[0];
        const tasks = callArgs[0] as any[];
        const testTask = tasks[0];
        const { task: mockTask } = createMockTaskRecorder();

        await testTask.task(
          {
            ...options,
            runtime: { ...options.runtime, promptEnabled: false },
          },
          mockTask,
        );

        expect(mockedExec).toHaveBeenCalledWith("pnpm", ["run", "test"], {
          onStderr: undefined,
          onStdout: undefined,
          throwOnError: true,
          nodeOptions: { cwd: expect.any(String) },
        });
      } finally {
        Object.defineProperty(process.stdout, "isTTY", {
          value: originalIsTTY,
          configurable: true,
        });
        mockIsCI.value = false;
      }
    });

    it("runs test task and throws AbstractError with context on exec rejection", async () => {
      mockedExec.mockRejectedValueOnce(new Error("test error"));

      const options = createOptions();
      await run(options);

      // Error triggers catch block with context message
      expect(mockedConsoleError).toHaveBeenCalled();
      const errorArg = mockedConsoleError.mock.calls[0][0];
      expect((errorArg as Error).message).toMatch(
        /Test script 'pnpm run test' failed/,
      );
    });

    it("runs test task successfully when no stderr", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions();
      await run(options);

      expect(mockedExec).toHaveBeenCalled();
    });

    it("runs build task and throws on exec error", async () => {
      // First exec call (test) succeeds, second (build) rejects
      mockedExec
        .mockResolvedValueOnce({ stdout: "ok", stderr: "" } as any)
        .mockRejectedValueOnce(new Error("build failed"));

      const options = createOptions();
      await run(options);

      expect(mockedConsoleError).toHaveBeenCalled();
    });

    it("executes version bump task which calls git operations", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions();
      await run(options);

      // Rollback actions should have been registered for version bump
      expect(options.runtime.rollback.size).toBeGreaterThan(0);
      expect(mockedWriteVersionsForEcosystem).toHaveBeenCalled();
    });

    it("calls writeVersionsForEcosystem when packages config exists", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const packages = [
        {
          path: ".",
          name: "my-package",
          version: "1.0.0",
          ecosystem: "js" as const,
          dependencies: [],
          registries: ["npm", "jsr"] as any,
        },
        {
          path: "rust/crates/my-crate",
          name: "my-crate",
          version: "1.0.0",
          ecosystem: "rust" as const,
          dependencies: [],
          registries: ["crates"] as any,
        },
      ];
      const options = createOptions({ config: { packages } });
      await run(options);

      expect(mockedWriteVersionsForEcosystem).toHaveBeenCalled();
    });

    it("registers rollback that handles tag deletion and commit reset", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions();
      await run(options);

      // Rollback actions should include tag deletion and commit reset
      expect(options.runtime.rollback.size).toBeGreaterThanOrEqual(2);
    });

    it("stashes and restores dirty files while rolling back a release commit", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const stash = vi.fn().mockResolvedValue(undefined);
      const popStash = vi.fn().mockResolvedValue(undefined);
      mockedGit.mockImplementation(function () {
        return {
          reset: vi.fn().mockResolvedValue(undefined),
          stage: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue("abc123"),
          createTag: vi.fn().mockResolvedValue(undefined),
          deleteTag: vi.fn().mockResolvedValue(undefined),
          push: vi.fn().mockResolvedValue(true),
          pushDelete: vi.fn().mockResolvedValue(undefined),
          forcePush: vi.fn().mockResolvedValue(undefined),
          latestTag: vi.fn().mockResolvedValue("v1.0.0"),
          previousTag: vi.fn().mockResolvedValue("v0.9.0"),
          firstCommit: vi.fn().mockResolvedValue("aaa"),
          commits: vi.fn().mockResolvedValue([{ id: "abc", message: "feat" }]),
          repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
          stash,
          popStash,
          status: vi.fn().mockResolvedValue(" M package.json"),
          checkTagExist: vi.fn().mockResolvedValue(false),
          revParse: vi.fn().mockResolvedValue("abc123"),
          branch: vi.fn().mockResolvedValue("main"),
        } as any;
      });

      const options = createOptions();
      await run(options);

      // Execute rollback to verify stash/popStash are called
      await options.runtime.rollback.execute(options, { interactive: false });

      expect(stash).toHaveBeenCalledOnce();
      expect(popStash).toHaveBeenCalledOnce();
    });

    it("push falls back to PR creation when push returns false (protected branch)", async () => {
      mockedExec.mockResolvedValue({
        stdout: "https://github.com/user/repo/pull/42",
        stderr: "",
      } as any);
      process.env.GITHUB_TOKEN = "mock-gh-token";

      // Make push return false (GH006)
      mockedGit.mockImplementation(function () {
        return {
          reset: vi.fn().mockResolvedValue(undefined),
          stage: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue("abc123"),
          createTag: vi.fn().mockResolvedValue(undefined),
          push: vi.fn().mockResolvedValue(false),
          pushDelete: vi.fn().mockResolvedValue(undefined),
          pushNewBranch: vi.fn().mockResolvedValue(undefined),
          createBranch: vi.fn().mockResolvedValue(undefined),
          switch: vi.fn().mockResolvedValue(undefined),
          latestTag: vi.fn().mockResolvedValue("v1.0.0"),
          previousTag: vi.fn().mockResolvedValue("v0.9.0"),
          firstCommit: vi.fn().mockResolvedValue("aaa"),
          commits: vi.fn().mockResolvedValue([{ id: "abc", message: "feat" }]),
          repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
          stash: vi.fn().mockResolvedValue(undefined),
          popStash: vi.fn().mockResolvedValue(undefined),
          deleteTag: vi.fn().mockResolvedValue(undefined),
          status: vi.fn().mockResolvedValue(""),
          checkTagExist: vi.fn().mockResolvedValue(false),
          revParse: vi.fn().mockResolvedValue("abc123"),
          branch: vi.fn().mockResolvedValue("main"),
        } as any;
      });

      const options = createOptions();
      await run(options);

      // Should succeed (PR fallback)
      expect(mockedConsoleError).not.toHaveBeenCalled();

      delete process.env.GITHUB_TOKEN;
    });

    it("creates PR directly when createPr option is true", async () => {
      process.env.GITHUB_TOKEN = "mock-gh-token";
      mockedExec.mockResolvedValue({
        stdout: "https://github.com/user/repo/pull/99",
        stderr: "",
      } as any);

      const createBranch = vi.fn().mockResolvedValue(undefined);
      const pushNewBranch = vi.fn().mockResolvedValue(undefined);
      const switchFn = vi.fn().mockResolvedValue(undefined);
      const pushFn = vi.fn().mockResolvedValue(true);
      mockedGit.mockImplementation(function () {
        return {
          reset: vi.fn().mockResolvedValue(undefined),
          stage: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue("abc123"),
          createTag: vi.fn().mockResolvedValue(undefined),
          deleteTag: vi.fn().mockResolvedValue(undefined),
          push: pushFn,
          pushDelete: vi.fn().mockResolvedValue(undefined),
          pushNewBranch,
          createBranch,
          switch: switchFn,
          latestTag: vi.fn().mockResolvedValue("v1.0.0"),
          previousTag: vi.fn().mockResolvedValue("v0.9.0"),
          firstCommit: vi.fn().mockResolvedValue("aaa"),
          commits: vi.fn().mockResolvedValue([{ id: "abc", message: "feat" }]),
          repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
          stash: vi.fn().mockResolvedValue(undefined),
          popStash: vi.fn().mockResolvedValue(undefined),
          status: vi.fn().mockResolvedValue(""),
          checkTagExist: vi.fn().mockResolvedValue(false),
          revParse: vi.fn().mockResolvedValue("abc123"),
          branch: vi.fn().mockResolvedValue("main"),
          forcePush: vi.fn().mockResolvedValue(undefined),
        } as any;
      });

      const options = createOptions({ options: { createPr: true } });
      await run(options);

      // Push should not be called (createPr bypasses normal push)
      expect(pushFn).not.toHaveBeenCalled();
      expect(createBranch).toHaveBeenCalled();
      expect(pushNewBranch).toHaveBeenCalled();
      expect(switchFn).toHaveBeenCalled();

      delete process.env.GITHUB_TOKEN;
    });

    it("throws when GITHUB_TOKEN is missing during pushViaPr", async () => {
      const originalToken = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;

      mockedGit.mockImplementation(function () {
        return {
          reset: vi.fn().mockResolvedValue(undefined),
          stage: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue("abc123"),
          createTag: vi.fn().mockResolvedValue(undefined),
          deleteTag: vi.fn().mockResolvedValue(undefined),
          push: vi.fn().mockResolvedValue(false), // fallback to PR
          pushDelete: vi.fn().mockResolvedValue(undefined),
          pushNewBranch: vi.fn().mockResolvedValue(undefined),
          createBranch: vi.fn().mockResolvedValue(undefined),
          switch: vi.fn().mockResolvedValue(undefined),
          latestTag: vi.fn().mockResolvedValue("v1.0.0"),
          previousTag: vi.fn().mockResolvedValue("v0.9.0"),
          firstCommit: vi.fn().mockResolvedValue("aaa"),
          commits: vi.fn().mockResolvedValue([{ id: "abc", message: "feat" }]),
          repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
          stash: vi.fn().mockResolvedValue(undefined),
          popStash: vi.fn().mockResolvedValue(undefined),
          status: vi.fn().mockResolvedValue(""),
          checkTagExist: vi.fn().mockResolvedValue(false),
          revParse: vi.fn().mockResolvedValue("abc123"),
          branch: vi.fn().mockResolvedValue("main"),
          forcePush: vi.fn().mockResolvedValue(undefined),
        } as any;
      });

      const options = createOptions();
      await run(options);

      // Should have called consoleError because token is missing
      expect(mockedConsoleError).toHaveBeenCalled();

      if (originalToken) process.env.GITHUB_TOKEN = originalToken;
    });

    it("registers remote tag rollback for independent mode after pushViaPr", async () => {
      process.env.GITHUB_TOKEN = "mock-gh-token";
      mockedExec.mockResolvedValue({
        stdout: "https://github.com/user/repo/pull/77",
        stderr: "",
      } as any);

      const pushDelete = vi.fn().mockResolvedValue(undefined);
      mockedGit.mockImplementation(function () {
        return {
          reset: vi.fn().mockResolvedValue(undefined),
          stage: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue("abc123"),
          createTag: vi.fn().mockResolvedValue(undefined),
          deleteTag: vi.fn().mockResolvedValue(undefined),
          push: vi.fn().mockResolvedValue(false), // fallback to PR
          pushDelete,
          pushNewBranch: vi.fn().mockResolvedValue(undefined),
          createBranch: vi.fn().mockResolvedValue(undefined),
          switch: vi.fn().mockResolvedValue(undefined),
          latestTag: vi.fn().mockResolvedValue("v1.0.0"),
          previousTag: vi.fn().mockResolvedValue("v0.9.0"),
          firstCommit: vi.fn().mockResolvedValue("aaa"),
          commits: vi.fn().mockResolvedValue([{ id: "abc", message: "feat" }]),
          repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
          stash: vi.fn().mockResolvedValue(undefined),
          popStash: vi.fn().mockResolvedValue(undefined),
          status: vi.fn().mockResolvedValue(""),
          checkTagExist: vi.fn().mockResolvedValue(false),
          revParse: vi.fn().mockResolvedValue("abc123"),
          branch: vi.fn().mockResolvedValue("main"),
          forcePush: vi.fn().mockResolvedValue(undefined),
        } as any;
      });

      const options = createOptions({
        runtime: {
          versionPlan: {
            mode: "independent" as const,
            packages: new Map([
              ["packages/a", "1.1.0"],
              ["packages/b", "2.0.0"],
            ]),
          },
        },
        config: {
          packages: [
            {
              path: "packages/a",
              name: "pkg-a",
              version: "1.0.0",
              ecosystem: "js" as const,
              dependencies: [],
              registries: ["npm"] as any,
            },
            {
              path: "packages/b",
              name: "pkg-b",
              version: "1.0.0",
              ecosystem: "js" as const,
              dependencies: [],
              registries: ["npm"] as any,
            },
          ],
        },
      });
      await run(options);

      // Rollback should include remote tag deletion entries for independent packages
      expect(options.runtime.rollback.size).toBeGreaterThan(0);

      delete process.env.GITHUB_TOKEN;
    });

    it("release draft generates body with commits and opens browser when no GH token", async () => {
      const { openUrl } = await import("../../../src/utils/open-url.js");
      const { resolveGitHubToken } = await import(
        "../../../src/utils/github-token.js"
      );
      vi.mocked(resolveGitHubToken).mockReturnValueOnce(undefined as any);
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      mockedGit.mockImplementation(function () {
        return {
          reset: vi.fn().mockResolvedValue(undefined),
          stage: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue("abc123"),
          createTag: vi.fn().mockResolvedValue(undefined),
          push: vi.fn().mockResolvedValue(true),
          latestTag: vi.fn().mockResolvedValue("v1.0.0"),
          previousTag: vi.fn().mockResolvedValue(null),
          firstCommit: vi.fn().mockResolvedValue("first-commit"),
          commits: vi.fn().mockResolvedValue([
            { id: "dummy", message: "dummy" },
            { id: "abc123", message: "feat: add feature" },
            { id: "def456", message: "fix: fix #123 bug" },
          ]),
          repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
          stash: vi.fn().mockResolvedValue(undefined),
          popStash: vi.fn().mockResolvedValue(undefined),
          deleteTag: vi.fn().mockResolvedValue(undefined),
          status: vi.fn().mockResolvedValue(""),
          checkTagExist: vi.fn().mockResolvedValue(false),
          revParse: vi.fn().mockResolvedValue("abc123"),
          branch: vi.fn().mockResolvedValue("main"),
        } as any;
      });

      const options = createOptions();
      await run(options);

      expect(openUrl).toHaveBeenCalled();
    });

    it("publish-only maps default registry to publish tasks", async () => {
      const options = createOptions({
        options: { publish: true },
        config: {
          packages: [
            pkg({ path: ".", registries: ["custom-registry"] as any }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      expect(tasks[3].title).toBe("Publishing");
    });

    it("normal mode maps default registry to npmPublishTasks", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions({
        config: {
          packages: [
            pkg({ path: ".", registries: ["custom-registry"] as any }),
          ],
        },
      });
      await run(options);

      expect(mockedCreateListr).toHaveBeenCalled();
    });

    it("summarizes publish subtasks before starting concurrent publishing", async () => {
      const options = createOptions();
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const publishTask = tasks[3];
      const mockParentTask = {
        output: "",
        title: "Publishing",
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await publishTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      expect(mockParentTask.title).toBe("Publishing (2 targets)");
      expect(mockParentTask.output).toContain("Concurrent publish tasks");
      expect(mockParentTask.output).toContain("JavaScript ecosystem > npm");
      expect(mockParentTask.output).toContain("JavaScript ecosystem > jsr");
    });
  });

  describe("multi-package publishing", () => {
    it("uses per-package registries from packages config in normal mode", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions({
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm", "jsr"] }),
            pkg({ path: "rust/crates/my-crate", registries: ["crates"] }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const publishTask = tasks[3]; // Publishing task

      // Get the subtasks generated by the publishing task
      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await publishTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      const allSubtasks = (mockParentTask.newListr as any).mock.calls[0][0];
      expect(allSubtasks).toHaveLength(2);
      expect(allSubtasks[0].title).toBe("JavaScript ecosystem");
      expect(allSubtasks[1].title).toBe("Rust ecosystem");
    });

    it("uses per-package registries in publish-only mode", async () => {
      const options = createOptions({
        options: { publish: true },
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm", "jsr"] }),
            pkg({ path: "rust/crates/my-crate", registries: ["crates"] }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const publishTask = tasks[3]; // Publishing task

      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await publishTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      const allSubtasks = (mockParentTask.newListr as any).mock.calls[0][0];
      expect(allSubtasks).toHaveLength(2);
      expect(allSubtasks[0].title).toBe("JavaScript ecosystem");
      expect(allSubtasks[1].title).toBe("Rust ecosystem");
    });

    it("deduplicates js publish tasks across packages", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions({
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm", "jsr"] }),
            pkg({ path: "packages/other", registries: ["npm"] }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const publishTask = tasks[3];

      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await publishTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      const allSubtasks = (mockParentTask.newListr as any).mock.calls[0][0];
      expect(allSubtasks).toHaveLength(1);
      expect(allSubtasks[0].title).toBe("JavaScript ecosystem");

      const ecosystemParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await allSubtasks[0].task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        ecosystemParentTask,
      );

      const registrySubtasks = (ecosystemParentTask.newListr as any).mock
        .calls[0][0];
      expect(registrySubtasks).toHaveLength(2);
      expect(registrySubtasks[0].title).toBe("Running npm publish");
      expect(registrySubtasks[1].title).toBe("Running jsr publish");
    });

    it("creates per-package crate publish tasks with package path", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions({
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm"] }),
            pkg({ path: "rust/crates/lib-a", registries: ["crates"] }),
            pkg({ path: "rust/crates/lib-b", registries: ["crates"] }),
          ] as any,
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const publishTask = tasks[3];

      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await publishTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      const allSubtasks = (mockParentTask.newListr as any).mock.calls[0][0];
      expect(allSubtasks).toHaveLength(2);
      expect(allSubtasks[0].title).toBe("JavaScript ecosystem");
      expect(allSubtasks[1].title).toBe("Rust ecosystem");

      const jsParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };
      const rustParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await allSubtasks[0].task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        jsParentTask,
      );
      await allSubtasks[1].task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        rustParentTask,
      );

      const jsRegistrySubtasks = (jsParentTask.newListr as any).mock
        .calls[0][0];
      const rustRegistrySubtasks = (rustParentTask.newListr as any).mock
        .calls[0][0];
      expect(jsRegistrySubtasks[0].title).toBe("Running npm publish");
      expect(rustRegistrySubtasks[0].title).toBe("Running crates.io publish");
    });

    it("creates per-package crate publish tasks in publish-only mode", async () => {
      const options = createOptions({
        options: { publish: true },
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm"] }),
            pkg({ path: "rust/crates/my-crate", registries: ["crates"] }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const publishTask = tasks[3]; // Publishing task

      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await publishTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      const allSubtasks = (mockParentTask.newListr as any).mock.calls[0][0];
      expect(allSubtasks).toHaveLength(2);
      expect(allSubtasks[0].title).toBe("JavaScript ecosystem");
      expect(allSubtasks[1].title).toBe("Rust ecosystem");
    });

    it("calls orderPackages on crates registry descriptor for crate packages", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const { registryCatalog } = await import(
        "../../../src/registry/catalog.js"
      );
      const cratesDescriptor = registryCatalog.get("crates") as any;
      cratesDescriptor.orderPackages.mockImplementation((paths: string[]) =>
        Promise.resolve(paths),
      );

      const options = createOptions({
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm"] }),
            pkg({ path: "rust/crates/update-kit", registries: ["crates"] }),
            pkg({ path: "rust/crates/update-kit-cli", registries: ["crates"] }),
          ],
        },
      });
      await run(options);

      expect(cratesDescriptor.orderPackages).toHaveBeenCalledWith([
        "rust/crates/update-kit",
        "rust/crates/update-kit-cli",
      ]);
    });

    it("wraps crates in a sequential task with concurrent: false", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions({
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm"] }),
            pkg({ path: "rust/crates/lib-a", registries: ["crates"] }),
            pkg({ path: "rust/crates/lib-b", registries: ["crates"] }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const publishTask = tasks[3];

      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await publishTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      const subtasks = (mockParentTask.newListr as any).mock.calls[0][0];
      expect(subtasks).toHaveLength(2);
      expect(subtasks[0].title).toBe("JavaScript ecosystem");
      expect(subtasks[1].title).toBe("Rust ecosystem");

      const jsParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };
      const rustParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await subtasks[0].task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        jsParentTask,
      );
      await subtasks[1].task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        rustParentTask,
      );

      const jsRegistrySubtasks = (jsParentTask.newListr as any).mock
        .calls[0][0];
      expect(jsRegistrySubtasks[0].title).toBe("Running npm publish");

      const rustRegistrySubtasks = (rustParentTask.newListr as any).mock
        .calls[0][0];
      expect(rustRegistrySubtasks[0].title).toBe("Running crates.io publish");

      const innerParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };
      rustRegistrySubtasks[0].task({}, innerParentTask);

      const innerSubtasks = (innerParentTask.newListr as any).mock.calls[0][0];
      const innerOptions = (innerParentTask.newListr as any).mock.calls[0][1];
      expect(innerSubtasks).toHaveLength(2);
      expect(innerSubtasks[0].title).toBe("crates publish (rust/crates/lib-a)");
      expect(innerSubtasks[1].title).toBe("crates publish (rust/crates/lib-b)");
      expect(innerOptions.concurrent).toBe(false);
    });

    it("uses per-package registries when packages config is present", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions({
        config: { packages: [pkg({ path: ".", registries: ["npm"] })] },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const publishTask = tasks[3];

      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await publishTask.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      const allSubtasks = (mockParentTask.newListr as any).mock.calls[0][0];
      expect(allSubtasks).toHaveLength(1);
      expect(allSubtasks[0].title).toBe("JavaScript ecosystem");

      const ecosystemParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await allSubtasks[0].task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        ecosystemParentTask,
      );

      const registrySubtasks = (ecosystemParentTask.newListr as any).mock
        .calls[0][0];
      expect(registrySubtasks).toHaveLength(1);
      expect(registrySubtasks[0].title).toBe("Running npm publish");
    });
  });

  describe("success", () => {
    it("logs success message after completing all tasks", async () => {
      const options = createOptions();
      await run(options);

      expect(consoleSpy).toHaveBeenCalledOnce();
      const logMessage = consoleSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("Successfully published");
    });

    it("includes npm and jsr in success message when packages have those registries", async () => {
      const options = createOptions({
        config: {
          packages: [pkg({ path: ".", registries: ["npm", "jsr"] })],
        },
      });
      await run(options);

      const logMessage = consoleSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("npm");
      expect(logMessage).toContain("jsr");
    });

    it("includes crates in success message when crates registry is used", async () => {
      const options = createOptions({
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm"] }),
            pkg({ path: "rust/crates/my-crate", registries: ["crates"] }),
          ],
        },
      });
      await run(options);

      const logMessage = consoleSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("crates.io");
      expect(logMessage).toContain("rust/crates/my-crate");
    });

    it("does not include jsr in success message when only npm is configured", async () => {
      const options = createOptions({
        config: {
          packages: [pkg({ path: ".", registries: ["npm"] })],
        },
      });
      await run(options);

      const logMessage = consoleSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("npm");
      expect(logMessage).not.toContain("jsr");
    });

    it("does not call process.exit on success", async () => {
      const options = createOptions();
      await run(options);

      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("does not call rollback on success", async () => {
      const options = createOptions();
      const executeSpy = vi.spyOn(options.runtime.rollback, "execute");
      await run(options);

      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  describe("SIGINT handling", () => {
    it("registers a SIGINT handler when run starts", async () => {
      const onSpy = vi.spyOn(process, "on");

      const options = createOptions();
      await run(options);

      expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      onSpy.mockRestore();
    });

    it("removes the SIGINT handler on success", async () => {
      const removeSpy = vi.spyOn(process, "removeListener");

      const options = createOptions();
      await run(options);

      expect(removeSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      removeSpy.mockRestore();
    });

    it("removes the SIGINT handler on error", async () => {
      const removeSpy = vi.spyOn(process, "removeListener");
      const error = new Error("Task failed");
      mockedPrerequisitesCheckTask.mockReturnValueOnce({
        run: vi.fn().mockRejectedValue(error),
      } as any);

      const options = createOptions();
      await run(options);

      expect(removeSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      removeSpy.mockRestore();
    });

    it("calls rollback and exits with 130 when SIGINT fires", async () => {
      let sigintHandler: (() => Promise<void>) | undefined;
      const onSpy = vi
        .spyOn(process, "on")
        // @ts-expect-error: simplified mock for SIGINT capture
        .mockImplementation((event: string, handler: any) => {
          if (event === "SIGINT") sigintHandler = handler;
          return process;
        });

      const options = createOptions();
      const executeSpy = vi.spyOn(options.runtime.rollback, "execute");
      await run(options);

      expect(sigintHandler).toBeDefined();
      await sigintHandler!();

      expect(executeSpy).toHaveBeenCalledOnce();
      expect(processExitSpy).toHaveBeenCalledWith(130);

      onSpy.mockRestore();
    });
  });

  describe("JSR token early collection", () => {
    it("collects JSR token before conditions check when jsr registry is configured", async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      mockedCollectTokens.mockResolvedValue({ jsr: "jsr-test-token" });

      const options = createOptions();
      await run(options);

      expect(mockedCollectTokens).toHaveBeenCalledWith(
        ["jsr"],
        expect.anything(),
      );
      expect(mockedInjectTokensToEnv).toHaveBeenCalledWith({
        jsr: "jsr-test-token",
      });
      expect(JsrClient.token).toBe("jsr-test-token");

      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    });

    it("skips JSR token collection when jsr is not in registries", async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      const options = createOptions({
        config: {
          packages: [pkg({ path: ".", registries: ["npm"] })],
        },
      });
      await run(options);

      const createListrCalls = mockedCreateListr.mock.calls;
      const jsrAuthCall = createListrCalls.find(
        (call) =>
          !Array.isArray(call[0]) &&
          call[0]?.title === "Ensuring registry authentication",
      );
      expect(jsrAuthCall).toBeUndefined();
      expect(mockedCollectTokens).not.toHaveBeenCalledWith(
        ["jsr"],
        expect.anything(),
      );

      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    });

    it("skips JSR token collection when promptEnabled is false", async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });

      const options = createOptions();
      await run(options);

      const createListrCalls = mockedCreateListr.mock.calls;
      const jsrAuthCall = createListrCalls.find(
        (call) =>
          !Array.isArray(call[0]) &&
          call[0]?.title === "Ensuring registry authentication",
      );
      expect(jsrAuthCall).toBeUndefined();
      expect(mockedCollectTokens).not.toHaveBeenCalledWith(
        ["jsr"],
        expect.anything(),
      );

      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    });

    // The prompt-skip-when-token-exists logic lives inside collectTokens itself
    // and is tested in preflight.test.ts. At the runner level, collectTokens is
    // always called and the runner uses whatever it returns.
    it("delegates token existence check to collectTokens (prompt-skip tested in preflight.test.ts)", async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      mockedCollectTokens.mockResolvedValue({ jsr: "existing-token" });

      const options = createOptions();
      await run(options);

      expect(mockedCollectTokens).toHaveBeenCalled();
      expect(JsrClient.token).toBe("existing-token");

      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    });
  });

  describe("CI prepare mode", () => {
    it("runs prerequisites and conditions checks in CI prepare mode", async () => {
      const options = createOptions({
        options: { mode: "ci", prepare: true },
      });
      await run(options);

      expect(mockedPrerequisitesCheckTask).toHaveBeenCalled();
      expect(mockedRequiredConditionsCheckTask).toHaveBeenCalled();
    });

    it("creates task list with dry-run publish instead of real publish", async () => {
      const options = createOptions({
        options: { mode: "ci", prepare: true },
      });
      await run(options);

      // First createListr call is token collection, second is pipeline
      const pipelineCall = mockedCreateListr.mock.calls.find((call) =>
        Array.isArray(call[0]),
      );
      const tasks = pipelineCall![0] as any[];

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(11);
      expect(tasks[0].title).toBe("Running tests");
      expect(tasks[1].title).toBe("Building the project");
      expect(tasks[2].title).toBe("Bumping version");
      expect(tasks[3].title).toBe("Publishing");
      expect(tasks[4].title).toBe("Restoring workspace protocols");
      expect(tasks[5].title).toBe("Running post-publish hooks");
      expect(tasks[6].title).toBe("Validating publish (dry-run)");
      expect(tasks[7].title).toBe("Restoring workspace protocols");
      expect(tasks[8].title).toBe("Restoring original versions (dry-run)");
      expect(tasks[9].title).toBe("Pushing tags to GitHub");
      expect(tasks[10].title).toBe("Creating GitHub Release");
    });

    it("injects tokens into env and cleans up after pipeline", async () => {
      const cleanupFn = vi.fn();
      mockedInjectTokensToEnv.mockReturnValue(cleanupFn);

      const options = createOptions({
        options: { mode: "ci", prepare: true },
      });
      await run(options);

      expect(mockedInjectTokensToEnv).toHaveBeenCalledWith({
        npm: "test-token",
      });
      expect(cleanupFn).toHaveBeenCalled();
    });

    it("skips real publish and uses dry-run in CI prepare", async () => {
      const options = createOptions({
        options: { mode: "ci", prepare: true },
      });
      await run(options);

      const pipelineCall = mockedCreateListr.mock.calls.find((call) =>
        Array.isArray(call[0]),
      );
      const tasks = pipelineCall![0] as any[];

      // Publishing should be disabled (hasPublish=false)
      expect(tasks[3].enabled).toBe(false);

      // Dry-run validation should be enabled in CI prepare
      expect(tasks[6].enabled).toBe(true);
    });

    it("shows CI prepare success message", async () => {
      const options = createOptions({
        options: { mode: "ci", prepare: true },
      });
      await run(options);

      const logMessage = consoleSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("CI prepare completed");
    });

    it("throws for unknown registries in CI prepare mode dry-run", async () => {
      await run(
        createOptions({
          options: { mode: "ci", prepare: true },
          config: {
            packages: [
              pkg({ path: ".", registries: ["custom-registry"] as any }),
            ],
          },
        }),
      );

      const pipelineCall = mockedCreateListr.mock.calls.find((call) =>
        Array.isArray(call[0]),
      );
      const tasks = pipelineCall![0] as any[];
      const validateTask = tasks[6];
      const parentTask = {
        output: "",
        title: "",
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };
      const ctx: any = {
        config: {
          packages: [
            pkg({ path: ".", registries: ["custom-registry"] as any }),
          ],
        },
        runtime: { pluginRunner: new PluginRunner([]) },
      };

      await validateTask.task(ctx, parentTask);

      const ecosystemTasks = parentTask.newListr.mock.calls[0][0];
      const ecosystemParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await ecosystemTasks[0].task(ctx, ecosystemParentTask);

      const registryWrapperTask =
        ecosystemParentTask.newListr.mock.calls[0][0][0];
      expect(registryWrapperTask.title).toBe("Dry-run custom-registry publish");

      const innerParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };
      expect(() => registryWrapperTask.task(ctx, innerParentTask)).toThrow(
        'No dry-run task factory registered for registry "custom-registry"',
      );
    });

    it("re-syncs lockfile after restoring workspace protocols", async () => {
      const jsDesc = ecosystemCatalog.get("js")!;
      const syncLockfileSpy = vi.spyOn(
        jsDesc.ecosystemClass.prototype,
        "syncLockfile",
      );
      syncLockfileSpy.mockResolvedValue("/workspace/bun.lock");

      const options = createOptions({
        options: { mode: "ci", prepare: true },
        runtime: {
          versionPlan: {
            mode: "single" as const,
            version: "2.0.0",
            packagePath: ".",
          },
          workspaceBackups: new Map([
            ["/workspace/packages/pubm/package.json", '{"version":"2.0.0"}'],
          ]),
        },
      });

      await run(options);

      expect(syncLockfileSpy).toHaveBeenCalled();
      syncLockfileSpy.mockRestore();
    });
  });
});
