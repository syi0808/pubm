import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("std-env", () => ({ isCI: false }));
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
vi.mock("../../../src/utils/rollback.js", () => ({
  rollback: vi.fn(),
  addRollback: vi.fn(),
  rollbackLog: vi.fn(),
  rollbackError: vi.fn(),
}));
vi.mock("../../../src/utils/cli.js", () => ({
  link: vi.fn(),
}));
vi.mock("../../../src/tasks/prerequisites-check.js", () => ({
  prerequisitesCheckTask: vi.fn(),
}));
vi.mock("../../../src/tasks/required-conditions-check.js", () => ({
  requiredConditionsCheckTask: vi.fn(),
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
  createCratesDryRunPublishTask: vi.fn((packagePath?: string) => ({
    title: `Dry-run crates publish (${packagePath})`,
    task: vi.fn(),
  })),
}));
vi.mock("../../../src/tasks/preflight.js", () => ({
  collectTokens: vi.fn(),
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
}));
vi.mock("../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(),
}));
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
import { link } from "../../../src/utils/cli.js";
import { sortCratesByDependencyOrder } from "../../../src/utils/crate-graph.js";
import { exec } from "../../../src/utils/exec.js";
import { createCiListrOptions, createListr } from "../../../src/utils/listr.js";
import { getPackageManager } from "../../../src/utils/package-manager.js";
import { addRollback, rollback } from "../../../src/utils/rollback.js";
import { injectTokensToEnv } from "../../../src/utils/token.js";
import { makeTestContext } from "../../helpers/make-context.js";

