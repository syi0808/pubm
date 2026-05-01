import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../../src/context.js";
import {
  type CleanupRef,
  runCiPreparePreflight,
  runCiPublishPluginCreds,
  runLocalPreflight,
} from "../../../../src/workflow/release-phases/preflight.js";

const preflightState = vi.hoisted(() => ({
  credentials: [] as Array<{
    key: string;
    ghSecretName?: string;
  }>,
  registries: new Map<string, { requiresEarlyAuth?: boolean }>(),
  checks: [] as string[],
  checkPromptFlags: [] as boolean[],
  cleanupCalls: [] as string[],
  collectedTokenPromptFlags: [] as boolean[],
  collectedPluginPromptFlags: [] as boolean[],
  secretSyncPromptFlags: [] as boolean[],
  jsr: { token: undefined as string | undefined },
}));

vi.mock("../../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../../src/workflow/release-operation.js", () => ({
  runReleaseOperations: vi.fn(async (ctx: PubmContext, operations: any) => {
    const operationList = Array.isArray(operations) ? operations : [operations];
    for (const operation of operationList) {
      await operation.run?.(ctx, {
        title: operation.title ?? "",
        output: "",
        prompt: () => ({ run: vi.fn() }),
        runOperations: vi.fn(),
        runTasks: vi.fn(),
        skip: vi.fn(),
      });
    }
  }),
}));

vi.mock("../../../../src/git.js", () => ({
  Git: class MockGit {
    async repository(): Promise<string> {
      return "https://github.com/acme/repo.git";
    }
  },
}));

vi.mock("../../../../src/registry/jsr.js", () => ({
  JsrClient: preflightState.jsr,
}));

vi.mock("../../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn((key: string) => preflightState.registries.get(key)),
  },
}));

vi.mock("../../../../src/tasks/preflight.js", () => ({
  collectTokens: vi.fn(
    async (registries: string[], _task, promptEnabled: boolean) => {
      preflightState.collectedTokenPromptFlags.push(promptEnabled);
      return Object.fromEntries(registries.map((key) => [key, `${key}-token`]));
    },
  ),
  collectPluginCredentials: vi.fn(async (_creds, promptEnabled: boolean) => {
    preflightState.collectedPluginPromptFlags.push(promptEnabled);
    return Object.fromEntries(
      preflightState.credentials.map((cred) => [cred.key, `${cred.key}-token`]),
    );
  }),
  promptGhSecretsSync: vi.fn(
    async (_tokens, _task, _pluginSecrets, _repoSlug, promptEnabled) => {
      preflightState.secretSyncPromptFlags.push(promptEnabled);
    },
  ),
}));

vi.mock("../../../../src/utils/token.js", () => ({
  injectTokensToEnv: vi.fn((tokens: Record<string, string>) => {
    preflightState.cleanupCalls.push(`inject:${Object.keys(tokens).join(",")}`);
    return () => preflightState.cleanupCalls.push("cleanup:tokens");
  }),
  injectPluginTokensToEnv: vi.fn((tokens: Record<string, string>) => {
    preflightState.cleanupCalls.push(
      `inject-plugin:${Object.keys(tokens).join(",")}`,
    );
    return () => preflightState.cleanupCalls.push("cleanup:plugins");
  }),
}));

vi.mock("../../../../src/workflow/release-phases/preflight-checks.js", () => ({
  createPrerequisitesCheckOperation: vi.fn(() => ({
    title: "prerequisites",
    run: async (ctx: PubmContext) => {
      preflightState.checks.push("prerequisites");
      preflightState.checkPromptFlags.push(ctx.runtime.promptEnabled);
    },
  })),
  createRequiredConditionsCheckOperation: vi.fn(() => ({
    title: "conditions",
    run: async (ctx: PubmContext) => {
      preflightState.checks.push("conditions");
      preflightState.checkPromptFlags.push(ctx.runtime.promptEnabled);
    },
  })),
}));

function createContext(
  overrides: {
    promptEnabled?: boolean;
    registries?: string[];
    credentials?: typeof preflightState.credentials;
  } = {},
): PubmContext {
  preflightState.credentials = overrides.credentials ?? [];
  return {
    cwd: "/repo",
    options: {
      skipConditionsCheck: false,
      skipPrerequisitesCheck: false,
    },
    config: {
      packages: [
        {
          ecosystem: "js",
          name: "pkg",
          path: ".",
          registries: overrides.registries ?? ["npm", "jsr"],
        },
      ],
    },
    runtime: {
      cleanWorkingTree: true,
      pluginRunner: {
        collectCredentials: vi.fn(() => preflightState.credentials),
      } as unknown as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: overrides.promptEnabled ?? true,
      rollback: {
        add: vi.fn(),
      } as unknown as PubmContext["runtime"]["rollback"],
      tag: "latest",
    },
  } as PubmContext;
}

