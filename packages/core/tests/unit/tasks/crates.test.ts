import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsInstalled,
  mockHasPermission,
  mockPublish,
  mockIsVersionPublished,
  mockPackageName,
  mockUnpublish,
  MockCratesRegistryFactory,
  MockRustEcosystemCtor,
} = vi.hoisted(() => ({
  mockIsInstalled: vi.fn().mockResolvedValue(true),
  mockHasPermission: vi.fn().mockResolvedValue(true),
  mockPublish: vi.fn().mockResolvedValue(true),
  mockIsVersionPublished: vi.fn().mockResolvedValue(false),
  mockPackageName: vi.fn().mockResolvedValue("my-crate"),
  mockUnpublish: vi.fn().mockResolvedValue(undefined),
  MockCratesRegistryFactory: vi.fn(),
  MockRustEcosystemCtor: vi.fn(),
}));

vi.mock("../../../src/registry/crates.js", () => ({
  CratesConnector: class MockCratesConnector {
    isInstalled = mockIsInstalled;
  },
  cratesPackageRegistry: (...args: unknown[]) => {
    MockCratesRegistryFactory(...args);
    return Promise.resolve({
      packageName: "my-crate",
      hasPermission: mockHasPermission,
      publish: mockPublish,
      isVersionPublished: mockIsVersionPublished,
      supportsUnpublish: true,
      unpublish: mockUnpublish,
    });
  },
}));

vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: class MockRustEcosystem {
    constructor(path: string) {
      MockRustEcosystemCtor(path);
    }
    packageName = mockPackageName;
  },
}));

import {
  createCratesAvailableCheckTask,
  createCratesPublishTask,
} from "../../../src/tasks/crates.js";
import { RollbackTracker } from "../../../src/utils/rollback.js";

beforeEach(() => {
  MockCratesRegistryFactory.mockClear();
  MockRustEcosystemCtor.mockClear();
  mockIsInstalled.mockClear().mockResolvedValue(true);
  mockHasPermission.mockClear().mockResolvedValue(true);
  mockPublish.mockClear().mockResolvedValue(true);
  mockIsVersionPublished.mockClear().mockResolvedValue(false);
  mockPackageName.mockClear().mockResolvedValue("my-crate");
  mockUnpublish.mockClear().mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// 1. createCratesAvailableCheckTask
// ---------------------------------------------------------------------------
describe("createCratesAvailableCheckTask", () => {
  const packagePath = "rust/crates/my-crate";

  it("has title with path label", () => {
    const task = createCratesAvailableCheckTask(packagePath);
    expect(task.title).toBe(
      "Checking crates.io availability (rust/crates/my-crate)",
    );
  });

  it("calls cratesPackageRegistry factory, checks isInstalled and hasPermission", async () => {
    const task = createCratesAvailableCheckTask(packagePath);
    await (task.task as () => Promise<void>)();

    expect(MockCratesRegistryFactory).toHaveBeenCalledWith(packagePath);
    expect(mockIsInstalled).toHaveBeenCalled();
    expect(mockHasPermission).toHaveBeenCalled();
  });

  it("throws when cargo is not installed", async () => {
    mockIsInstalled.mockResolvedValue(false);

    const task = createCratesAvailableCheckTask(packagePath);
    await expect((task.task as () => Promise<void>)()).rejects.toThrow(
      "cargo is not installed",
    );
  });

  it("throws when no permission", async () => {
    mockHasPermission.mockResolvedValue(false);

    const task = createCratesAvailableCheckTask(packagePath);
    await expect((task.task as () => Promise<void>)()).rejects.toThrow(
      "No crates.io credentials found",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. createCratesPublishTask
// ---------------------------------------------------------------------------
describe("createCratesPublishTask", () => {
  const packagePath = "rust/crates/my-crate";
  const mockCtx = {
    runtime: {
      version: "1.0.0",
      promptEnabled: true,
      rollback: new RollbackTracker(),
    },
    config: {
      rollback: { strategy: "individual", dangerouslyAllowUnpublish: false },
    },
  } as any;
  const mockTask = { output: "", title: "", skip: vi.fn() };

  beforeEach(() => {
    mockTask.output = "";
    mockTask.title = "";
    mockTask.skip.mockClear();
    mockCtx.runtime.rollback = new RollbackTracker();
  });

  it("has title with path label", () => {
    const task = createCratesPublishTask(packagePath);
    expect(task.title).toBe("Publishing to crates.io (rust/crates/my-crate)");
  });

  it("calls registry.publish() with no args", async () => {
    const task = createCratesPublishTask(packagePath);
    await (task.task as any)(mockCtx, mockTask);

    expect(MockCratesRegistryFactory).toHaveBeenCalledWith(packagePath);
    expect(mockPublish).toHaveBeenCalledWith();
  });

  it("constructs RustEcosystem with the given path", async () => {
    const task = createCratesPublishTask(packagePath);
    await (task.task as any)(mockCtx, mockTask);

    expect(MockRustEcosystemCtor).toHaveBeenCalledWith(packagePath);
  });

  describe("rollback registration", () => {
    it("registers no-op rollback in CI without dangerouslyAllowUnpublish", async () => {
      const ctx = {
        runtime: {
          version: "1.0.0",
          promptEnabled: false,
          rollback: new RollbackTracker(),
        },
        config: {
          rollback: { strategy: "individual", dangerouslyAllowUnpublish: false },
        },
      } as any;
      const task = createCratesPublishTask(packagePath);
      await (task.task as any)(ctx, mockTask);

      expect(ctx.runtime.rollback.size).toBe(1);
      await ctx.runtime.rollback.execute(ctx, { interactive: false });
      expect(mockUnpublish).not.toHaveBeenCalled();
    });

    it("registers real yank rollback in TTY mode", async () => {
      const ctx = {
        runtime: {
          version: "1.0.0",
          promptEnabled: true,
          rollback: new RollbackTracker(),
        },
        config: {
          rollback: { strategy: "individual", dangerouslyAllowUnpublish: false },
        },
      } as any;
      const task = createCratesPublishTask(packagePath);
      await (task.task as any)(ctx, mockTask);

      expect(ctx.runtime.rollback.size).toBe(1);
    });
  });
});
