import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsVersionPublished, mockPublish } = vi.hoisted(() => ({
  mockIsVersionPublished: vi.fn().mockResolvedValue(false),
  mockPublish: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../src/registry/crates.js", () => ({
  cratesPackageRegistry: vi.fn().mockImplementation(() =>
    Promise.resolve({
      packageName: "test-crate",
      isVersionPublished: mockIsVersionPublished,
      publish: mockPublish,
    }),
  ),
}));

vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: class MockRustEcosystem {
    packageName = vi.fn().mockResolvedValue("test-crate");
  },
}));

import { createCratesPublishTask } from "../../../src/tasks/crates.js";

describe("cratesPublishTask — already published", () => {
  const mockTask = {
    output: "",
    title: "",
    skip: vi.fn(),
  };

  beforeEach(() => {
    mockIsVersionPublished.mockClear().mockResolvedValue(false);
    mockPublish.mockClear().mockResolvedValue(true);
    mockTask.output = "";
    mockTask.title = "";
    mockTask.skip.mockClear();
  });

  it("skips publish when version is already published", async () => {
    mockIsVersionPublished.mockResolvedValue(true);

    const task = createCratesPublishTask("packages/my-crate");
    const ctx = { runtime: { version: "1.0.0" } } as any;

    await (task as any).task(ctx, mockTask);

    expect(mockIsVersionPublished).toHaveBeenCalledWith("1.0.0");
    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("skips publish when publish throws 'already uploaded' error (fallback)", async () => {
    mockIsVersionPublished.mockResolvedValue(false);
    mockPublish.mockRejectedValue(
      new Error("crate version `1.0.0` is already uploaded"),
    );

    const task = createCratesPublishTask("packages/my-crate");
    const ctx = { runtime: { version: "1.0.0" } } as any;

    await (task as any).task(ctx, mockTask);

    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("proceeds with publish when version is not published", async () => {
    mockIsVersionPublished.mockResolvedValue(false);

    const task = createCratesPublishTask("packages/my-crate");
    const ctx = { runtime: { version: "1.0.0" } } as any;

    await (task as any).task(ctx, mockTask);

    expect(mockPublish).toHaveBeenCalled();
    expect(mockTask.skip).not.toHaveBeenCalled();
  });
});
