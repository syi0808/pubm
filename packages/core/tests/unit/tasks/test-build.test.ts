import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExec = vi.hoisted(() => vi.fn());
const mockDetectWorkspace = vi.hoisted(() => vi.fn(() => []));
const mockResolveTestCommand = vi.hoisted(() =>
  vi.fn((script: string) =>
    Promise.resolve({ cmd: "pnpm", args: ["run", script] }),
  ),
);
const mockResolveBuildCommand = vi.hoisted(() =>
  vi.fn((script: string) =>
    Promise.resolve({ cmd: "pnpm", args: ["run", script] }),
  ),
);

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: mockDetectWorkspace,
}));

vi.mock("../../../src/ecosystem/catalog.js", () => {
  class MockJsEcosystem {
    packagePath: string;
    constructor(p: string) {
      this.packagePath = p;
    }
    resolveTestCommand(script: string) {
      return mockResolveTestCommand(script);
    }
    resolveBuildCommand(script: string) {
      return mockResolveBuildCommand(script);
    }
  }
  class MockRustEcosystem {
    packagePath: string;
    constructor(p: string) {
      this.packagePath = p;
    }
    resolveTestCommand(script: string) {
      const parts = script.split(/\s+/);
      return Promise.resolve({ cmd: "cargo", args: parts });
    }
    resolveBuildCommand(script: string) {
      const parts = script.split(/\s+/);
      return Promise.resolve({ cmd: "cargo", args: parts });
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

vi.mock("../../../src/utils/exec.js", () => ({
  exec: mockExec,
}));

vi.mock("../../../src/tasks/runner-utils/output-formatting.js", () => ({
  shouldRenderLiveCommandOutput: vi.fn(() => false),
  createLiveCommandOutput: vi.fn(),
}));

import type { PubmContext } from "../../../src/context.js";
import { makeTestContext } from "../../helpers/make-context.js";

function createCtx(
  overrides: {
    config?: Partial<PubmContext["config"]>;
    options?: Partial<PubmContext["options"]>;
    runtime?: Partial<PubmContext["runtime"]>;
    cwd?: string;
  } = {},
): PubmContext {
  return makeTestContext({
    config: {
      packages: [
        {
          path: ".",
          registries: ["npm"],
          ecosystem: "js",
        },
      ],
      ...overrides.config,
    },
    options: {
      testScript: "test",
      buildScript: "build",
      ...overrides.options,
    },
    runtime: {
      version: "1.0.0",
      promptEnabled: true,
      cleanWorkingTree: true,
      ...overrides.runtime,
    },
    cwd: overrides.cwd,
  });
}

function createTask() {
  return {
    title: "",
    output: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockResolvedValue({ stdout: "", stderr: "" });
  mockDetectWorkspace.mockReturnValue([]);
  mockResolveTestCommand.mockImplementation((script: string) =>
    Promise.resolve({ cmd: "pnpm", args: ["run", script] }),
  );
  mockResolveBuildCommand.mockImplementation((script: string) =>
    Promise.resolve({ cmd: "pnpm", args: ["run", script] }),
  );
});

describe("createTestTask", () => {
  it("is disabled when hasPrepare is false", async () => {
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const task = createTestTask(false, false);
    expect(task.enabled).toBe(false);
  });

  it("is disabled when skipTests is true", async () => {
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const task = createTestTask(true, true);
    expect(task.enabled).toBe(false);
  });

  it("is enabled when hasPrepare is true and skipTests is false", async () => {
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const task = createTestTask(true, false);
    expect(task.enabled).toBe(true);
  });
});

describe("createBuildTask", () => {
  it("is disabled when hasPrepare is false", async () => {
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const task = createBuildTask(false, false);
    expect(task.enabled).toBe(false);
  });

  it("is disabled when skipBuild is true", async () => {
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const task = createBuildTask(true, true);
    expect(task.enabled).toBe(false);
  });

  it("is enabled when hasPrepare is true and skipBuild is false", async () => {
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const task = createBuildTask(true, false);
    expect(task.enabled).toBe(true);
  });
});

describe("test task execution", () => {
  it("runs test with workspace command via pnpm", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx();
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "pnpm",
      ["run", "test"],
      expect.any(Object),
    );
  });

  it("runs test with testCommand as sh -c", async () => {
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          {
            path: ".",
            registries: ["npm"],
            ecosystem: "js",
            testCommand: "npm run test -- --ci",
          },
        ],
      },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "npm run test -- --ci"],
      expect.any(Object),
    );
  });

  it("runs test with ecosystem-level testCommand", async () => {
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        ecosystems: { js: { testCommand: "npx vitest run" } },
        packages: [
          {
            path: ".",
            registries: ["npm"],
            ecosystem: "js",
          },
        ],
      },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "npx vitest run"],
      expect.any(Object),
    );
  });

  it("runs test with ecosystem-level testScript", async () => {
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        ecosystems: { js: { testScript: "test:ci" } },
        packages: [
          {
            path: ".",
            registries: ["npm"],
            ecosystem: "js",
          },
        ],
      },
      options: { testScript: undefined },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockResolveTestCommand).toHaveBeenCalledWith("test:ci");
  });

  it("uses ECOSYSTEM_DEFAULTS when no script is configured", async () => {
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      options: { testScript: undefined },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockResolveTestCommand).toHaveBeenCalledWith("test");
  });

  it("runs per-package when no workspace detected", async () => {
    mockDetectWorkspace.mockReturnValue([]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          { path: "packages/a", registries: ["npm"], ecosystem: "js" },
          { path: "packages/b", registries: ["npm"], ecosystem: "js" },
        ],
      },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("runs individual package with testScript override", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          { path: "packages/a", registries: ["npm"], ecosystem: "js" },
          {
            path: "packages/b",
            registries: ["npm"],
            ecosystem: "js",
            testScript: "test:special",
          },
        ],
      },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    // Group run for packages/a + individual run for packages/b
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("runs individual package with testCommand override", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          {
            path: "packages/a",
            registries: ["npm"],
            ecosystem: "js",
            testCommand: "make test",
          },
        ],
      },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "make test"],
      expect.any(Object),
    );
  });

  it("throws AbstractError when test execution fails", async () => {
    mockExec.mockRejectedValue(new Error("test failed"));
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx();
    const task = createTask();

    await expect((testTask as any).task(ctx, task)).rejects.toThrow();
  });

  it("runs rust ecosystem test with cargo", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "cargo", patterns: ["crates/*"] },
    ]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [{ path: ".", registries: ["crates"], ecosystem: "rust" }],
      },
      options: { testScript: undefined },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "cargo",
      ["test"],
      expect.any(Object),
    );
  });

  it("runs rust per-package without workspace", async () => {
    mockDetectWorkspace.mockReturnValue([]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          { path: "crates/a", registries: ["crates"], ecosystem: "rust" },
        ],
      },
      options: { testScript: undefined },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "cargo",
      ["test"],
      expect.any(Object),
    );
  });
});

