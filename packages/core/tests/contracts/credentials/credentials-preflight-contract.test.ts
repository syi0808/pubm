import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginCredential } from "../../../src/plugin/types.js";

const contractState = vi.hoisted(() => {
  const store = new Map<string, string>();
  const syncHashes = new Map<string, string>();
  const ledger: {
    kind: string;
    target: string;
    detail?: Record<string, unknown>;
  }[] = [];

  return {
    store,
    syncHashes,
    ledger,
    reset() {
      store.clear();
      syncHashes.clear();
      ledger.length = 0;
    },
  };
});

vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: class MockSecureStore {
    get(field: string): string | null {
      contractState.ledger.push({ kind: "secureStore.get", target: field });
      return contractState.store.get(field) ?? null;
    }

    set(field: string, value: unknown): void {
      contractState.ledger.push({ kind: "secureStore.set", target: field });
      contractState.store.set(field, `${value}`);
    }

    delete(field: string): void {
      contractState.ledger.push({ kind: "secureStore.delete", target: field });
      contractState.store.delete(field);
    }
  },
}));

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(async (cmd: string, args: string[]) => {
    const redactedArgs = args.map((arg, index) =>
      args[index - 1] === "--body" ? "<redacted>" : arg,
    );
    contractState.ledger.push({
      kind: "command.exec",
      target: [cmd, ...redactedArgs].join(" "),
      detail: {
        command: cmd,
        secretName:
          cmd === "gh" && args[0] === "secret" && args[1] === "set"
            ? args[2]
            : undefined,
      },
    });
    return { stdout: "contract-user\n", stderr: "", exitCode: 0 };
  }),
}));

vi.mock("../../../src/utils/gh-secrets-sync-state.js", () => ({
  readGhSecretsSyncHash: vi.fn((repoSlug: string) => {
    contractState.ledger.push({
      kind: "ghSecretsSync.read",
      target: repoSlug,
    });
    return contractState.syncHashes.get(repoSlug) ?? null;
  }),
  writeGhSecretsSyncHash: vi.fn((repoSlug: string, hash: string) => {
    contractState.ledger.push({
      kind: "ghSecretsSync.write",
      target: repoSlug,
      detail: { hash },
    });
    contractState.syncHashes.set(repoSlug, hash);
  }),
}));

import { registryCatalog } from "../../../src/registry/catalog.js";
import {
  collectPluginCredentials,
  collectTokens,
  promptGhSecretsSync,
  syncGhSecrets,
} from "../../../src/tasks/preflight.js";
import {
  injectPluginTokensToEnv,
  injectTokensToEnv,
} from "../../../src/utils/token.js";

const managedEnvVars = [
  "NODE_AUTH_TOKEN",
  "npm_config_//registry.npmjs.org/:_authToken",
  "JSR_TOKEN",
  "CARGO_REGISTRY_TOKEN",
  "CONTRACT_PLUGIN_TOKEN",
  "CONTRACT_REQUIRED_TOKEN",
  "CONTRACT_EXISTING_PLUGIN_TOKEN",
] as const;

const savedEnv = new Map<string, string | undefined>();

