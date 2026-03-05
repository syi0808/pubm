import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tinyexec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("tinyexec")>();
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

vi.mock("../../../src/utils/package.js", () => ({
  getJsrJson: vi.fn(),
  version: vi.fn().mockResolvedValue("0.0.5"),
}));

vi.mock("../../../src/utils/package-name.js", () => ({
  getScope: vi.fn(),
  getScopeAndName: vi.fn(),
  isValidPackageName: vi.fn(),
}));

import { exec } from "tinyexec";
import {
  JsrClient,
  JsrRegisry,
  jsrRegistry,
} from "../../../src/registry/jsr.js";
import { getJsrJson } from "../../../src/utils/package.js";
import {
  getScope,
  getScopeAndName,
  isValidPackageName,
} from "../../../src/utils/package-name.js";

const mockedExec = vi.mocked(exec);
const mockedGetScope = vi.mocked(getScope);
const mockedGetScopeAndName = vi.mocked(getScopeAndName);
const mockedIsValidPackageName = vi.mocked(isValidPackageName);
const mockedGetJsrJson = vi.mocked(getJsrJson);

let mockedFetch: ReturnType<typeof vi.fn>;

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}

function mockStderr(stderr: string) {
  mockedExec.mockResolvedValue({ stdout: "", stderr } as any);
}

