import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");

vi.mock("../../../src/utils/exec.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/utils/exec.js")>();
  return {
    ...original,
    exec: vi.fn(),
  };
});

vi.mock("../../../src/utils/package-name.js", () => ({
  isValidPackageName: vi.fn(),
}));

import {
  NpmConnector,
  NpmPackageRegistry,
  npmConnector,
  npmPackageRegistry,
} from "../../../src/registry/npm.js";
import { exec, NonZeroExitError } from "../../../src/utils/exec.js";
import { isValidPackageName } from "../../../src/utils/package-name.js";

const mockedExec = vi.mocked(exec);
const mockedIsValidPackageName = vi.mocked(isValidPackageName);

let mockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetch = vi.fn();
  vi.stubGlobal("fetch", mockedFetch);
});

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}

function mockNonZeroExitError(stderr: string) {
  const error = new NonZeroExitError("npm", 1, {
    stderr,
    stdout: "",
  });
  mockedExec.mockRejectedValue(error);
}

describe("NpmConnector", () => {
  let connector: NpmConnector;

  beforeEach(() => {
    connector = new NpmConnector();
  });

  it("has default registry url", () => {
    expect(connector.registryUrl).toBe("https://registry.npmjs.org");
  });

  describe("isInstalled()", () => {
    it("returns true when npm --version succeeds", async () => {
      mockStdout("11.5.1");

      const result = await connector.isInstalled();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["--version"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("returns false when npm --version fails", async () => {
      mockedExec.mockRejectedValue(new Error("not found"));

      const result = await connector.isInstalled();

      expect(result).toBe(false);
    });

    it("does not throw when command succeeds with stderr output", async () => {
      mockedExec.mockResolvedValue({
        stdout: "ok",
        stderr: "npm warn deprecated",
      } as any);

      const result = await connector.isInstalled();

      expect(result).toBe(true);
    });
  });

  describe("version()", () => {
    it("returns npm version string", async () => {
      mockStdout("10.2.0");

      const result = await connector.version();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["--version"], {
        throwOnError: true,
      });
      expect(result).toBe("10.2.0");
    });

    it("throws on failure (no await, so raw error escapes catch)", async () => {
      mockedExec.mockRejectedValue(new Error("some error"));

      await expect(connector.version()).rejects.toThrow("some error");
    });
  });

  describe("ping()", () => {
    it("returns true when ping succeeds", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      const result = await connector.ping();

      expect(mockedExec).toHaveBeenCalledWith("npm", ["ping"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("throws NpmError when ping fails", async () => {
      mockedExec.mockRejectedValue(new Error("timeout"));

      await expect(connector.ping()).rejects.toThrow(
        "Failed to run `npm ping`",
      );
    });
  });
});

describe("npmConnector()", () => {
  it("creates NpmConnector instance", () => {
    const connector = npmConnector();
    expect(connector).toBeInstanceOf(NpmConnector);
  });
});

describe("NpmPackageRegistry", () => {
  let registry: NpmPackageRegistry;

  beforeEach(() => {
    registry = new NpmPackageRegistry("my-package", FIXTURE_PATH);
    vi.doUnmock("../../../src/utils/spawn-interactive.js");
    vi.doUnmock("../../../src/utils/open-url.js");
  });

  it("has default registry url", () => {
    expect(registry.registry).toBe("https://registry.npmjs.org");
  });

  describe("npm(args)", () => {
    it("calls exec with npm and returns stdout", async () => {
      mockStdout("test-user");
      const result = await registry.userName();
      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        expect.arrayContaining(["whoami"]),
        expect.any(Object),
      );
      expect(result).toBe("test-user");
    });

    it("throws when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("fatal error"));
      await expect(registry.userName()).rejects.toThrow();
    });
  });

  describe("isPublished()", () => {
    it("returns true when registry responds with 200", async () => {
      mockedFetch.mockResolvedValue({ status: 200 });

      const result = await registry.isPublished();

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://registry.npmjs.org/my-package",
        undefined,
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

  describe("publishProvenance()", () => {
    it("returns true on successful publish", async () => {
      mockStdout("+ my-package@1.0.0");

      const result = await registry.publishProvenance();

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--provenance", "--access", "public"],
        { throwOnError: true, nodeOptions: { cwd: FIXTURE_PATH } },
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

    it("includes stderr in error message for non-EOTP errors", async () => {
      mockNonZeroExitError("npm error code ENEEDAUTH");

      await expect(registry.publishProvenance()).rejects.toThrow(
        /Failed to publish to npm\nnpm error code ENEEDAUTH/,
      );
    });

    it("falls back to publish without provenance on provenance error", async () => {
      const provenanceError = new NonZeroExitError("npm", 1, {
        stderr:
          'Error verifying sigstore provenance bundle: Unsupported GitHub Actions source repository visibility: "private"',
        stdout: "",
      });
      mockedExec.mockRejectedValueOnce(provenanceError).mockResolvedValueOnce({
        stdout: "+ my-package@1.0.0",
        stderr: "",
      } as any);

      const result = await registry.publishProvenance();

      expect(result).toBe(true);
      expect(mockedExec).toHaveBeenCalledTimes(2);
      expect(mockedExec).toHaveBeenNthCalledWith(
        1,
        "npm",
        ["publish", "--provenance", "--access", "public"],
        { throwOnError: true, nodeOptions: { cwd: FIXTURE_PATH } },
      );
      expect(mockedExec).toHaveBeenNthCalledWith(2, "npm", ["publish"], {
        throwOnError: true,
        nodeOptions: { cwd: FIXTURE_PATH },
      });
    });

    it("falls back to plain publish when npm reports a provenance bundle error", async () => {
      const provenanceError = new NonZeroExitError("npm", 1, {
        stderr: "npm ERR! provenance bundle could not be verified",
        stdout: "",
      });
      mockedExec.mockRejectedValueOnce(provenanceError).mockResolvedValueOnce({
        stdout: "+ my-package@1.0.0",
        stderr: "",
      } as any);

      const result = await registry.publishProvenance();

      expect(result).toBe(true);
      expect(mockedExec).toHaveBeenNthCalledWith(2, "npm", ["publish"], {
        throwOnError: true,
        nodeOptions: { cwd: FIXTURE_PATH },
      });
    });

    it("throws NpmError with forbidden message for 403 errors", async () => {
      mockNonZeroExitError("403 Forbidden");

      await expect(registry.publishProvenance()).rejects.toThrow(/forbidden/i);
    });

    it("includes stderr in forbidden error message", async () => {
      mockNonZeroExitError("403 Forbidden - you don't have access");

      await expect(registry.publishProvenance()).rejects.toThrow(
        /403 Forbidden - you don't have access/,
      );
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
        nodeOptions: { cwd: FIXTURE_PATH },
      });
      expect(result).toBe(true);
    });

    it("returns true on successful publish with OTP", async () => {
      mockStdout("+ my-package@1.0.0");

      const result = await registry.publish("123456");

      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--otp", "123456"],
        { throwOnError: true, nodeOptions: { cwd: FIXTURE_PATH } },
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

    it("includes stderr in error message for non-EOTP errors", async () => {
      mockNonZeroExitError("npm error code ENEEDAUTH");

      await expect(registry.publish()).rejects.toThrow(
        /Failed to publish to npm\nnpm error code ENEEDAUTH/,
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

    it("classifies forbidden errors even when npm omits the status code", async () => {
      mockNonZeroExitError("Forbidden: package access denied");

      await expect(registry.publish()).rejects.toThrow(/permission denied/i);
    });

    it("classifies rate limiting when npm only reports the reason phrase", async () => {
      mockNonZeroExitError("Too Many Requests from npm registry");

      await expect(registry.publish()).rejects.toThrow(/rate limited/i);
    });

    it("wraps non-process errors with a generic publish failure", async () => {
      mockedExec.mockRejectedValue(new Error("socket hang up"));

      await expect(registry.publish()).rejects.toThrow(
        "Failed to publish to npm",
      );
    });
  });

  describe("dryRunPublish()", () => {
    it("runs npm publish --dry-run", async () => {
      mockStdout("");
      await registry.dryRunPublish();
      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["publish", "--dry-run"],
        expect.objectContaining({ throwOnError: true }),
      );
    });

    it("throws on dry-run failure", async () => {
      mockedExec.mockRejectedValue(new Error("dry-run failed"));
      await expect(registry.dryRunPublish()).rejects.toThrow(
        "Failed to run `npm publish --dry-run`",
      );
    });

    it("includes stderr output when dry-run exits non-zero", async () => {
      mockedExec.mockRejectedValue(
        new NonZeroExitError("npm", 1, {
          stdout: "",
          stderr: "npm ERR! code ENEEDAUTH",
        }),
      );

      await expect(registry.dryRunPublish()).rejects.toThrow(
        "npm ERR! code ENEEDAUTH",
      );
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

    it("returns null when npm returns a null profile payload", async () => {
      mockStdout("null");

      const result = await registry.twoFactorAuthMode();

      expect(result).toBeNull();
    });
  });

  describe("isPackageNameAvailable()", () => {
    it("returns true when package name is valid", async () => {
      mockedIsValidPackageName.mockReturnValue(true);

      const result = await registry.isPackageNameAvailable();

      expect(mockedIsValidPackageName).toHaveBeenCalledWith("my-package");
      expect(result).toBe(true);
    });

    it("returns false when package name is invalid", async () => {
      mockedIsValidPackageName.mockReturnValue(false);

      const result = await registry.isPackageNameAvailable();

      expect(result).toBe(false);
    });
  });
});

describe("getRequirements", () => {
  it("returns requiredManifest package.json", () => {
    const registry = new NpmPackageRegistry("my-package", FIXTURE_PATH);
    const requirements = registry.getRequirements();
    expect(requirements).toEqual({
      requiredManifest: "package.json",
    });
  });
});

describe("npmPackageRegistry()", () => {
  it("creates NpmPackageRegistry from ManifestReader", async () => {
    const readSpy = vi
      .spyOn(NpmPackageRegistry.reader, "read")
      .mockResolvedValue({
        name: "my-lib",
        version: "1.0.0",
        private: false,
        dependencies: [],
      });

    const result = await npmPackageRegistry("/test/path");

    expect(readSpy).toHaveBeenCalledWith("/test/path");
    expect(result).toBeInstanceOf(NpmPackageRegistry);
    expect(result.packageName).toBe("my-lib");
    readSpy.mockRestore();
  });
});

describe("NpmPackageRegistry checkAvailability()", () => {
  let registry: NpmPackageRegistry;

  beforeEach(() => {
    registry = new NpmPackageRegistry("my-package", FIXTURE_PATH);
    vi.doUnmock("../../../src/utils/spawn-interactive.js");
    vi.doUnmock("../../../src/utils/open-url.js");
  });

  function makeTask() {
    return { output: "" } as any;
  }

  function makeCtx(promptEnabled = true) {
    return {
      runtime: {
        promptEnabled,
        rollback: { add: vi.fn() },
        tokenRetryPromises: {},
      },
    } as any;
  }

  function makeStream(chunks: string[] = []) {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
  }

  function makeChild(
    stdoutChunks: string[] = [],
    stderrChunks: string[] = [],
    exitCode = 0,
  ) {
    return {
      stdout: makeStream(stdoutChunks),
      stderr: makeStream(stderrChunks),
      stdin: { write: vi.fn(), flush: vi.fn() },
      exited: Promise.resolve(exitCode),
    };
  }

  async function importFreshRegistryWithMocks(
    child: ReturnType<typeof makeChild>,
  ) {
    vi.resetModules();

    const spawnInteractive = vi.fn().mockReturnValue(child);
    const openUrl = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../../../src/utils/spawn-interactive.js", () => ({
      spawnInteractive,
    }));
    vi.doMock("../../../src/utils/open-url.js", () => ({
      openUrl,
    }));

    const { NpmPackageRegistry: FreshNpmRegistry } = await import(
      "../../../src/registry/npm.js"
    );

    return { FreshNpmRegistry, openUrl, spawnInteractive };
  }

  describe("isOfficialNpmRegistry()", () => {
    it("returns true for default registry", () => {
      const registry = new NpmPackageRegistry("my-package", FIXTURE_PATH);
      expect(registry["isOfficialNpmRegistry"]()).toBe(true);
    });

    it("returns true for registry with trailing slash", () => {
      const registry = new NpmPackageRegistry(
        "my-package",
        FIXTURE_PATH,
        "https://registry.npmjs.org/",
      );
      expect(registry["isOfficialNpmRegistry"]()).toBe(true);
    });

    it("returns false for private registry", () => {
      const registry = new NpmPackageRegistry(
        "my-package",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );
      expect(registry["isOfficialNpmRegistry"]()).toBe(false);
    });
  });

  describe("direct web login (official npm)", () => {
    function makeDoneResponse(token: string) {
      return new Response(JSON.stringify({ token }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    function make202Response(retryAfter = "1") {
      return new Response(JSON.stringify({}), {
        status: 202,
        headers: {
          "retry-after": retryAfter,
          "content-type": "application/json",
        },
      });
    }

    function makeLoginResponse(loginUrl: string, doneUrl: string) {
      return new Response(JSON.stringify({ loginUrl, doneUrl }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    it("completes direct web login: POST → poll 202 → poll 200 → save token", async () => {
      const openUrl = vi.fn().mockResolvedValue(undefined);
      vi.doMock("../../../src/utils/open-url.js", () => ({ openUrl }));

      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);

      vi.spyOn(freshRegistry, "isLoggedIn")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      vi.spyOn(freshRegistry, "isPublished").mockResolvedValue(true);
      vi.spyOn(freshRegistry, "hasPermission").mockResolvedValue(true);

      const loginUrl = "https://www.npmjs.com/auth/cli/test-uuid";
      const doneUrl = "https://www.npmjs.com/-/v1/login/test-uuid/done";

      mockedFetch
        .mockResolvedValueOnce(makeLoginResponse(loginUrl, doneUrl))
        .mockResolvedValueOnce(make202Response("0"))
        .mockResolvedValueOnce(makeDoneResponse("npm_test-token-123"));

      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      const task = makeTask();
      await freshRegistry.checkAvailability(task, makeCtx(true));

      // Verify POST to /-/v1/login
      expect(mockedFetch).toHaveBeenCalledWith(
        "https://registry.npmjs.org/-/v1/login",
        expect.objectContaining({ method: "POST" }),
      );
      // Verify doneUrl polled
      expect(mockedFetch).toHaveBeenCalledWith(doneUrl);
      // Verify browser opened with loginUrl
      expect(openUrl).toHaveBeenCalledWith(loginUrl);
      // Verify token saved
      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        [
          "config",
          "set",
          "//registry.npmjs.org/:_authToken",
          "npm_test-token-123",
          "--location=user",
        ],
        expect.objectContaining({ throwOnError: true }),
      );
      // Verify loginUrl shown in task output
      expect(task.output).toContain(loginUrl);
    });

    it("throws when POST response is missing loginUrl", async () => {
      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);
      vi.spyOn(freshRegistry, "isLoggedIn").mockResolvedValue(false);

      mockedFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ doneUrl: "https://example.com/done" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow("npm web login response missing valid loginUrl or doneUrl");
    });

    it("throws when POST response has invalid URL", async () => {
      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);
      vi.spyOn(freshRegistry, "isLoggedIn").mockResolvedValue(false);

      mockedFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ loginUrl: "not-a-url", doneUrl: "also-not-a-url" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow("npm web login response missing valid loginUrl or doneUrl");
    });

    it("throws when polling returns 200 without token", async () => {
      const openUrl = vi.fn().mockResolvedValue(undefined);
      vi.doMock("../../../src/utils/open-url.js", () => ({ openUrl }));
      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);
      vi.spyOn(freshRegistry, "isLoggedIn").mockResolvedValue(false);

      mockedFetch
        .mockResolvedValueOnce(
          makeLoginResponse("https://www.npmjs.com/auth/cli/x", "https://www.npmjs.com/-/v1/login/x/done"),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({}), { status: 200 }),
        );

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow("npm web login completed but no token received");
    });

    it("throws on unexpected polling status", async () => {
      const openUrl = vi.fn().mockResolvedValue(undefined);
      vi.doMock("../../../src/utils/open-url.js", () => ({ openUrl }));
      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);
      vi.spyOn(freshRegistry, "isLoggedIn").mockResolvedValue(false);

      mockedFetch
        .mockResolvedValueOnce(
          makeLoginResponse("https://www.npmjs.com/auth/cli/x", "https://www.npmjs.com/-/v1/login/x/done"),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }),
        );

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow("npm web login polling failed (HTTP 500)");
    });

    it("throws when POST to login endpoint fails", async () => {
      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);
      vi.spyOn(freshRegistry, "isLoggedIn").mockResolvedValue(false);

      mockedFetch.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }),
      );

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow("npm web login initiation failed (HTTP 404)");
    });

    it("uses 1 second default when Retry-After header is absent", async () => {
      const openUrl = vi.fn().mockResolvedValue(undefined);
      vi.doMock("../../../src/utils/open-url.js", () => ({ openUrl }));
      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);
      vi.spyOn(freshRegistry, "isLoggedIn")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      vi.spyOn(freshRegistry, "isPublished").mockResolvedValue(true);
      vi.spyOn(freshRegistry, "hasPermission").mockResolvedValue(true);

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      mockedFetch
        .mockResolvedValueOnce(
          makeLoginResponse("https://www.npmjs.com/auth/cli/x", "https://www.npmjs.com/-/v1/login/x/done"),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({}), { status: 202 }),
        )
        .mockResolvedValueOnce(makeDoneResponse("npm_token"));

      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      await freshRegistry.checkAvailability(makeTask(), makeCtx(true));

      const delayCall = setTimeoutSpy.mock.calls.find(
        ([, ms]) => ms === 1000,
      );
      expect(delayCall).toBeDefined();

      setTimeoutSpy.mockRestore();
    });

    it("succeeds even when browser open fails", async () => {
      const openUrl = vi.fn().mockRejectedValue(new Error("no browser"));
      vi.doMock("../../../src/utils/open-url.js", () => ({ openUrl }));
      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);
      vi.spyOn(freshRegistry, "isLoggedIn")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      vi.spyOn(freshRegistry, "isPublished").mockResolvedValue(true);
      vi.spyOn(freshRegistry, "hasPermission").mockResolvedValue(true);

      mockedFetch
        .mockResolvedValueOnce(
          makeLoginResponse("https://www.npmjs.com/auth/cli/x", "https://www.npmjs.com/-/v1/login/x/done"),
        )
        .mockResolvedValueOnce(makeDoneResponse("npm_token"));

      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).resolves.toBeUndefined();
    });

    it("throws when npm config set fails", async () => {
      const openUrl = vi.fn().mockResolvedValue(undefined);
      vi.doMock("../../../src/utils/open-url.js", () => ({ openUrl }));
      vi.resetModules();
      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry("my-package", FIXTURE_PATH);
      vi.spyOn(freshRegistry, "isLoggedIn").mockResolvedValue(false);

      mockedFetch
        .mockResolvedValueOnce(
          makeLoginResponse("https://www.npmjs.com/auth/cli/x", "https://www.npmjs.com/-/v1/login/x/done"),
        )
        .mockResolvedValueOnce(makeDoneResponse("npm_token"));

      mockedExec.mockRejectedValue(new Error("permission denied"));

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow("Failed to save npm auth token");
    });
  });

  describe("N1: login check", () => {
    it("throws when not logged in in CI mode", async () => {
      vi.spyOn(registry, "isLoggedIn").mockResolvedValue(false);

      await expect(
        registry.checkAvailability(makeTask(), makeCtx(false)),
      ).rejects.toThrow("Not logged in to npm. Set NODE_AUTH_TOKEN.");
    });

    it("launches interactive npm login and canonicalizes query login URLs", async () => {
      const { FreshNpmRegistry, openUrl, spawnInteractive } =
        await importFreshRegistryWithMocks(
          makeChild([
            "Login at:\n",
            "https://www.npmjs.com/login?next=/login/cli/abc-123\n",
          ]),
        );
      const freshRegistry = new FreshNpmRegistry(
        "my-package",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );
      vi.spyOn(freshRegistry, "isLoggedIn")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      vi.spyOn(freshRegistry, "isPublished").mockResolvedValue(true);
      vi.spyOn(freshRegistry, "hasPermission").mockResolvedValue(true);

      const task = makeTask();
      await expect(
        freshRegistry.checkAvailability(task, makeCtx(true)),
      ).resolves.toBeUndefined();

      expect(spawnInteractive).toHaveBeenCalledWith(["npm", "login"]);
      expect(openUrl).toHaveBeenCalledWith(
        "https://www.npmjs.com/login?next=/login/cli/abc-123",
      );
      expect(task.output).toContain(
        "https://www.npmjs.com/login?next=/login/cli/abc-123",
      );
    });

    it("preserves canonical auth CLI URLs from npm output", async () => {
      const { FreshNpmRegistry, openUrl } = await importFreshRegistryWithMocks(
        makeChild([
          "Authenticate your account at:\n",
          "https://www.npmjs.com/auth/cli/xyz-789\n",
        ]),
      );
      const freshRegistry = new FreshNpmRegistry(
        "my-package",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );
      vi.spyOn(freshRegistry, "isLoggedIn")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      vi.spyOn(freshRegistry, "isPublished").mockResolvedValue(true);
      vi.spyOn(freshRegistry, "hasPermission").mockResolvedValue(true);

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).resolves.toBeUndefined();

      expect(openUrl).toHaveBeenCalledWith(
        "https://www.npmjs.com/auth/cli/xyz-789",
      );
    });

    it("deduplicates concurrent npm login attempts and browser opens", async () => {
      const { FreshNpmRegistry, openUrl, spawnInteractive } =
        await importFreshRegistryWithMocks(
          makeChild([
            "Login at:\n",
            "https://www.npmjs.com/login?next=/login/cli/shared-123\n",
          ]),
        );
      const firstRegistry = new FreshNpmRegistry(
        "pkg-a",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );
      const secondRegistry = new FreshNpmRegistry(
        "pkg-b",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );

      for (const current of [firstRegistry, secondRegistry]) {
        vi.spyOn(current, "isLoggedIn")
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true);
        vi.spyOn(current, "isPublished").mockResolvedValue(true);
        vi.spyOn(current, "hasPermission").mockResolvedValue(true);
      }

      const ctx = makeCtx(true);
      const firstTask = makeTask();
      const secondTask = makeTask();

      await expect(
        Promise.all([
          firstRegistry.checkAvailability(firstTask, ctx),
          secondRegistry.checkAvailability(secondTask, ctx),
        ]),
      ).resolves.toEqual([undefined, undefined]);

      expect(spawnInteractive).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledWith(
        "https://www.npmjs.com/login?next=/login/cli/shared-123",
      );
      expect(ctx.runtime.npmLoginPromise).toBeUndefined();
    });

    it("throws when npm login process exits with non-zero code", async () => {
      const { FreshNpmRegistry } = await importFreshRegistryWithMocks(
        makeChild([], [], 1),
      );
      const freshRegistry = new FreshNpmRegistry(
        "my-package",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );
      vi.spyOn(freshRegistry, "isLoggedIn").mockResolvedValue(false);

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow("npm login failed: npm login exited with code 1");
    });

    it("throws a clear error when npm login output has no supported web URL", async () => {
      const { FreshNpmRegistry } = await importFreshRegistryWithMocks(
        makeChild(["Logged in on https://registry.npmjs.org/.\n"]),
      );
      const freshRegistry = new FreshNpmRegistry(
        "my-package",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );
      vi.spyOn(freshRegistry, "isLoggedIn").mockResolvedValue(false);

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow(
        "npm login failed: npm login did not provide a supported web login URL.",
      );
    });

    it("clears the shared login promise after failure so a retry can start a new login", async () => {
      const failingChild = makeChild([], [], 1);
      const successChild = makeChild([
        "Login at:\n",
        "https://www.npmjs.com/auth/cli/retry-456\n",
      ]);

      vi.resetModules();
      const spawnInteractive = vi
        .fn()
        .mockReturnValueOnce(failingChild)
        .mockReturnValueOnce(successChild);
      const openUrl = vi.fn().mockResolvedValue(undefined);

      vi.doMock("../../../src/utils/spawn-interactive.js", () => ({
        spawnInteractive,
      }));
      vi.doMock("../../../src/utils/open-url.js", () => ({
        openUrl,
      }));

      const { NpmPackageRegistry: FreshNpmRegistry } = await import(
        "../../../src/registry/npm.js"
      );
      const freshRegistry = new FreshNpmRegistry(
        "my-package",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );
      vi.spyOn(freshRegistry, "isLoggedIn")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      vi.spyOn(freshRegistry, "isPublished").mockResolvedValue(true);
      vi.spyOn(freshRegistry, "hasPermission").mockResolvedValue(true);

      const ctx = makeCtx(true);

      await expect(
        freshRegistry.checkAvailability(makeTask(), ctx),
      ).rejects.toThrow("npm login failed: npm login exited with code 1");
      expect(ctx.runtime.npmLoginPromise).toBeUndefined();

      await expect(
        freshRegistry.checkAvailability(makeTask(), ctx),
      ).resolves.toBeUndefined();

      expect(spawnInteractive).toHaveBeenCalledTimes(2);
      expect(openUrl).toHaveBeenCalledWith(
        "https://www.npmjs.com/auth/cli/retry-456",
      );
    });

    it("throws when still not logged in after npm login succeeds", async () => {
      const { FreshNpmRegistry } = await importFreshRegistryWithMocks(
        makeChild([
          "Login at:\n",
          "https://www.npmjs.com/auth/cli/still-not-logged-in\n",
        ]),
      );
      const freshRegistry = new FreshNpmRegistry(
        "my-package",
        FIXTURE_PATH,
        "https://npm.mycompany.com",
      );
      vi.spyOn(freshRegistry, "isLoggedIn")
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);

      await expect(
        freshRegistry.checkAvailability(makeTask(), makeCtx(true)),
      ).rejects.toThrow("Still not logged in after npm login");
    });
  });

  describe("N2: published + permission", () => {
    it("succeeds when published and has permission", async () => {
      vi.spyOn(registry, "isLoggedIn").mockResolvedValue(true);
      vi.spyOn(registry, "isPublished").mockResolvedValue(true);
      vi.spyOn(registry, "hasPermission").mockResolvedValue(true);

      await expect(
        registry.checkAvailability(makeTask(), makeCtx(false)),
      ).resolves.toBeUndefined();
    });

    it("throws when published but no permission", async () => {
      vi.spyOn(registry, "isLoggedIn").mockResolvedValue(true);
      vi.spyOn(registry, "isPublished").mockResolvedValue(true);
      vi.spyOn(registry, "hasPermission").mockResolvedValue(false);

      await expect(
        registry.checkAvailability(makeTask(), makeCtx(false)),
      ).rejects.toThrow("No permission to publish on npm.");
    });
  });

  describe("N3: package name availability", () => {
    it("throws when not published and name not available", async () => {
      vi.spyOn(registry, "isLoggedIn").mockResolvedValue(true);
      vi.spyOn(registry, "isPublished").mockResolvedValue(false);
      vi.spyOn(registry, "isPackageNameAvailable").mockResolvedValue(false);

      await expect(
        registry.checkAvailability(makeTask(), makeCtx(false)),
      ).rejects.toThrow("Package name is not available.");
    });

    it("passes when not published and name is available", async () => {
      vi.spyOn(registry, "isLoggedIn").mockResolvedValue(true);
      vi.spyOn(registry, "isPublished").mockResolvedValue(false);
      vi.spyOn(registry, "isPackageNameAvailable").mockResolvedValue(true);
      vi.spyOn(registry, "twoFactorAuthMode").mockResolvedValue(null);

      await expect(
        registry.checkAvailability(makeTask(), makeCtx(false)),
      ).resolves.toBeUndefined();
    });
  });

  describe("N4: CI 2FA warning", () => {
    it("throws when CI and 2FA is auth-and-writes", async () => {
      vi.spyOn(registry, "isLoggedIn").mockResolvedValue(true);
      vi.spyOn(registry, "isPublished").mockResolvedValue(false);
      vi.spyOn(registry, "isPackageNameAvailable").mockResolvedValue(true);
      vi.spyOn(registry, "twoFactorAuthMode").mockResolvedValue(
        "auth-and-writes",
      );

      await expect(
        registry.checkAvailability(makeTask(), makeCtx(false)),
      ).rejects.toThrow("2FA auth-and-writes blocks CI publish.");
    });

    it("passes when CI and 2FA is auth-only", async () => {
      vi.spyOn(registry, "isLoggedIn").mockResolvedValue(true);
      vi.spyOn(registry, "isPublished").mockResolvedValue(false);
      vi.spyOn(registry, "isPackageNameAvailable").mockResolvedValue(true);
      vi.spyOn(registry, "twoFactorAuthMode").mockResolvedValue("auth-only");

      await expect(
        registry.checkAvailability(makeTask(), makeCtx(false)),
      ).resolves.toBeUndefined();
    });

    it("skips 2FA check in interactive mode", async () => {
      vi.spyOn(registry, "isLoggedIn").mockResolvedValue(true);
      vi.spyOn(registry, "isPublished").mockResolvedValue(false);
      vi.spyOn(registry, "isPackageNameAvailable").mockResolvedValue(true);
      const tfaSpy = vi
        .spyOn(registry, "twoFactorAuthMode")
        .mockResolvedValue("auth-and-writes");

      await expect(
        registry.checkAvailability(makeTask(), makeCtx(true)),
      ).resolves.toBeUndefined();

      expect(tfaSpy).not.toHaveBeenCalled();
    });
  });

  describe("unpublish", () => {
    it("supportsUnpublish returns true", () => {
      const registry = new NpmPackageRegistry("test-pkg", FIXTURE_PATH);
      expect(registry.supportsUnpublish).toBe(true);
    });

    it("calls npm unpublish with correct args", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      const registry = new NpmPackageRegistry("test-pkg", FIXTURE_PATH);
      await registry.unpublish("test-pkg", "1.0.0");

      expect(mockedExec).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["unpublish", "test-pkg@1.0.0"]),
        expect.any(Object),
      );
    });
  });
});
