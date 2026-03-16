import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

import {
  RegistryCatalog,
  type RegistryDescriptor,
  registryCatalog,
} from "../../../src/registry/catalog.js";
import { JsrPackageRegistry } from "../../../src/registry/jsr.js";
import { NpmPackageRegistry } from "../../../src/registry/npm.js";
import { PackageRegistry } from "../../../src/registry/package-registry.js";
import { exec } from "../../../src/utils/exec.js";

const mockedExec = vi.mocked(exec);

function createDescriptor(
  overrides: Partial<RegistryDescriptor> = {},
): RegistryDescriptor {
  return {
    key: "test",
    ecosystem: "js",
    label: "Test",
    tokenConfig: {
      envVar: "TEST_TOKEN",
      dbKey: "test-token",
      ghSecretName: "TEST_TOKEN",
      promptLabel: "test token",
      tokenUrl: "https://example.com",
      tokenUrlLabel: "example.com",
    },
    needsPackageScripts: false,
    concurrentPublish: true,
    connector: () => ({}) as any,
    factory: async () => ({}) as any,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegistryCatalog", () => {
  it("registers and retrieves a descriptor by key", () => {
    const catalog = new RegistryCatalog();
    const desc = createDescriptor({ key: "npm" });
    catalog.register(desc);
    expect(catalog.get("npm")).toBe(desc);
  });

  it("returns undefined for unregistered key", () => {
    const catalog = new RegistryCatalog();
    expect(catalog.get("unknown")).toBeUndefined();
  });

  it("returns all registered descriptors", () => {
    const catalog = new RegistryCatalog();
    const npm = createDescriptor({ key: "npm" });
    const jsr = createDescriptor({ key: "jsr" });
    catalog.register(npm);
    catalog.register(jsr);
    expect(catalog.all()).toEqual([npm, jsr]);
  });

  it("filters descriptors by ecosystem", () => {
    const catalog = new RegistryCatalog();
    catalog.register(createDescriptor({ key: "npm", ecosystem: "js" }));
    catalog.register(createDescriptor({ key: "crates", ecosystem: "rust" }));
    const jsRegistries = catalog.getByEcosystem("js");
    expect(jsRegistries).toHaveLength(1);
    expect(jsRegistries[0].key).toBe("npm");
  });
});

