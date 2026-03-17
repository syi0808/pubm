import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/npm.js", () => ({
  npmPackageRegistry: vi.fn(),
}));

import { npmPackageRegistry } from "../../../src/registry/npm.js";
import { createNpmPublishTask } from "../../../src/tasks/npm.js";

const mockedNpmRegistry = vi.mocked(npmPackageRegistry);

describe("createNpmPublishTask — already published", () => {
  const mockTask = {
    output: "",
    title: "",
    skip: vi.fn(),
    prompt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTask.output = "";
    mockTask.title = "";
  });

  it("calls npmPackageRegistry with the provided packagePath", async () => {
    const mockNpm = {
      isVersionPublished: vi.fn().mockResolvedValue(true),
      packageName: "test-package",
    };
    mockedNpmRegistry.mockResolvedValue(mockNpm as any);

    const ctx = {
      runtime: {
        promptEnabled: true,
        versionPlan: { mode: "single", version: "1.0.0", packagePath: "packages/core" },
      },
    } as any;
    const task = createNpmPublishTask("packages/core");

    await (task.task as any)(ctx, mockTask);

    expect(mockedNpmRegistry).toHaveBeenCalledWith("packages/core");
  });

  it("skips publish when version is already published", async () => {
    const mockNpm = {
      isVersionPublished: vi.fn().mockResolvedValue(true),
      packageName: "test-package",
    };
    mockedNpmRegistry.mockResolvedValue(mockNpm as any);

    const ctx = {
      runtime: {
        promptEnabled: true,
        versionPlan: { mode: "single", version: "1.0.0", packagePath: "packages/core" },
      },
    } as any;
    const task = createNpmPublishTask("packages/core");

    await (task.task as any)(ctx, mockTask);

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

    const ctx = {
      runtime: {
        promptEnabled: true,
        versionPlan: { mode: "single", version: "1.0.0", packagePath: "packages/core" },
      },
    } as any;
    const task = createNpmPublishTask("packages/core");

    await (task.task as any)(ctx, mockTask);

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

    const ctx = {
      runtime: {
        promptEnabled: true,
        versionPlan: { mode: "single", version: "1.0.0", packagePath: "packages/core" },
      },
    } as any;
    const task = createNpmPublishTask("packages/core");

    await (task.task as any)(ctx, mockTask);

    expect(mockNpm.publish).toHaveBeenCalled();
  });
});
