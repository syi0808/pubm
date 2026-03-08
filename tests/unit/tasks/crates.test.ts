import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsInstalled,
  mockHasPermission,
  mockPublish,
  mockIsVersionPublished,
  mockPackageName,
  MockCratesRegistryCtor,
  MockRustEcosystemCtor,
} = vi.hoisted(() => ({
  mockIsInstalled: vi.fn().mockResolvedValue(true),
  mockHasPermission: vi.fn().mockResolvedValue(true),
  mockPublish: vi.fn().mockResolvedValue(true),
  mockIsVersionPublished: vi.fn().mockResolvedValue(false),
  mockPackageName: vi.fn().mockResolvedValue("my-crate"),
  MockCratesRegistryCtor: vi.fn(),
  MockRustEcosystemCtor: vi.fn(),
}));

vi.mock("../../../src/registry/crates.js", () => ({
  CratesRegistry: class MockCratesRegistry {
    constructor(name: string) {
      MockCratesRegistryCtor(name);
    }
    isInstalled = mockIsInstalled;
    hasPermission = mockHasPermission;
    publish = mockPublish;
    isVersionPublished = mockIsVersionPublished;
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
  cratesAvailableCheckTasks,
  cratesPublishTasks,
  createCratesAvailableCheckTask,
  createCratesPublishTask,
} from "../../../src/tasks/crates.js";

beforeEach(() => {
  MockCratesRegistryCtor.mockClear();
  MockRustEcosystemCtor.mockClear();
  mockIsInstalled.mockClear().mockResolvedValue(true);
  mockHasPermission.mockClear().mockResolvedValue(true);
  mockPublish.mockClear().mockResolvedValue(true);
  mockIsVersionPublished.mockClear().mockResolvedValue(false);
  mockPackageName.mockClear().mockResolvedValue("my-crate");
});

// ---------------------------------------------------------------------------
// 1. Static exports (backward compat)
// ---------------------------------------------------------------------------
describe("static exports (backward compat)", () => {
  it("cratesAvailableCheckTasks has correct title", () => {
    expect(cratesAvailableCheckTasks.title).toBe(
      "Checking crates.io availability",
    );
  });

  it("cratesPublishTasks has correct title", () => {
    expect(cratesPublishTasks.title).toBe("Publishing to crates.io");
  });
});

// ---------------------------------------------------------------------------
// 2. createCratesAvailableCheckTask without path
// ---------------------------------------------------------------------------
describe("createCratesAvailableCheckTask without path", () => {
  it("has title without label", () => {
    const task = createCratesAvailableCheckTask();
    expect(task.title).toBe("Checking crates.io availability");
  });

  it("calls getCrateName, creates CratesRegistry, checks isInstalled and hasPermission", async () => {
    const task = createCratesAvailableCheckTask();
    await (task.task as () => Promise<void>)();

    expect(MockRustEcosystemCtor).toHaveBeenCalledWith(process.cwd());
    expect(mockPackageName).toHaveBeenCalled();
    expect(MockCratesRegistryCtor).toHaveBeenCalledWith("my-crate");
    expect(mockIsInstalled).toHaveBeenCalled();
    expect(mockHasPermission).toHaveBeenCalled();
  });

  it("throws when cargo is not installed", async () => {
    mockIsInstalled.mockResolvedValue(false);

    const task = createCratesAvailableCheckTask();
    await expect((task.task as () => Promise<void>)()).rejects.toThrow(
      "cargo is not installed",
    );
  });

  it("throws when no permission", async () => {
    mockHasPermission.mockResolvedValue(false);

    const task = createCratesAvailableCheckTask();
    await expect((task.task as () => Promise<void>)()).rejects.toThrow(
      "No crates.io credentials found",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. createCratesAvailableCheckTask with path
// ---------------------------------------------------------------------------
describe("createCratesAvailableCheckTask with path", () => {
  const packagePath = "rust/crates/my-crate";

  it("has title with path label", () => {
    const task = createCratesAvailableCheckTask(packagePath);
    expect(task.title).toBe(
      "Checking crates.io availability (rust/crates/my-crate)",
    );
  });

  it("creates RustEcosystem with the given path", async () => {
    const task = createCratesAvailableCheckTask(packagePath);
    await (task.task as () => Promise<void>)();

    expect(MockRustEcosystemCtor).toHaveBeenCalledWith(packagePath);
  });
});

// ---------------------------------------------------------------------------
// 4. createCratesPublishTask without path
// ---------------------------------------------------------------------------
describe("createCratesPublishTask without path", () => {
  const mockCtx = { version: "1.0.0" } as any;
  const mockTask = { output: "", title: "", skip: vi.fn() };

  beforeEach(() => {
    mockTask.output = "";
    mockTask.title = "";
    mockTask.skip.mockClear();
  });

  it("has title without label", () => {
    const task = createCratesPublishTask();
    expect(task.title).toBe("Publishing to crates.io");
  });

  it("calls registry.publish() with no args (undefined)", async () => {
    const task = createCratesPublishTask();
    await (task.task as any)(mockCtx, mockTask);

    expect(MockRustEcosystemCtor).toHaveBeenCalledWith(process.cwd());
    expect(MockCratesRegistryCtor).toHaveBeenCalledWith("my-crate");
    expect(mockPublish).toHaveBeenCalledWith(undefined);
  });
});

// ---------------------------------------------------------------------------
// 5. createCratesPublishTask with path
// ---------------------------------------------------------------------------
describe("createCratesPublishTask with path", () => {
  const packagePath = "rust/crates/my-crate";
  const mockCtx = { version: "1.0.0" } as any;
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

  it("calls registry.publish with the package path", async () => {
    const task = createCratesPublishTask(packagePath);
    await (task.task as any)(mockCtx, mockTask);

    expect(mockPublish).toHaveBeenCalledWith(packagePath);
  });

  it("constructs RustEcosystem with the given path", async () => {
    const task = createCratesPublishTask(packagePath);
    await (task.task as any)(mockCtx, mockTask);

    expect(MockRustEcosystemCtor).toHaveBeenCalledWith(packagePath);
  });
});