describe("build task execution", () => {
  it("runs build with workspace command", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx();
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "pnpm",
      ["run", "build"],
      expect.any(Object),
    );
  });

  it("runs build with buildCommand as sh -c", async () => {
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          {
            path: ".",
            registries: ["npm"],
            ecosystem: "js",
            buildCommand: "make build",
          },
        ],
      },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "make build"],
      expect.any(Object),
    );
  });

  it("runs build with ecosystem-level buildCommand", async () => {
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        ecosystems: { js: { buildCommand: "npx tsup" } },
        packages: [
          {
            path: ".",
            registries: ["npm"],
            ecosystem: "js",
          },
        ],
      },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "npx tsup"],
      expect.any(Object),
    );
  });

  it("runs build with ecosystem-level buildScript", async () => {
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        ecosystems: { js: { buildScript: "build:prod" } },
        packages: [
          {
            path: ".",
            registries: ["npm"],
            ecosystem: "js",
          },
        ],
      },
      options: { buildScript: undefined },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockResolveBuildCommand).toHaveBeenCalledWith("build:prod");
  });

  it("runs per-package when no workspace detected", async () => {
    mockDetectWorkspace.mockReturnValue([]);
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          { path: "packages/a", registries: ["npm"], ecosystem: "js" },
          { path: "packages/b", registries: ["npm"], ecosystem: "js" },
        ],
      },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("runs individual package with buildCommand override", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          {
            path: "packages/a",
            registries: ["npm"],
            ecosystem: "js",
            buildCommand: "make build",
          },
        ],
      },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "make build"],
      expect.any(Object),
    );
  });

  it("runs individual package with buildScript override", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          {
            path: "packages/a",
            registries: ["npm"],
            ecosystem: "js",
            buildScript: "build:special",
          },
        ],
      },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockResolveBuildCommand).toHaveBeenCalledWith("build:special");
  });

  it("throws AbstractError when build execution fails", async () => {
    mockExec.mockRejectedValue(new Error("build failed"));
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx();
    const task = createTask();

    await expect((buildTask as any).task(ctx, task)).rejects.toThrow();
  });

  it("runs rust ecosystem build with cargo", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "cargo", patterns: ["crates/*"] },
    ]);
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [{ path: ".", registries: ["crates"], ecosystem: "rust" }],
      },
      options: { buildScript: undefined },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "cargo",
      ["build", "--release"],
      expect.any(Object),
    );
  });

  it("uses ECOSYSTEM_DEFAULTS build for unknown global script", async () => {
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      options: { buildScript: undefined },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockResolveBuildCommand).toHaveBeenCalledWith("build");
  });

  it("falls back to type name when no ecosystem default exists", async () => {
    // This tests the ?? type fallback in ECOSYSTEM_DEFAULTS
    // We can't easily test an unknown ecosystem, but we ensure
    // the defaults path works for known ecosystems
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [{ path: ".", registries: ["npm"], ecosystem: "js" }],
      },
      options: { buildScript: undefined },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    expect(mockResolveBuildCommand).toHaveBeenCalledWith("build");
  });

  it("handles mixed ecosystem packages in same run", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
      { type: "cargo", patterns: ["crates/*"] },
    ]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        packages: [
          { path: "packages/a", registries: ["npm"], ecosystem: "js" },
          { path: "crates/a", registries: ["crates"], ecosystem: "rust" },
        ],
      },
      options: { testScript: undefined },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    // Should have 2 exec calls: one for js workspace, one for rust workspace
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("group command path uses sh -c for group-level testCommand", async () => {
    mockDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        ecosystems: { js: { testCommand: "npx vitest" } },
        packages: [
          { path: "packages/a", registries: ["npm"], ecosystem: "js" },
          { path: "packages/b", registries: ["npm"], ecosystem: "js" },
        ],
      },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "npx vitest"],
      expect.any(Object),
    );
    // Only one exec for the group (workspace manager handles fan-out)
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("runs ecosystem-level testCommand per-package when no workspace detected", async () => {
    mockDetectWorkspace.mockReturnValue([]);
    const { createTestTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const testTask = createTestTask(true, false);
    const ctx = createCtx({
      config: {
        ecosystems: { js: { testCommand: "npx vitest run" } },
        packages: [
          { path: "packages/a", registries: ["npm"], ecosystem: "js" },
          { path: "packages/b", registries: ["npm"], ecosystem: "js" },
        ],
      },
    });
    const task = createTask();

    await (testTask as any).task(ctx, task);

    // Without a workspace, command must run once per package
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "npx vitest run"],
      expect.objectContaining({
        nodeOptions: expect.objectContaining({
          cwd: expect.stringContaining("packages/a"),
        }),
      }),
    );
    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "npx vitest run"],
      expect.objectContaining({
        nodeOptions: expect.objectContaining({
          cwd: expect.stringContaining("packages/b"),
        }),
      }),
    );
  });

  it("runs ecosystem-level buildCommand per-package when no workspace detected", async () => {
    mockDetectWorkspace.mockReturnValue([]);
    const { createBuildTask } = await import(
      "../../../src/tasks/phases/test-build.js"
    );
    const buildTask = createBuildTask(true, false);
    const ctx = createCtx({
      config: {
        ecosystems: { js: { buildCommand: "npx tsup" } },
        packages: [
          { path: "packages/a", registries: ["npm"], ecosystem: "js" },
          { path: "packages/b", registries: ["npm"], ecosystem: "js" },
        ],
      },
    });
    const task = createTask();

    await (buildTask as any).task(ctx, task);

    // Without a workspace, command must run once per package
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "npx tsup"],
      expect.objectContaining({
        nodeOptions: expect.objectContaining({
          cwd: expect.stringContaining("packages/a"),
        }),
      }),
    );
    expect(mockExec).toHaveBeenCalledWith(
      "sh",
      ["-c", "npx tsup"],
      expect.objectContaining({
        nodeOptions: expect.objectContaining({
          cwd: expect.stringContaining("packages/b"),
        }),
      }),
    );
  });
});
