import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateScript = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));

vi.mock("std-env", () => ({ isCI: false }));

vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(),
}));

vi.mock("../../../src/registry/index.js", () => ({
  getConnector: vi.fn(),
}));

vi.mock("../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn(),
  },
}));

vi.mock("../../../src/utils/engine-version.js", () => ({
  validateEngineVersion: vi.fn(),
}));

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(() => []),
}));

vi.mock("../../../src/ecosystem/catalog.js", () => {
  class MockEcosystem {
    packagePath: string;
    constructor(p: string) {
      this.packagePath = p;
    }
    validateScript(script: string, type: string) {
      return mockValidateScript(script, type);
    }
  }
  const descriptors: Record<string, any> = {
    js: {
      key: "js",
      label: "JavaScript",
      ecosystemClass: MockEcosystem,
    },
    rust: {
      key: "rust",
      label: "Rust",
      ecosystemClass: MockEcosystem,
    },
  };
  return {
    ecosystemCatalog: {
      get: vi.fn((key: string) => descriptors[key]),
      all: vi.fn(() => Object.values(descriptors)),
    },
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn((taskDef: any) => {
    return { _taskDef: taskDef, run: vi.fn() };
  }),
  createCiListrOptions: vi.fn(),
}));

import type { PubmContext } from "../../../src/context.js";
import { makeTestContext } from "../../helpers/make-context.js";

function createCtx(
  overrides: {
    config?: Partial<PubmContext["config"]>;
    options?: Partial<PubmContext["options"]>;
    runtime?: Partial<PubmContext["runtime"]>;
  } = {},
): PubmContext {
  return makeTestContext({
    config: {
      packages: [{ path: ".", registries: ["npm"], ecosystem: "js" }],
      ...overrides.config,
    },
    options: overrides.options,
    runtime: {
      version: "1.0.0",
      promptEnabled: true,
      cleanWorkingTree: true,
      ...overrides.runtime,
    },
  });
}

let mockGitInstance: Record<string, ReturnType<typeof vi.fn>>;
let capturedSubtasks: any[];

function makeNpmDescriptor() {
  return {
    key: "npm",
    ecosystem: "js",
    label: "npm",
    factory: vi.fn(),
  };
}

function makeJsrDescriptor() {
  return {
    key: "jsr",
    ecosystem: "js",
    label: "jsr",
    factory: vi.fn(),
  };
}

