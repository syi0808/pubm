import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
    };
  }),
}));
vi.mock("../../../src/utils/gh-secrets-sync-state.js", () => ({
  readGhSecretsSyncHash: vi.fn(),
  writeGhSecretsSyncHash: vi.fn(),
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

import {
  collectTokens,
  promptGhSecretsSync,
  syncGhSecrets,
} from "../../../src/tasks/preflight.js";
import { exec } from "../../../src/utils/exec.js";
import {
  readGhSecretsSyncHash,
  writeGhSecretsSyncHash,
} from "../../../src/utils/gh-secrets-sync-state.js";
import { SecureStore } from "../../../src/utils/secure-store.js";
import { loadTokensFromDb } from "../../../src/utils/token.js";

const mockedExec = vi.mocked(exec);
const mockedSecureStore = vi.mocked(SecureStore);
const mockedReadGhSecretsSyncHash = vi.mocked(readGhSecretsSyncHash);
const mockedWriteGhSecretsSyncHash = vi.mocked(writeGhSecretsSyncHash);
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
    mockedSecureStore.mockImplementation(function () {
      return { get: vi.fn(), set: mockDbSet } as any;
    });

    const tokens = await collectTokens(["npm"], mockTask as any);

    expect(tokens).toEqual({ npm: "new-token" });
    expect(mockDbSet).toHaveBeenCalledWith("npm-token", "new-token");
  });

  it("throws when a required token input is empty", async () => {
    mockedLoadTokens.mockReturnValue({});
    mockedExec.mockResolvedValue({ stdout: "testuser\n", stderr: "" } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("   "),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await expect(collectTokens(["npm"], mockTask as any)).rejects.toThrow(
      "npm access token is required to continue in preflight mode.",
    );
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
  it("calls gh secret set for each token with --body flag", async () => {
    mockedExec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    } as any);

    await syncGhSecrets({ npm: "tok-123", jsr: "tok-456" });

    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "NODE_AUTH_TOKEN", "--body", "tok-123"],
      { throwOnError: true },
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "JSR_TOKEN", "--body", "tok-456"],
      { throwOnError: true },
    );
  });

  it("skips registries without a descriptor in the catalog", async () => {
    mockedExec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    } as any);

    await syncGhSecrets({ "unknown-registry": "tok-999" });

    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("throws when gh is not installed", async () => {
    mockedExec.mockRejectedValue(new Error("not found"));

    await expect(syncGhSecrets({ npm: "tok-123" })).rejects.toThrow();
  });
});

describe("promptGhSecretsSync", () => {
  it("skips prompt if tokens already synced (same hash)", async () => {
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

    mockedReadGhSecretsSyncHash.mockReturnValue(hash);

    const mockTask = { output: "", prompt: vi.fn() };
    await promptGhSecretsSync(tokens, mockTask);

    expect(mockTask.prompt).not.toHaveBeenCalled();
    expect(mockTask.output).toBe(
      "GitHub Secrets sync already acknowledged for the current tokens.",
    );
  });

  it("prompts when tokens have changed (different hash)", async () => {
    mockedReadGhSecretsSyncHash.mockReturnValue("oldhash");

    mockedExec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    } as any);

    const mockPromptAdapter = { run: vi.fn().mockResolvedValue(true) };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await promptGhSecretsSync({ npm: "tok-new" }, mockTask);

    expect(mockTask.prompt).toHaveBeenCalled();
    expect(mockedExec).toHaveBeenCalled();
    expect(mockedWriteGhSecretsSyncHash).toHaveBeenCalledWith(
      expect.any(String),
    );
  });

  it("does not sync but still saves hash when user declines", async () => {
    mockedReadGhSecretsSyncHash.mockReturnValue(null);

    const mockPromptAdapter = { run: vi.fn().mockResolvedValue(false) };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await promptGhSecretsSync({ npm: "tok-1" }, mockTask);

    expect(mockedExec).not.toHaveBeenCalled();
    expect(mockedWriteGhSecretsSyncHash).toHaveBeenCalledWith(
      expect.any(String),
    );
  });

  it("wraps sync hash persistence failures", async () => {
    mockedReadGhSecretsSyncHash.mockReturnValue(null);
    mockedWriteGhSecretsSyncHash.mockImplementation(() => {
      throw new Error("EACCES");
    });

    const mockPromptAdapter = { run: vi.fn().mockResolvedValue(false) };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await expect(
      promptGhSecretsSync({ npm: "tok-1" }, mockTask),
    ).rejects.toThrow("Failed to save GitHub Secrets sync state.");
  });
});