function chainCleanup(
  existing: (() => void) | undefined,
  next: () => void,
): () => void {
  return () => {
    existing?.();
    next();
  };
}

beforeEach(() => {
  preflightState.credentials = [];
  preflightState.registries.clear();
  preflightState.registries.set("jsr", { requiresEarlyAuth: true });
  preflightState.registries.set("npm", {});
  preflightState.checks = [];
  preflightState.checkPromptFlags = [];
  preflightState.cleanupCalls = [];
  preflightState.collectedTokenPromptFlags = [];
  preflightState.collectedPluginPromptFlags = [];
  preflightState.secretSyncPromptFlags = [];
  preflightState.jsr.token = undefined;
});

describe("workflow preflight phases", () => {
  it("collects CI prepare tokens with prompts, then runs checks noninteractively", async () => {
    const ctx = createContext({
      credentials: [{ key: "brew", ghSecretName: "BREW_TOKEN" }],
    });
    const cleanupRef: CleanupRef = { current: undefined };

    await runCiPreparePreflight(ctx, chainCleanup, cleanupRef);

    expect(ctx.runtime.promptEnabled).toBe(false);
    expect(ctx.runtime.pluginTokens).toEqual({ brew: "brew-token" });
    expect(preflightState.cleanupCalls).toEqual([
      "inject:npm,jsr",
      "inject-plugin:brew",
    ]);
    expect(preflightState.collectedTokenPromptFlags).toEqual([true]);
    expect(preflightState.collectedPluginPromptFlags).toEqual([true]);
    expect(preflightState.secretSyncPromptFlags).toEqual([true]);
    expect(preflightState.checks).toEqual(["prerequisites", "conditions"]);
    expect(preflightState.checkPromptFlags).toEqual([false, false]);

    cleanupRef.current?.();
    expect(preflightState.cleanupCalls).toContain("cleanup:tokens");
    expect(preflightState.cleanupCalls).toContain("cleanup:plugins");
  });

  it("keeps CI prepare prerequisite and condition checks noninteractive when prompts start disabled", async () => {
    const ctx = createContext({
      promptEnabled: false,
      credentials: [{ key: "brew", ghSecretName: "BREW_TOKEN" }],
    });
    const cleanupRef: CleanupRef = { current: undefined };

    await runCiPreparePreflight(ctx, chainCleanup, cleanupRef);

    expect(ctx.runtime.promptEnabled).toBe(false);
    expect(preflightState.collectedTokenPromptFlags).toEqual([false]);
    expect(preflightState.collectedPluginPromptFlags).toEqual([false]);
    expect(preflightState.secretSyncPromptFlags).toEqual([false]);
    expect(preflightState.checks).toEqual(["prerequisites", "conditions"]);
    expect(preflightState.checkPromptFlags).toEqual([false, false]);
  });

  it("collects early auth tokens and plugin credentials during local preflight", async () => {
    const ctx = createContext({
      promptEnabled: true,
      credentials: [{ key: "brew" }],
    });
    const cleanupRef: CleanupRef = { current: undefined };

    await runLocalPreflight(ctx, chainCleanup, cleanupRef);

    expect(preflightState.jsr.token).toBe("jsr-token");
    expect(ctx.runtime.pluginTokens).toEqual({ brew: "brew-token" });
    expect(preflightState.collectedPluginPromptFlags).toEqual([true]);
    expect(preflightState.checks).toEqual(["prerequisites", "conditions"]);
  });

  it("skips local early auth when prompts are disabled", async () => {
    const ctx = createContext({ promptEnabled: false, credentials: [] });
    const cleanupRef: CleanupRef = { current: undefined };

    await runLocalPreflight(ctx, chainCleanup, cleanupRef);

    expect(preflightState.jsr.token).toBeUndefined();
    expect(preflightState.cleanupCalls).toEqual([]);
    expect(preflightState.checks).toEqual(["prerequisites", "conditions"]);
  });

  it("collects plugin credentials for CI publish without prompting", async () => {
    const ctx = createContext({
      credentials: [{ key: "brew", ghSecretName: "BREW_TOKEN" }],
    });
    const cleanupRef: CleanupRef = { current: undefined };

    await runCiPublishPluginCreds(ctx, chainCleanup, cleanupRef);

    expect(ctx.runtime.pluginTokens).toEqual({ brew: "brew-token" });
    expect(preflightState.collectedPluginPromptFlags).toEqual([false]);
    expect(preflightState.cleanupCalls).toEqual(["inject-plugin:brew"]);
  });

  it("does nothing for CI publish when there are no plugin credentials", async () => {
    const ctx = createContext({ credentials: [] });
    const cleanupRef: CleanupRef = { current: undefined };

    await runCiPublishPluginCreds(ctx, chainCleanup, cleanupRef);

    expect(ctx.runtime.pluginTokens).toBeUndefined();
    expect(preflightState.cleanupCalls).toEqual([]);
  });
});
