import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateRegistryConfig } from "../../../src/config/types.js";
import {
  RegistryCatalog,
  registerPrivateRegistry,
} from "../../../src/registry/catalog.js";
import { NpmPackageRegistry } from "../../../src/registry/npm.js";

describe("registerPrivateRegistry", () => {
  let catalog: RegistryCatalog;

  beforeEach(() => {
    catalog = new RegistryCatalog();
  });

  it("registers a private registry and returns normalized key", () => {
    const config: PrivateRegistryConfig = {
      url: "https://npm.internal.com",
      token: { envVar: "INTERNAL_NPM_TOKEN" },
    };
    const key = registerPrivateRegistry(config, "js", catalog);
    expect(key).toBe("npm.internal.com");
    expect(catalog.get(key)).toBeDefined();
    expect(catalog.get(key)?.ecosystem).toBe("js");
  });

  it("sets tokenConfig from private registry config", () => {
    const config: PrivateRegistryConfig = {
      url: "https://npm.internal.com",
      token: { envVar: "MY_TOKEN" },
    };
    const key = registerPrivateRegistry(config, "js", catalog);
    const descriptor = catalog.get(key)!;
    expect(descriptor.tokenConfig.envVar).toBe("MY_TOKEN");
    expect(descriptor.tokenConfig.dbKey).toBe("npm.internal.com-token");
  });

  it("creates a factory that produces CustomPackageRegistry with correct URL", async () => {
    const spy = vi.spyOn(NpmPackageRegistry.reader, "read").mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
      private: false,
      dependencies: [],
    });

    const config: PrivateRegistryConfig = {
      url: "https://npm.internal.com",
      token: { envVar: "MY_TOKEN" },
    };
    const key = registerPrivateRegistry(config, "js", catalog);
    const descriptor = catalog.get(key)!;
    const registry = await descriptor.factory("/path/to/my-pkg");
    expect(registry.registry).toBe("https://npm.internal.com");
    expect(registry.packageName).toBe("my-pkg");

    spy.mockRestore();
  });

  it("handles duplicate registration (same URL) without error", () => {
    const config: PrivateRegistryConfig = {
      url: "https://npm.internal.com",
      token: { envVar: "MY_TOKEN" },
    };
    registerPrivateRegistry(config, "js", catalog);
    registerPrivateRegistry(config, "js", catalog);
    expect(catalog.get("npm.internal.com")).toBeDefined();
  });

  it("supports rust ecosystem private registry", () => {
    const config: PrivateRegistryConfig = {
      url: "https://crates.internal.com",
      token: { envVar: "CRATES_TOKEN" },
    };
    const key = registerPrivateRegistry(config, "rust", catalog);
    expect(catalog.get(key)?.ecosystem).toBe("rust");
  });
});