describe("default registrations", () => {
  it("has npm registered with ecosystem js", () => {
    const npm = registryCatalog.get("npm");
    expect(npm).toBeDefined();
    expect(npm!.ecosystem).toBe("js");
    expect(npm!.label).toBe("npm");
    expect(npm!.needsPackageScripts).toBe(true);
    expect(npm!.tokenConfig.envVar).toBe("NODE_AUTH_TOKEN");
  });

  it("has jsr registered with ecosystem js", () => {
    const jsr = registryCatalog.get("jsr");
    expect(jsr).toBeDefined();
    expect(jsr!.ecosystem).toBe("js");
    expect(jsr!.needsPackageScripts).toBe(false);
    expect(jsr!.tokenConfig.envVar).toBe("JSR_TOKEN");
  });

  it("has crates registered with ecosystem rust", () => {
    const crates = registryCatalog.get("crates");
    expect(crates).toBeDefined();
    expect(crates!.ecosystem).toBe("rust");
    expect(crates!.label).toBe("crates.io");
    expect(crates!.tokenConfig.envVar).toBe("CARGO_REGISTRY_TOKEN");
  });

  it("npm has additionalEnvVars", () => {
    const npm = registryCatalog.get("npm")!;
    expect(npm.additionalEnvVars).toBeDefined();
    const vars = npm.additionalEnvVars!("my-token");
    expect(vars["npm_config_//registry.npmjs.org/:_authToken"]).toBe(
      "my-token",
    );
  });

  it("keeps the npm token URL unchanged when no username placeholder is present", async () => {
    const npm = registryCatalog.get("npm")!;

    await expect(
      npm.resolveTokenUrl?.("https://registry.npmjs.org/tokens/new"),
    ).resolves.toBe("https://registry.npmjs.org/tokens/new");
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("falls back to the original npm token URL when whoami returns no username", async () => {
    const npm = registryCatalog.get("npm")!;
    mockedExec.mockResolvedValue({
      stdout: "\n",
      stderr: "",
      exitCode: 0,
    } as any);

    await expect(
      npm.resolveTokenUrl?.(
        "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
      ),
    ).resolves.toBe(
      "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
    );
  });

  it("returns no npm display names when no packages have npm registry", async () => {
    const npm = registryCatalog.get("npm")!;

    await expect(
      npm.resolveDisplayName?.({
        packages: [
          { name: "my-crate", path: "/crate", registries: ["crates"] } as any,
        ],
      }),
    ).resolves.toEqual([]);
  });

  it("returns no npm display names when packages is undefined", async () => {
    const npm = registryCatalog.get("npm")!;

    await expect(npm.resolveDisplayName?.({})).resolves.toEqual([]);
  });

  it("returns no jsr display names when no packages have jsr registry", async () => {
    const jsr = registryCatalog.get("jsr")!;

    await expect(
      jsr.resolveDisplayName?.({
        packages: [
          { name: "my-pkg", path: "/pkg", registries: ["npm"] } as any,
        ],
      }),
    ).resolves.toEqual([]);
  });

  it("returns no jsr display names when packages is undefined", async () => {
    const jsr = registryCatalog.get("jsr")!;

    await expect(jsr.resolveDisplayName?.({})).resolves.toEqual([]);
  });

  it("uses a generic crates display name when no packages were discovered", async () => {
    const crates = registryCatalog.get("crates")!;

    await expect(crates.resolveDisplayName?.({})).resolves.toEqual(["crate"]);
  });
});

describe("PackageRegistry base class defaults", () => {
  class TestRegistry extends PackageRegistry {
    static reader = {} as any;
    static registryType = "test";
    distTags = vi.fn();
    publish = vi.fn();
    isPublished = vi.fn();
    isVersionPublished = vi.fn();
    hasPermission = vi.fn().mockResolvedValue(true);
    isPackageNameAvailable = vi.fn().mockResolvedValue(true);
    getRequirements = vi.fn();
  }

  it("checkAvailability succeeds when available", async () => {
    const reg = new TestRegistry("test-pkg");
    await expect(reg.checkAvailability({} as any)).resolves.toBeUndefined();
  });
});

describe("RegistryDescriptor connector", () => {
  it("npm descriptor has concurrentPublish true", () => {
    expect(registryCatalog.get("npm")!.concurrentPublish).toBe(true);
  });

  it("jsr descriptor has concurrentPublish true", () => {
    expect(registryCatalog.get("jsr")!.concurrentPublish).toBe(true);
  });

  it("crates descriptor has concurrentPublish false", () => {
    expect(registryCatalog.get("crates")!.concurrentPublish).toBe(false);
  });

  it("crates descriptor has orderPackages function", () => {
    expect(registryCatalog.get("crates")!.orderPackages).toBeTypeOf("function");
  });

  it("npm descriptor has connector function", () => {
    expect(registryCatalog.get("npm")!.connector).toBeTypeOf("function");
  });

  it("jsr descriptor has connector function", () => {
    expect(registryCatalog.get("jsr")!.connector).toBeTypeOf("function");
  });

  it("crates descriptor has connector function", () => {
    expect(registryCatalog.get("crates")!.connector).toBeTypeOf("function");
  });
});

describe("validateToken", () => {
  it("npm validateToken returns true for valid token", async () => {
    const npm = registryCatalog.get("npm")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await npm.validateToken!("valid-token");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/-/whoami",
      { headers: { Authorization: "Bearer valid-token" } },
    );

    vi.unstubAllGlobals();
  });

  it("npm validateToken returns false for invalid token", async () => {
    const npm = registryCatalog.get("npm")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await npm.validateToken!("bad-token");

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it("npm validateToken throws on network error", async () => {
    const npm = registryCatalog.get("npm")!;
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(npm.validateToken!("any-token")).rejects.toThrow(
      "ECONNREFUSED",
    );
    vi.unstubAllGlobals();
  });

  it("jsr validateToken throws on network error", async () => {
    const jsr = registryCatalog.get("jsr")!;
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(jsr.validateToken!("any-token")).rejects.toThrow(
      "ECONNREFUSED",
    );
    vi.unstubAllGlobals();
  });

  it("jsr validateToken returns true for valid token", async () => {
    const jsr = registryCatalog.get("jsr")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await jsr.validateToken!("valid-jsr-token");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://jsr.io/api/user", {
      headers: { Authorization: "Bearer valid-jsr-token" },
    });
    vi.unstubAllGlobals();
  });

  it("jsr validateToken returns false for invalid token", async () => {
    const jsr = registryCatalog.get("jsr")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await jsr.validateToken!("bad-jsr-token");

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it("crates validateToken returns true for valid token", async () => {
    const crates = registryCatalog.get("crates")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await crates.validateToken!("valid-cargo-token");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://crates.io/api/v1/me", {
      headers: {
        Authorization: "valid-cargo-token",
        "User-Agent": "pubm (https://github.com/syi0808/pubm)",
      },
    });
    vi.unstubAllGlobals();
  });

  it("crates validateToken returns false for invalid token", async () => {
    const crates = registryCatalog.get("crates")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await crates.validateToken!("bad-cargo-token");

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it("crates validateToken throws on network error", async () => {
    const crates = registryCatalog.get("crates")!;
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(crates.validateToken!("any-token")).rejects.toThrow(
      "ECONNREFUSED",
    );
    vi.unstubAllGlobals();
  });
});

describe("registerPrivateRegistry duplicate key", () => {
  it("returns existing key without re-registering when already in catalog", async () => {
    const { registerPrivateRegistry } = await import(
      "../../../src/registry/catalog.js"
    );
    const catalog = new RegistryCatalog();
    const desc = createDescriptor({ key: "npm.internal.com" });
    catalog.register(desc);

    const key = registerPrivateRegistry(
      { url: "https://npm.internal.com", token: { envVar: "TOK" } },
      "js",
      catalog,
    );
    expect(key).toBe("npm.internal.com");
    // The original descriptor should still be there, not overwritten
    expect(catalog.get(key)).toBe(desc);
  });
});

describe("default registration factory and connector invocations", () => {
  it("npm connector returns a RegistryConnector instance", () => {
    const npm = registryCatalog.get("npm")!;
    const connector = npm.connector();
    expect(connector).toBeDefined();
  });

  it("jsr connector returns a RegistryConnector instance", () => {
    const jsr = registryCatalog.get("jsr")!;
    const connector = jsr.connector();
    expect(connector).toBeDefined();
  });

  it("crates connector returns a RegistryConnector instance", () => {
    const crates = registryCatalog.get("crates")!;
    const connector = crates.connector();
    expect(connector).toBeDefined();
  });

  it("npm factory creates a PackageRegistry", async () => {
    const npm = registryCatalog.get("npm")!;
    const spy = vi.spyOn(NpmPackageRegistry.reader, "read").mockResolvedValue({
      name: "test-pkg",
      version: "1.0.0",
      private: false,
      dependencies: [],
    });
    const reg = await npm.factory("/fake/path");
    expect(reg).toBeDefined();
    expect(reg.packageName).toBe("test-pkg");
    spy.mockRestore();
  });

  it("jsr factory creates a PackageRegistry", async () => {
    const jsr = registryCatalog.get("jsr")!;
    const spy = vi.spyOn(JsrPackageRegistry.reader, "read").mockResolvedValue({
      name: "@scope/test-pkg",
      version: "1.0.0",
      private: false,
      dependencies: [],
    });
    const reg = await jsr.factory("/fake/path");
    expect(reg).toBeDefined();
    expect(reg.packageName).toBe("@scope/test-pkg");
    spy.mockRestore();
  });

  it("npm resolveTokenUrl replaces ~ with username from whoami", async () => {
    const npm = registryCatalog.get("npm")!;
    mockedExec.mockResolvedValue({
      stdout: "testuser\n",
      stderr: "",
      exitCode: 0,
    } as any);

    const result = await npm.resolveTokenUrl!(
      "https://www.npmjs.com/settings/~/tokens",
    );
    expect(result).toBe("https://www.npmjs.com/settings/testuser/tokens");
  });

  it("npm resolveDisplayName returns package names from ctx.packages", async () => {
    const npm = registryCatalog.get("npm")!;

    const names = await npm.resolveDisplayName!({
      packages: [
        {
          name: "@pubm/core",
          path: "packages/core",
          registries: ["npm", "jsr"],
        } as any,
        { name: "pubm", path: "packages/cli", registries: ["npm"] } as any,
        { name: "my-crate", path: "crates/foo", registries: ["crates"] } as any,
      ],
    });
    expect(names).toEqual(["@pubm/core", "pubm"]);
  });

  it("jsr resolveDisplayName returns package names from ctx.packages", async () => {
    const jsr = registryCatalog.get("jsr")!;

    const names = await jsr.resolveDisplayName!({
      packages: [
        {
          name: "@pubm/core",
          path: "packages/core",
          registries: ["npm", "jsr"],
        } as any,
        { name: "pubm", path: "packages/cli", registries: ["npm"] } as any,
      ],
    });
    expect(names).toEqual(["@pubm/core"]);
  });

  it("crates resolveDisplayName filters packages by crates registry", async () => {
    const crates = registryCatalog.get("crates")!;

    const names = await crates.resolveDisplayName!({
      packages: [
        { name: "my-crate", path: "/crate", registries: ["crates"] } as any,
        { name: "my-npm", path: "/npm", registries: ["npm"] } as any,
      ],
    });
    expect(names).toEqual(["/crate"]);
  });
});