function restoreManagedEnv(): void {
  for (const key of managedEnvVars) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearManagedEnv(): void {
  savedEnv.clear();
  for (const key of managedEnvVars) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
}

function makeTask(promptResponses: unknown[] = []) {
  return {
    output: "",
    title: "",
    prompt: vi.fn(() => ({
      run: vi.fn(async (options: { message?: string }) => {
        const response = promptResponses.shift();
        contractState.ledger.push({
          kind: "prompt.requested",
          target: options.message ?? "",
          detail: { response },
        });
        return response;
      }),
    })),
  };
}

async function withoutTokenValidation<T>(
  registries: string[],
  run: () => Promise<T>,
): Promise<T> {
  const originals = registries.map((key) => {
    const descriptor = registryCatalog.get(key);
    const validateToken = descriptor?.validateToken;
    if (descriptor) descriptor.validateToken = undefined;
    return { descriptor, validateToken };
  });

  try {
    return await run();
  } finally {
    for (const { descriptor, validateToken } of originals) {
      if (descriptor) descriptor.validateToken = validateToken;
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  contractState.reset();
  clearManagedEnv();
});

afterEach(() => {
  restoreManagedEnv();
});

describe("credentials/preflight contract", () => {
  it("collects registry tokens with env precedence over stored tokens and registry filtering", async () => {
    process.env.NODE_AUTH_TOKEN = "env-npm-token";
    contractState.store.set("npm-token", "stored-npm-token");
    contractState.store.set("jsr-token", "stored-jsr-token");
    contractState.store.set("cargo-token", "stored-cargo-token");

    const task = makeTask();

    const tokens = await withoutTokenValidation(["npm", "jsr"], () =>
      collectTokens(["npm", "jsr"], task),
    );

    expect(tokens).toEqual({
      npm: "env-npm-token",
      jsr: "stored-jsr-token",
    });
    expect(task.prompt).not.toHaveBeenCalled();
    expect(contractState.ledger).toEqual([
      { kind: "secureStore.get", target: "jsr-token" },
    ]);
  });

  it("restores registry and plugin environment variables through cleanup callbacks", () => {
    process.env.NODE_AUTH_TOKEN = "original-npm-token";
    process.env.CONTRACT_EXISTING_PLUGIN_TOKEN = "original-plugin-token";

    const registryCleanup = injectTokensToEnv({
      npm: "injected-npm-token",
      jsr: "injected-jsr-token",
    });
    const pluginCleanup = injectPluginTokensToEnv(
      {
        "contract-plugin-token": "injected-plugin-token",
        "existing-plugin-token": "updated-plugin-token",
      },
      [
        {
          key: "contract-plugin-token",
          env: "CONTRACT_PLUGIN_TOKEN",
          label: "Contract Plugin Token",
        },
        {
          key: "existing-plugin-token",
          env: "CONTRACT_EXISTING_PLUGIN_TOKEN",
          label: "Existing Plugin Token",
        },
      ],
    );

    expect(process.env.NODE_AUTH_TOKEN).toBe("injected-npm-token");
    expect(process.env["npm_config_//registry.npmjs.org/:_authToken"]).toBe(
      "injected-npm-token",
    );
    expect(process.env.JSR_TOKEN).toBe("injected-jsr-token");
    expect(process.env.CONTRACT_PLUGIN_TOKEN).toBe("injected-plugin-token");
    expect(process.env.CONTRACT_EXISTING_PLUGIN_TOKEN).toBe(
      "updated-plugin-token",
    );

    pluginCleanup();
    registryCleanup();

    expect(process.env.NODE_AUTH_TOKEN).toBe("original-npm-token");
    expect(
      process.env["npm_config_//registry.npmjs.org/:_authToken"],
    ).toBeUndefined();
    expect(process.env.JSR_TOKEN).toBeUndefined();
    expect(process.env.CONTRACT_PLUGIN_TOKEN).toBeUndefined();
    expect(process.env.CONTRACT_EXISTING_PLUGIN_TOKEN).toBe(
      "original-plugin-token",
    );
  });

  it("fails required plugin credentials in non-interactive preflight without prompting", async () => {
    const credentials: PluginCredential[] = [
      {
        key: "contract-required-token",
        env: "CONTRACT_REQUIRED_TOKEN",
        label: "Contract Required Token",
        required: true,
      },
    ];
    const task = makeTask(["should-not-be-used"]);

    await expect(
      collectPluginCredentials(credentials, false, task),
    ).rejects.toThrow("Contract Required Token");

    expect(task.prompt).not.toHaveBeenCalled();
    expect(contractState.ledger).toEqual([
      { kind: "secureStore.get", target: "contract-required-token" },
    ]);
  });

  it("syncs only the registry and plugin secrets supplied to the GitHub boundary", async () => {
    await syncGhSecrets({ npm: "npm-token" }, [
      { secretName: "CONTRACT_PLUGIN_TOKEN", token: "plugin-token" },
    ]);

    expect(
      contractState.ledger
        .filter((entry) => entry.kind === "command.exec")
        .map((entry) => entry.target),
    ).toEqual([
      "gh secret set NODE_AUTH_TOKEN --body <redacted>",
      "gh secret set CONTRACT_PLUGIN_TOKEN --body <redacted>",
    ]);
    expect(
      contractState.ledger.some((entry) => entry.target.includes("JSR_TOKEN")),
    ).toBe(false);
  });

  it("persists the GitHub secret sync hash and skips repeated gh execution for the same semantic secret set", async () => {
    const task = makeTask([true]);
    const tokens = {
      npm: "npm-token",
      jsr: "jsr-token",
    };
    const pluginSecrets = [
      {
        secretName: "CONTRACT_PLUGIN_TOKEN",
        token: "plugin-token",
      },
    ];

    await promptGhSecretsSync(tokens, task, pluginSecrets, "owner/repo");

    const storedHash = contractState.syncHashes.get("owner/repo");
    expect(storedHash).toMatch(/^[a-f0-9]{16}$/);
    expect(
      contractState.ledger
        .filter((entry) => entry.kind === "command.exec")
        .map((entry) => entry.target),
    ).toEqual([
      "gh secret set NODE_AUTH_TOKEN --body <redacted>",
      "gh secret set JSR_TOKEN --body <redacted>",
      "gh secret set CONTRACT_PLUGIN_TOKEN --body <redacted>",
    ]);
    expect(task.prompt).toHaveBeenCalledTimes(1);

    await promptGhSecretsSync(tokens, task, pluginSecrets, "owner/repo");

    expect(task.prompt).toHaveBeenCalledTimes(1);
    expect(
      contractState.ledger.filter((entry) => entry.kind === "command.exec"),
    ).toHaveLength(3);
    expect(
      contractState.ledger.filter(
        (entry) => entry.kind === "ghSecretsSync.write",
      ),
    ).toHaveLength(1);
  });
});
