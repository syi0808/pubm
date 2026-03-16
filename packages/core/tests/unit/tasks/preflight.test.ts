import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
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

import { registryCatalog } from "../../../src/registry/catalog.js";
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
  // Disable real network validateToken calls for all tests in this suite
  // (the "token validation" sub-describe sets its own mocks as needed)
  const npmDescriptorOuter = registryCatalog.get("npm")!;
  const originalValidateOuter = npmDescriptorOuter.validateToken;
  beforeEach(() => {
    npmDescriptorOuter.validateToken = undefined;
  });
  afterEach(() => {
    npmDescriptorOuter.validateToken = originalValidateOuter;
  });

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
      "npm access token is required to continue.",
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

  describe("token validation", () => {
    const npmDescriptor = registryCatalog.get("npm")!;
    const originalValidate = npmDescriptor.validateToken;
    const originalEnv = process.env.NODE_AUTH_TOKEN;

    afterEach(() => {
      npmDescriptor.validateToken = originalValidate;
      if (originalEnv === undefined) {
        delete process.env.NODE_AUTH_TOKEN;
      } else {
        process.env.NODE_AUTH_TOKEN = originalEnv;
      }
    });

    it("re-prompts when stored token fails validation", async () => {
      mockedLoadTokens.mockReturnValue({ npm: "expired-token" });

      npmDescriptor.validateToken = vi
        .fn()
        .mockResolvedValueOnce(false) // stored token invalid
        .mockResolvedValueOnce(true); // prompted token valid

      const mockPromptAdapter = {
        run: vi.fn().mockResolvedValue("fresh-token"),
      };
      const mockTask = {
        output: "",
        prompt: vi.fn().mockReturnValue(mockPromptAdapter),
      };

      const mockDbDelete = vi.fn();
      const mockDbSet = vi.fn();
      mockedSecureStore.mockImplementation(function () {
        return { get: vi.fn(), set: mockDbSet, delete: mockDbDelete } as any;
      });

      const tokens = await collectTokens(["npm"], mockTask as any);

      expect(tokens).toEqual({ npm: "fresh-token" });
      expect(mockDbDelete).toHaveBeenCalledWith("npm-token");
      expect(mockDbSet).toHaveBeenCalledWith("npm-token", "fresh-token");
    });

    it("skips validation when validateToken is not defined", async () => {
      mockedLoadTokens.mockReturnValue({ npm: "some-token" });
      npmDescriptor.validateToken = undefined;

      const mockTask = {
        output: "",
        prompt: vi.fn(),
      };

      const tokens = await collectTokens(["npm"], mockTask as any);

      expect(tokens).toEqual({ npm: "some-token" });
      expect(mockTask.prompt).not.toHaveBeenCalled();
    });

    it("throws when env var token fails validation", async () => {
      process.env.NODE_AUTH_TOKEN = "bad-env-token";
      mockedLoadTokens.mockReturnValue({ npm: "bad-env-token" });
      npmDescriptor.validateToken = vi.fn().mockResolvedValue(false);

      const mockTask = {
        output: "",
        prompt: vi.fn(),
      };

      await expect(collectTokens(["npm"], mockTask as any)).rejects.toThrow(
        "NODE_AUTH_TOKEN is set but invalid",
      );
    });

    it("re-prompts when prompted token fails validation", async () => {
      mockedLoadTokens.mockReturnValue({});
      npmDescriptor.validateToken = vi
        .fn()
        .mockResolvedValueOnce(false) // first prompted token invalid
        .mockResolvedValueOnce(true); // second prompted token valid

      // resolveTokenUrl needs exec mock
      mockedExec.mockResolvedValue({ stdout: "testuser\n", stderr: "" } as any);

      const mockPromptAdapter = {
        run: vi
          .fn()
          .mockResolvedValueOnce("bad-token")
          .mockResolvedValueOnce("good-token"),
      };
      const mockTask = {
        output: "",
        prompt: vi.fn().mockReturnValue(mockPromptAdapter),
      };

      const mockDbSet = vi.fn();
      mockedSecureStore.mockImplementation(function () {
        return { get: vi.fn(), set: mockDbSet, delete: vi.fn() } as any;
      });

      const tokens = await collectTokens(["npm"], mockTask as any);

      expect(tokens).toEqual({ npm: "good-token" });
      expect(mockPromptAdapter.run).toHaveBeenCalledTimes(2);
      expect(mockDbSet).toHaveBeenCalledWith("npm-token", "good-token");
    });

    it("propagates network errors from validateToken", async () => {
      mockedLoadTokens.mockReturnValue({ npm: "some-token" });
      npmDescriptor.validateToken = vi
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED"));

      const mockTask = {
        output: "",
        prompt: vi.fn(),
      };

      await expect(collectTokens(["npm"], mockTask as any)).rejects.toThrow(
        "ECONNREFUSED",
      );
    });
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
