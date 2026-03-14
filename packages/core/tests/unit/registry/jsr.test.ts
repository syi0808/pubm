import process from "node:process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/exec.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/utils/exec.js")>();
  return {
    ...actual,
    exec: vi.fn(),
  };
});

vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue("mock-jsr-token"),
  })),
}));

vi.mock("../../../src/utils/package-name.js", () => ({
  getScope: vi.fn(),
  getScopeAndName: vi.fn(),
  isValidPackageName: vi.fn(),
}));

import {
  JsrClient,
  JsrConnector,
  JsrPackageRegistry,
  JsrRegisry,
  jsrPackageRegistry,
  jsrRegistry,
} from "../../../src/registry/jsr.js";
import { exec, NonZeroExitError } from "../../../src/utils/exec.js";
import {
  getScope,
  getScopeAndName,
  isValidPackageName,
} from "../../../src/utils/package-name.js";

const mockedExec = vi.mocked(exec);
const mockedGetScope = vi.mocked(getScope);
const mockedGetScopeAndName = vi.mocked(getScopeAndName);
const mockedIsValidPackageName = vi.mocked(isValidPackageName);

let mockedFetch: ReturnType<typeof vi.fn>;

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}

function mockFetchResponse(status: number, body?: unknown) {
  mockedFetch.mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    statusText:
      status === 200 ? "OK" : status === 401 ? "Unauthorized" : "Error",
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("JsrConnector", () => {
  let connector: JsrConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch = vi.fn();
    vi.stubGlobal("fetch", mockedFetch);
    connector = new JsrConnector();
  });

  it("has default registry url", () => {
    expect(connector.registryUrl).toBe("https://jsr.io");
  });

  describe("isInstalled()", () => {
    it("returns true when jsr --version succeeds", async () => {
      mockStdout("help output");

      const result = await connector.isInstalled();

      expect(result).toBe(true);
    });

    it("returns false when jsr --version fails", async () => {
      mockedExec.mockRejectedValue(new Error("not found"));

      const result = await connector.isInstalled();

      expect(result).toBe(false);
    });
  });

  describe("version()", () => {
    it("returns jsr version string", async () => {
      mockStdout("0.1.0");

      const result = await connector.version();

      expect(mockedExec).toHaveBeenCalledWith("jsr", ["--version"], {
        throwOnError: true,
      });
      expect(result).toBe("0.1.0");
    });

    it("throws when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      await expect(connector.version()).rejects.toThrow("error");
    });
  });

  describe("ping()", () => {
    it('returns true when ping contains "1 packets transmitted"', async () => {
      mockedExec.mockResolvedValue({
        stdout: "1 packets transmitted, 1 received, 0% packet loss",
        stderr: "",
      } as any);

      const result = await connector.ping();

      const flag = process.platform === "win32" ? "-n" : "-c";
      expect(mockedExec).toHaveBeenCalledWith("ping", [flag, "1", "jsr.io"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it('returns false when output does not contain "1 packets transmitted"', async () => {
      mockedExec.mockResolvedValue({
        stdout: "0 packets transmitted",
        stderr: "",
      } as any);

      const result = await connector.ping();

      expect(result).toBe(false);
    });

    it("throws JsrError when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("network error"));

      await expect(connector.ping()).rejects.toThrow("Failed to ping jsr.io");
    });

    it('returns true on Windows ping output that reports "Sent = 1"', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });
      mockedExec.mockResolvedValue({
        stdout: "Packets: Sent = 1, Received = 1, Lost = 0 (0% loss)",
        stderr: "",
      } as any);

      try {
        const result = await connector.ping();

        expect(mockedExec).toHaveBeenCalledWith("ping", ["-n", "1", "jsr.io"], {
          throwOnError: true,
        });
        expect(result).toBe(true);
      } finally {
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
      }
    });
  });
});

