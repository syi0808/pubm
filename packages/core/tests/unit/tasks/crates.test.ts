import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsInstalled,
  mockHasPermission,
  mockPublish,
  mockIsVersionPublished,
  mockPackageName,
  MockCratesRegistryFactory,
  MockRustEcosystemCtor,
} = vi.hoisted(() => ({
  mockIsInstalled: vi.fn().mockResolvedValue(true),
  mockHasPermission: vi.fn().mockResolvedValue(true),
  mockPublish: vi.fn().mockResolvedValue(true),
  mockIsVersionPublished: vi.fn().mockResolvedValue(false),
  mockPackageName: vi.fn().mockResolvedValue("my-crate"),
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

beforeEach(() => {
  MockCratesRegistryFactory.mockClear();
  MockRustEcosystemCtor.mockClear();
  mockIsInstalled.mockClear().mockResolvedValue(true);
  mockHasPermission.mockClear().mockResolvedValue(true);
  mockPublish.mockClear().mockResolvedValue(true);
  mockIsVersionPublished.mockClear().mockResolvedValue(false);
  mockPackageName.mockClear().mockResolvedValue("my-crate");
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
  const mockCtx = { runtime: { version: "1.0.0" } } as any;
  const mockTask = { output: "", title: "", skip: vi.fn() };

  beforeEach(() => {
    mockTask.output = "";
    mockTask.title = "";
    mockTask.skip.mockClear();
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
});
