import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

vi.mock("../../../src/utils/package-name.js", () => ({
  isValidPackageName: vi.fn(),
}));

import {
  CustomPackageRegistry,
  customPackageRegistry,
} from "../../../src/registry/custom-registry.js";
import { NpmPackageRegistry } from "../../../src/registry/npm.js";
import { exec } from "../../../src/utils/exec.js";

const mockedExec = vi.mocked(exec);

let registry: CustomPackageRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  registry = new CustomPackageRegistry("my-package", FIXTURE_PATH);
});

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}

describe("CustomPackageRegistry", () => {
  it("extends NpmPackageRegistry", () => {
    expect(registry).toBeInstanceOf(NpmPackageRegistry);
  });

  describe("npm(args)", () => {
    it("appends --registry flag to all npm commands", async () => {
      mockStdout("+ my-package@1.0.0");

      await registry.publish();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--registry", "https://registry.npmjs.org"],
        {
          throwOnError: true,
          nodeOptions: { cwd: FIXTURE_PATH },
        },
      );
    });

    it("does not throw when command succeeds with stderr output", async () => {
      mockedExec.mockResolvedValue({
        stdout: "+ my-package@1.0.0",
        stderr: "npm warn deprecated",
      } as any);

      const result = await registry.publish();

      expect(result).toBe(true);
    });

    it("returns stdout on success", async () => {
      mockStdout("testuser\n");

      const result = await registry.userName();

      expect(result).toBe("testuser");
    });

    it("throws when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("fatal error"));

      // The overridden npm() throws via throwOnError; userName() catches it and
      // wraps in NpmError
      await expect(registry.userName()).rejects.toThrow();
    });
  });

  describe("inherited methods use overridden npm()", () => {
    it("publish calls npm with --registry appended (via overridden npm)", async () => {
      mockStdout("+ my-package@1.0.0");

      await registry.publish();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--registry", "https://registry.npmjs.org"],
        {
          throwOnError: true,
          nodeOptions: { cwd: FIXTURE_PATH },
        },
      );
    });

    it("publish calls npm with --registry appended", async () => {
      mockStdout("+ my-package@1.0.0");

      await registry.publish();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--registry", "https://registry.npmjs.org"],
        {
          throwOnError: true,
          nodeOptions: { cwd: FIXTURE_PATH },
        },
      );
    });

    it("publish with otp calls npm with --registry appended", async () => {
      mockStdout("+ my-package@1.0.0");

      await registry.publish("123456");

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        [
          "publish",
          "--otp",
          "123456",
          "--registry",
          "https://registry.npmjs.org",
        ],
        {
          throwOnError: true,
          nodeOptions: { cwd: FIXTURE_PATH },
        },
      );
    });

    it("userName calls npm with --registry appended", async () => {
      mockStdout("testuser\n");

      const result = await registry.userName();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["whoami", "--registry", "https://registry.npmjs.org"],
        { throwOnError: true },
      );
      expect(result).toBe("testuser");
    });
  });
});

describe("CustomPackageRegistry.npm() without registry URL", () => {
  it("throws when registry is falsy", async () => {
    const reg = new CustomPackageRegistry("test-pkg", FIXTURE_PATH);
    // Force registry to undefined to test the guard on line 7
    (reg as any).registry = undefined;

    await expect(reg.npm(["whoami"])).rejects.toThrow(
      "Custom registry URL is required for npm operations.",
    );
  });
});

describe("CustomPackageRegistry URL support", () => {
  it("uses custom registry URL when provided", () => {
    const registry = new CustomPackageRegistry(
      "test-pkg",
      FIXTURE_PATH,
      "https://npm.internal.com",
    );
    expect(registry.registry).toBe("https://npm.internal.com");
  });

  it("falls back to npm registry when no URL provided", () => {
    const registry = new CustomPackageRegistry("test-pkg", FIXTURE_PATH);
    expect(registry.registry).toBe("https://registry.npmjs.org");
  });
});

describe("customPackageRegistry()", () => {
  it("creates CustomPackageRegistry from ManifestReader", async () => {
    const readSpy = vi
      .spyOn(NpmPackageRegistry.reader, "read")
      .mockResolvedValue({
        name: "my-lib",
        version: "1.0.0",
        private: false,
        dependencies: [],
      });

    const result = await customPackageRegistry("/test/path");

    expect(readSpy).toHaveBeenCalledWith("/test/path");
    expect(result).toBeInstanceOf(CustomPackageRegistry);
    expect(result.packageName).toBe("my-lib");
    readSpy.mockRestore();
  });

  it("creates CustomPackageRegistry from provided packagePath", async () => {
    const readSpy = vi
      .spyOn(NpmPackageRegistry.reader, "read")
      .mockResolvedValue({
        name: "specific-lib",
        version: "2.0.0",
        private: false,
        dependencies: [],
      });

    const result = await customPackageRegistry(
      "/specific/path",
      "https://custom.reg",
    );

    expect(readSpy).toHaveBeenCalledWith("/specific/path");
    expect(result).toBeInstanceOf(CustomPackageRegistry);
    expect(result.packageName).toBe("specific-lib");
    expect(result.registry).toBe("https://custom.reg");
    readSpy.mockRestore();
  });
});
