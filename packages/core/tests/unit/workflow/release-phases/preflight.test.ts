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
  cleanupCalls: [] as string[],
  collectedPluginPromptFlags: [] as boolean[],
  jsr: { token: undefined as string | undefined },
}));

vi.mock("../../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
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
  collectTokens: vi.fn(async (registries: string[]) =>
    Object.fromEntries(registries.map((key) => [key, `${key}-token`])),
  ),
  collectPluginCredentials: vi.fn(async (_creds, promptEnabled: boolean) => {
    preflightState.collectedPluginPromptFlags.push(promptEnabled);
    return Object.fromEntries(
      preflightState.credentials.map((cred) => [cred.key, `${cred.key}-token`]),
    );
  }),
  promptGhSecretsSync: vi.fn(async () => undefined),
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
    run: async () => {
      preflightState.checks.push("prerequisites");
    },
  })),
  createRequiredConditionsCheckOperation: vi.fn(() => ({
    title: "conditions",
    run: async () => {
      preflightState.checks.push("conditions");
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
  preflightState.cleanupCalls = [];
  preflightState.collectedPluginPromptFlags = [];
  preflightState.jsr.token = undefined;
});

describe("workflow preflight phases", () => {
  it("collects CI prepare tokens, syncs GitHub secrets, and disables prompts", async () => {
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
    expect(preflightState.checks).toEqual(["prerequisites", "conditions"]);

    cleanupRef.current?.();
    expect(preflightState.cleanupCalls).toContain("cleanup:tokens");
    expect(preflightState.cleanupCalls).toContain("cleanup:plugins");
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
