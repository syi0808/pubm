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

import type { PluginCredential } from "../../../src/plugin/types.js";
import { registryCatalog } from "../../../src/registry/catalog.js";
import {
  collectPluginCredentials,
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

  it("syncs plugin secrets using secretName/token pairs", async () => {
    mockedExec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    } as any);

    await syncGhSecrets({}, [
      { secretName: "MY_PLUGIN_SECRET", token: "plugin-token-123" },
    ]);

    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "MY_PLUGIN_SECRET", "--body", "plugin-token-123"],
      { throwOnError: true },
    );
  });

  it("syncs both registry and plugin secrets", async () => {
    mockedExec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    } as any);

    await syncGhSecrets({ npm: "npm-token" }, [
      { secretName: "PLUGIN_TOKEN", token: "plugin-val" },
    ]);

    // npm registry secret
    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "NODE_AUTH_TOKEN", "--body", "npm-token"],
      { throwOnError: true },
    );
    // plugin secret
    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "PLUGIN_TOKEN", "--body", "plugin-val"],
      { throwOnError: true },
    );
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
    const pluginSorted: unknown[] = [];
    const hash = createHash("sha256")
      .update(JSON.stringify({ v: 2, sorted, pluginSorted }))
      .digest("hex")
      .slice(0, 16);

    mockedReadGhSecretsSyncHash.mockReturnValue(hash);

    const mockTask = { output: "", prompt: vi.fn() };
    await promptGhSecretsSync(tokens, mockTask, [], "owner/repo");

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

    await promptGhSecretsSync({ npm: "tok-new" }, mockTask, [], "owner/repo");

    expect(mockTask.prompt).toHaveBeenCalled();
    expect(mockedExec).toHaveBeenCalled();
    expect(mockedWriteGhSecretsSyncHash).toHaveBeenCalledWith(
      "owner/repo",
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

    await promptGhSecretsSync({ npm: "tok-1" }, mockTask, [], "owner/repo");

    expect(mockedExec).not.toHaveBeenCalled();
    expect(mockedWriteGhSecretsSyncHash).toHaveBeenCalledWith(
      "owner/repo",
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
      promptGhSecretsSync({ npm: "tok-1" }, mockTask, [], "owner/repo"),
    ).rejects.toThrow("Failed to save GitHub Secrets sync state.");
  });
});

describe("collectPluginCredentials", () => {
  const makePluginTask = () => ({
    output: "",
    title: "",
    prompt: vi.fn().mockReturnValue({
      run: vi.fn().mockResolvedValue("prompted-token"),
    }),
  });

  it("resolves from env var", async () => {
    process.env.TEST_PLUGIN_TOKEN = "env-token";
    const credentials: PluginCredential[] = [
      { key: "test-key", env: "TEST_PLUGIN_TOKEN", label: "Test Token" },
    ];

    const result = await collectPluginCredentials(
      credentials,
      true,
      makePluginTask() as any,
    );

    expect(result).toEqual({ "test-key": "env-token" });
    delete process.env.TEST_PLUGIN_TOKEN;
  });

  it("resolves from custom resolver before keyring", async () => {
    const credentials: PluginCredential[] = [
      {
        key: "test-key",
        env: "NONEXISTENT_VAR_1",
        label: "Test Token",
        resolve: vi.fn().mockResolvedValue("resolved-token"),
      },
    ];

    const result = await collectPluginCredentials(
      credentials,
      true,
      makePluginTask() as any,
    );

    expect(result).toEqual({ "test-key": "resolved-token" });
    expect(credentials[0].resolve).toHaveBeenCalled();
  });

  it("resolves from keyring when env and resolver return null", async () => {
    const mockStore = {
      get: vi.fn().mockReturnValue("keyring-token"),
      set: vi.fn(),
      delete: vi.fn(),
    };
    mockedSecureStore.mockImplementation(function () {
      return mockStore as any;
    });

    const credentials: PluginCredential[] = [
      { key: "test-key", env: "NONEXISTENT_VAR_2", label: "Test Token" },
    ];

    const result = await collectPluginCredentials(
      credentials,
      true,
      makePluginTask() as any,
    );

    expect(result).toEqual({ "test-key": "keyring-token" });
  });

  it("prompts when all sources return null and promptEnabled is true", async () => {
    mockedSecureStore.mockImplementation(function () {
      return {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
        delete: vi.fn(),
      } as any;
    });

    const task = makePluginTask();
    const credentials: PluginCredential[] = [
      { key: "test-key", env: "NONEXISTENT_VAR_3", label: "Test Token" },
    ];

    const result = await collectPluginCredentials(
      credentials,
      true,
      task as any,
    );

    expect(result).toEqual({ "test-key": "prompted-token" });
  });

  it("throws for required credential when prompt is disabled (CI)", async () => {
    mockedSecureStore.mockImplementation(function () {
      return {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
        delete: vi.fn(),
      } as any;
    });

    const credentials: PluginCredential[] = [
      {
        key: "test-key",
        env: "NONEXISTENT_VAR_4",
        label: "Test Token",
        required: true,
      },
    ];

    await expect(
      collectPluginCredentials(credentials, false, makePluginTask() as any),
    ).rejects.toThrow("Test Token");
  });

  it("skips optional credential when not available", async () => {
    mockedSecureStore.mockImplementation(function () {
      return {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
        delete: vi.fn(),
      } as any;
    });

    const credentials: PluginCredential[] = [
      {
        key: "test-key",
        env: "NONEXISTENT_VAR_5",
        label: "Test Token",
        required: false,
      },
    ];

    const result = await collectPluginCredentials(
      credentials,
      false,
      makePluginTask() as any,
    );

    expect(result).toEqual({});
  });

  it("throws when env token fails validation", async () => {
    process.env.TEST_PLUGIN_TOKEN_INVALID = "bad-token";
    const credentials: PluginCredential[] = [
      {
        key: "test-key",
        env: "TEST_PLUGIN_TOKEN_INVALID",
        label: "Test Token",
        validate: vi.fn().mockResolvedValue(false),
      },
    ];

    await expect(
      collectPluginCredentials(credentials, true, makePluginTask() as any),
    ).rejects.toThrow("TEST_PLUGIN_TOKEN_INVALID is set but invalid");

    expect(credentials[0].validate).toHaveBeenCalledWith(
      "bad-token",
      expect.any(Object),
    );
    delete process.env.TEST_PLUGIN_TOKEN_INVALID;
  });

  it("validates token and saves to SecureStore on success", async () => {
    const mockStore = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      delete: vi.fn(),
    };
    mockedSecureStore.mockImplementation(function () {
      return mockStore as any;
    });

    const task = makePluginTask();
    const credentials: PluginCredential[] = [
      {
        key: "test-key",
        env: "NONEXISTENT_VAR_6",
        label: "Test Token",
        validate: vi.fn().mockResolvedValue(true),
      },
    ];

    await collectPluginCredentials(credentials, true, task as any);

    expect(credentials[0].validate).toHaveBeenCalled();
    expect(mockStore.set).toHaveBeenCalledWith("test-key", "prompted-token");
  });
});
