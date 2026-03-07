import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(),
}));

vi.mock("../../../src/registry/index.js", () => ({
  getRegistry: vi.fn(),
}));

vi.mock("../../../src/registry/npm.js", () => ({
  npmRegistry: vi.fn(),
}));

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrRegistry: vi.fn(),
}));

vi.mock("../../../src/utils/engine-version.js", () => ({
  validateEngineVersion: vi.fn(),
}));

vi.mock("../../../src/utils/package.js", () => ({
  getPackageJson: vi.fn(),
}));

vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn((taskDef: any) => {
    return { _taskDef: taskDef, run: vi.fn() };
  }),
}));

vi.mock("../../../src/tasks/npm.js", () => ({
  npmAvailableCheckTasks: { title: "npm-check-mock", task: vi.fn() },
}));

vi.mock("../../../src/tasks/jsr.js", () => ({
  jsrAvailableCheckTasks: { title: "jsr-check-mock", task: vi.fn() },
}));

import type { Ctx } from "../../../src/tasks/runner.js";

function createCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    promptEnabled: true,
    cleanWorkingTree: true,
    registries: ["npm"],
    version: "1.0.0",
    tag: "latest",
    branch: "main",
    testScript: "test",
    buildScript: "build",
    skipTests: false,
    skipBuild: false,
    skipPublish: false,
    skipPrerequisitesCheck: false,
    skipConditionsCheck: false,
    skipReleaseDraft: false,
    publishOnly: false,
    ...overrides,
  } as Ctx;
}

function createMockTask(promptResponses: any[] = []) {
  let promptIndex = 0;
  return {
    output: "",
    title: "",
    prompt: vi.fn(() => ({
      run: vi.fn(async () => promptResponses[promptIndex++]),
    })),
  };
}

let mockGitInstance: Record<string, ReturnType<typeof vi.fn>>;
let capturedSubtasks: any[];

async function getSubtasks() {
  const { requiredConditionsCheckTask } = await import(
    "../../../src/tasks/required-conditions-check.js"
  );
  const listrResult = requiredConditionsCheckTask();
  const taskDef = (listrResult as any)._taskDef;

  const mockParentTask = {
    newListr: vi.fn((subtasks: any[], _opts?: any) => {
      capturedSubtasks = subtasks;
      return subtasks;
    }),
  };

  taskDef.task({}, mockParentTask);

  return capturedSubtasks;
}

beforeEach(async () => {
  vi.clearAllMocks();

  vi.resetModules();

  vi.doMock("../../../src/git.js", () => ({
    Git: vi.fn(),
  }));

  vi.doMock("../../../src/registry/index.js", () => ({
    getRegistry: vi.fn(),
  }));

  vi.doMock("../../../src/registry/npm.js", () => ({
    npmRegistry: vi.fn(),
  }));

  vi.doMock("../../../src/registry/jsr.js", () => ({
    jsrRegistry: vi.fn(),
  }));

  vi.doMock("../../../src/utils/engine-version.js", () => ({
    validateEngineVersion: vi.fn(),
  }));

  vi.doMock("../../../src/utils/package.js", () => ({
    getPackageJson: vi.fn(),
  }));

  vi.doMock("../../../src/utils/listr.js", () => ({
    createListr: vi.fn((taskDef: any) => {
      return { _taskDef: taskDef, run: vi.fn() };
    }),
  }));

  vi.doMock("../../../src/tasks/npm.js", () => ({
    npmAvailableCheckTasks: { title: "npm-check-mock", task: vi.fn() },
  }));

  vi.doMock("../../../src/tasks/jsr.js", () => ({
    jsrAvailableCheckTasks: { title: "jsr-check-mock", task: vi.fn() },
  }));

  vi.doMock("../../../src/tasks/crates.js", () => ({
    cratesAvailableCheckTasks: { title: "crates-check-mock", task: vi.fn() },
    createCratesAvailableCheckTask: vi.fn((pkgPath?: string) => ({
      title: `crates-check-mock (${pkgPath})`,
      task: vi.fn(),
    })),
  }));

  mockGitInstance = {
    version: vi.fn().mockResolvedValue("2.40.0"),
  };
});