function mockFetchResponse(status: number, body?: unknown) {
  mockedFetch.mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 200 ? "OK" : status === 401 ? "Unauthorized" : "Error",
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("JsrRegisry", () => {
  let registry: JsrRegisry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch = vi.fn();
    vi.stubGlobal("fetch", mockedFetch);
    JsrClient.token = "test-token";
    registry = new JsrRegisry("@scope/pkg");
  });

  it("has default registry url", () => {
    expect(registry.registry).toBe("https://jsr.io");
  });

  it("creates a JsrClient with the api endpoint", () => {
    expect(registry.client).toBeInstanceOf(JsrClient);
    expect(registry.client.apiEndpoint).toBe("https://api.jsr.io/");
  });

  describe("jsr(args)", () => {
    it("calls exec with jsr command", async () => {
      mockStdout("help");

      await registry.isInstalled();

      expect(mockedExec).toHaveBeenCalledWith("jsr", ["--version"], {
        throwOnError: true,
      });
    });

    it("does not throw when command succeeds with stderr output", async () => {
      mockedExec.mockResolvedValue({
        stdout: "ok",
        stderr: "some warning",
      } as any);

      const result = await registry.isInstalled();

      expect(result).toBe(true);
    });

    it("throws when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      await expect(registry.version()).rejects.toThrow("error");
    });
  });

  describe("isInstalled()", () => {
    it("returns true when jsr --version succeeds", async () => {
      mockStdout("help output");

      const result = await registry.isInstalled();

      expect(result).toBe(true);
    });

    it("returns false when jsr --version fails", async () => {
      mockedExec.mockRejectedValue(new Error("not found"));

      const result = await registry.isInstalled();

      expect(result).toBe(false);
    });
  });

  describe("distTags()", () => {
    it("returns empty array", async () => {
      const result = await registry.distTags();

      expect(result).toEqual([]);
    });
  });

  describe("ping()", () => {
    it('returns true when ping contains "1 packets transmitted"', async () => {
      mockedExec.mockResolvedValue({
        stdout: "1 packets transmitted, 1 received, 0% packet loss",
        stderr: "",
      } as any);

      const result = await registry.ping();

      expect(mockedExec).toHaveBeenCalledWith("ping", ["jsr.io", "-c", "1"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it('returns false when output does not contain "1 packets transmitted"', async () => {
      mockedExec.mockResolvedValue({
        stdout: "0 packets transmitted",
        stderr: "",
      } as any);

      const result = await registry.ping();

      expect(result).toBe(false);
    });

    it("throws JsrError when exec rejects", async () => {
      mockedExec.mockRejectedValue(new Error("network error"));

      await expect(registry.ping()).rejects.toThrow(
        "Failed to run `ping jsr.io` -c 1",
      );
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
  });

  describe("version()", () => {
    it("returns jsr version string", async () => {
      mockStdout("0.1.0");

      const result = await registry.version();

      expect(mockedExec).toHaveBeenCalledWith("jsr", ["--version"], {
        throwOnError: true,
      });
      expect(result).toBe("0.1.0");
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

    it("returns true even when scopePermission returns null (missing await in source)", async () => {
      mockedGetScope.mockReturnValue("scope");
      vi.spyOn(registry.client, "scopePermission").mockResolvedValue(null);

      const result = await registry.hasPermission();

      // Source code compares Promise !== null (missing await), which is always true
      expect(result).toBe(true);
    });
  });

  describe("isPackageNameAvaliable()", () => {
    it("returns true when package name is valid", async () => {
      mockedIsValidPackageName.mockReturnValue(true);

      const result = await registry.isPackageNameAvaliable();

      expect(mockedIsValidPackageName).toHaveBeenCalledWith("@scope/pkg");
      expect(result).toBe(true);
    });

    it("returns false when package name is invalid", async () => {
      mockedIsValidPackageName.mockReturnValue(false);

      const result = await registry.isPackageNameAvaliable();

      expect(result).toBe(false);
    });
  });
});

describe("JsrClient", () => {
  let client: JsrClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch = vi.fn();
    vi.stubGlobal("fetch", mockedFetch);
    JsrClient.token = "test-token";
    client = new JsrClient("https://api.jsr.io/");
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
        "Failed to fetch `https://api.jsr.io//user`",
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
        "Failed to fetch `https://api.jsr.io//user/member/myscope`",
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
        "Failed to fetch `https://api.jsr.io//user/scopes`",
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

    it("throws JsrError when fetch fails", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.package("@myscope/mypkg")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io//scopes/myscope/packages/mypkg`",
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

    it("returns false on other status codes", async () => {
      mockFetchResponse(409);

      const result = await client.createScope("myscope");

      expect(result).toBe(false);
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.createScope("myscope")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io//scopes`",
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

    it("returns false on other status codes", async () => {
      mockFetchResponse(404);

      const result = await client.deleteScope("myscope");

      expect(result).toBe(false);
    });

    it("throws JsrError when fetch fails", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.deleteScope("myscope")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io//scopes/myscope`",
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

    it("returns false on other status codes", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockFetchResponse(409);

      const result = await client.createPackage("@myscope/mypkg");

      expect(result).toBe(false);
    });

    it("throws JsrError when fetch fails", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.createPackage("@myscope/mypkg")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io//scopes/myscope/packages`",
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

    it("returns false on other status codes", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockFetchResponse(404);

      const result = await client.deletePackage("@myscope/mypkg");

      expect(result).toBe(false);
    });

    it("throws JsrError when fetch fails", async () => {
      mockedGetScopeAndName.mockReturnValue(["myscope", "mypkg"]);
      mockedFetch.mockRejectedValue(new Error("network error"));

      await expect(client.deletePackage("@myscope/mypkg")).rejects.toThrow(
        "Failed to fetch `https://api.jsr.io//scopes/myscope/packages/mypkg`",
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
        "Failed to fetch `https://api.jsr.io//packages?query=my-query`",
      );
    });
  });
});

describe("jsrRegistry()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch = vi.fn();
    vi.stubGlobal("fetch", mockedFetch);
  });

  it("creates JsrRegisry from jsr.json name", async () => {
    mockedGetJsrJson.mockResolvedValue({
      name: "@scope/my-lib",
      version: "1.0.0",
    } as any);

    const result = await jsrRegistry();

    expect(mockedGetJsrJson).toHaveBeenCalled();
    expect(result).toBeInstanceOf(JsrRegisry);
    expect(result.packageName).toBe("@scope/my-lib");
  });
});
