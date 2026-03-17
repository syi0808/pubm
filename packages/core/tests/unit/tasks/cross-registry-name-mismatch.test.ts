/**
 * Regression test for the cross-registry name mismatch bug.
 *
 * When a package directory publishes to multiple registries with different
 * names (e.g. package.json → "@pubm/core", jsr.json → "@pubm/pubm"),
 * each publish task must resolve the correct version via packagePath,
 * not via the registry-specific packageName.
 *
 * Before the fix, getPackageVersion looked up by jsr.json name ("@pubm/pubm")
 * in an independent-mode versionPlan keyed by package.json name ("@pubm/core"),
 * returned "", and isVersionPublished("") returned true → incorrectly skipped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrPackageRegistry: vi.fn(),
  JsrClient: { token: "fake-token" },
}));

vi.mock("../../../src/registry/npm.js", () => ({
  npmPackageRegistry: vi.fn(),
}));

import { npmPackageRegistry } from "../../../src/registry/npm.js";
import { jsrPackageRegistry } from "../../../src/registry/jsr.js";
import { createJsrPublishTask } from "../../../src/tasks/jsr.js";
import { createNpmPublishTask } from "../../../src/tasks/npm.js";

const mockedJsrRegistry = vi.mocked(jsrPackageRegistry);
const mockedNpmRegistry = vi.mocked(npmPackageRegistry);

describe("cross-registry name mismatch — independent mode", () => {
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

  it("JSR task resolves version by packagePath, not by jsr.json name", async () => {
    // jsr.json has name "@pubm/pubm" — different from package.json "@pubm/core"
    const mockJsr = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue(true),
      packageName: "@pubm/pubm", // ← different from config name
    };
    mockedJsrRegistry.mockResolvedValue(mockJsr as any);

    // Independent mode: versionPlan keyed by packagePath
    const ctx = {
      runtime: {
        promptEnabled: true,
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/core", "1.2.0"], // keyed by path, not name
            ["packages/cli", "0.5.0"],
          ]),
        },
      },
    } as any;

    const listrTask = createJsrPublishTask("packages/core");
    await (listrTask as any).task(ctx, mockTask);

    // Version should be "1.2.0" (resolved by path), not "" (name mismatch)
    expect(mockJsr.isVersionPublished).toHaveBeenCalledWith("1.2.0");
    expect(mockJsr.publish).toHaveBeenCalled();
    expect(mockTask.skip).not.toHaveBeenCalled();
  });

  it("npm task resolves version by packagePath in independent mode", async () => {
    const mockNpm = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue(true),
      packageName: "@pubm/core",
    };
    mockedNpmRegistry.mockResolvedValue(mockNpm as any);

    const ctx = {
      runtime: {
        promptEnabled: true,
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/core", "1.2.0"],
            ["packages/cli", "0.5.0"],
          ]),
        },
      },
    } as any;

    const listrTask = createNpmPublishTask("packages/core");
    await (listrTask as any).task(ctx, mockTask);

    expect(mockNpm.isVersionPublished).toHaveBeenCalledWith("1.2.0");
    expect(mockNpm.publish).toHaveBeenCalled();
    expect(mockTask.skip).not.toHaveBeenCalled();
  });

  it("returns empty version for unknown packagePath in independent mode", async () => {
    const mockJsr = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue(true),
      packageName: "@pubm/pubm",
    };
    mockedJsrRegistry.mockResolvedValue(mockJsr as any);

    const ctx = {
      runtime: {
        promptEnabled: true,
        versionPlan: {
          mode: "independent",
          packages: new Map([["packages/cli", "0.5.0"]]),
        },
      },
    } as any;

    // packages/core is NOT in the versionPlan
    const listrTask = createJsrPublishTask("packages/core");
    await (listrTask as any).task(ctx, mockTask);

    // isVersionPublished should receive "" and the empty guard returns false
    expect(mockJsr.isVersionPublished).toHaveBeenCalledWith("");
  });
});
