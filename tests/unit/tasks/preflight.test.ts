import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tinyexec", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));
vi.mock("../../../src/utils/token.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/utils/token.js")>();
  return {
    ...original,
    loadTokensFromDb: vi.fn(),
    injectTokensToEnv: vi.fn(),
  };
});

import { exec } from "tinyexec";
import {
  collectTokens,
  promptGhSecretsSync,
  syncGhSecrets,
} from "../../../src/tasks/preflight.js";
import { SecureStore } from "../../../src/utils/secure-store.js";
import { loadTokensFromDb } from "../../../src/utils/token.js";

const mockedExec = vi.mocked(exec);
const mockedSecureStore = vi.mocked(SecureStore);
const mockedLoadTokens = vi.mocked(loadTokensFromDb);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collectTokens", () => {
  it("uses existing tokens from Db without prompting", async () => {
    mockedLoadTokens.mockReturnValue({ npm: "existing-token" });

    const mockTask = {
      output: "",
      prompt: vi.fn(),
    };

    const tokens = await collectTokens(["npm"], mockTask as any);

    expect(tokens).toEqual({ npm: "existing-token" });
    expect(mockTask.prompt).not.toHaveBeenCalled();
  });

  it("prompts for missing tokens", async () => {
    mockedLoadTokens.mockReturnValue({});
    mockedExec.mockResolvedValue({ stdout: "testuser\n", stderr: "" } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    const mockDbSet = vi.fn();
    mockedSecureStore.mockImplementation(
      () => ({ get: vi.fn(), set: mockDbSet }) as any,
    );

    const tokens = await collectTokens(["npm"], mockTask as any);

    expect(tokens).toEqual({ npm: "new-token" });
    expect(mockDbSet).toHaveBeenCalledWith("npm-token", "new-token");
  });

  it("skips registries without token config", async () => {
    mockedLoadTokens.mockReturnValue({});

    const mockTask = {
      output: "",
      prompt: vi.fn(),
    };

    const tokens = await collectTokens(["custom-registry"], mockTask as any);

    expect(tokens).toEqual({});
    expect(mockTask.prompt).not.toHaveBeenCalled();
  });
});

describe("syncGhSecrets", () => {
  it("calls gh secret set for each token and writes to stdin", async () => {
    const mockStdin = { end: vi.fn() };
    const mockResult = Object.assign(
      Promise.resolve({ stdout: "", stderr: "" }),
      {
        process: { stdin: mockStdin },
      },
    );
    mockedExec.mockReturnValue(mockResult as any);

    await syncGhSecrets({ npm: "tok-123", jsr: "tok-456" });

    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "NODE_AUTH_TOKEN"],
      { throwOnError: true },
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "JSR_TOKEN"],
      { throwOnError: true },
    );
    expect(mockStdin.end).toHaveBeenCalledWith("tok-123");
    expect(mockStdin.end).toHaveBeenCalledWith("tok-456");
  });

  it("throws when gh is not installed", async () => {
    const mockResult = Object.assign(Promise.reject(new Error("not found")), {
      process: undefined,
    });
    mockedExec.mockReturnValue(mockResult as any);

    await expect(syncGhSecrets({ npm: "tok-123" })).rejects.toThrow();
  });
});

describe("promptGhSecretsSync", () => {
  it("skips prompt if tokens already synced (same hash)", async () => {
    const mockDbGet = vi.fn().mockReturnValue("somehash");
    const mockDbSet = vi.fn();
    mockedSecureStore.mockImplementation(
      () => ({ get: mockDbGet, set: mockDbSet }) as any,
    );

    // Use a fixed token set — the hash will match what's stored
    // We mock db.get to return the current hash, so it should skip
    // To make this work, we need the hash to match. Let's just verify the prompt is not called.
    // We'll set the stored hash to match by computing it ourselves:
    const { createHash } = await import("node:crypto");
    const tokens = { npm: "tok-1" };
    const sorted = Object.entries(tokens).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const hash = createHash("sha256")
      .update(JSON.stringify(sorted))
      .digest("hex")
      .slice(0, 16);

    mockDbGet.mockReturnValue(hash);

    const mockTask = { output: "", prompt: vi.fn() };
    await promptGhSecretsSync(tokens, mockTask);

    expect(mockTask.prompt).not.toHaveBeenCalled();
    expect(mockTask.output).toBe("Tokens already synced to GitHub Secrets.");
  });

  it("prompts when tokens have changed (different hash)", async () => {
    const mockDbGet = vi.fn().mockReturnValue("oldhash");
    const mockDbSet = vi.fn();
    mockedSecureStore.mockImplementation(
      () => ({ get: mockDbGet, set: mockDbSet }) as any,
    );

    const mockStdin = { end: vi.fn() };
    const mockResult = Object.assign(
      Promise.resolve({ stdout: "", stderr: "" }),
      { process: { stdin: mockStdin } },
    );
    mockedExec.mockReturnValue(mockResult as any);

    const mockPromptAdapter = { run: vi.fn().mockResolvedValue(true) };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await promptGhSecretsSync({ npm: "tok-new" }, mockTask);

    expect(mockTask.prompt).toHaveBeenCalled();
    expect(mockedExec).toHaveBeenCalled();
    expect(mockDbSet).toHaveBeenCalledWith(
      "gh-secrets-sync-hash",
      expect.any(String),
    );
  });

  it("does not sync or save hash when user declines", async () => {
    const mockDbGet = vi.fn().mockReturnValue(null);
    const mockDbSet = vi.fn();
    mockedSecureStore.mockImplementation(
      () => ({ get: mockDbGet, set: mockDbSet }) as any,
    );

    const mockPromptAdapter = { run: vi.fn().mockResolvedValue(false) };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await promptGhSecretsSync({ npm: "tok-1" }, mockTask);

    expect(mockedExec).not.toHaveBeenCalled();
    expect(mockDbSet).not.toHaveBeenCalled();
  });
});
