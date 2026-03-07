import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tinyexec", async (importOriginal) => {
  const original = await importOriginal<typeof import("tinyexec")>();
  return {
    ...original,
    exec: vi.fn(),
  };
});

vi.mock("../../../src/utils/package-name.js", () => ({
  isValidPackageName: vi.fn(),
}));

vi.mock("../../../src/utils/package.js", () => ({
  getPackageJson: vi.fn(),
}));

import { exec, NonZeroExitError } from "tinyexec";
import { NpmRegistry, npmRegistry } from "../../../src/registry/npm.js";
import { getPackageJson } from "../../../src/utils/package.js";
import { isValidPackageName } from "../../../src/utils/package-name.js";

const mockedExec = vi.mocked(exec);
const mockedIsValidPackageName = vi.mocked(isValidPackageName);
const mockedGetPackageJson = vi.mocked(getPackageJson);

let mockedFetch: ReturnType<typeof vi.fn>;
let registry: NpmRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetch = vi.fn();
  vi.stubGlobal("fetch", mockedFetch);
  registry = new NpmRegistry("my-package");
});

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}

function mockNonZeroExitError(stderr: string) {
  const error = new NonZeroExitError({ exitCode: 1 } as any, {
    stderr,
    stdout: "",
  });
  mockedExec.mockRejectedValue(error);
}

