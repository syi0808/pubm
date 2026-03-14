import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

import {
  RegistryCatalog,
  type RegistryDescriptor,
  registryCatalog,
} from "../../../src/registry/catalog.js";
import { JsrRegisry } from "../../../src/registry/jsr.js";
import { NpmRegistry } from "../../../src/registry/npm.js";
import { Registry } from "../../../src/registry/registry.js";
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

  it("returns no npm display names when package metadata is missing a name", async () => {
    const npm = registryCatalog.get("npm")!;
    const spy = vi.spyOn(NpmRegistry.reader, "read").mockResolvedValue({
      name: "",
      version: "0.0.0",
      private: false,
      dependencies: [],
    });

    await expect(npm.resolveDisplayName?.({})).resolves.toEqual([]);
    spy.mockRestore();
  });

  it("returns no jsr display names when jsr metadata is missing a name", async () => {
    const jsr = registryCatalog.get("jsr")!;
    const spy = vi.spyOn(JsrRegisry.reader, "read").mockResolvedValue({
      name: "",
      version: "0.0.0",
      private: false,
      dependencies: [],
    });

    await expect(jsr.resolveDisplayName?.({})).resolves.toEqual([]);
    spy.mockRestore();
  });

  it("uses a generic crates display name when no packages were discovered", async () => {
    const crates = registryCatalog.get("crates")!;

    await expect(crates.resolveDisplayName?.({})).resolves.toEqual(["crate"]);
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
