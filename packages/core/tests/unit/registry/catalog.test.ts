import { describe, expect, it, vi } from "vitest";
import {
  RegistryCatalog,
  type RegistryDescriptor,
  registryCatalog,
} from "../../../src/registry/catalog.js";
import { Registry } from "../../../src/registry/registry.js";

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
    factory: async () => ({}) as any,
    ...overrides,
  };
}

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
});

describe("Registry base class defaults", () => {
  class TestRegistry extends Registry {
    ping = vi.fn();
    isInstalled = vi.fn().mockResolvedValue(true);
    distTags = vi.fn();
    version = vi.fn();
    publish = vi.fn();
    isPublished = vi.fn();
    isVersionPublished = vi.fn();
    hasPermission = vi.fn().mockResolvedValue(true);
    isPackageNameAvaliable = vi.fn().mockResolvedValue(true);
    getRequirements = vi.fn();
  }

  it("concurrentPublish defaults to true", () => {
    const reg = new TestRegistry("test-pkg");
    expect(reg.concurrentPublish).toBe(true);
  });

  it("orderPackages returns paths unchanged", async () => {
    const reg = new TestRegistry("test-pkg");
    const paths = ["/a", "/b", "/c"];
    expect(await reg.orderPackages(paths)).toEqual(paths);
  });

  it("checkAvailability succeeds when installed and available", async () => {
    const reg = new TestRegistry("test-pkg");
    await expect(reg.checkAvailability({} as any)).resolves.toBeUndefined();
  });

  it("checkAvailability throws when not installed", async () => {
    const reg = new TestRegistry("test-pkg");
    reg.isInstalled.mockResolvedValue(false);
    await expect(reg.checkAvailability({} as any)).rejects.toThrow(
      "not installed",
    );
  });
});