describe("NpmRegistry", () => {
  it("has default registry url", () => {
    expect(registry.registry).toBe("https://registry.npmjs.org");
  });

  describe("npm(args)", () => {
    it("does not throw when command succeeds with stderr output", async () => {
      mockedExec.mockResolvedValue({
        stdout: "ok",
        stderr: "npm warn deprecated",
      } as any);

      const result = await registry.isInstalled();

      expect(result).toBe(true);
    });

    it("calls exec with npm and returns stdout", async () => {
      mockStdout("help output");

      // npm() is protected, test indirectly via isInstalled
      const result = await registry.isInstalled();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["--version"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("throws when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("fatal error"));

      // npm() throws via throwOnError, which bubbles up through version() catch as NpmError
      await expect(registry.version()).rejects.toThrow();
    });
  });

  describe("isInstalled()", () => {
    it("returns true when npm --version succeeds", async () => {
      mockStdout("11.5.1");

      const result = await registry.isInstalled();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["--version"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("returns false when npm --version fails", async () => {
      mockedExec.mockRejectedValue(new Error("not found"));

      const result = await registry.isInstalled();

      expect(result).toBe(false);
    });
  });

  describe("installGlobally(packageName)", () => {
    it("returns true on success", async () => {
      mockStdout("added 1 package");

      const result = await registry.installGlobally("some-pkg");

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["install", "-g", "some-pkg"],
        { throwOnError: true },
      );
      expect(result).toBe(true);
    });

    it("throws NpmError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("ERR! code EACCES"));

      await expect(registry.installGlobally("some-pkg")).rejects.toThrow(
        "Failed to run `npm install -g some-pkg`",
      );
    });
  });

  describe("isPublished()", () => {
    it("returns true when registry responds with 200", async () => {
      mockedFetch.mockResolvedValue({ status: 200 });

      const result = await registry.isPublished();

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://registry.npmjs.org/my-package",
      );
      expect(result).toBe(true);
    });

    it("returns false when registry responds with 404", async () => {
      mockedFetch.mockResolvedValue({ status: 404 });

      const result = await registry.isPublished();

      expect(result).toBe(false);
    });

    it("throws NpmError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(registry.isPublished()).rejects.toThrow(
        "Failed to fetch `https://registry.npmjs.org/my-package`",
      );
    });
  });

  describe("userName()", () => {
    it("returns trimmed username", async () => {
      mockStdout("testuser\n");

      const result = await registry.userName();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["whoami"], {
        throwOnError: true,
      });
      expect(result).toBe("testuser");
    });

    it("throws NpmError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("ENEEDAUTH"));

      await expect(registry.userName()).rejects.toThrow(
        "Failed to run `npm whoami`",
      );
    });
  });

  describe("isLoggedIn()", () => {
    it("returns true when whoami succeeds", async () => {
      mockStdout("testuser");

      const result = await registry.isLoggedIn();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["whoami"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("returns false when error includes ENEEDAUTH", async () => {
      mockNonZeroExitError("ENEEDAUTH");

      const result = await registry.isLoggedIn();

      expect(result).toBe(false);
    });

    it("returns false for other NonZeroExitError", async () => {
      mockNonZeroExitError("some other error");

      const result = await registry.isLoggedIn();

      expect(result).toBe(false);
    });

    it("throws NpmError for non-NonZeroExitError", async () => {
      mockedExec.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(registry.isLoggedIn()).rejects.toThrow(
        "Failed to run `npm whoami`",
      );
    });
  });

  describe("collaborators()", () => {
    it("returns parsed collaborators JSON", async () => {
      const data = { testuser: "read-write" };
      mockStdout(JSON.stringify(data));

      const result = await registry.collaborators();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["access", "list", "collaborators", "my-package", "--json"],
        { throwOnError: true },
      );
      expect(result).toEqual(data);
    });

    it("throws NpmError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("ERR!"));

      await expect(registry.collaborators()).rejects.toThrow(
        "Failed to run `npm access list collaborators my-package --json`",
      );
    });

    it("throws NpmError with unexpected response message on invalid JSON", async () => {
      mockStdout("not valid json");

      await expect(registry.collaborators()).rejects.toThrow(
        /unexpected response/i,
      );
    });
  });

  describe("hasPermission()", () => {
    it("returns true when user has write permission", async () => {
      mockedExec
        .mockResolvedValueOnce({ stdout: "testuser\n", stderr: "" } as any)
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ testuser: "read-write" }),
          stderr: "",
        } as any);

      const result = await registry.hasPermission();

      expect(result).toBe(true);
    });

    it("returns false when user does not have write permission", async () => {
      mockedExec
        .mockResolvedValueOnce({ stdout: "testuser\n", stderr: "" } as any)
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ testuser: "read-only" }),
          stderr: "",
        } as any);

      const result = await registry.hasPermission();

      expect(result).toBe(false);
    });

    it("returns false when user is not in collaborators", async () => {
      mockedExec
        .mockResolvedValueOnce({ stdout: "testuser\n", stderr: "" } as any)
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ otheruser: "read-write" }),
          stderr: "",
        } as any);

      const result = await registry.hasPermission();

      expect(result).toBe(false);
    });
  });

  describe("distTags()", () => {
    it("returns array of dist-tag names", async () => {
      const tags = { latest: "1.0.0", beta: "2.0.0-beta.1" };
      mockStdout(JSON.stringify(tags));

      const result = await registry.distTags();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["view", "my-package", "dist-tags", "--json"],
        { throwOnError: true },
      );
      expect(result).toEqual(["latest", "beta"]);
    });

    it("throws NpmError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("ERR! 404"));

      await expect(registry.distTags()).rejects.toThrow(
        "Failed to run `npm view my-package dist-tags --json`",
      );
    });

    it("throws NpmError with unexpected response message on invalid JSON", async () => {
      mockStdout("not valid json");

      await expect(registry.distTags()).rejects.toThrow(/unexpected response/i);
    });
  });

  describe("version()", () => {
    it("returns npm version string", async () => {
      mockStdout("10.2.0");

      const result = await registry.version();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["--version"], {
        throwOnError: true,
      });
      expect(result).toBe("10.2.0");
    });

    it("throws on failure (no await, so raw error escapes catch)", async () => {
      mockedExec.mockRejectedValue(new Error("some error"));

      await expect(registry.version()).rejects.toThrow("some error");
    });
  });

  describe("ping()", () => {
    it("returns true when ping succeeds", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      const result = await registry.ping();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["ping"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("throws NpmError when ping fails", async () => {
      mockedExec.mockRejectedValue(new Error("timeout"));

      await expect(registry.ping()).rejects.toThrow("Failed to run `npm ping`");
    });
  });

  describe("publishProvenance()", () => {
    it("returns true on successful publish", async () => {
      mockStdout("+ my-package@1.0.0");

      const result = await registry.publishProvenance();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--provenance", "--access", "public"],
        { throwOnError: true },
      );
      expect(result).toBe(true);
    });

    it("returns false when error includes EOTP", async () => {
      mockNonZeroExitError("EOTP");

      const result = await registry.publishProvenance();

      expect(result).toBe(false);
    });

    it("throws NpmError for non-EOTP errors", async () => {
      mockNonZeroExitError("ENEEDAUTH");

      await expect(registry.publishProvenance()).rejects.toThrow(
        "Failed to publish to npm",
      );
    });

    it("throws NpmError with forbidden message for 403 errors", async () => {
      mockNonZeroExitError("403 Forbidden");

      await expect(registry.publishProvenance()).rejects.toThrow(/forbidden/i);
    });

    it("throws NpmError with rate limit message for 429 errors", async () => {
      mockNonZeroExitError("429 Too Many Requests");

      await expect(registry.publishProvenance()).rejects.toThrow(/rate/i);
    });

    it("returns true when publish succeeds without EOTP", async () => {
      mockStdout("published");

      const result = await registry.publishProvenance();

      expect(result).toBe(true);
    });
  });

  describe("publish()", () => {
    it("returns true on successful publish without OTP", async () => {
      mockStdout("+ my-package@1.0.0");

      const result = await registry.publish();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["publish"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("returns true on successful publish with OTP", async () => {
      mockStdout("+ my-package@1.0.0");

      const result = await registry.publish("123456");

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--otp", "123456"],
        { throwOnError: true },
      );
      expect(result).toBe(true);
    });

    it("returns false when error includes EOTP (without otp)", async () => {
      mockNonZeroExitError("EOTP");

      const result = await registry.publish();

      expect(result).toBe(false);
    });

    it("returns false when error includes EOTP (with otp)", async () => {
      mockNonZeroExitError("EOTP");

      const result = await registry.publish("123456");

      expect(result).toBe(false);
    });

    it("throws NpmError for non-EOTP errors", async () => {
      mockNonZeroExitError("ENEEDAUTH");

      await expect(registry.publish()).rejects.toThrow(
        "Failed to publish to npm",
      );
    });

    it("throws NpmError with forbidden message for 403 errors", async () => {
      mockNonZeroExitError("403 Forbidden");

      await expect(registry.publish()).rejects.toThrow(/forbidden/i);
    });

    it("throws NpmError with rate limit message for 429 errors", async () => {
      mockNonZeroExitError("429 Too Many Requests");

      await expect(registry.publish()).rejects.toThrow(/rate/i);
    });
  });

  describe("twoFactorAuthMode()", () => {
    it("returns tfa mode from npm profile", async () => {
      mockStdout(JSON.stringify({ tfa: { mode: "auth-and-writes" } }));

      const result = await registry.twoFactorAuthMode();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["profile", "get", "--json"],
        { throwOnError: true },
      );
      expect(result).toBe("auth-and-writes");
    });

    it("returns auth-only mode", async () => {
      mockStdout(JSON.stringify({ tfa: { mode: "auth-only" } }));

      const result = await registry.twoFactorAuthMode();

      expect(result).toBe("auth-only");
    });

    it("returns null when tfa is not set", async () => {
      mockStdout(JSON.stringify({}));

      const result = await registry.twoFactorAuthMode();

      expect(result).toBeNull();
    });

    it("returns null on command failure", async () => {
      mockedExec.mockRejectedValue(new Error("not logged in"));

      const result = await registry.twoFactorAuthMode();

      expect(result).toBeNull();
    });
  });

  describe("isPackageNameAvaliable()", () => {
    it("returns true when package name is valid", async () => {
      mockedIsValidPackageName.mockReturnValue(true);

      const result = await registry.isPackageNameAvaliable();

      expect(mockedIsValidPackageName).toHaveBeenCalledWith("my-package");
      expect(result).toBe(true);
    });

    it("returns false when package name is invalid", async () => {
      mockedIsValidPackageName.mockReturnValue(false);

      const result = await registry.isPackageNameAvaliable();

      expect(result).toBe(false);
    });
  });
});

describe("getRequirements", () => {
  it("returns needsPackageScripts true and requiredManifest package.json", () => {
    const registry = new NpmRegistry("my-package");
    const requirements = registry.getRequirements();
    expect(requirements).toEqual({
      needsPackageScripts: true,
      requiredManifest: "package.json",
    });
  });
});

describe("npmRegistry()", () => {
  it("creates NpmRegistry from package.json name", async () => {
    mockedGetPackageJson.mockResolvedValue({
      name: "my-lib",
      version: "1.0.0",
    } as any);

    const result = await npmRegistry();

    expect(mockedGetPackageJson).toHaveBeenCalled();
    expect(result).toBeInstanceOf(NpmRegistry);
    expect(result.packageName).toBe("my-lib");
  });
});
