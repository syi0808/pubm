import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
    };
  }),
}));

import type { PluginCredential } from "../../../src/plugin/types.js";
import { registryCatalog } from "../../../src/registry/catalog.js";
import { SecureStore } from "../../../src/utils/secure-store.js";
import {
  injectPluginTokensToEnv,
  injectTokensToEnv,
  loadTokensFromDb,
} from "../../../src/utils/token.js";

const mockedSecureStore = vi.mocked(SecureStore);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registryCatalog token configs", () => {
  it("has tokenConfig for npm", () => {
    expect(registryCatalog.get("npm")?.tokenConfig).toEqual({
      envVar: "NODE_AUTH_TOKEN",
      dbKey: "npm-token",
      ghSecretName: "NODE_AUTH_TOKEN",
      promptLabel: "npm access token",
      tokenUrl:
        "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
      tokenUrlLabel: "npmjs.com",
    });
  });

  it("has tokenConfig for jsr", () => {
    expect(registryCatalog.get("jsr")?.tokenConfig).toEqual({
      envVar: "JSR_TOKEN",
      dbKey: "jsr-token",
      ghSecretName: "JSR_TOKEN",
      promptLabel: "jsr API token",
      tokenUrl: "https://jsr.io/account/tokens/create",
      tokenUrlLabel: "jsr.io",
    });
  });

  it("has tokenConfig for crates", () => {
    expect(registryCatalog.get("crates")?.tokenConfig).toEqual({
      envVar: "CARGO_REGISTRY_TOKEN",
      dbKey: "cargo-token",
      ghSecretName: "CARGO_REGISTRY_TOKEN",
      promptLabel: "crates.io API token",
      tokenUrl: "https://crates.io/settings/tokens/new",
      tokenUrlLabel: "crates.io",
    });
  });
});

describe("loadTokensFromDb", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const descriptor of registryCatalog.all()) {
      const envVar = descriptor.tokenConfig.envVar;
      savedEnv[envVar] = process.env[envVar];
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns tokens found in SecureStore", () => {
    const mockGet = vi.fn((key: string) =>
      key === "npm-token" ? "npm-tok-123" : null,
    );
    mockedSecureStore.mockImplementation(function () {
      return { get: mockGet, set: vi.fn() } as any;
    });

    const result = loadTokensFromDb(["npm", "jsr"]);
    expect(result).toEqual({ npm: "npm-tok-123" });
  });

  it("skips registries with no token config", () => {
    const mockGet = vi.fn().mockReturnValue(null);
    mockedSecureStore.mockImplementation(function () {
      return { get: mockGet, set: vi.fn() } as any;
    });

    const result = loadTokensFromDb(["npm", "custom-registry"]);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result).toEqual({});
  });

  it("prefers env var over SecureStore", () => {
    process.env.NODE_AUTH_TOKEN = "env-token";
    const mockGet = vi.fn().mockReturnValue("stored-token");
    mockedSecureStore.mockImplementation(function () {
      return { get: mockGet, set: vi.fn() } as any;
    });

    const result = loadTokensFromDb(["npm"]);
    expect(result).toEqual({ npm: "env-token" });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("injectTokensToEnv", () => {
  it("sets environment variables and returns cleanup function", () => {
    const originalEnv = { ...process.env };
    const cleanup = injectTokensToEnv({ npm: "test-token" });

    expect(process.env.NODE_AUTH_TOKEN).toBe("test-token");
    expect(process.env["npm_config_//registry.npmjs.org/:_authToken"]).toBe(
      "test-token",
    );
    cleanup();
    expect(process.env.NODE_AUTH_TOKEN).toBe(originalEnv.NODE_AUTH_TOKEN);
    expect(process.env["npm_config_//registry.npmjs.org/:_authToken"]).toBe(
      originalEnv["npm_config_//registry.npmjs.org/:_authToken"],
    );
  });

  it("sets npm additional env var via catalog additionalEnvVars", () => {
    const cleanup = injectTokensToEnv({ npm: "my-npm-token" });

    expect(process.env["npm_config_//registry.npmjs.org/:_authToken"]).toBe(
      "my-npm-token",
    );

    cleanup();
    expect(
      process.env["npm_config_//registry.npmjs.org/:_authToken"],
    ).toBeUndefined();
  });

  it("restores previously defined env vars for registries without additional env vars", () => {
    const original = process.env.JSR_TOKEN;
    process.env.JSR_TOKEN = "old-jsr-token";

    try {
      const cleanup = injectTokensToEnv({ jsr: "new-jsr-token" });

      expect(process.env.JSR_TOKEN).toBe("new-jsr-token");

      cleanup();

      expect(process.env.JSR_TOKEN).toBe("old-jsr-token");
    } finally {
      if (original === undefined) delete process.env.JSR_TOKEN;
      else process.env.JSR_TOKEN = original;
    }
  });

  it("ignores unknown registries when injecting tokens", () => {
    const previousNodeAuthToken = process.env.NODE_AUTH_TOKEN;

    const cleanup = injectTokensToEnv({ unknown: "ignored-token" });

    expect(process.env.NODE_AUTH_TOKEN).toBe(previousNodeAuthToken);

    cleanup();
    expect(process.env.NODE_AUTH_TOKEN).toBe(previousNodeAuthToken);
  });
});

describe("injectPluginTokensToEnv", () => {
  it("injects plugin tokens into process.env", () => {
    const creds: PluginCredential[] = [
      { key: "my-token", env: "MY_PLUGIN_TOKEN", label: "My Token" },
    ];
    const cleanup = injectPluginTokensToEnv({ "my-token": "secret" }, creds);

    expect(process.env.MY_PLUGIN_TOKEN).toBe("secret");
    cleanup();
    expect(process.env.MY_PLUGIN_TOKEN).toBeUndefined();
  });

  it("skips credentials without a matching token", () => {
    const creds: PluginCredential[] = [
      { key: "missing", env: "MISSING_TOKEN", label: "Missing" },
    ];
    const cleanup = injectPluginTokensToEnv({}, creds);

    expect(process.env.MISSING_TOKEN).toBeUndefined();
    cleanup();
  });

  it("restores pre-existing env value after cleanup", () => {
    process.env.MY_PLUGIN_TOKEN = "original";
    const creds: PluginCredential[] = [
      { key: "my-token", env: "MY_PLUGIN_TOKEN", label: "My Token" },
    ];
    const cleanup = injectPluginTokensToEnv({ "my-token": "injected" }, creds);

    expect(process.env.MY_PLUGIN_TOKEN).toBe("injected");
    cleanup();
    expect(process.env.MY_PLUGIN_TOKEN).toBe("original");
    delete process.env.MY_PLUGIN_TOKEN;
  });
});
