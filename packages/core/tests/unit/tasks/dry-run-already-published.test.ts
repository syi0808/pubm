import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/npm.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/registry/npm.js")>();
  return {
    ...original,
    npmPackageRegistry: vi.fn(),
  };
});

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrPackageRegistry: vi.fn(),
  JsrClient: { token: "fake-token" },
}));

vi.mock("../../../src/registry/crates.js", () => ({
  cratesPackageRegistry: vi.fn(),
}));

vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: vi.fn().mockImplementation(function () {
    return {
      packageName: vi.fn().mockResolvedValue("test-crate"),
      dependencies: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
    };
  }),
}));

import { RustEcosystem } from "../../../src/ecosystem/rust.js";
import { cratesPackageRegistry } from "../../../src/registry/crates.js";
import { jsrPackageRegistry } from "../../../src/registry/jsr.js";
import { npmPackageRegistry } from "../../../src/registry/npm.js";
import {
  createCratesDryRunPublishTask,
  createJsrDryRunPublishTask,
  createNpmDryRunPublishTask,
} from "../../../src/tasks/dry-run-publish.js";

describe("dry-run publish — already published", () => {
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

  describe("npm", () => {
    it("skips dry-run when version already published", async () => {
      const mockNpm = {
        isVersionPublished: vi.fn().mockResolvedValue(true),
        dryRunPublish: vi.fn(),
        packageName: "test-package",
      };
      vi.mocked(npmPackageRegistry).mockResolvedValue(mockNpm as any);

      const ctx = { runtime: { version: "1.0.0" } } as any;
      const task = createNpmDryRunPublishTask("packages/core");
      await (task as any).task(ctx, mockTask);

      expect(vi.mocked(npmPackageRegistry)).toHaveBeenCalledWith(
        "packages/core",
      );
      expect(mockNpm.isVersionPublished).toHaveBeenCalledWith("1.0.0");
      expect(mockTask.skip).toHaveBeenCalled();
      expect(mockNpm.dryRunPublish).not.toHaveBeenCalled();
    });
  });

  describe("jsr", () => {
    it("skips dry-run when version already published", async () => {
      const mockJsr = {
        isVersionPublished: vi.fn().mockResolvedValue(true),
        dryRunPublish: vi.fn(),
        packageName: "@scope/test",
      };
      vi.mocked(jsrPackageRegistry).mockResolvedValue(mockJsr as any);

      const ctx = { runtime: { version: "1.0.0" } } as any;
      const task = createJsrDryRunPublishTask("packages/core");
      await (task as any).task(ctx, mockTask);

      expect(vi.mocked(jsrPackageRegistry)).toHaveBeenCalledWith(
        "packages/core",
      );
      expect(mockJsr.isVersionPublished).toHaveBeenCalledWith("1.0.0");
      expect(mockTask.skip).toHaveBeenCalled();
      expect(mockJsr.dryRunPublish).not.toHaveBeenCalled();
    });
  });

  describe("crates", () => {
    it("skips dry-run when version already published", async () => {
      vi.mocked(RustEcosystem).mockImplementation(function () {
        return {
          packageName: vi.fn().mockResolvedValue("test-crate"),
          dependencies: vi.fn().mockResolvedValue([]),
        } as any;
      });

      const mockRegistry = {
        isVersionPublished: vi.fn().mockResolvedValue(true),
        dryRunPublish: vi.fn(),
        packageName: "test-crate",
      };
      vi.mocked(cratesPackageRegistry).mockResolvedValue(mockRegistry as any);

      const task = createCratesDryRunPublishTask("packages/my-crate");
      const ctx = { runtime: { version: "1.0.0" } } as any;
      await (task as any).task(ctx, mockTask);

      expect(mockRegistry.isVersionPublished).toHaveBeenCalledWith("1.0.0");
      expect(mockTask.skip).toHaveBeenCalled();
      expect(mockRegistry.dryRunPublish).not.toHaveBeenCalled();
    });
  });
});
