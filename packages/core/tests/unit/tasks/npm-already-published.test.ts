import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/npm.js", () => ({
  npmPackageRegistry: vi.fn(),
}));

import { npmPackageRegistry } from "../../../src/registry/npm.js";
import { npmPublishTasks } from "../../../src/tasks/npm.js";

const mockedNpmRegistry = vi.mocked(npmPackageRegistry);

describe("npmPublishTasks — already published", () => {
  const mockTask = {
    output: "",
    title: "Running npm publish",
    skip: vi.fn(),
    prompt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTask.output = "";
    mockTask.title = "Running npm publish";
  });

  it("skips publish when version is already published", async () => {
    const mockNpm = {
      isVersionPublished: vi.fn().mockResolvedValue(true),
      packageName: "test-package",
    };
    mockedNpmRegistry.mockResolvedValue(mockNpm as any);

    const ctx = { runtime: { promptEnabled: true, version: "1.0.0" } } as any;

    await (npmPublishTasks as any).task(ctx, mockTask);

    expect(mockNpm.isVersionPublished).toHaveBeenCalledWith("1.0.0");
    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("skips publish when publish throws 'already published' error (fallback)", async () => {
    const mockNpm = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "You cannot publish over the previously published versions",
          ),
        ),
      packageName: "test-package",
    };
    mockedNpmRegistry.mockResolvedValue(mockNpm as any);

    const ctx = { runtime: { promptEnabled: true, version: "1.0.0" } } as any;

    await (npmPublishTasks as any).task(ctx, mockTask);

    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("proceeds with publish when version is not published", async () => {
    const mockNpm = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue(true),
      packageName: "test-package",
    };
    mockedNpmRegistry.mockResolvedValue(mockNpm as any);

    const ctx = { runtime: { promptEnabled: true, version: "1.0.0" } } as any;

    await (npmPublishTasks as any).task(ctx, mockTask);

    expect(mockNpm.publish).toHaveBeenCalled();
  });
});