describe("JsrPackageRegistry", () => {
  let registry: JsrPackageRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch = vi.fn();
    vi.stubGlobal("fetch", mockedFetch);
    JsrClient.token = "test-token";
    registry = new JsrPackageRegistry("@scope/pkg");
  });

  it("has default registry url", () => {
    expect(registry.registry).toBe("https://jsr.io");
  });

  it("creates a JsrClient with the api endpoint", () => {
    expect(registry.client).toBeInstanceOf(JsrClient);
    expect(registry.client.apiEndpoint).toBe("https://api.jsr.io");
  });

  describe("jsr(args)", () => {
    it("calls exec with jsr command", async () => {
      mockStdout("0.1.0");

      await (registry as any).jsr(["--version"]);

      expect(mockedExec).toHaveBeenCalledWith("jsr", ["--version"], {
        throwOnError: true,
      });
    });

    it("does not throw when command succeeds with stderr output", async () => {
      mockedExec.mockResolvedValue({
        stdout: "ok",
        stderr: "some warning",
      } as any);

      const result = await (registry as any).jsr(["--version"]);

      expect(result).toBe("ok");
    });

    it("throws when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      await expect((registry as any).jsr(["--version"])).rejects.toThrow(
        "error",
      );
    });
  });

  describe("distTags()", () => {
    it("returns empty array", async () => {
      const result = await registry.distTags();

      expect(result).toEqual([]);
    });
  });

  describe("publish()", () => {
    it("returns true on successful publish", async () => {
      mockedExec.mockResolvedValue({ stdout: "published", stderr: "" } as any);

      const result = await registry.publish();

      expect(mockedExec).toHaveBeenCalledWith(
        "jsr",
        ["publish", "--allow-dirty", "--token", "test-token"],
        { throwOnError: true },
      );
      expect(result).toBe(true);
    });

    it("throws JsrError when publish fails", async () => {
      mockedExec.mockRejectedValue(new Error("publish failed"));

      await expect(registry.publish()).rejects.toThrow(
        "Failed to run `jsr publish --allow-dirty --token ***`",
      );
    });

    it("returns false and stores package creation URLs when jsr package is missing", async () => {
      mockedExec.mockRejectedValue(
        new NonZeroExitError("jsr", 1, {
          stdout: "",
          stderr:
            "Packages don't exist yet. Create them at https://jsr.io/new?scope=scope&package=pkg",
        }),
      );

      const result = await registry.publish();

      expect(result).toBe(false);
      expect(registry.packageCreationUrls).toEqual([
        "https://jsr.io/new?scope=scope&package=pkg",
      ]);
    });

    it("throws when missing-package stderr does not include a creation URL", async () => {
      mockedExec.mockRejectedValue(
        new NonZeroExitError("jsr", 1, {
          stdout: "",
          stderr: "Packages don't exist yet.",
        }),
      );

      await expect(registry.publish()).rejects.toThrow(
        "Packages don't exist yet.",
      );
    });
  });

  describe("dryRunPublish()", () => {
    it("runs jsr publish --dry-run --allow-dirty", async () => {
      mockStdout("");
      await registry.dryRunPublish();
      expect(mockedExec).toHaveBeenCalledWith(
        "jsr",
        [
          "publish",
          "--dry-run",
          "--allow-dirty",
          "--token",
          expect.any(String),
        ],
        expect.objectContaining({ throwOnError: true }),
      );
    });

    it("throws on dry-run failure", async () => {
      mockedExec.mockRejectedValue(new Error("dry-run failed"));
      await expect(registry.dryRunPublish()).rejects.toThrow(
        "Failed to run `jsr publish --dry-run`",
      );
    });

    it("includes stderr output when dry-run exits non-zero", async () => {
      mockedExec.mockRejectedValue(
        new NonZeroExitError("jsr", 1, {
          stdout: "",
          stderr: "permission denied",
        }),
      );

      await expect(registry.dryRunPublish()).rejects.toThrow(
        "permission denied",
      );
    });
  });

  describe("isPublished()", () => {
    it("returns true when registry responds with 200", async () => {
      mockedFetch.mockResolvedValue({ status: 200 });

      const result = await registry.isPublished();

      expect(mockedFetch).toHaveBeenCalledWith("https://jsr.io/@scope/pkg");
      expect(result).toBe(true);
    });

    it("returns false when registry responds with 404", async () => {
      mockedFetch.mockResolvedValue({ status: 404 });

      const result = await registry.isPublished();

      expect(result).toBe(false);
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(registry.isPublished()).rejects.toThrow(
        "Failed to fetch `https://jsr.io/@scope/pkg`",
      );
    });
  });

  describe("hasPermission()", () => {
    it("returns true when scopePermission returns non-null", async () => {
      mockedGetScope.mockReturnValue("scope");
      const spy = vi
        .spyOn(registry.client, "scopePermission")
        .mockResolvedValue({
          scope: "scope",
          user: {} as any,
          isAdmin: true,
          createdAt: "",
          updatedAt: "",
        });

      const result = await registry.hasPermission();

      expect(spy).toHaveBeenCalledWith("scope");
      expect(result).toBe(true);
    });

    it("returns false when scopePermission returns null", async () => {
      mockedGetScope.mockReturnValue("scope");
      vi.spyOn(registry.client, "scopePermission").mockResolvedValue(null);

      const result = await registry.hasPermission();

      expect(result).toBe(false);
    });
  });

  describe("isPackageNameAvailable()", () => {
    it("returns true when package name is valid", async () => {
      mockedIsValidPackageName.mockReturnValue(true);

      const result = await registry.isPackageNameAvailable();

      expect(mockedIsValidPackageName).toHaveBeenCalledWith("@scope/pkg");
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
  it("returns needsPackageScripts false and requiredManifest jsr.json", () => {
    const registry = new JsrPackageRegistry("@scope/my-package");
    const requirements = registry.getRequirements();
    expect(requirements).toEqual({
      needsPackageScripts: false,
      requiredManifest: "jsr.json",
    });
  });
});

describe("deprecated re-exports", () => {
  it("JsrRegisry is an alias for JsrPackageRegistry", () => {
    expect(JsrRegisry).toBe(JsrPackageRegistry);
  });

  it("jsrRegistry is an alias for jsrPackageRegistry", () => {
    expect(jsrRegistry).toBe(jsrPackageRegistry);
  });
});

describe("JsrClient", () => {
  let client: JsrClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch = vi.fn();
    vi.stubGlobal("fetch", mockedFetch);
    JsrClient.token = "test-token";
    client = new JsrClient("https://api.jsr.io");
  });

  describe("user()", () => {
    it("returns user data on success", async () => {
      const userData = { id: "1", name: "testuser" };
      mockFetchResponse(200, userData);

      const result = await client.user();

      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/user", "https://api.jsr.io/"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "User-Agent": expect.stringContaining("pubm/"),
          }),
        }),
      );
      expect(result).toEqual(userData);
    });

    it("returns null on 401", async () => {
      mockFetchResponse(401);

      const result = await client.user();

      expect(result).toBeNull();
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.user()).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/user`",
      );
    });

    it("throws JsrError on unexpected API status", async () => {
      mockFetchResponse(500);

      await expect(client.user()).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/user`",
      );
    });
  });

  describe("scopePermission(scope)", () => {
    it("returns permission data on success", async () => {
      const permData = { scope: "myscope", isAdmin: true };
      mockFetchResponse(200, permData);

      const result = await client.scopePermission("myscope");

      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/user/member/myscope", "https://api.jsr.io/"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "User-Agent": expect.stringContaining("pubm/"),
          }),
        }),
      );
      expect(result).toEqual(permData);
    });

    it("returns null on 401", async () => {
      mockFetchResponse(401);

      const result = await client.scopePermission("myscope");

      expect(result).toBeNull();
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.scopePermission("myscope")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/user/member/myscope`",
      );
    });

    it("throws JsrError on unexpected API status", async () => {
      mockFetchResponse(500);

      await expect(client.scopePermission("myscope")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/user/member/myscope`",
      );
    });
  });

  describe("scopes()", () => {
    it("returns array of scope names on success", async () => {
      const scopesData = [
        { scope: "scope-a", creator: {} },
        { scope: "scope-b", creator: {} },
      ];
      mockFetchResponse(200, scopesData);

      const result = await client.scopes();

      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/user/scopes", "https://api.jsr.io/"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result).toEqual(["scope-a", "scope-b"]);
    });

    it("returns empty array on 401", async () => {
      mockFetchResponse(401);

      const result = await client.scopes();

      expect(result).toEqual([]);
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.scopes()).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/user/scopes`",
      );
    });

    it("throws JsrError on unexpected API status", async () => {
      mockFetchResponse(500);

      await expect(client.scopes()).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/user/scopes`",
      );
    });

    it("throws JsrError when scopes response is not an array", async () => {
      mockFetchResponse(200, { scope: "not-an-array" });

      await expect(client.scopes()).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/user/scopes`",
      );
    });
  });

  describe("package(packageName)", () => {
    it("returns package data on success", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      const pkgData = { scope: "myscope", name: "mypkg" };
      mockFetchResponse(200, pkgData);

      const result = await client.package("@myscope/mypkg");

      expect(mockedGetScopeAndName).toHaveBeenCalledWith("@myscope/mypkg");
      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/scopes/myscope/packages/mypkg", "https://api.jsr.io/"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result).toEqual(pkgData);
    });

    it("returns null on 404", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockFetchResponse(404);

      const result = await client.package("@myscope/mypkg");

      expect(result).toBeNull();
    });

    it("throws JsrError with API error on non-404 failure status", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockFetchResponse(500);

      await expect(client.package("@myscope/mypkg")).rejects.toThrow(
        /API error/,
      );
    });

    it("throws JsrError when fetch fails", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.package("@myscope/mypkg")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/scopes/myscope/packages/mypkg`",
      );
    });
  });

  describe("createScope(scope)", () => {
    it("returns true on 200", async () => {
      mockFetchResponse(200);

      const result = await client.createScope("myscope");

      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/scopes", "https://api.jsr.io/"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ scope: "myscope" }),
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result).toBe(true);
    });

    it("returns true on 201", async () => {
      mockFetchResponse(201);

      const result = await client.createScope("myscope");

      expect(result).toBe(true);
    });

    it("throws JsrError with API detail on other status codes", async () => {
      mockedFetch.mockResolvedValue({
        status: 409,
        ok: false,
        statusText: "Conflict",
        json: vi.fn().mockResolvedValue({ message: "Scope already exists" }),
      });

      await expect(client.createScope("myscope")).rejects.toThrow(
        /Failed to create scope 'myscope': HTTP 409/,
      );
    });

    it("includes API error detail in thrown error message", async () => {
      mockedFetch.mockResolvedValue({
        status: 422,
        ok: false,
        statusText: "Unprocessable Entity",
        json: vi.fn().mockResolvedValue({ message: "Invalid scope name" }),
      });

      await expect(client.createScope("myscope")).rejects.toThrow(
        /Invalid scope name/,
      );
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.createScope("myscope")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/scopes`",
      );
    });

    it("uses the error field when message is absent", async () => {
      mockedFetch.mockResolvedValue({
        status: 422,
        ok: false,
        statusText: "Unprocessable Entity",
        json: vi.fn().mockResolvedValue({ error: "Reserved scope" }),
      });

      await expect(client.createScope("myscope")).rejects.toThrow(
        "Reserved scope",
      );
    });

    it("omits API detail when the error body cannot be parsed", async () => {
      mockedFetch.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      });

      await expect(client.createScope("myscope")).rejects.toThrow(
        "Failed to create scope 'myscope': HTTP 500",
      );
    });
  });

  describe("deleteScope(scope)", () => {
    it("returns true on 200", async () => {
      mockFetchResponse(200);

      const result = await client.deleteScope("myscope");

      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/scopes/myscope", "https://api.jsr.io/"),
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result).toBe(true);
    });

    it("returns true on 204", async () => {
      mockFetchResponse(204);

      const result = await client.deleteScope("myscope");

      expect(result).toBe(true);
    });

    it("throws JsrError with API detail on other status codes", async () => {
      mockedFetch.mockResolvedValue({
        status: 404,
        ok: false,
        statusText: "Not Found",
        json: vi.fn().mockResolvedValue({ message: "Scope not found" }),
      });

      await expect(client.deleteScope("myscope")).rejects.toThrow(
        /Failed to delete scope 'myscope': HTTP 404/,
      );
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.deleteScope("myscope")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/scopes/myscope`",
      );
    });

    it("serializes error detail when message and error fields are absent", async () => {
      mockedFetch.mockResolvedValue({
        status: 409,
        ok: false,
        statusText: "Conflict",
        json: vi.fn().mockResolvedValue({ reason: "Scope in use" }),
      });

      await expect(client.deleteScope("myscope")).rejects.toThrow(
        '{"reason":"Scope in use"}',
      );
    });

    it("omits error detail when delete scope body parsing fails", async () => {
      mockedFetch.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      });

      await expect(client.deleteScope("myscope")).rejects.toThrow(
        "Failed to delete scope 'myscope': HTTP 500",
      );
    });
  });

  describe("createPackage(packageName)", () => {
    it("returns true on 200", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockFetchResponse(200);

      const result = await client.createPackage("@myscope/mypkg");

      expect(mockedGetScopeAndName).toHaveBeenCalledWith("@myscope/mypkg");
      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/scopes/myscope/packages", "https://api.jsr.io/"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ package: "mypkg" }),
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result).toBe(true);
    });

    it("returns true on 201", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockFetchResponse(201);

      const result = await client.createPackage("@myscope/mypkg");

      expect(result).toBe(true);
    });

    it("throws JsrError with API detail on other status codes", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockResolvedValue({
        status: 409,
        ok: false,
        statusText: "Conflict",
        json: vi.fn().mockResolvedValue({ message: "Package already exists" }),
      });

      await expect(client.createPackage("@myscope/mypkg")).rejects.toThrow(
        /Failed to create package '@myscope\/mypkg': HTTP 409/,
      );
    });

    it("throws JsrError when fetch fails", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.createPackage("@myscope/mypkg")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/scopes/myscope/packages`",
      );
    });

    it("uses the error field when package creation detail omits message", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockResolvedValue({
        status: 422,
        ok: false,
        statusText: "Unprocessable Entity",
        json: vi.fn().mockResolvedValue({ error: "Package name reserved" }),
      });

      await expect(client.createPackage("@myscope/mypkg")).rejects.toThrow(
        "Package name reserved",
      );
    });

    it("omits detail when package creation error body cannot be parsed", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      });

      await expect(client.createPackage("@myscope/mypkg")).rejects.toThrow(
        "Failed to create package '@myscope/mypkg': HTTP 500",
      );
    });
  });

  describe("deletePackage(packageName)", () => {
    it("returns true on 200", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockFetchResponse(200);

      const result = await client.deletePackage("@myscope/mypkg");

      expect(mockedGetScopeAndName).toHaveBeenCalledWith("@myscope/mypkg");
      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/scopes/myscope/packages/mypkg", "https://api.jsr.io/"),
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result).toBe(true);
    });

    it("returns true on 204", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockFetchResponse(204);

      const result = await client.deletePackage("@myscope/mypkg");

      expect(result).toBe(true);
    });

    it("throws JsrError with API detail on other status codes", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockResolvedValue({
        status: 404,
        ok: false,
        statusText: "Not Found",
        json: vi.fn().mockResolvedValue({ message: "Package not found" }),
      });

      await expect(client.deletePackage("@myscope/mypkg")).rejects.toThrow(
        /Failed to delete package '@myscope\/mypkg': HTTP 404/,
      );
    });

    it("throws JsrError when fetch fails", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.deletePackage("@myscope/mypkg")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/scopes/myscope/packages/mypkg`",
      );
    });

    it("serializes error detail when delete package body has no known fields", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockResolvedValue({
        status: 409,
        ok: false,
        statusText: "Conflict",
        json: vi.fn().mockResolvedValue({ reason: "Package linked to scope" }),
      });

      await expect(client.deletePackage("@myscope/mypkg")).rejects.toThrow(
        '{"reason":"Package linked to scope"}',
      );
    });

    it("omits detail when delete package error body cannot be parsed", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      });

      await expect(client.deletePackage("@myscope/mypkg")).rejects.toThrow(
        "Failed to delete package '@myscope/mypkg': HTTP 500",
      );
    });
  });

  describe("searchPackage(query)", () => {
    it("returns search results on success", async () => {
      const searchData = { items: [{ name: "pkg" }], total: 1 };
      mockFetchResponse(200, searchData);

      const result = await client.searchPackage("my-query");

      expect(mockedFetch).toHaveBeenCalledWith(
        new URL("/packages?query=my-query", "https://api.jsr.io/"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result).toEqual(searchData);
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.searchPackage("my-query")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/packages?query=my-query`",
      );
    });

    it("throws JsrError when search returns a non-ok response", async () => {
      mockFetchResponse(500);

      await expect(client.searchPackage("my-query")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io/packages?query=my-query`",
      );
    });
  });
});

describe("jsrPackageRegistry()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch = vi.fn();
    vi.stubGlobal("fetch", mockedFetch);
  });

  it("creates JsrPackageRegistry from ManifestReader", async () => {
    const readSpy = vi
      .spyOn(JsrPackageRegistry.reader, "read")
      .mockResolvedValue({
        name: "@scope/my-lib",
        version: "1.0.0",
        private: false,
        dependencies: [],
      });

    const result = await jsrPackageRegistry();

    expect(readSpy).toHaveBeenCalled();
    expect(result).toBeInstanceOf(JsrPackageRegistry);
    expect(result.packageName).toBe("@scope/my-lib");
    readSpy.mockRestore();
  });
});