function makeCratesDescriptor() {
  return {
    key: "crates",
    ecosystem: "rust",
    label: "crates.io",
    factory: vi.fn(),
  };
}

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

  taskDef.task(createCtx(), mockParentTask);

  return capturedSubtasks;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockValidateScript.mockReset().mockReturnValue(Promise.resolve(null));

  vi.resetModules();

  vi.doMock("../../../src/git.js", () => ({
    Git: vi.fn(),
  }));

  vi.doMock("../../../src/registry/index.js", () => ({
    getConnector: vi.fn(),
  }));

  vi.doMock("../../../src/registry/catalog.js", () => ({
    registryCatalog: {
      get: vi.fn((key: string) => {
        if (key === "npm") return makeNpmDescriptor();
        if (key === "jsr") return makeJsrDescriptor();
        if (key === "crates") return makeCratesDescriptor();
        return undefined;
      }),
    },
  }));

  vi.doMock("../../../src/utils/engine-version.js", () => ({
    validateEngineVersion: vi.fn(),
  }));

  vi.doMock("../../../src/monorepo/workspace.js", () => ({
    detectWorkspace: vi.fn(() => []),
  }));

  vi.doMock("../../../src/ecosystem/catalog.js", () => {
    class MockEcosystem {
      packagePath: string;
      constructor(p: string) {
        this.packagePath = p;
      }
      validateScript(script: string, type: string) {
        return mockValidateScript(script, type);
      }
    }
    const descriptors: Record<string, any> = {
      js: {
        key: "js",
        label: "JavaScript",
        ecosystemClass: MockEcosystem,
      },
      rust: {
        key: "rust",
        label: "Rust",
        ecosystemClass: MockEcosystem,
      },
    };
    return {
      ecosystemCatalog: {
        get: vi.fn((key: string) => descriptors[key]),
        all: vi.fn(() => Object.values(descriptors)),
      },
    };
  });

  vi.doMock("node:fs/promises", () => ({
    readFile: vi.fn(),
  }));

  vi.doMock("../../../src/utils/listr.js", () => ({
    createListr: vi.fn((taskDef: any) => {
      return { _taskDef: taskDef, run: vi.fn() };
    }),
    createCiListrOptions: vi.fn(),
  }));

  vi.doMock("../../../src/plugin/wrap-task-context.js", () => ({
    wrapTaskContext: vi.fn((task: any) => task),
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

    it("produces 4 subtasks", async () => {
      const subtasks = await getSubtasks();

      expect(subtasks).toHaveLength(4);
    });
  });

  describe("Subtask 1: Ping registries", () => {
    it("pings each configured registry", async () => {
      const subtasks = await getSubtasks();
      const pingTask = subtasks[0];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["npm", "jsr"] }] },
      });

      const mockRegistry1 = { ping: vi.fn().mockResolvedValue(true) };
      const mockRegistry2 = { ping: vi.fn().mockResolvedValue(true) };

      const { getConnector: mockGetConnector } = await import(
        "../../../src/registry/index.js"
      );
      vi.mocked(mockGetConnector)
        .mockReturnValueOnce(mockRegistry1 as any)
        .mockReturnValueOnce(mockRegistry2 as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[], _opts?: any) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      pingTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0].title).toBe("JavaScript ecosystem");

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[], _opts?: any) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, ecosystemParentTask);

      expect(registrySubtasks).toHaveLength(2);
      expect(registrySubtasks[0].title).toBe("Ping npm");
      expect(registrySubtasks[1].title).toBe("Ping jsr");

      await registrySubtasks[0].task();
      expect(mockGetConnector).toHaveBeenCalledWith("npm");
      expect(mockRegistry1.ping).toHaveBeenCalledOnce();

      await registrySubtasks[1].task();
      expect(mockGetConnector).toHaveBeenCalledWith("jsr");
      expect(mockRegistry2.ping).toHaveBeenCalledOnce();
    });

    it("pings a single registry", async () => {
      const subtasks = await getSubtasks();
      const pingTask = subtasks[0];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["npm"] }] },
      });

      const mockRegistry = { ping: vi.fn().mockResolvedValue(true) };
      const { getConnector: mockGetConnector } = await import(
        "../../../src/registry/index.js"
      );
      vi.mocked(mockGetConnector).mockReturnValue(mockRegistry as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      pingTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0].title).toBe("JavaScript ecosystem");

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, ecosystemParentTask);

      expect(registrySubtasks).toHaveLength(1);
      expect(registrySubtasks[0].title).toBe("Ping npm");

      await registrySubtasks[0].task();
      expect(mockRegistry.ping).toHaveBeenCalledOnce();
    });

    it("propagates ping errors", async () => {
      const subtasks = await getSubtasks();
      const pingTask = subtasks[0];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["npm"] }] },
      });

      const mockRegistry = {
        ping: vi.fn().mockRejectedValue(new Error("ping failed")),
      };
      const { getConnector: mockGetConnector } = await import(
        "../../../src/registry/index.js"
      );
      vi.mocked(mockGetConnector).mockReturnValue(mockRegistry as any);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      pingTask.task(ctx, innerParentTask);

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, ecosystemParentTask);

      await expect(registrySubtasks[0].task()).rejects.toThrow("ping failed");
    });
  });

  describe("Subtask 2: Scripts existence check", () => {
    it("skips when both skipTests and skipBuild are true", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { skipTests: true, skipBuild: true },
      });

      expect(scriptsTask.skip(ctx)).toBe(true);
    });

    it("does not skip when skipTests is false", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { skipTests: false, skipBuild: true },
      });

      expect(scriptsTask.skip(ctx)).toBe(false);
    });

    it("does not skip when skipBuild is false", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { skipTests: true, skipBuild: false },
      });

      expect(scriptsTask.skip(ctx)).toBe(false);
    });

    it("passes when validateScript returns null for all packages", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build" },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws when test script validation fails and skipTests is false", async () => {
      mockValidateScript.mockImplementation((script: string, type: string) => {
        if (type === "test")
          return Promise.resolve(
            `Script '${script}' not found in /fake/package.json`,
          );
        return Promise.resolve(null);
      });
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build", skipTests: false },
      });

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Script 'test' not found",
      );
    });

    it("passes when test script validation fails but skipTests is true", async () => {
      mockValidateScript.mockImplementation((script: string, type: string) => {
        if (type === "test")
          return Promise.resolve(`Script '${script}' not found`);
        return Promise.resolve(null);
      });
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build", skipTests: true },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws when build script validation fails and skipBuild is false", async () => {
      mockValidateScript.mockImplementation((script: string, type: string) => {
        if (type === "build")
          return Promise.resolve(
            `Script '${script}' not found in /fake/package.json`,
          );
        return Promise.resolve(null);
      });
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build", skipBuild: false },
      });

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Script 'build' not found",
      );
    });

    it("passes when build script validation fails but skipBuild is true", async () => {
      mockValidateScript.mockImplementation((script: string, type: string) => {
        if (type === "build")
          return Promise.resolve(`Script '${script}' not found`);
        return Promise.resolve(null);
      });
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build", skipBuild: true },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws with combined message when both scripts validation fails", async () => {
      mockValidateScript.mockImplementation((script: string) => {
        return Promise.resolve(
          `Script '${script}' not found in /fake/package.json`,
        );
      });
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: {
          testScript: "test",
          buildScript: "build",
          skipTests: false,
          skipBuild: false,
        },
      });

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Please check your configuration",
      );
    });

    it("throws when validateScript returns error for package", async () => {
      mockValidateScript.mockResolvedValue("Cannot read /fake/package.json");
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: {
          testScript: "test",
          buildScript: "build",
          skipTests: false,
          skipBuild: false,
        },
      });

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Please check your configuration",
      );
    });

    it("uses custom script names from ctx", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "custom-test", buildScript: "custom-build" },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });
  });

  describe("Subtask 3: Git version check", () => {
    it("validates git version against engines", async () => {
      const subtasks = await getSubtasks();
      const gitVersionTask = subtasks[2];

      const { Git: MockedGit } = await import("../../../src/git.js");
      vi.mocked(MockedGit).mockImplementation(function () {
        return mockGitInstance as any;
      });
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
      const gitVersionTask = subtasks[2];

      const { Git: MockedGit } = await import("../../../src/git.js");
      vi.mocked(MockedGit).mockImplementation(function () {
        return mockGitInstance as any;
      });
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

  describe("Subtask 4: Registry availability check", () => {
    it("uses catalog descriptor to create availability task for npm", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[3];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["npm"] }] },
      });

      const mockCheckAvailability = vi.fn().mockResolvedValue(undefined);
      const mockRegistry = { checkAvailability: mockCheckAvailability };
      const npmDescriptor = makeNpmDescriptor();
      npmDescriptor.factory.mockResolvedValue(mockRegistry as any);

      const { registryCatalog: mockCatalog } = await import(
        "../../../src/registry/catalog.js"
      );
      vi.mocked(mockCatalog.get).mockImplementation((key: string) => {
        if (key === "npm") return npmDescriptor as any;
        return undefined;
      });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0].title).toBe("JavaScript ecosystem");

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, ecosystemParentTask);

      expect(registrySubtasks).toHaveLength(1);
      expect(registrySubtasks[0].title).toBe("Checking npm availability");

      const mockTask = {};
      await registrySubtasks[0].task({}, mockTask);
      expect(npmDescriptor.factory).toHaveBeenCalledWith(".");
      expect(mockCheckAvailability).toHaveBeenCalledWith(
        mockTask,
        expect.any(Object),
      );
    });

    it("uses catalog descriptor to create availability task for jsr", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[3];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["jsr"] }] },
      });

      const mockCheckAvailability = vi.fn().mockResolvedValue(undefined);
      const mockRegistry = { checkAvailability: mockCheckAvailability };
      const jsrDescriptor = makeJsrDescriptor();
      jsrDescriptor.factory.mockResolvedValue(mockRegistry as any);

      const { registryCatalog: mockCatalog } = await import(
        "../../../src/registry/catalog.js"
      );
      vi.mocked(mockCatalog.get).mockImplementation((key: string) => {
        if (key === "jsr") return jsrDescriptor as any;
        return undefined;
      });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0].title).toBe("JavaScript ecosystem");

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, ecosystemParentTask);

      expect(registrySubtasks).toHaveLength(1);
      expect(registrySubtasks[0].title).toBe("Checking jsr availability");

      const mockTask = {};
      await registrySubtasks[0].task({}, mockTask);
      expect(jsrDescriptor.factory).toHaveBeenCalledWith(".");
      expect(mockCheckAvailability).toHaveBeenCalledWith(
        mockTask,
        expect.any(Object),
      );
    });

    it("returns a no-op task for unknown registry", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[3];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["custom-registry"] }] },
      });

      const { registryCatalog: mockCatalog } = await import(
        "../../../src/registry/catalog.js"
      );
      vi.mocked(mockCatalog.get).mockReturnValue(undefined);

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0].title).toBe("JavaScript ecosystem");

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, ecosystemParentTask);

      expect(registrySubtasks).toHaveLength(1);
      expect(registrySubtasks[0].title).toBe("custom-registry");

      // Should be a no-op task
      await expect(registrySubtasks[0].task()).resolves.toBeUndefined();
    });

    it("maps multiple registries correctly", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[3];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["npm", "jsr"] }] },
      });

      const npmDescriptor = makeNpmDescriptor();
      const jsrDescriptor = makeJsrDescriptor();
      const mockNpmRegistry = {
        checkAvailability: vi.fn().mockResolvedValue(undefined),
      };
      const mockJsrRegistry = {
        checkAvailability: vi.fn().mockResolvedValue(undefined),
      };
      npmDescriptor.factory.mockResolvedValue(mockNpmRegistry as any);
      jsrDescriptor.factory.mockResolvedValue(mockJsrRegistry as any);

      const { registryCatalog: mockCatalog } = await import(
        "../../../src/registry/catalog.js"
      );
      vi.mocked(mockCatalog.get).mockImplementation((key: string) => {
        if (key === "npm") return npmDescriptor as any;
        if (key === "jsr") return jsrDescriptor as any;
        return undefined;
      });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0].title).toBe("JavaScript ecosystem");

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, ecosystemParentTask);

      expect(registrySubtasks).toHaveLength(2);
      expect(registrySubtasks[0].title).toBe("Checking npm availability");
      expect(registrySubtasks[1].title).toBe("Checking jsr availability");
    });

    it("passes concurrent option to newListr", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[3];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["npm"] }] },
      });

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

    it("maps crates registry using catalog descriptor", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[3];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["crates"] }] },
      });

      const cratesDescriptor = makeCratesDescriptor();
      const mockCratesRegistry = {
        checkAvailability: vi.fn().mockResolvedValue(undefined),
      };
      cratesDescriptor.factory.mockResolvedValue(mockCratesRegistry as any);

      const { registryCatalog: mockCatalog } = await import(
        "../../../src/registry/catalog.js"
      );
      vi.mocked(mockCatalog.get).mockImplementation((key: string) => {
        if (key === "crates") return cratesDescriptor as any;
        return undefined;
      });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(1);
      expect(innerSubtasks[0].title).toBe("Rust ecosystem");

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, ecosystemParentTask);

      expect(registrySubtasks).toHaveLength(1);
      expect(registrySubtasks[0].title).toBe("Checking crates.io availability");
    });

    it("includes crates from packages config in ping registries", async () => {
      const subtasks = await getSubtasks();
      const pingTask = subtasks[0];
      const ctx = createCtx({
        config: {
          packages: [
            { path: ".", registries: ["npm"] },
            { path: "rust/crates/my-crate", registries: ["crates"] },
          ],
        },
      });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      pingTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(2);
      expect(innerSubtasks[0].title).toBe("JavaScript ecosystem");
      expect(innerSubtasks[1].title).toBe("Rust ecosystem");

      let jsRegistrySubtasks: any[] = [];
      const jsParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          jsRegistrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, jsParentTask);

      let rustRegistrySubtasks: any[] = [];
      const rustParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          rustRegistrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[1].task(ctx, rustParentTask);

      expect(jsRegistrySubtasks[0].title).toBe("Ping npm");
      expect(rustRegistrySubtasks[0].title).toBe("Ping crates.io");
    });

    it("creates per-package crates availability check tasks when multiple packages", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[3];
      const ctx = createCtx({
        config: {
          packages: [
            { path: ".", registries: ["npm"] },
            { path: "rust/crates/lib-a", registries: ["crates"] },
            { path: "rust/crates/lib-b", registries: ["crates"] },
          ],
        },
      });

      const npmDescriptor = makeNpmDescriptor();
      const cratesDescriptor = makeCratesDescriptor();
      const mockNpmRegistry = {
        checkAvailability: vi.fn().mockResolvedValue(undefined),
      };
      const mockCratesRegistry = {
        checkAvailability: vi.fn().mockResolvedValue(undefined),
      };
      npmDescriptor.factory.mockResolvedValue(mockNpmRegistry as any);
      cratesDescriptor.factory.mockResolvedValue(mockCratesRegistry as any);

      const { registryCatalog: mockCatalog } = await import(
        "../../../src/registry/catalog.js"
      );
      vi.mocked(mockCatalog.get).mockImplementation((key: string) => {
        if (key === "npm") return npmDescriptor as any;
        if (key === "crates") return cratesDescriptor as any;
        return undefined;
      });

      let innerSubtasks: any[] = [];
      const innerParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          innerSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, innerParentTask);

      expect(innerSubtasks).toHaveLength(2);
      expect(innerSubtasks[0].title).toBe("JavaScript ecosystem");
      expect(innerSubtasks[1].title).toBe("Rust ecosystem");

      let jsRegistrySubtasks: any[] = [];
      const jsParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          jsRegistrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[0].task(ctx, jsParentTask);

      expect(jsRegistrySubtasks).toHaveLength(1);
      expect(jsRegistrySubtasks[0].title).toBe("Checking npm availability");

      let rustRegistrySubtasks: any[] = [];
      const rustParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          rustRegistrySubtasks = tasks;
          return tasks;
        }),
      };

      innerSubtasks[1].task(ctx, rustParentTask);

      expect(rustRegistrySubtasks).toHaveLength(1);
      expect(rustRegistrySubtasks[0].title).toBe(
        "Checking crates.io availability",
      );

      let cratePackageSubtasks: any[] = [];
      const cratesParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          cratePackageSubtasks = tasks;
          return tasks;
        }),
      };

      rustRegistrySubtasks[0].task(ctx, cratesParentTask);

      expect(cratePackageSubtasks).toHaveLength(2);
      expect(cratePackageSubtasks[0].title).toBe("rust/crates/lib-a");
      expect(cratePackageSubtasks[1].title).toBe("rust/crates/lib-b");
    });

    it("deduplicates npm availability checks across js packages", async () => {
      const subtasks = await getSubtasks();
      const registryTask = subtasks[3];
      const ctx = createCtx({
        config: {
          packages: [
            { path: "packages/core", registries: ["npm", "jsr"] },
            { path: "packages/pubm", registries: ["npm"] },
          ],
        },
      });

      const npmDescriptor = makeNpmDescriptor();
      const jsrDescriptor = makeJsrDescriptor();
      const mockNpmRegistry = {
        checkAvailability: vi.fn().mockResolvedValue(undefined),
      };
      const mockJsrRegistry = {
        checkAvailability: vi.fn().mockResolvedValue(undefined),
      };
      npmDescriptor.factory.mockResolvedValue(mockNpmRegistry as any);
      jsrDescriptor.factory.mockResolvedValue(mockJsrRegistry as any);

      const { registryCatalog: mockCatalog } = await import(
        "../../../src/registry/catalog.js"
      );
      vi.mocked(mockCatalog.get).mockImplementation((key: string) => {
        if (key === "npm") return npmDescriptor as any;
        if (key === "jsr") return jsrDescriptor as any;
        return undefined;
      });

      let ecosystemSubtasks: any[] = [];
      const parentTask = {
        newListr: vi.fn((tasks: any[]) => {
          ecosystemSubtasks = tasks;
          return tasks;
        }),
      };

      registryTask.task(ctx, parentTask);

      expect(ecosystemSubtasks).toHaveLength(1);
      expect(ecosystemSubtasks[0].title).toBe("JavaScript ecosystem");

      let registrySubtasks: any[] = [];
      const ecosystemParentTask = {
        newListr: vi.fn((tasks: any[]) => {
          registrySubtasks = tasks;
          return tasks;
        }),
      };

      ecosystemSubtasks[0].task(ctx, ecosystemParentTask);

      expect(registrySubtasks).toHaveLength(2);
      expect(registrySubtasks[0].title).toBe("Checking npm availability");
      expect(registrySubtasks[1].title).toBe("Checking jsr availability");
    });
  });

  describe("Subtask 2: Scripts check — ecosystem and command branches", () => {
    it("defaults to js ecosystem when pkg.ecosystem is undefined", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [{ path: ".", registries: ["npm"] } as any],
        },
        options: { testScript: "test", buildScript: "build" },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("skips validation when testCommand is set on package", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            {
              path: ".",
              registries: ["npm"],
              ecosystem: "js",
              testCommand: "make test",
            } as any,
          ],
        },
        options: { skipTests: false, skipBuild: true },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      // validateScript should not be called since testCommand is set
      expect(mockValidateScript).not.toHaveBeenCalled();
    });

    it("skips validation when buildCommand is set on package", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            {
              path: ".",
              registries: ["npm"],
              ecosystem: "js",
              buildCommand: "make build",
            } as any,
          ],
        },
        options: { skipTests: true, skipBuild: false },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).not.toHaveBeenCalled();
    });

    it("skips validation when ecosystems.testCommand is set", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          ecosystems: { js: { testCommand: "npx vitest" } },
          packages: [{ path: ".", registries: ["npm"], ecosystem: "js" }],
        },
        options: { skipTests: false, skipBuild: true },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).not.toHaveBeenCalled();
    });

    it("skips validation when ecosystems.buildCommand is set", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          ecosystems: { js: { buildCommand: "npx tsup" } },
          packages: [{ path: ".", registries: ["npm"], ecosystem: "js" }],
        },
        options: { skipTests: true, skipBuild: false },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).not.toHaveBeenCalled();
    });

    it("uses pkg.testScript override for validation", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            {
              path: "packages/a",
              registries: ["npm"],
              ecosystem: "js",
              testScript: "test:special",
            } as any,
          ],
        },
        options: { skipTests: false, skipBuild: true },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).toHaveBeenCalledWith("test:special", "test");
    });

    it("uses ecosystems.testScript override for validation", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          ecosystems: { js: { testScript: "test:ci" } },
          packages: [{ path: ".", registries: ["npm"], ecosystem: "js" }],
        },
        options: { skipTests: false, skipBuild: true, testScript: "test" },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).toHaveBeenCalledWith("test:ci", "test");
    });

    it("uses pkg.buildScript override for validation", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            {
              path: "packages/a",
              registries: ["npm"],
              ecosystem: "js",
              buildScript: "build:special",
            } as any,
          ],
        },
        options: { skipTests: true, skipBuild: false },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).toHaveBeenCalledWith("build:special", "build");
    });

    it("uses ecosystems.buildScript override for validation", async () => {
      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          ecosystems: { js: { buildScript: "build:ci" } },
          packages: [{ path: ".", registries: ["npm"], ecosystem: "js" }],
        },
        options: { skipTests: true, skipBuild: false, buildScript: "build" },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).toHaveBeenCalledWith("build:ci", "build");
    });

    it("validates at root cwd in workspace mode for grouped packages", async () => {
      const { detectWorkspace } = await import(
        "../../../src/monorepo/workspace.js"
      );
      vi.mocked(detectWorkspace).mockReturnValue([
        { type: "pnpm", patterns: ["packages/*"] },
      ] as any);

      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            { path: "packages/a", registries: ["npm"], ecosystem: "js" },
            { path: "packages/b", registries: ["npm"], ecosystem: "js" },
          ],
        },
        options: { skipTests: false, skipBuild: true },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      // Only called once for the group (groupValidated skips second package)
      expect(mockValidateScript).toHaveBeenCalledTimes(1);
    });

    it("validates per-package when package has testScript override in workspace", async () => {
      const { detectWorkspace } = await import(
        "../../../src/monorepo/workspace.js"
      );
      vi.mocked(detectWorkspace).mockReturnValue([
        { type: "pnpm", patterns: ["packages/*"] },
      ] as any);

      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            {
              path: "packages/a",
              registries: ["npm"],
              ecosystem: "js",
              testScript: "test:special",
            } as any,
          ],
        },
        options: { skipTests: false, skipBuild: true },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).toHaveBeenCalledWith("test:special", "test");
    });

    it("detects rust workspace via cargo type", async () => {
      const { detectWorkspace } = await import(
        "../../../src/monorepo/workspace.js"
      );
      vi.mocked(detectWorkspace).mockReturnValue([
        { type: "cargo", patterns: ["crates/*"] },
      ] as any);

      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            { path: "crates/a", registries: ["crates"], ecosystem: "rust" },
            { path: "crates/b", registries: ["crates"], ecosystem: "rust" },
          ],
        },
        options: { skipTests: false, skipBuild: true },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      // Only called once for the group (workspace groupValidated)
      expect(mockValidateScript).toHaveBeenCalledTimes(1);
    });

    it("validates both test and build once each for workspace group", async () => {
      const { detectWorkspace } = await import(
        "../../../src/monorepo/workspace.js"
      );
      vi.mocked(detectWorkspace).mockReturnValue([
        { type: "pnpm", patterns: ["packages/*"] },
      ] as any);

      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            { path: "packages/a", registries: ["npm"], ecosystem: "js" },
            { path: "packages/b", registries: ["npm"], ecosystem: "js" },
          ],
        },
        options: { skipTests: false, skipBuild: false },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      // test and build each validated once for workspace group (separate flags)
      expect(mockValidateScript).toHaveBeenCalledTimes(2);
      expect(mockValidateScript).toHaveBeenCalledWith("test", "test");
      expect(mockValidateScript).toHaveBeenCalledWith("build", "build");
    });

    it("validates per-package with buildScript override in workspace", async () => {
      const { detectWorkspace } = await import(
        "../../../src/monorepo/workspace.js"
      );
      vi.mocked(detectWorkspace).mockReturnValue([
        { type: "pnpm", patterns: ["packages/*"] },
      ] as any);

      mockValidateScript.mockResolvedValue(null);
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: {
          packages: [
            {
              path: "packages/a",
              registries: ["npm"],
              ecosystem: "js",
              buildScript: "build:special",
            } as any,
          ],
        },
        options: { skipTests: true, skipBuild: false },
      });

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
      expect(mockValidateScript).toHaveBeenCalledWith("build:special", "build");
    });
  });

  describe("isCI branch", () => {
    it("uses createCiListrOptions when isCI is true", async () => {
      vi.doMock("std-env", () => ({ isCI: true }));

      vi.doMock("../../../src/utils/listr.js", () => ({
        createListr: vi.fn((taskDef: any, options?: any) => {
          return { _taskDef: taskDef, _options: options, run: vi.fn() };
        }),
        createCiListrOptions: vi.fn(() => ({ renderer: "ci" })),
      }));

      const { requiredConditionsCheckTask } = await import(
        "../../../src/tasks/required-conditions-check.js"
      );
      const result = requiredConditionsCheckTask();
      expect((result as any)._options).toEqual({ renderer: "ci" });
    });
  });

  describe("Plugin condition checks", () => {
    it("appends plugin condition checks as subtasks", async () => {
      const pluginCheckFn = vi.fn();

      const { requiredConditionsCheckTask } = await import(
        "../../../src/tasks/required-conditions-check.js"
      );
      const listrResult = requiredConditionsCheckTask();
      const taskDef = (listrResult as any)._taskDef;

      const mockPluginRunner = {
        collectChecks: vi.fn().mockReturnValue([
          {
            title: "Plugin condition check",
            phase: "conditions",
            task: pluginCheckFn,
          },
        ]),
      };

      const ctx = createCtx({
        runtime: {
          pluginRunner: mockPluginRunner as any,
        },
      });

      let captured: any[];
      const mockParentTask = {
        newListr: vi.fn((subtasks: any[], _opts?: any) => {
          captured = subtasks;
          return subtasks;
        }),
      };

      taskDef.task(ctx, mockParentTask);

      expect(mockPluginRunner.collectChecks).toHaveBeenCalledWith(
        ctx,
        "conditions",
      );

      // Should have 4 built-in + 1 plugin check = 5
      expect(captured!).toHaveLength(5);
      expect(captured![4].title).toBe("Plugin condition check");

      // Verify the plugin check task calls through wrapTaskContext
      const mockTask = { output: "", title: "" };
      await captured![4].task(ctx, mockTask);
      expect(pluginCheckFn).toHaveBeenCalled();
    });
  });
});
