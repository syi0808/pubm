import { beforeEach, describe, expect, it, vi } from "vitest";

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
      packages: [{ path: ".", registries: ["npm"] }],
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
    needsPackageScripts: true,
    factory: vi.fn(),
  };
}

function makeJsrDescriptor() {
  return {
    key: "jsr",
    ecosystem: "js",
    label: "jsr",
    needsPackageScripts: false,
    factory: vi.fn(),
  };
}

function makeCratesDescriptor() {
  return {
    key: "crates",
    ecosystem: "rust",
    label: "crates.io",
    needsPackageScripts: false,
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

  vi.doMock("node:fs/promises", () => ({
    readFile: vi.fn(),
  }));

  vi.doMock("../../../src/utils/listr.js", () => ({
    createListr: vi.fn((taskDef: any) => {
      return { _taskDef: taskDef, run: vi.fn() };
    }),
    createCiListrOptions: vi.fn(),
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
    it("skips when all registries have needsPackageScripts false (e.g., jsr only)", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["jsr"] }] },
      });

      expect(scriptsTask.skip(ctx)).toBe(true);
    });

    it("does not skip when any registry has needsPackageScripts true", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["npm", "jsr"] }] },
      });

      expect(scriptsTask.skip(ctx)).toBe(false);
    });

    it("skips when registries contain only crates", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        config: { packages: [{ path: ".", registries: ["crates"] }] },
      });

      expect(scriptsTask.skip(ctx)).toBe(true);
    });

    it("passes when both test and build scripts exist", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build" },
      });

      const { readFile: mockReadFile } = await import("node:fs/promises");
      vi.mocked(mockReadFile).mockResolvedValue(
        JSON.stringify({
          name: "my-package",
          version: "1.0.0",
          scripts: { test: "vitest", build: "tsup" },
        }) as any,
      );

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws when test script is missing and skipTests is false", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build", skipTests: false },
      });

      const { readFile: mockReadFile } = await import("node:fs/promises");
      vi.mocked(mockReadFile).mockResolvedValue(
        JSON.stringify({
          name: "my-package",
          version: "1.0.0",
          scripts: { build: "tsup" },
        }) as any,
      );

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Test script 'test' does not exist",
      );
    });

    it("passes when test script is missing but skipTests is true", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build", skipTests: true },
      });

      const { readFile: mockReadFile } = await import("node:fs/promises");
      vi.mocked(mockReadFile).mockResolvedValue(
        JSON.stringify({
          name: "my-package",
          version: "1.0.0",
          scripts: { build: "tsup" },
        }) as any,
      );

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws when build script is missing and skipBuild is false", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build", skipBuild: false },
      });

      const { readFile: mockReadFile } = await import("node:fs/promises");
      vi.mocked(mockReadFile).mockResolvedValue(
        JSON.stringify({
          name: "my-package",
          version: "1.0.0",
          scripts: { test: "vitest" },
        }) as any,
      );

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Build script 'build' does not exist",
      );
    });

    it("passes when build script is missing but skipBuild is true", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "test", buildScript: "build", skipBuild: true },
      });

      const { readFile: mockReadFile } = await import("node:fs/promises");
      vi.mocked(mockReadFile).mockResolvedValue(
        JSON.stringify({
          name: "my-package",
          version: "1.0.0",
          scripts: { test: "vitest" },
        }) as any,
      );

      await expect(scriptsTask.task(ctx)).resolves.toBeUndefined();
    });

    it("throws with combined message when both scripts are missing", async () => {
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

      const { readFile: mockReadFile } = await import("node:fs/promises");
      vi.mocked(mockReadFile).mockResolvedValue(
        JSON.stringify({
          name: "my-package",
          version: "1.0.0",
          scripts: {},
        }) as any,
      );

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Test script 'test' does not exist. and Build script 'build' does not exist.",
      );
    });

    it("handles package.json with no scripts field", async () => {
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

      const { readFile: mockReadFile } = await import("node:fs/promises");
      vi.mocked(mockReadFile).mockResolvedValue(
        JSON.stringify({
          name: "my-package",
          version: "1.0.0",
        }) as any,
      );

      await expect(scriptsTask.task(ctx)).rejects.toThrow(
        "Please check your configuration",
      );
    });

    it("uses custom script names from ctx", async () => {
      const subtasks = await getSubtasks();
      const scriptsTask = subtasks[1];
      const ctx = createCtx({
        options: { testScript: "custom-test", buildScript: "custom-build" },
      });

      const { readFile: mockReadFile } = await import("node:fs/promises");
      vi.mocked(mockReadFile).mockResolvedValue(
        JSON.stringify({
          name: "my-package",
          version: "1.0.0",
          scripts: { "custom-test": "vitest", "custom-build": "tsup" },
        }) as any,
      );

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
      expect(mockCheckAvailability).toHaveBeenCalledWith(mockTask);
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
      expect(mockCheckAvailability).toHaveBeenCalledWith(mockTask);
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
});
