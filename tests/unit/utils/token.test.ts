import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

import { Db } from "../../../src/utils/db.js";
import {
  injectTokensToEnv,
  loadTokensFromDb,
  TOKEN_CONFIG,
} from "../../../src/utils/token.js";

const mockedDb = vi.mocked(Db);

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
  it("returns tokens found in Db", () => {
    const mockGet = vi.fn((key: string) =>
      key === "npm-token" ? "npm-tok-123" : null,
    );
    mockedDb.mockImplementation(() => ({ get: mockGet, set: vi.fn() }) as any);

    const result = loadTokensFromDb(["npm", "jsr"]);
    expect(result).toEqual({ npm: "npm-tok-123" });
  });

  it("skips registries with no token config", () => {
    const mockGet = vi.fn().mockReturnValue(null);
    mockedDb.mockImplementation(() => ({ get: mockGet, set: vi.fn() }) as any);

    const result = loadTokensFromDb(["npm", "custom-registry"]);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result).toEqual({});
  });
});

describe("injectTokensToEnv", () => {
  it("sets environment variables and returns cleanup function", () => {
    const originalEnv = { ...process.env };
    const cleanup = injectTokensToEnv({ npm: "test-token" });

    expect(process.env.NODE_AUTH_TOKEN).toBe("test-token");
    cleanup();
    expect(process.env.NODE_AUTH_TOKEN).toBe(originalEnv.NODE_AUTH_TOKEN);
  });
});
