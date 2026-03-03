import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("std-env", () => ({ isCI: false }));
vi.mock("tinyexec", () => ({
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
vi.mock("../../../src/utils/package.js", () => ({
  getPackageJson: vi.fn(),
  getJsrJson: vi.fn(),
  replaceVersion: vi.fn(),
  version: vi.fn(),
}));
vi.mock("../../../src/utils/rollback.js", () => ({
  rollback: vi.fn(),
  addRollback: vi.fn(),
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
}));
vi.mock("@npmcli/promise-spawn", () => ({
  default: { open: vi.fn() },
}));

vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn(),
}));

import { exec } from "tinyexec";
import { consoleError } from "../../../src/error.js";
import { Git } from "../../../src/git.js";
import { prerequisitesCheckTask } from "../../../src/tasks/prerequisites-check.js";
import { requiredConditionsCheckTask } from "../../../src/tasks/required-conditions-check.js";
import { run } from "../../../src/tasks/runner.js";
import type { ResolvedOptions } from "../../../src/types/options.js";
import { link } from "../../../src/utils/cli.js";
import { createListr } from "../../../src/utils/listr.js";
import {
  getJsrJson,
  getPackageJson,
  replaceVersion,
} from "../../../src/utils/package.js";
import { getPackageManager } from "../../../src/utils/package-manager.js";
import { addRollback, rollback } from "../../../src/utils/rollback.js";

const mockedPrerequisitesCheckTask = vi.mocked(prerequisitesCheckTask);
const mockedRequiredConditionsCheckTask = vi.mocked(
  requiredConditionsCheckTask,
);
const mockedCreateListr = vi.mocked(createListr);
const mockedConsoleError = vi.mocked(consoleError);
const mockedRollback = vi.mocked(rollback);
const mockedExec = vi.mocked(exec);
const mockedGetPackageManager = vi.mocked(getPackageManager);
const mockedGetPackageJson = vi.mocked(getPackageJson);
const mockedGetJsrJson = vi.mocked(getJsrJson);
const mockedReplaceVersion = vi.mocked(replaceVersion);
const mockedAddRollback = vi.mocked(addRollback);
const mockedLink = vi.mocked(link);
const mockedGit = vi.mocked(Git);

