import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

vi.mock("../../../src/utils/package.js", () => ({
  getPackageJson: vi.fn(),
}));

vi.mock("../../../src/utils/package-name.js", () => ({
  isValidPackageName: vi.fn(),
}));

import {
  CustomRegistry,
  customRegistry,
} from "../../../src/registry/custom-registry.js";
import { NpmRegistry } from "../../../src/registry/npm.js";
import { exec } from "../../../src/utils/exec.js";
import { getPackageJson } from "../../../src/utils/package.js";

const mockedExec = vi.mocked(exec);
const mockedGetPackageJson = vi.mocked(getPackageJson);

let registry: CustomRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  registry = new CustomRegistry("my-package");
});

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}

describe("CustomRegistry", () => {
  it("extends NpmRegistry", () => {
    expect(registry).toBeInstanceOf(NpmRegistry);
  });

  describe("npm(args)", () => {
    it("appends --registry flag to all npm commands", async () => {
      mockStdout("help output");

      await registry.isInstalled();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["--version", "--registry", "https://registry.npmjs.org"],
        { throwOnError: true },
      );
    });

    it("does not throw when command succeeds with stderr output", async () => {
      mockedExec.mockResolvedValue({
        stdout: "ok",
        stderr: "npm warn deprecated",
      } as any);

      const result = await registry.isInstalled();

      expect(result).toBe(true);
    });

    it("returns stdout on success", async () => {
      mockStdout("10.0.0");

      const result = await registry.version();

      expect(result).toBe("10.0.0");
    });

    it("throws when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("fatal error"));

      // The overridden npm() throws via throwOnError; version() catches it and
      // wraps in NpmError
      await expect(registry.version()).rejects.toThrow();
    });
  });

  describe("inherited methods use overridden npm()", () => {
    it("isInstalled calls npm with --registry appended", async () => {
      mockStdout("");

      await registry.isInstalled();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["--version", "--registry", "https://registry.npmjs.org"],
        { throwOnError: true },
      );
    });

    it("publish calls npm with --registry appended", async () => {
      mockStdout("+ my-package@1.0.0");

      await registry.publish();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--registry", "https://registry.npmjs.org"],
        { throwOnError: true },
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
        { throwOnError: true },
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

describe("CustomRegistry URL support", () => {
  it("uses custom registry URL when provided", () => {
    const registry = new CustomRegistry("test-pkg", "https://npm.internal.com");
    expect(registry.registry).toBe("https://npm.internal.com");
  });

  it("falls back to npm registry when no URL provided", () => {
    const registry = new CustomRegistry("test-pkg");
    expect(registry.registry).toBe("https://registry.npmjs.org");
  });
});

describe("customRegistry()", () => {
  it("creates CustomRegistry from package.json name", async () => {
    mockedGetPackageJson.mockResolvedValue({
      name: "my-lib",
      version: "1.0.0",
    } as any);

    const result = await customRegistry();

    expect(mockedGetPackageJson).toHaveBeenCalled();
    expect(result).toBeInstanceOf(CustomRegistry);
    expect(result.packageName).toBe("my-lib");
  });
});
