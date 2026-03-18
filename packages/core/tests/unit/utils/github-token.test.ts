import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
    };
  }),
}));

import {
  resolveGitHubToken,
  saveGitHubToken,
} from "../../../src/utils/github-token.js";
import { SecureStore } from "../../../src/utils/secure-store.js";

const mockedSecureStore = vi.mocked(SecureStore);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe("resolveGitHubToken", () => {
  it("returns env token when GITHUB_TOKEN is set", () => {
    process.env.GITHUB_TOKEN = "ghp_env_token_123";
    const result = resolveGitHubToken();
    expect(result).toEqual({ token: "ghp_env_token_123", source: "env" });
  });

  it("returns stored token from SecureStore when env is not set", () => {
    const mockGet = vi.fn().mockReturnValue("ghp_stored_token_456");
    mockedSecureStore.mockImplementation(function () {
      return { get: mockGet, set: vi.fn() } as any;
    });

    const result = resolveGitHubToken();
    expect(result).toEqual({ token: "ghp_stored_token_456", source: "store" });
    expect(mockGet).toHaveBeenCalledWith("github-token");
  });

  it("returns null when no token is available", () => {
    const mockGet = vi.fn().mockReturnValue(null);
    mockedSecureStore.mockImplementation(function () {
      return { get: mockGet, set: vi.fn() } as any;
    });

    const result = resolveGitHubToken();
    expect(result).toBeNull();
  });

  it("prefers env token over stored token", () => {
    process.env.GITHUB_TOKEN = "ghp_env_token";
    const mockGet = vi.fn().mockReturnValue("ghp_stored_token");
    mockedSecureStore.mockImplementation(function () {
      return { get: mockGet, set: vi.fn() } as any;
    });

    const result = resolveGitHubToken();
    expect(result).toEqual({ token: "ghp_env_token", source: "env" });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("saveGitHubToken", () => {
  it("saves token to SecureStore", () => {
    const mockSet = vi.fn();
    mockedSecureStore.mockImplementation(function () {
      return { get: vi.fn(), set: mockSet } as any;
    });

    saveGitHubToken("ghp_new_token_789");
    expect(mockSet).toHaveBeenCalledWith("github-token", "ghp_new_token_789");
  });
});