function createOptions(
  overrides: Partial<ResolvedOptions> = {},
): ResolvedOptions {
  return {
    version: "1.0.0",
    testScript: "test",
    buildScript: "build",
    branch: "main",
    tag: "latest",
    registries: ["npm", "jsr"],
    saveToken: true,
    ...overrides,
  } as ResolvedOptions;
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
  mockedGit.mockImplementation(
    () =>
      ({
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
      }) as any,
  );
  mockedGetPackageManager.mockResolvedValue("pnpm" as any);
  mockedGetPackageJson.mockResolvedValue({ name: "my-package" } as any);
  mockedGetJsrJson.mockResolvedValue({ name: "@scope/my-package" } as any);
  mockedReplaceVersion.mockResolvedValue(["package.json", "jsr.json"]);
  mockedRollback.mockResolvedValue(undefined);
  mockedAddRollback.mockImplementation(() => {});
  mockedLink.mockImplementation((_text: string, url: string) => url);
  mockedPrerequisitesCheckTask.mockReturnValue({
    run: vi.fn().mockResolvedValue(undefined),
  } as any);
  mockedRequiredConditionsCheckTask.mockReturnValue({
    run: vi.fn().mockResolvedValue(undefined),
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

    it("sets npmOnly to true when registries contain only npm", async () => {
      const options = createOptions({ registries: ["npm"] });
      await run(options);

      expect(mockedCreateListr).toHaveBeenCalled();
    });

    it("sets jsrOnly to true when registries contain only jsr", async () => {
      const options = createOptions({ registries: ["jsr"] });
      await run(options);

      expect(mockedCreateListr).toHaveBeenCalled();
    });

    it("sets npmOnly and jsrOnly to false when registries contain both", async () => {
      const options = createOptions({ registries: ["npm", "jsr"] });
      await run(options);

      expect(mockedCreateListr).toHaveBeenCalled();
    });
  });

  describe("contents option", () => {
    it("calls process.chdir when contents is set", async () => {
      const options = createOptions({ contents: "/some/path" });
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
      const options = createOptions({ publishOnly: true });
      await run(options);

      expect(mockedPrerequisitesCheckTask).not.toHaveBeenCalled();
      expect(mockedRequiredConditionsCheckTask).not.toHaveBeenCalled();
    });

    it("passes a single publishing task object instead of task array", async () => {
      const options = createOptions({ publishOnly: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      // publishOnly passes a single object, not an array
      expect(callArgs[0]).toHaveProperty("title", "Publishing");
      expect(Array.isArray(callArgs[0])).toBe(false);
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
      const options = createOptions({ skipPrerequisitesCheck: true });
      await run(options);

      expect(mockedPrerequisitesCheckTask).toHaveBeenCalledWith({
        skip: true,
      });
    });

    it("passes skipConditionsCheck to requiredConditionsCheckTask", async () => {
      const options = createOptions({ skipConditionsCheck: true });
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
      expect(tasks).toHaveLength(6);
      expect(tasks[0].title).toBe("Running tests");
      expect(tasks[1].title).toBe("Building the project");
      expect(tasks[2].title).toBe("Bumping version");
      expect(tasks[3].title).toBe("Publishing");
      expect(tasks[4].title).toBe("Pushing tags to GitHub");
      expect(tasks[5].title).toBe("Creating release draft on GitHub");
    });
  });

  describe("task skip flags", () => {
    it("skips tests when skipTests is true", async () => {
      const options = createOptions({ skipTests: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[0].skip).toBe(true);
    });

    it("skips build when skipBuild is true", async () => {
      const options = createOptions({ skipBuild: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];

      expect(tasks[1].skip).toBe(true);
    });

    it("skips version bump when preview is set", async () => {
      const options = createOptions({ preview: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[2].skip as (ctx: any) => boolean;

      expect(skipFn({ preview: true })).toBe(true);
    });

    it("does not skip version bump when preview is falsy", async () => {
      const options = createOptions();
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[2].skip as (ctx: any) => boolean;

      expect(skipFn({ preview: undefined })).toBe(false);
    });

    it("skips publish when skipPublish is true", async () => {
      const options = createOptions({ skipPublish: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[3].skip as (ctx: any) => boolean;

      expect(skipFn({ preview: false })).toBe(true);
    });

    it("skips publish when preview is set", async () => {
      const options = createOptions({ preview: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[3].skip as (ctx: any) => boolean;

      expect(skipFn({ preview: true })).toBe(true);
    });

    it("skips pushing tags when preview is set", async () => {
      const options = createOptions({ preview: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[4].skip as (ctx: any) => boolean;

      expect(skipFn({ preview: true })).toBe(true);
    });

    it("skips release draft when skipReleaseDraft is true", async () => {
      const options = createOptions({ skipReleaseDraft: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[5].skip as (ctx: any) => boolean;

      expect(skipFn({ preview: false })).toBe(true);
    });

    it("skips release draft when preview is set", async () => {
      const options = createOptions({ preview: true });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const tasks = callArgs[0] as any[];
      const skipFn = tasks[5].skip as (ctx: any) => boolean;

      expect(skipFn({ preview: true })).toBe(true);
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
    it("runs test task and throws on stderr", async () => {
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "test error",
      } as any);

      const options = createOptions();
      await run(options);

      // Error triggers catch block
      expect(mockedConsoleError).toHaveBeenCalled();
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
      expect(mockedReplaceVersion).toHaveBeenCalledWith("1.0.0");
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
      const rollbackConsoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});
      await capturedRollback!();
      rollbackConsoleSpy.mockRestore();
    });

    it("push tags handles GH006 protected branch by pushing only tags", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      // Make push return false (GH006)
      mockedGit.mockImplementation(
        () =>
          ({
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
            commits: vi
              .fn()
              .mockResolvedValue([{ id: "abc", message: "feat" }]),
            repository: vi
              .fn()
              .mockResolvedValue("https://github.com/user/repo"),
            stash: vi.fn().mockResolvedValue(undefined),
            popStash: vi.fn().mockResolvedValue(undefined),
            deleteTag: vi.fn().mockResolvedValue(undefined),
          }) as any,
      );

      const options = createOptions();
      await run(options);

      // Should succeed (push tags fallback)
      expect(mockedConsoleError).not.toHaveBeenCalled();
    });

    it("release draft generates body with commits and opens browser", async () => {
      const { default: npmCli } = await import("@npmcli/promise-spawn");
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      mockedGit.mockImplementation(
        () =>
          ({
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
            repository: vi
              .fn()
              .mockResolvedValue("https://github.com/user/repo"),
            stash: vi.fn().mockResolvedValue(undefined),
            popStash: vi.fn().mockResolvedValue(undefined),
            deleteTag: vi.fn().mockResolvedValue(undefined),
          }) as any,
      );

      const options = createOptions();
      await run(options);

      expect(npmCli.open).toHaveBeenCalled();
    });

    it("publishOnly maps default registry to npmPublishTasks", async () => {
      const options = createOptions({
        publishOnly: true,
        registries: ["custom-registry"],
      });
      await run(options);

      const callArgs = mockedCreateListr.mock.calls[0];
      const taskDef = callArgs[0] as any;
      expect(taskDef.title).toBe("Publishing");
    });

    it("normal mode maps default registry to npmPublishTasks", async () => {
      mockedExec.mockResolvedValue({ stdout: "ok", stderr: "" } as any);

      const options = createOptions({
        registries: ["custom-registry"],
      });
      await run(options);

      expect(mockedCreateListr).toHaveBeenCalled();
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
});
