import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
    };
  }),
}));

import { SecureStore } from "../../../src/utils/secure-store.js";
import {
  injectTokensToEnv,
  loadTokensFromDb,
  TOKEN_CONFIG,
} from "../../../src/utils/token.js";

const mockedSecureStore = vi.mocked(SecureStore);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TOKEN_CONFIG", () => {
  it("has entries for npm, jsr, and crates", () => {
    expect(TOKEN_CONFIG.npm).toEqual({
      envVar: "NODE_AUTH_TOKEN",
      dbKey: "npm-token",
      ghSecretName: "NODE_AUTH_TOKEN",
      promptLabel: "npm access token",
      tokenUrl:
        "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
      tokenUrlLabel: "npmjs.com",
    });
    expect(TOKEN_CONFIG.jsr).toEqual({
      envVar: "JSR_TOKEN",
      dbKey: "jsr-token",
      ghSecretName: "JSR_TOKEN",
      promptLabel: "jsr API token",
      tokenUrl: "https://jsr.io/account/tokens/create",
      tokenUrlLabel: "jsr.io",
    });
    expect(TOKEN_CONFIG.crates).toEqual({
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
    for (const config of Object.values(TOKEN_CONFIG)) {
      savedEnv[config.envVar] = process.env[config.envVar];
      delete process.env[config.envVar];
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
});