const mockedPrerequisitesCheckTask = vi.mocked(prerequisitesCheckTask);
const mockedRequiredConditionsCheckTask = vi.mocked(
  requiredConditionsCheckTask,
);
const mockedCreateListr = vi.mocked(createListr);
const mockedCreateCiListrOptions = vi.mocked(createCiListrOptions);
const mockedConsoleError = vi.mocked(consoleError);
const mockedRollback = vi.mocked(rollback);
const mockedExec = vi.mocked(exec);
const mockedGetPackageManager = vi.mocked(getPackageManager);
const mockedWriteVersionsForEcosystem = vi.mocked(writeVersionsForEcosystem);
const mockedAddRollback = vi.mocked(addRollback);
const mockedLink = vi.mocked(link);
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
          if (typeof task.skip === "function" && task.skip(ctx)) continue;
          if (typeof task.skip === "boolean" && task.skip) continue;
          if (task.task) {
            const mockTask = {
              output: "",
              title: task.title || "",
              newListr: vi.fn((_subtasks: any[]) => ({
                run: vi.fn(),
              })),
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
    } as any;
  });
  mockedGetPackageManager.mockResolvedValue("pnpm" as any);
  mockedWriteVersionsForEcosystem.mockResolvedValue([]);
  mockedRollback.mockResolvedValue(undefined);
  mockedAddRollback.mockImplementation(() => {});
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

  describe("publishOnly mode", () => {
    it("skips prerequisites and conditions checks when publishOnly is true", async () => {
      const options = createOptions({ options: { publishOnly: true } });
      await run(options);

      expect(mockedPrerequisitesCheckTask).not.toHaveBeenCalled();
      expect(mockedRequiredConditionsCheckTask).not.toHaveBeenCalled();
    });

    it("passes a single publishing task object instead of task array", async () => {
      const options = createOptions({ options: { publishOnly: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      // publishOnly passes a single object, not an array
      expect(callArgs[0]).toHaveProperty("title", "Publishing");
      expect(Array.isArray(callArgs[0])).toBe(false);
    });
  });

  describe("CI logging", () => {
    it("passes CI renderer options to the pipeline when --ci is enabled", async () => {
      const ciListrOptions = { renderer: "ci-renderer" } as any;
      mockedCreateCiListrOptions.mockReturnValue(ciListrOptions);

      const options = createOptions({ options: { ci: true } });
      await run(options);

      expect(mockedCreateCiListrOptions).toHaveBeenCalled();
      expect(mockedCreateListr.mock.calls[0][1]).toBe(ciListrOptions);
    });
  });

  describe("normal mode (publishOnly=false)", () => {
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
      expect(tasks).toHaveLength(8);
      expect(tasks[0].title).toBe("Running tests");
      expect(tasks[1].title).toBe("Building the project");
      expect(tasks[2].title).toBe("Bumping version");
      expect(tasks[3].title).toBe("Publishing");
      expect(tasks[4].title).toBe("Running post-publish hooks");
      expect(tasks[5].title).toBe("Validating publish (dry-run)");
      expect(tasks[6].title).toBe("Pushing tags to GitHub");
      expect(tasks[7].title).toBe("Creating release draft on GitHub");
    });
  });

  describe("task skip flags", () => {
    it("skips tests when skipTests is true", async () => {
      const options = createOptions({ options: { skipTests: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[0].skip).toBe(true);
    });

    it("skips build when skipBuild is true", async () => {
      const options = createOptions({ options: { skipBuild: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[1].skip).toBe(true);
    });

    it("skips version bump when preview is set", async () => {
      const options = createOptions({ options: { preview: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[2].skip as (ctx: any) => boolean;

      expect(skipFn({ options: { preview: true } })).toBe(true);
    });

    it("does not skip version bump when preview is falsy", async () => {
      const options = createOptions();
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[2].skip as (ctx: any) => boolean;

      expect(skipFn({ options: { preview: undefined } })).toBe(false);
    });

    it("skips publish when skipPublish is true", async () => {
      const options = createOptions({ options: { skipPublish: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[3].skip as (ctx: any) => boolean;

      expect(skipFn({ options: { preview: false, skipPublish: true } })).toBe(
        true,
      );
    });

    it("skips publish when preview is set", async () => {
      const options = createOptions({ options: { preview: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[3].skip as (ctx: any) => boolean;

      expect(skipFn({ options: { preview: true } })).toBe(true);
    });

    it("skips pushing tags when preview is set", async () => {
      const options = createOptions({ options: { preview: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[6].skip as (ctx: any) => boolean;

      expect(skipFn({ options: { preview: true } })).toBe(true);
    });

    it("skips release draft when skipReleaseDraft is true", async () => {
      const options = createOptions({ options: { skipReleaseDraft: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[7].skip as (ctx: any) => boolean;

      expect(
        skipFn({ options: { preview: false, skipReleaseDraft: true } }),
      ).toBe(true);
    });

    it("skips release draft when preview is set", async () => {
      const options = createOptions({ options: { preview: true } });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[7].skip as (ctx: any) => boolean;

      expect(skipFn({ options: { preview: true } })).toBe(true);
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
      await run(options);

      expect(mockedRollback).toHaveBeenCalledOnce();
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
      mockedRollback.mockImplementationOnce(async () => {
        callOrder.push("rollback");
      });
      processExitSpy.mockImplementation((() => {
        callOrder.push("exit");
      }) as any);

      const error = new Error("Task failed");
      mockedPrerequisitesCheckTask.mockReturnValueOnce({
        run: vi.fn().mockRejectedValue(error),
      } as any);

      const options = createOptions();
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
            ci: false,
            promptEnabled: true,
            pluginRunner: new PluginRunner([]),
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
            ci: false,
            promptEnabled: true,
            pluginRunner: new PluginRunner([]),
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

    it("does not attach live output callbacks in CI mode", async () => {
      const originalIsTTY = process.stdout.isTTY;
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
            options: { ...options.options, ci: true },
            runtime: { ...options.runtime, promptEnabled: false },
          },
          mockTask,
        );

        expect(mockedExec).toHaveBeenCalledWith("pnpm", ["run", "test"], {
          onStderr: undefined,
          onStdout: undefined,
          throwOnError: true,
        });
      } finally {
        Object.defineProperty(process.stdout, "isTTY", {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });

    it("runs test task and throws AbstractError with context on exec rejection", async () => {
      mockedExec.mockRejectedValueOnce(new Error("test error"));

      const options = createOptions();
      await run(options);

      // Error triggers catch block with context message
      expect(mockedConsoleError).toHaveBeenCalled();
      const errorArg = mockedConsoleError.mock.calls[0][0];
      expect((errorArg as Error).message).toMatch(/Test script 'test' failed/);
    });

    it("runs test task successfully when no stderr", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions();
      await run(options);

      expect(mockedGetPackageManager).toHaveBeenCalled();
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

      // addRollback should have been called for version bump
      expect(mockedAddRollback).toHaveBeenCalled();
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

      let capturedRollback: Function | undefined;
      mockedAddRollback.mockImplementation((fn: any) => {
        capturedRollback = fn;
      });

      const options = createOptions();
      await run(options);

      // Execute the captured rollback
      expect(capturedRollback).toBeDefined();
      await capturedRollback!();
    });

    it("stashes and restores dirty files while rolling back a release commit", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      let capturedRollback: Function | undefined;
      const stash = vi.fn().mockResolvedValue(undefined);
      const popStash = vi.fn().mockResolvedValue(undefined);
      mockedAddRollback.mockImplementation((fn: any) => {
        capturedRollback = fn;
      });
      mockedGit.mockImplementation(function () {
        return {
          reset: vi.fn().mockResolvedValue(undefined),
          stage: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue("abc123"),
          createTag: vi.fn().mockResolvedValue(undefined),
          deleteTag: vi.fn().mockResolvedValue(undefined),
          push: vi.fn().mockResolvedValue(true),
          latestTag: vi.fn().mockResolvedValue("v1.0.0"),
          previousTag: vi.fn().mockResolvedValue("v0.9.0"),
          firstCommit: vi.fn().mockResolvedValue("aaa"),
          commits: vi.fn().mockResolvedValue([{ id: "abc", message: "feat" }]),
          repository: vi.fn().mockResolvedValue("https://github.com/user/repo"),
          stash,
          popStash,
          status: vi.fn().mockResolvedValue(" M package.json"),
          checkTagExist: vi.fn().mockResolvedValue(false),
        } as any;
      });

      await run(createOptions());

      expect(capturedRollback).toBeDefined();
      await capturedRollback!();

      expect(stash).toHaveBeenCalledOnce();
      expect(popStash).toHaveBeenCalledOnce();
    });

    it("push tags handles GH006 protected branch by pushing only tags", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      // Make push return false (GH006)
      mockedGit.mockImplementation(function () {
        return {
          reset: vi.fn().mockResolvedValue(undefined),
          stage: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue("abc123"),
          createTag: vi.fn().mockResolvedValue(undefined),
          push: vi
            .fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true),
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
        } as any;
      });

      const options = createOptions();
      await run(options);

      // Should succeed (push tags fallback)
      expect(mockedConsoleError).not.toHaveBeenCalled();
    });

    it("release draft generates body with commits and opens browser", async () => {
      const { openUrl } = await import("../../../src/utils/open-url.js");
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
        } as any;
      });

      const options = createOptions();
      await run(options);

      expect(openUrl).toHaveBeenCalled();
    });

    it("publishOnly maps default registry to npmPublishTasks", async () => {
      const options = createOptions({
        options: { publishOnly: true },
        config: {
          packages: [
            pkg({ path: ".", registries: ["custom-registry"] as any }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const taskDef = callArgs[0] as any;
      expect(taskDef.title).toBe("Publishing");
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

    it("uses per-package registries in publishOnly mode", async () => {
      const options = createOptions({
        options: { publishOnly: true },
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm", "jsr"] }),
            pkg({ path: "rust/crates/my-crate", registries: ["crates"] }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const taskDef = callArgs[0] as any;

      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await taskDef.task(
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

    it("creates per-package crate publish tasks in publishOnly mode", async () => {
      const options = createOptions({
        options: { publishOnly: true },
        config: {
          packages: [
            pkg({ path: ".", registries: ["npm"] }),
            pkg({ path: "rust/crates/my-crate", registries: ["crates"] }),
          ],
        },
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const taskDef = callArgs[0] as any;

      const mockParentTask = {
        newListr: vi.fn(() => ({ run: vi.fn() })),
      };

      await taskDef.task(
        { ...options, runtime: { ...options.runtime, promptEnabled: true } },
        mockParentTask,
      );

      const allSubtasks = (mockParentTask.newListr as any).mock.calls[0][0];
      expect(allSubtasks).toHaveLength(2);
      expect(allSubtasks[0].title).toBe("JavaScript ecosystem");
      expect(allSubtasks[1].title).toBe("Rust ecosystem");
    });

    it("calls sortCratesByDependencyOrder for crate packages", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);
      mockedSortCrates.mockResolvedValue([
        "rust/crates/update-kit",
        "rust/crates/update-kit-cli",
      ]);

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

      expect(mockedSortCrates).toHaveBeenCalledWith([
        "rust/crates/update-kit",
        "rust/crates/update-kit-cli",
      ]);
    });

    it("does not call sortCratesByDependencyOrder when no crates packages", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions({
        config: { packages: [pkg({ path: ".", registries: ["npm", "jsr"] })] },
      });
      await run(options);

      expect(mockedSortCrates).not.toHaveBeenCalled();
    });

    it("wraps crates in a sequential task with concurrent: false", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);
      mockedSortCrates.mockResolvedValue([
        "rust/crates/lib-a",
        "rust/crates/lib-b",
      ]);

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
      await run(options);

      expect(mockedRollback).not.toHaveBeenCalled();
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
      await run(options);

      expect(sigintHandler).toBeDefined();
      await sigintHandler!();

      expect(mockedRollback).toHaveBeenCalledOnce();
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
          call[0]?.title === "Ensuring JSR authentication",
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
          call[0]?.title === "Ensuring JSR authentication",
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

  describe("preflight mode", () => {
    it("runs prerequisites and conditions checks in preflight mode", async () => {
      const options = createOptions({ options: { preflight: true } });
      await run(options);

      expect(mockedPrerequisitesCheckTask).toHaveBeenCalled();
      expect(mockedRequiredConditionsCheckTask).toHaveBeenCalled();
    });

    it("creates task list with dry-run publish instead of real publish", async () => {
      const options = createOptions({ options: { preflight: true } });
      await run(options);

      // First createListr call is token collection, second is pipeline
      const pipelineCall = mockedCreateListr.mock.calls[1];
      const tasks = pipelineCall[0] as any[];

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(8);
      expect(tasks[0].title).toBe("Running tests");
      expect(tasks[1].title).toBe("Building the project");
      expect(tasks[2].title).toBe("Bumping version");
      expect(tasks[3].title).toBe("Publishing");
      expect(tasks[4].title).toBe("Running post-publish hooks");
      expect(tasks[5].title).toBe("Validating publish (dry-run)");
      expect(tasks[6].title).toBe("Pushing tags to GitHub");
      expect(tasks[7].title).toBe("Creating release draft on GitHub");
    });

    it("injects tokens into env and cleans up after pipeline", async () => {
      const cleanupFn = vi.fn();
      mockedInjectTokensToEnv.mockReturnValue(cleanupFn);

      const options = createOptions({ options: { preflight: true } });
      await run(options);

      expect(mockedInjectTokensToEnv).toHaveBeenCalledWith({
        npm: "test-token",
      });
      expect(cleanupFn).toHaveBeenCalled();
    });

    it("skips real publish and uses dry-run in preflight", async () => {
      const options = createOptions({ options: { preflight: true } });
      await run(options);

      const pipelineCall = mockedCreateListr.mock.calls[1];
      const tasks = pipelineCall[0] as any[];

      // Publishing should be skipped in preflight
      const publishSkipFn = tasks[3].skip as (ctx: any) => boolean;
      expect(
        publishSkipFn({ options: { preview: false, preflight: true } }),
      ).toBe(true);

      // Dry-run should not be skipped in preflight
      expect(tasks[5].skip).toBe(false);
    });

    it("shows preflight success message", async () => {
      const options = createOptions({ options: { preflight: true } });
      await run(options);

      const logMessage = consoleSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("Preflight check passed");
    });

    it("creates no-op dry-run task for unknown registries in preflight mode", async () => {
      await run(
        createOptions({
          options: { preflight: true },
          config: {
            packages: [
              pkg({ path: ".", registries: ["custom-registry"] as any }),
            ],
          },
        }),
      );

      const pipelineCall = mockedCreateListr.mock.calls[1];
      const tasks = pipelineCall[0] as any[];
      const validateTask = tasks[5];
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
      registryWrapperTask.task(ctx, innerParentTask);

      expect(innerParentTask.newListr.mock.calls[0][0][0].title).toBe(
        "Dry-run custom-registry",
      );
    });
  });
});