describe("requiredConditionsCheckTask", () => {
  describe("createListr call", () => {
    it("creates a listr with the correct title", async () => {
      const { createListr } = await import("../../../src/utils/listr.js");
      const { requiredConditionsCheckTask } = await import(
        "../../../src/tasks/required-conditions-check.js"
      );

      requiredConditionsCheckTask();

      expect(createListr).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Required conditions check (for pubm tasks)",
        }),
      );
    });

    it("spreads additional options into the task definition", async () => {
      const { createListr } = await import("../../../src/utils/listr.js");
      const { requiredConditionsCheckTask } = await import(
        "../../../src/tasks/required-conditions-check.js"
      );

      requiredConditionsCheckTask({ skip: true });

      expect(createListr).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: true,
        }),
      );
    });

    it("produces 5 subtasks", async () => {
      const subtasks = await getSubtasks();

      expect(subtasks).toHaveLength(5);
    });
  });

  describe("Subtask 1: Ping registries", () => {
    it("pings each configured registry", async () => {
      const subtasks = await getSubtasks();
      const pingTask = subtasks[0];
      const ctx = createCtx({ registries: ["npm", "jsr"] });

      const mockRegistry1 = { ping: vi.fn().mockResolvedValue(true) };
      const mockRegistry2 = { ping: vi.fn().mockResolvedValue(true) };

      const { getRegistry: mockGetRegistry } = await import(
        "../../../src/registry/index.js"
      );
      vi.mocked(mockGetRegistry)
        .mockResolvedValueOnce(mockRegistry1 as any)
        .mockResolvedValueOnce(mockRegistry2 as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[], _opts?: any) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      pingTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(2);
      expect(innerSubtasks[0].title).toBe("Ping to npm");
      expect(innerSubtasks[1].title).toBe("Ping to jsr");

      await innerSubtasks[0].task();
      expect(mockGetRegistry).toHaveBeenCalledWith("npm");
      expect(mockRegistry1.ping).toHaveBeenCalledOnce();

      await innerSubtasks[1].task();
      expect(mockGetRegistry).toHaveBeenCalledWith("jsr");
      expect(mockRegistry2.ping).toHaveBeenCalledOnce();
    });

    it("pings a single registry", async () => {
      const subtasks = await getSubtasks();
      const pingTask = subtasks[0];
      const ctx = createCtx({ registries: ["npm"] });

      const mockRegistry = { ping: vi.fn().mockResolvedValue(true) };
      const { getRegistry: mockGetRegistry } = await import(
        "../../../src/registry/index.js"
      );
      vi.mocked(mockGetRegistry).mockResolvedValue(mockRegistry as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      pingTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(1);

      await innerSubtasks[0].task();
      expect(mockRegistry.ping).toHaveBeenCalledOnce();
    });

    it("propagates ping errors", async () => {
      const subtasks = await getSubtasks();
      const pingTask = subtasks[0];
      const ctx = createCtx({ registries: ["npm"] });

      const mockRegistry = {
        ping: vi.fn().mockRejectedValue(new Error("ping failed")),
      };
      const { getRegistry: mockGetRegistry } = await import(
        "../../../src/registry/index.js"
      );
      vi.mocked(mockGetRegistry).mockResolvedValue(mockRegistry as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      pingTask.task(ctx, innerParentTask);

      await expect(innerSubtasks[0].task()).rejects.toThrow("ping failed");
    });
  });

  describe("Subtask 2: npm/jsr installation check", () => {
    it("npm enabled check returns true when registries include non-jsr", async () => {
      const subtasks = await getSubtasks();
      const installTask = subtasks[1];

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      await installTask.task({}, innerParentTask);

      const npmSubtask = innerSubtasks[0];
      const jsrSubtask = innerSubtasks[1];

      // npm enabled when registries include non-jsr
      const ctxWithNpm = createCtx({ registries: ["npm"] });
      expect(npmSubtask.enabled(ctxWithNpm)).toBe(true);

      // npm not enabled when only jsr
      const ctxJsrOnly = createCtx({ registries: ["jsr"] });
      expect(npmSubtask.enabled(ctxJsrOnly)).toBe(false);

      // jsr enabled when registries include jsr
      expect(jsrSubtask.enabled(ctxWithNpm)).toBe(false);
      expect(jsrSubtask.enabled(ctxJsrOnly)).toBe(true);
    });

    it("throws when npm is not installed", async () => {
      const subtasks = await getSubtasks();
      const installTask = subtasks[1];

      const mockNpm = { isInstalled: vi.fn().mockResolvedValue(false) };
      const { npmRegistry: mockNpmReg } = await import(
        "../../../src/registry/npm.js"
      );
      vi.mocked(mockNpmReg).mockResolvedValue(mockNpm as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      await installTask.task({}, innerParentTask);

      await expect(innerSubtasks[0].task()).rejects.toThrow(
        "npm is not installed",
      );
    });

    it("passes when npm is installed", async () => {
      const subtasks = await getSubtasks();
      const installTask = subtasks[1];

      const mockNpm = { isInstalled: vi.fn().mockResolvedValue(true) };
      const { npmRegistry: mockNpmReg } = await import(
        "../../../src/registry/npm.js"
      );
      vi.mocked(mockNpmReg).mockResolvedValue(mockNpm as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      await installTask.task({}, innerParentTask);

      await expect(innerSubtasks[0].task()).resolves.toBeUndefined();
    });

    it("prompts to install jsr when not installed and installs on confirm", async () => {
      const subtasks = await getSubtasks();
      const installTask = subtasks[1];

      const mockJsr = { isInstalled: vi.fn().mockResolvedValue(false) };
      const mockNpm = { installGlobally: vi.fn().mockResolvedValue(true) };

      const { jsrRegistry: mockJsrReg } = await import(
        "../../../src/registry/jsr.js"
      );
      const { npmRegistry: mockNpmReg } = await import(
        "../../../src/registry/npm.js"
      );
      vi.mocked(mockJsrReg).mockResolvedValue(mockJsr as any);
      vi.mocked(mockNpmReg).mockResolvedValue(mockNpm as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      await installTask.task({}, innerParentTask);

      const task = createMockTask([true]);
      await innerSubtasks[1].task({}, task);

      expect(task.prompt).toHaveBeenCalledOnce();
      expect(task.output).toBe("Installing jsr...");
      expect(mockNpm.installGlobally).toHaveBeenCalledWith("jsr");
    });

    it("throws when jsr not installed and user declines", async () => {
      const subtasks = await getSubtasks();
      const installTask = subtasks[1];

      const mockJsr = { isInstalled: vi.fn().mockResolvedValue(false) };

      const { jsrRegistry: mockJsrReg } = await import(
        "../../../src/registry/jsr.js"
      );
      vi.mocked(mockJsrReg).mockResolvedValue(mockJsr as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      await installTask.task({}, innerParentTask);

      const task = createMockTask([false]);
      await expect(innerSubtasks[1].task({}, task)).rejects.toThrow(
        "jsr is not installed",
      );
    });

    it("passes when jsr is already installed", async () => {
      const subtasks = await getSubtasks();
      const installTask = subtasks[1];

      const mockJsr = { isInstalled: vi.fn().mockResolvedValue(true) };

      const { jsrRegistry: mockJsrReg } = await import(
        "../../../src/registry/jsr.js"
      );
      vi.mocked(mockJsrReg).mockResolvedValue(mockJsr as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      await installTask.task({}, innerParentTask);

      const task = createMockTask();
      await innerSubtasks[1].task({}, task);

      expect(task.prompt).not.toHaveBeenCalled();
    });
  });

  describe("Subtask 3: Scripts existence check", () => {
    it("skips when all registries have needsPackageScripts false (e.g., jsr only)", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({ registries: ["jsr"] });

      expect(scriptsTask.skip(ctx)).toBe(true);
    });

    it("does not skip when any registry has needsPackageScripts true", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({ registries: ["npm", "jsr"] });

      expect(scriptsTask.skip(ctx)).toBe(false);
    });

    it("skips when registries contain only crates", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({ registries: ["crates"] });

      expect(scriptsTask.skip(ctx)).toBe(true);
    });

    it("passes when both test and build scripts exist", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({ testScript: "test", buildScript: "build" });

      const { getPackageJson: mockGetPkg } = await import(
        "../../../src/utils/package.js"
      );
      vi.mocked(mockGetPkg).mockResolvedValue({
        name: "my-package",
        version: "1.0.0",
        scripts: { test: "vitest", build: "tsup" },
      } as any);

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws when test script is missing and skipTests is false", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({
        testScript: "test",
        buildScript: "build",
        skipTests: false,
      });

      const { getPackageJson: mockGetPkg } = await import(
        "../../../src/utils/package.js"
      );
      vi.mocked(mockGetPkg).mockResolvedValue({
        name: "my-package",
        version: "1.0.0",
        scripts: { build: "tsup" },
      } as any);

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Test script 'test' does not exist",
      );
    });

    it("passes when test script is missing but skipTests is true", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({
        testScript: "test",
        buildScript: "build",
        skipTests: true,
      });

      const { getPackageJson: mockGetPkg } = await import(
        "../../../src/utils/package.js"
      );
      vi.mocked(mockGetPkg).mockResolvedValue({
        name: "my-package",
        version: "1.0.0",
        scripts: { build: "tsup" },
      } as any);

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws when build script is missing and skipBuild is false", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({
        testScript: "test",
        buildScript: "build",
        skipBuild: false,
      });

      const { getPackageJson: mockGetPkg } = await import(
        "../../../src/utils/package.js"
      );
      vi.mocked(mockGetPkg).mockResolvedValue({
        name: "my-package",
        version: "1.0.0",
        scripts: { test: "vitest" },
      } as any);

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Build script 'build' does not exist",
      );
    });

    it("passes when build script is missing but skipBuild is true", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({
        testScript: "test",
        buildScript: "build",
        skipBuild: true,
      });

      const { getPackageJson: mockGetPkg } = await import(
        "../../../src/utils/package.js"
      );
      vi.mocked(mockGetPkg).mockResolvedValue({
        name: "my-package",
        version: "1.0.0",
        scripts: { test: "vitest" },
      } as any);

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws with combined message when both scripts are missing", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({
        testScript: "test",
        buildScript: "build",
        skipTests: false,
        skipBuild: false,
      });

      const { getPackageJson: mockGetPkg } = await import(
        "../../../src/utils/package.js"
      );
      vi.mocked(mockGetPkg).mockResolvedValue({
        name: "my-package",
        version: "1.0.0",
        scripts: {},
      } as any);

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Test script 'test' does not exist. and Build script 'build' does not exist.",
      );
    });

    it("handles package.json with no scripts field", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({
        testScript: "test",
        buildScript: "build",
        skipTests: false,
        skipBuild: false,
      });

      const { getPackageJson: mockGetPkg } = await import(
        "../../../src/utils/package.js"
      );
      vi.mocked(mockGetPkg).mockResolvedValue({
        name: "my-package",
        version: "1.0.0",
      } as any);

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Please check your configuration",
      );
    });

    it("uses custom script names from ctx", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[2];
      const ctx = createCtx({
        testScript: "custom-test",
        buildScript: "custom-build",
      });

      const { getPackageJson: mockGetPkg } = await import(
        "../../../src/utils/package.js"
      );
      vi.mocked(mockGetPkg).mockResolvedValue({
        name: "my-package",
        version: "1.0.0",
        scripts: { "custom-test": "vitest", "custom-build": "tsup" },
      } as any);

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });
  });

  describe("Subtask 4: Git version check", () => {
    it("validates git version against engines", async () => {
      const subtasks = await getSubtasks();
      const gitVersionTask = subtasks[3];

      const { Git: MockedGit } = await import("../../../src/git.js");
      vi.mocked(MockedGit).mockImplementation(() => mockGitInstance as any);
      mockGitInstance.version.mockResolvedValue("2.40.0");

      const { validateEngineVersion: mockValidate } = await import(
        "../../../src/utils/engine-version.js"
      );

      await gitVersionTask.task();

      expect(mockGitInstance.version).toHaveBeenCalledOnce();
      expect(mockValidate).toHaveBeenCalledWith("git", "2.40.0");
    });

    it("propagates validation errors", async () => {
      const subtasks = await getSubtasks();
      const gitVersionTask = subtasks[3];

      const { Git: MockedGit } = await import("../../../src/git.js");
      vi.mocked(MockedGit).mockImplementation(() => mockGitInstance as any);
      mockGitInstance.version.mockResolvedValue("1.0.0");

      const { validateEngineVersion: mockValidate } = await import(
        "../../../src/utils/engine-version.js"
      );
      vi.mocked(mockValidate).mockImplementation(() => {
        throw new Error("git version too old");
      });

      await expect(gitVersionTask.task()).rejects.toThrow(
        "git version too old",
      );
    });
  });

  describe("Subtask 5: Registry availability check", () => {
    it("maps npm registry to npmAvailableCheckTasks", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[4];
      const ctx = createCtx({ registries: ["npm"] });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      const { npmAvailableCheckTasks: npmCheck } = await import(
        "../../../src/tasks/npm.js"
      );

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0]).toBe(npmCheck);
    });

    it("maps jsr registry to jsrAvailableCheckTasks", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[4];
      const ctx = createCtx({ registries: ["jsr"] });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      const { jsrAvailableCheckTasks: jsrCheck } = await import(
        "../../../src/tasks/jsr.js"
      );

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0]).toBe(jsrCheck);
    });

    it("maps unknown registry to npmAvailableCheckTasks (default case)", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[4];
      const ctx = createCtx({ registries: ["custom-registry" as any] });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      const { npmAvailableCheckTasks: npmCheck } = await import(
        "../../../src/tasks/npm.js"
      );

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0]).toBe(npmCheck);
    });

    it("maps multiple registries correctly", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[4];
      const ctx = createCtx({ registries: ["npm", "jsr"] });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      const { npmAvailableCheckTasks: npmCheck } = await import(
        "../../../src/tasks/npm.js"
      );
      const { jsrAvailableCheckTasks: jsrCheck } = await import(
        "../../../src/tasks/jsr.js"
      );

      expect(innerSubtasks).toHaveLength(2);
      expect(innerSubtasks[0]).toBe(npmCheck);
      expect(innerSubtasks[1]).toBe(jsrCheck);
    });

    it("passes concurrent option to newListr", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[4];
      const ctx = createCtx({ registries: ["npm"] });

      const innerParentTask = {
        newListr: vi.fn((tasks: any[], _opts?: any) => {
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      expect(innerParentTask.newListr).toHaveBeenCalledWith(expect.any(Array), {
        concurrent: true,
      });
    });

    it("maps crates registry to cratesAvailableCheckTasks", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[4];
      const ctx = createCtx({ registries: ["crates"] });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      const { cratesAvailableCheckTasks: cratesCheck } = await import(
        "../../../src/tasks/crates.js"
      );

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0]).toBe(cratesCheck);
    });

    it("includes crates from packages config in ping registries", async () => {
      const subtasks = await getSubtasks();
      const pingTask = subtasks[0];
      const ctx = createCtx({
        registries: ["npm"],
        packages: [
          { path: ".", registries: ["npm"] },
          { path: "rust/crates/my-crate", registries: ["crates"] },
        ],
      } as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      pingTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(2);
      expect(innerSubtasks[0].title).toBe("Ping to npm");
      expect(innerSubtasks[1].title).toBe("Ping to crates");
    });

    it("creates per-package crates availability check tasks", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[4];
      const ctx = createCtx({
        registries: ["npm"],
        packages: [
          { path: ".", registries: ["npm"] },
          { path: "rust/crates/lib-a", registries: ["crates"] },
          { path: "rust/crates/lib-b", registries: ["crates"] },
        ],
      } as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      // npm (from pkg 1) + crates lib-a + crates lib-b = 3
      expect(innerSubtasks).toHaveLength(3);
      expect(innerSubtasks[0].title).toBe("npm-check-mock");
      expect(innerSubtasks[1].title).toBe(
        "crates-check-mock (rust/crates/lib-a)",
      );
      expect(innerSubtasks[2].title).toBe(
        "crates-check-mock (rust/crates/lib-b)",
      );
    });
  });
});
