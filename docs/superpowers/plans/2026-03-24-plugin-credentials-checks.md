# Plugin Credentials & Checks Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable plugins to declare credentials and preflight checks, so the brew plugin can request a PAT for external repo access via the existing token collection pipeline.

**Architecture:** Extend `PubmPlugin` with `credentials` and `checks` fields. Plugin credentials flow through `collectPluginCredentials()` (env → resolve → keyring → prompt) and are stored in `ctx.runtime.pluginTokens`. Plugin checks are appended to existing prerequisite/condition task lists. Brew plugin uses the collected PAT for git push / gh pr create.

**Tech Stack:** TypeScript, vitest, listr2, @napi-rs/keyring (SecureStore)

**Spec:** `docs/superpowers/specs/2026-03-24-plugin-credentials-checks-design.md`

---

## File Structure

### Core (packages/core)

| File | Responsibility |
|------|---------------|
| `src/plugin/types.ts` | `PluginTaskContext`, `PluginCredential`, `PluginCheck` type definitions; `PubmPlugin` extension |
| `src/plugin/runner.ts` | `collectCredentials()`, `collectChecks()` methods on `PluginRunner` |
| `src/plugin/index.ts` | Re-export new types |
| `src/plugin/wrap-task-context.ts` | **New** — `wrapTaskContext()` adapter from listr2 to `PluginTaskContext` |
| `src/context.ts` | `pluginTokens` field on `PubmContext.runtime` |
| `src/tasks/preflight.ts` | `collectPluginCredentials()` function; `syncGhSecrets()` generalization |
| `src/utils/token.ts` | `injectPluginTokensToEnv()` function |
| `src/tasks/prerequisites-check.ts` | Append plugin checks |
| `src/tasks/required-conditions-check.ts` | Append plugin checks |
| `src/tasks/runner.ts` | Integrate `collectPluginCredentials` into 3 flows |
| `src/index.ts` | Export new types |

### Brew Plugin (packages/plugins/plugin-brew)

| File | Responsibility |
|------|---------------|
| `src/brew-tap.ts` | Add `credentials`, `checks`; use `pluginTokens` instead of `resolveGitHubToken()` |
| `src/brew-core.ts` | Add `credentials`, `checks`; use `pluginTokens` for clone URL + `GH_TOKEN` |

### Tests

| File | Responsibility |
|------|---------------|
| `packages/core/tests/unit/plugin/runner.test.ts` | Tests for `collectCredentials()` (dedup) and `collectChecks()` |
| `packages/core/tests/unit/plugin/wrap-task-context.test.ts` | **New** — `wrapTaskContext()` tests |
| `packages/core/tests/unit/tasks/preflight.test.ts` | Tests for `collectPluginCredentials()` |
| `packages/core/tests/unit/tasks/prerequisites-check.test.ts` | Plugin checks integration |
| `packages/core/tests/unit/tasks/required-conditions-check.test.ts` | Plugin checks integration |
| `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts` | Credential declaration, PAT injection |
| `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts` | Credential declaration, PAT injection |

---

## Task 1: Plugin Type Definitions

**Files:**
- Modify: `packages/core/src/plugin/types.ts:61-67`
- Modify: `packages/core/src/plugin/index.ts:1-12`
- Modify: `packages/core/src/index.ts:121-130`

- [ ] **Step 1: Add `PluginTaskContext`, `PluginCredential`, `PluginCheck` types to `types.ts`**

Add before the `PubmPlugin` interface (after line 59):

```typescript
export interface PluginTaskContext {
  /** Display status message on the current task */
  output: string;
  /** Modify task title */
  title: string;
  /** Run an enquirer prompt */
  prompt<T = unknown>(options: {
    type: string;
    message: string;
    [key: string]: unknown;
  }): Promise<T>;
}

export interface PluginCredential {
  /** SecureStore storage key (e.g. "brew-github-token") */
  key: string;
  /** Environment variable name (e.g. "PUBM_BREW_GITHUB_TOKEN") */
  env: string;
  /** Prompt display label (e.g. "GitHub PAT for Homebrew tap") */
  label: string;
  /** Token generation URL for user guidance */
  tokenUrl?: string;
  /** Display text for the token URL */
  tokenUrlLabel?: string;
  /** GitHub Secrets key name for sync */
  ghSecretName?: string;
  /** If false, collection failure is skipped (default: true) */
  required?: boolean;
  /** Custom resolver tried after env, before keyring */
  resolve?: () => Promise<string | null>;
  /** Token validation function */
  validate?: (
    token: string,
    task: PluginTaskContext,
  ) => Promise<boolean>;
}

export interface PluginCheck {
  /** Check display title */
  title: string;
  /** Which preflight phase to insert into */
  phase: "prerequisites" | "conditions";
  /** Check logic */
  task: (ctx: PubmContext, task: PluginTaskContext) => Promise<void>;
}
```

- [ ] **Step 2: Add `credentials` and `checks` to `PubmPlugin` interface**

Modify the `PubmPlugin` interface in `types.ts` (lines 61-67):

```typescript
export interface PubmPlugin {
  name: string;
  registries?: PackageRegistry[];
  ecosystems?: Ecosystem[];
  hooks?: PluginHooks;
  commands?: PluginCommand[];
  /** Declare credentials this plugin needs */
  credentials?: (ctx: PubmContext) => PluginCredential[];
  /** Declare preflight checks this plugin adds */
  checks?: (ctx: PubmContext) => PluginCheck[];
}
```

- [ ] **Step 3: Re-export new types from `plugin/index.ts`**

Add to the type export list in `packages/core/src/plugin/index.ts`:

```typescript
export type {
  AfterReleaseHookFn,
  ErrorHookFn,
  HookFn,
  HookName,
  PluginCheck,
  PluginCommand,
  PluginCommandOption,
  PluginCredential,
  PluginHooks,
  PluginSubcommand,
  PluginTaskContext,
  PubmPlugin,
} from "./types.js";
```

- [ ] **Step 4: Re-export from `core/src/index.ts`**

Update the plugin type re-export block (lines 121-130) to include the new types:

```typescript
export type {
  AfterReleaseHookFn,
  ErrorHookFn,
  HookFn,
  HookName,
  PluginCheck,
  PluginCommand,
  PluginCommandOption,
  PluginCredential,
  PluginHooks,
  PluginSubcommand,
  PluginTaskContext,
  PubmPlugin,
} from "./plugin/index.js";
```

- [ ] **Step 5: Add `pluginTokens` to context type**

In `packages/core/src/context.ts`, add to the `runtime` interface (after line 75):

```typescript
  pluginTokens?: Record<string, string>;
```

- [ ] **Step 6: Run typecheck**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: PASS (types only, no implementation yet)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plugin/types.ts packages/core/src/plugin/index.ts packages/core/src/index.ts packages/core/src/context.ts
git commit -m "feat(core): add PluginCredential, PluginCheck, PluginTaskContext types"
```

---

## Task 2: `wrapTaskContext` Adapter

**Files:**
- Create: `packages/core/src/plugin/wrap-task-context.ts`
- Create: `packages/core/tests/unit/plugin/wrap-task-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/unit/plugin/wrap-task-context.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { wrapTaskContext } from "../../../src/plugin/wrap-task-context.js";

function makeMockListrTask() {
  const promptRun = vi.fn();
  return {
    _output: "",
    get output() {
      return this._output;
    },
    set output(v: string) {
      this._output = v;
    },
    _title: "Original title",
    get title() {
      return this._title;
    },
    set title(v: string) {
      this._title = v;
    },
    prompt: vi.fn().mockReturnValue({ run: promptRun }),
    _promptRun: promptRun,
  };
}

describe("wrapTaskContext", () => {
  it("proxies output getter/setter", () => {
    const mock = makeMockListrTask();
    const ctx = wrapTaskContext(mock as any);

    ctx.output = "hello";
    expect(mock.output).toBe("hello");
    expect(ctx.output).toBe("hello");
  });

  it("proxies title getter/setter", () => {
    const mock = makeMockListrTask();
    const ctx = wrapTaskContext(mock as any);

    ctx.title = "New title";
    expect(mock.title).toBe("New title");
    expect(ctx.title).toBe("New title");
  });

  it("delegates prompt to listr2 prompt adapter", async () => {
    const mock = makeMockListrTask();
    mock._promptRun.mockResolvedValue("user-input");
    const ctx = wrapTaskContext(mock as any);

    const result = await ctx.prompt({ type: "password", message: "Enter token" });

    expect(mock.prompt).toHaveBeenCalled();
    expect(mock._promptRun).toHaveBeenCalledWith({
      type: "password",
      message: "Enter token",
    });
    expect(result).toBe("user-input");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bunx vitest --run tests/unit/plugin/wrap-task-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `packages/core/src/plugin/wrap-task-context.ts`:

```typescript
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { PluginTaskContext } from "./types.js";

/**
 * Wraps a listr2 TaskWrapper into the plugin-facing PluginTaskContext,
 * so plugins do not depend on listr2 internals.
 */
// biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
export function wrapTaskContext(listrTask: any): PluginTaskContext {
  return {
    get output() {
      return listrTask.output as string;
    },
    set output(v: string) {
      listrTask.output = v;
    },
    get title() {
      return listrTask.title as string;
    },
    set title(v: string) {
      listrTask.title = v;
    },
    prompt: (options) =>
      listrTask.prompt(ListrEnquirerPromptAdapter).run(options),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bunx vitest --run tests/unit/plugin/wrap-task-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugin/wrap-task-context.ts packages/core/tests/unit/plugin/wrap-task-context.test.ts
git commit -m "feat(core): add wrapTaskContext adapter for plugin-facing API"
```

---

## Task 3: `PluginRunner.collectCredentials()` and `collectChecks()`

**Files:**
- Modify: `packages/core/src/plugin/runner.ts:16-57`
- Modify: `packages/core/tests/unit/plugin/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/unit/plugin/runner.test.ts`:

```typescript
describe("collectCredentials", () => {
  it("collects credentials from all plugins", () => {
    const plugin1: PubmPlugin = {
      name: "plugin-1",
      credentials: () => [
        { key: "token-a", env: "TOKEN_A", label: "Token A" },
      ],
    };
    const plugin2: PubmPlugin = {
      name: "plugin-2",
      credentials: () => [
        { key: "token-b", env: "TOKEN_B", label: "Token B" },
      ],
    };

    const runner = new PluginRunner([plugin1, plugin2]);
    const creds = runner.collectCredentials(makeCtx());

    expect(creds).toHaveLength(2);
    expect(creds[0].key).toBe("token-a");
    expect(creds[1].key).toBe("token-b");
  });

  it("deduplicates by key (first-wins)", () => {
    const plugin1: PubmPlugin = {
      name: "plugin-1",
      credentials: () => [
        { key: "shared", env: "SHARED_TOKEN", label: "From plugin 1" },
      ],
    };
    const plugin2: PubmPlugin = {
      name: "plugin-2",
      credentials: () => [
        { key: "shared", env: "SHARED_TOKEN", label: "From plugin 2" },
      ],
    };

    const runner = new PluginRunner([plugin1, plugin2]);
    const creds = runner.collectCredentials(makeCtx());

    expect(creds).toHaveLength(1);
    expect(creds[0].label).toBe("From plugin 1");
  });

  it("returns empty array when no plugins have credentials", () => {
    const plugin: PubmPlugin = { name: "no-creds" };
    const runner = new PluginRunner([plugin]);

    expect(runner.collectCredentials(makeCtx())).toEqual([]);
  });
});

describe("collectChecks", () => {
  it("collects checks filtered by phase", () => {
    const plugin: PubmPlugin = {
      name: "check-plugin",
      checks: () => [
        { title: "Pre check", phase: "prerequisites" as const, task: vi.fn() },
        { title: "Cond check", phase: "conditions" as const, task: vi.fn() },
      ],
    };

    const runner = new PluginRunner([plugin]);

    expect(runner.collectChecks(makeCtx(), "prerequisites")).toHaveLength(1);
    expect(runner.collectChecks(makeCtx(), "prerequisites")[0].title).toBe("Pre check");
    expect(runner.collectChecks(makeCtx(), "conditions")).toHaveLength(1);
    expect(runner.collectChecks(makeCtx(), "conditions")[0].title).toBe("Cond check");
  });

  it("returns empty array when no plugins have checks", () => {
    const plugin: PubmPlugin = { name: "no-checks" };
    const runner = new PluginRunner([plugin]);

    expect(runner.collectChecks(makeCtx(), "prerequisites")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bunx vitest --run tests/unit/plugin/runner.test.ts`
Expected: FAIL — `collectCredentials` / `collectChecks` not functions

- [ ] **Step 3: Write implementation**

Add to `PluginRunner` class in `packages/core/src/plugin/runner.ts` (after `collectEcosystems()`, around line 57):

```typescript
  collectCredentials(ctx: PubmContext): PluginCredential[] {
    const all = this.plugins.flatMap((p) => p.credentials?.(ctx) ?? []);
    const seen = new Set<string>();
    return all.filter((c) => {
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    });
  }

  collectChecks(
    ctx: PubmContext,
    phase: "prerequisites" | "conditions",
  ): PluginCheck[] {
    return this.plugins
      .flatMap((p) => p.checks?.(ctx) ?? [])
      .filter((c) => c.phase === phase);
  }
```

Add imports at the top of `runner.ts`:

```typescript
import type { HookName, PluginCheck, PluginCredential, PubmPlugin } from "./types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bunx vitest --run tests/unit/plugin/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugin/runner.ts packages/core/tests/unit/plugin/runner.test.ts
git commit -m "feat(core): add collectCredentials and collectChecks to PluginRunner"
```

---

## Task 4: `collectPluginCredentials` Function

**Files:**
- Modify: `packages/core/src/tasks/preflight.ts`
- Modify: `packages/core/tests/unit/tasks/preflight.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/unit/tasks/preflight.test.ts`:

```typescript
import { collectPluginCredentials } from "../../../src/tasks/preflight.js";
import type { PluginCredential } from "../../../src/plugin/types.js";

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
        env: "NONEXISTENT_VAR",
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
    const mockStore = { get: vi.fn().mockReturnValue("keyring-token"), set: vi.fn(), delete: vi.fn() };
    mockedSecureStore.mockImplementation(() => mockStore as any);

    const credentials: PluginCredential[] = [
      { key: "test-key", env: "NONEXISTENT_VAR", label: "Test Token" },
    ];

    const result = await collectPluginCredentials(
      credentials,
      true,
      makePluginTask() as any,
    );

    expect(result).toEqual({ "test-key": "keyring-token" });
  });

  it("prompts when all sources return null and promptEnabled is true", async () => {
    mockedSecureStore.mockImplementation(
      () => ({ get: vi.fn().mockReturnValue(null), set: vi.fn(), delete: vi.fn() }) as any,
    );

    const task = makePluginTask();
    const credentials: PluginCredential[] = [
      { key: "test-key", env: "NONEXISTENT_VAR", label: "Test Token" },
    ];

    const result = await collectPluginCredentials(
      credentials,
      true,
      task as any,
    );

    expect(result).toEqual({ "test-key": "prompted-token" });
  });

  it("throws for required credential when prompt is disabled (CI)", async () => {
    mockedSecureStore.mockImplementation(
      () => ({ get: vi.fn().mockReturnValue(null), set: vi.fn(), delete: vi.fn() }) as any,
    );

    const credentials: PluginCredential[] = [
      { key: "test-key", env: "NONEXISTENT_VAR", label: "Test Token", required: true },
    ];

    await expect(
      collectPluginCredentials(credentials, false, makePluginTask() as any),
    ).rejects.toThrow("Test Token");
  });

  it("skips optional credential when not available", async () => {
    mockedSecureStore.mockImplementation(
      () => ({ get: vi.fn().mockReturnValue(null), set: vi.fn(), delete: vi.fn() }) as any,
    );

    const credentials: PluginCredential[] = [
      { key: "test-key", env: "NONEXISTENT_VAR", label: "Test Token", required: false },
    ];

    const result = await collectPluginCredentials(
      credentials,
      false,
      makePluginTask() as any,
    );

    expect(result).toEqual({});
  });

  it("validates token and saves to SecureStore on success", async () => {
    const mockStore = { get: vi.fn().mockReturnValue(null), set: vi.fn(), delete: vi.fn() };
    mockedSecureStore.mockImplementation(() => mockStore as any);

    const task = makePluginTask();
    const credentials: PluginCredential[] = [
      {
        key: "test-key",
        env: "NONEXISTENT_VAR",
        label: "Test Token",
        validate: vi.fn().mockResolvedValue(true),
      },
    ];

    await collectPluginCredentials(credentials, true, task as any);

    expect(credentials[0].validate).toHaveBeenCalled();
    expect(mockStore.set).toHaveBeenCalledWith("test-key", "prompted-token");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bunx vitest --run tests/unit/tasks/preflight.test.ts`
Expected: FAIL — `collectPluginCredentials` not exported

- [ ] **Step 3: Write implementation**

Add to `packages/core/src/tasks/preflight.ts` (after `collectTokens` function, around line 72):

```typescript
import type { PluginCredential } from "../plugin/types.js";
import { wrapTaskContext } from "../plugin/wrap-task-context.js";

export async function collectPluginCredentials(
  credentials: PluginCredential[],
  promptEnabled: boolean,
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
  task: any,
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};
  const store = new SecureStore();
  const wrappedTask = wrapTaskContext(task);

  for (const credential of credentials) {
    const required = credential.required !== false;

    // 1. Check environment variable
    const envValue = process.env[credential.env];
    if (envValue) {
      if (credential.validate) {
        wrappedTask.output = `Validating ${credential.label}...`;
        const isValid = await credential.validate(envValue, wrappedTask);
        if (!isValid) {
          throw new PreflightError(
            `${credential.env} is set but invalid. Please update the environment variable.`,
          );
        }
      }
      tokens[credential.key] = envValue;
      continue;
    }

    // 2. Try custom resolver
    if (credential.resolve) {
      const resolved = await credential.resolve();
      if (resolved) {
        if (credential.validate) {
          wrappedTask.output = `Validating ${credential.label}...`;
          if (await credential.validate(resolved, wrappedTask)) {
            tokens[credential.key] = resolved;
            store.set(credential.key, resolved);
            continue;
          }
        } else {
          tokens[credential.key] = resolved;
          store.set(credential.key, resolved);
          continue;
        }
      }
    }

    // 3. Check keyring/SecureStore
    const stored = store.get(credential.key);
    if (stored) {
      if (credential.validate) {
        wrappedTask.output = `Validating stored ${credential.label}...`;
        const isValid = await credential.validate(stored, wrappedTask);
        if (!isValid) {
          wrappedTask.output = `Stored ${credential.label} is invalid`;
          store.delete(credential.key);
        } else {
          tokens[credential.key] = stored;
          continue;
        }
      } else {
        tokens[credential.key] = stored;
        continue;
      }
    }

    // 4. Prompt (if interactive)
    if (!promptEnabled) {
      if (required) {
        throw new PreflightError(
          `${credential.label} is required. Set ${credential.env} environment variable.`,
        );
      }
      continue;
    }

    // Prompt loop
    while (true) {
      wrappedTask.output = `Enter ${credential.label}`;
      const tokenUrlInfo = credential.tokenUrl
        ? `\nGenerate a token from ${color.bold(ui.link(credential.tokenUrlLabel ?? credential.tokenUrl, credential.tokenUrl))}`
        : "";
      const token = await wrappedTask.prompt({
        type: "password",
        message: `Enter ${credential.label}`,
        ...(tokenUrlInfo ? { footer: tokenUrlInfo } : {}),
      });

      if (!`${token}`.trim()) {
        if (required) {
          throw new PreflightError(
            `${credential.label} is required to continue.`,
          );
        }
        break;
      }

      if (credential.validate) {
        wrappedTask.output = `Validating ${credential.label}...`;
        const isValid = await credential.validate(token, wrappedTask);
        if (!isValid) {
          wrappedTask.output = `${credential.label} is invalid. Please try again.`;
          continue;
        }
      }

      tokens[credential.key] = token;
      store.set(credential.key, token);
      break;
    }
  }

  return tokens;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bunx vitest --run tests/unit/tasks/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/preflight.ts packages/core/tests/unit/tasks/preflight.test.ts
git commit -m "feat(core): add collectPluginCredentials function"
```

---

## Task 5: Generalize `syncGhSecrets` and `injectPluginTokensToEnv`

**Files:**
- Modify: `packages/core/src/tasks/preflight.ts:74-81`
- Modify: `packages/core/src/utils/token.ts`
- Modify: `packages/core/tests/unit/tasks/preflight.test.ts`

- [ ] **Step 1: Write the failing test for generalized `syncGhSecrets`**

Add to `packages/core/tests/unit/tasks/preflight.test.ts` within the existing `syncGhSecrets` describe block:

```typescript
it("syncs plugin secrets using secretName/token pairs", async () => {
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
  await syncGhSecrets(
    { npm: "npm-token" },
    [{ secretName: "PLUGIN_TOKEN", token: "plugin-val" }],
  );

  // npm registry secret
  expect(mockedExec).toHaveBeenCalledWith(
    "gh",
    expect.arrayContaining(["secret", "set"]),
    expect.anything(),
  );
  // plugin secret
  expect(mockedExec).toHaveBeenCalledWith(
    "gh",
    ["secret", "set", "PLUGIN_TOKEN", "--body", "plugin-val"],
    { throwOnError: true },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bunx vitest --run tests/unit/tasks/preflight.test.ts`
Expected: FAIL — `syncGhSecrets` signature mismatch

- [ ] **Step 3: Update `syncGhSecrets` to accept plugin secrets**

Modify in `packages/core/src/tasks/preflight.ts`:

```typescript
export interface GhSecretEntry {
  secretName: string;
  token: string;
}

export async function syncGhSecrets(
  tokens: Record<string, string>,
  pluginSecrets: GhSecretEntry[] = [],
): Promise<void> {
  // Registry tokens
  for (const [registry, token] of Object.entries(tokens)) {
    const descriptor = registryCatalog.get(registry);
    if (!descriptor) continue;
    const config = descriptor.tokenConfig;

    await exec("gh", ["secret", "set", config.ghSecretName, "--body", token], {
      throwOnError: true,
    });
  }

  // Plugin tokens
  for (const { secretName, token } of pluginSecrets) {
    await exec("gh", ["secret", "set", secretName, "--body", token], {
      throwOnError: true,
    });
  }
}
```

- [ ] **Step 4: Add `injectPluginTokensToEnv` to `token.ts`**

Add to `packages/core/src/utils/token.ts`:

```typescript
import type { PluginCredential } from "../plugin/types.js";

export function injectPluginTokensToEnv(
  pluginTokens: Record<string, string>,
  credentials: PluginCredential[],
): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const credential of credentials) {
    const token = pluginTokens[credential.key];
    if (!token) continue;

    originals[credential.env] = process.env[credential.env];
    process.env[credential.env] = token;
  }

  return () => {
    for (const [envVar, original] of Object.entries(originals)) {
      if (original === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = original;
      }
    }
  };
}
```

- [ ] **Step 5: Update `promptGhSecretsSync` call site to pass plugin secrets**

In `promptGhSecretsSync` inside `preflight.ts`, update the call to `syncGhSecrets`:

The `promptGhSecretsSync` function signature changes to accept optional plugin secrets:

```typescript
export async function promptGhSecretsSync(
  tokens: Record<string, string>,
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
  task: any,
  pluginSecrets: GhSecretEntry[] = [],
): Promise<void> {
```

And update both the `syncGhSecrets` call and `tokensSyncHash` call inside it:

```typescript
await syncGhSecrets(tokens, pluginSecrets);
```

```typescript
const currentHash = tokensSyncHash(tokens, pluginSecrets);
```

Update `tokensSyncHash` to include plugin secrets:

```typescript
function tokensSyncHash(
  tokens: Record<string, string>,
  pluginSecrets: GhSecretEntry[] = [],
): string {
  const sorted = Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b));
  const pluginSorted = [...pluginSecrets].sort((a, b) =>
    a.secretName.localeCompare(b.secretName),
  );
  return createHash("sha256")
    .update(JSON.stringify({ sorted, pluginSorted }))
    .digest("hex")
    .slice(0, 16);
}
```

- [ ] **Step 5b: Write test for `injectPluginTokensToEnv`**

Add to an appropriate test file (e.g. `packages/core/tests/unit/utils/token.test.ts` or create one):

```typescript
import { injectPluginTokensToEnv } from "../../../src/utils/token.js";
import type { PluginCredential } from "../../../src/plugin/types.js";

describe("injectPluginTokensToEnv", () => {
  it("injects plugin tokens into process.env", () => {
    const creds: PluginCredential[] = [
      { key: "my-token", env: "MY_PLUGIN_TOKEN", label: "My Token" },
    ];
    const cleanup = injectPluginTokensToEnv({ "my-token": "secret" }, creds);

    expect(process.env.MY_PLUGIN_TOKEN).toBe("secret");
    cleanup();
    expect(process.env.MY_PLUGIN_TOKEN).toBeUndefined();
  });

  it("skips credentials without a matching token", () => {
    const creds: PluginCredential[] = [
      { key: "missing", env: "MISSING_TOKEN", label: "Missing" },
    ];
    const cleanup = injectPluginTokensToEnv({}, creds);

    expect(process.env.MISSING_TOKEN).toBeUndefined();
    cleanup();
  });
});
```

- [ ] **Step 6: Export new types and functions from `core/src/index.ts`**

Add to exports:

```typescript
export type { GhSecretEntry } from "./tasks/preflight.js";
export { collectPluginCredentials } from "./tasks/preflight.js";
export { injectPluginTokensToEnv } from "./utils/token.js";
```

- [ ] **Step 7: Run all preflight tests**

Run: `cd packages/core && bunx vitest --run tests/unit/tasks/preflight.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/tasks/preflight.ts packages/core/src/utils/token.ts packages/core/src/index.ts packages/core/tests/unit/tasks/preflight.test.ts
git commit -m "feat(core): generalize syncGhSecrets and add injectPluginTokensToEnv"
```

---

## Task 6: Integrate Plugin Checks into Prerequisites/Conditions

**Files:**
- Modify: `packages/core/src/tasks/prerequisites-check.ts`
- Modify: `packages/core/src/tasks/required-conditions-check.ts`
- Modify: `packages/core/tests/unit/tasks/prerequisites-check.test.ts`
- Modify: `packages/core/tests/unit/tasks/required-conditions-check.test.ts`

- [ ] **Step 1: Write failing test for prerequisites check**

Add to `packages/core/tests/unit/tasks/prerequisites-check.test.ts` — a test that creates a plugin with a prerequisites check and verifies it runs:

```typescript
it("runs plugin prerequisite checks", async () => {
  const pluginCheckFn = vi.fn();
  const ctx = makeTestContext({
    runtime: {
      pluginRunner: new PluginRunner([
        {
          name: "test-plugin",
          checks: () => [
            {
              title: "Plugin pre check",
              phase: "prerequisites" as const,
              task: pluginCheckFn,
            },
          ],
        },
      ]),
    },
  });

  // Run prerequisites check (skip built-in checks for isolation)
  await prerequisitesCheckTask({ skip: false }).run(ctx);

  expect(pluginCheckFn).toHaveBeenCalled();
});
```

Note: Adapt this test to the existing test pattern in the file. The mock may need to handle git operations from the built-in checks. Read the existing test file first to match the pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bunx vitest --run tests/unit/tasks/prerequisites-check.test.ts`
Expected: FAIL — plugin check not called

- [ ] **Step 3: Modify `prerequisitesCheckTask` to append plugin checks**

In `packages/core/src/tasks/prerequisites-check.ts`, inside the `task` callback where the subtask list is defined, add after the last existing check (the "commits since last tag" check):

```typescript
// Append plugin prerequisite checks
...ctx.runtime.pluginRunner
  .collectChecks(ctx, "prerequisites")
  .map((check) => ({
    title: check.title,
    task: async (ctx: PubmContext, task: any) => {
      await check.task(ctx, wrapTaskContext(task));
    },
  })),
```

Add import:

```typescript
import { wrapTaskContext } from "../plugin/wrap-task-context.js";
```

Note: The `parentTask.newListr([...existingTasks, ...pluginTasks])` pattern — spread plugin checks into the array.

- [ ] **Step 4: Do the same for `requiredConditionsCheckTask`**

In `packages/core/src/tasks/required-conditions-check.ts`, append plugin condition checks after the last existing check:

```typescript
// Append plugin condition checks
...ctx.runtime.pluginRunner
  .collectChecks(ctx, "conditions")
  .map((check) => ({
    title: check.title,
    task: async (ctx: PubmContext, task: any) => {
      await check.task(ctx, wrapTaskContext(task));
    },
  })),
```

Add import:

```typescript
import { wrapTaskContext } from "../plugin/wrap-task-context.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && bunx vitest --run tests/unit/tasks/prerequisites-check.test.ts tests/unit/tasks/required-conditions-check.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tasks/prerequisites-check.ts packages/core/src/tasks/required-conditions-check.ts packages/core/tests/unit/tasks/prerequisites-check.test.ts packages/core/tests/unit/tasks/required-conditions-check.test.ts
git commit -m "feat(core): append plugin checks to prerequisites and conditions tasks"
```

---

## Task 7: Integrate `collectPluginCredentials` into Runner Flows

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:688-735`

- [ ] **Step 1: Add import to runner.ts**

Add at the top imports:

```typescript
import { collectPluginCredentials } from "./preflight.js";
import type { GhSecretEntry } from "./preflight.js";
import { injectPluginTokensToEnv } from "../utils/token.js";
```

- [ ] **Step 2: Integrate into CI prepare flow (lines 688-710)**

After `collectTokens` and before `promptGhSecretsSync`, add plugin credential collection:

```typescript
if (mode === "ci" && hasPrepare) {
  await createListr<PubmContext>({
    title: "Collecting registry tokens",
    task: async (ctx, task): Promise<void> => {
      const registries = collectRegistries(ctx.config);
      const tokens = await collectTokens(registries, task);

      // Collect plugin credentials
      const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
      const pluginTokens = await collectPluginCredentials(
        pluginCreds,
        ctx.runtime.promptEnabled,
        task,
      );
      ctx.runtime.pluginTokens = pluginTokens;

      // Build plugin secrets for GitHub sync
      const pluginSecrets: GhSecretEntry[] = pluginCreds
        .filter((c) => c.ghSecretName && pluginTokens[c.key])
        .map((c) => ({ secretName: c.ghSecretName!, token: pluginTokens[c.key] }));

      await promptGhSecretsSync(tokens, task, pluginSecrets);

      cleanupEnv = injectTokensToEnv(tokens);
      const cleanupPluginEnv = injectPluginTokensToEnv(pluginTokens, pluginCreds);
      const originalCleanup = cleanupEnv;
      cleanupEnv = () => { originalCleanup(); cleanupPluginEnv(); };
      ctx.runtime.promptEnabled = false;
    },
  }).run(ctx);

  // ... prerequisites and conditions checks unchanged
}
```

- [ ] **Step 3: Integrate into local flow (lines 712-735)**

After the JSR token collection and before conditions check, add plugin credentials:

```typescript
if (mode === "local" && hasPrepare) {
  await prerequisitesCheckTask({
    skip: ctx.options.skipPrerequisitesCheck,
  }).run(ctx);

  const registries = collectRegistries(ctx.config);
  if (registries.includes("jsr") && ctx.runtime.promptEnabled) {
    // ... existing JSR collection unchanged
  }

  // Collect plugin credentials
  const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
  if (pluginCreds.length > 0) {
    await createListr<PubmContext>({
      title: "Collecting plugin credentials",
      task: async (ctx, task): Promise<void> => {
        const pluginTokens = await collectPluginCredentials(
          pluginCreds,
          ctx.runtime.promptEnabled,
          task,
        );
        ctx.runtime.pluginTokens = pluginTokens;
        const cleanupPluginEnv = injectPluginTokensToEnv(pluginTokens, pluginCreds);
        const originalCleanup = cleanupEnv;
        cleanupEnv = () => { originalCleanup(); cleanupPluginEnv(); };
      },
    }).run(ctx);
  }

  await requiredConditionsCheckTask({
    skip: ctx.options.skipConditionsCheck,
  }).run(ctx);
}
```

- [ ] **Step 4: Integrate into CI publish flow**

There is no dedicated CI publish block in `runner.ts`. When `mode === "ci"` and only `hasPublish` (no `hasPrepare`), neither the CI prepare block (line 688) nor the local block (line 712) executes. The pipeline starts directly at line 741.

Add a new block between line 735 (end of local mode block) and line 737 (`const pipelineListrOptions`):

```typescript
    // CI publish: collect plugin credentials from env (no prompting)
    if (mode === "ci" && hasPublish && !hasPrepare) {
      const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
      if (pluginCreds.length > 0) {
        await createListr<PubmContext>({
          title: "Collecting plugin credentials",
          task: async (ctx, task): Promise<void> => {
            const pluginTokens = await collectPluginCredentials(
              pluginCreds,
              false, // No prompting in CI
              task,
            );
            ctx.runtime.pluginTokens = pluginTokens;
            const cleanupPluginEnv = injectPluginTokensToEnv(pluginTokens, pluginCreds);
            const originalCleanup = cleanupEnv;
            cleanupEnv = () => {
              originalCleanup?.();
              cleanupPluginEnv();
            };
          },
        }).run(ctx);
      }
    }
```

In CI publish with `promptEnabled=false`, `collectPluginCredentials` only tries env/resolve/keyring and throws on missing required credentials — it never calls `task.prompt`.

- [ ] **Step 5: Run typecheck and existing runner tests**

Run: `cd packages/core && bunx tsc --noEmit && bunx vitest --run tests/unit/tasks/runner.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "feat(core): integrate collectPluginCredentials into all runner flows"
```

---

## Task 8: Brew Plugin — Add Credentials and Checks

**Files:**
- Modify: `packages/plugins/plugin-brew/src/brew-tap.ts`
- Modify: `packages/plugins/plugin-brew/src/brew-core.ts`
- Modify: `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts`
- Modify: `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts`

- [ ] **Step 1: Write failing test for brew-tap credential declaration**

Add to `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts`:

```typescript
describe("credentials", () => {
  it("returns credential for external repo", () => {
    const plugin = brewTap({ formula: "Formula/test.rb", repo: "user/homebrew-test" });
    const ctx = {
      options: { mode: "local", publish: true },
      config: {},
      runtime: { promptEnabled: true },
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(1);
    expect(creds[0].key).toBe("brew-github-token");
    expect(creds[0].env).toBe("PUBM_BREW_GITHUB_TOKEN");
  });

  it("returns empty for same-repo formula", () => {
    const plugin = brewTap({ formula: "Formula/test.rb" });
    const ctx = { options: { mode: "local" }, config: {}, runtime: {} } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(0);
  });
});

describe("checks", () => {
  it("adds condition check for external repo", () => {
    const plugin = brewTap({ formula: "Formula/test.rb", repo: "user/homebrew-test" });
    const ctx = { options: { mode: "local" }, config: {}, runtime: {} } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(1);
    expect(checks[0].phase).toBe("conditions");
  });

  it("returns empty checks for same-repo formula", () => {
    const plugin = brewTap({ formula: "Formula/test.rb" });
    const ctx = { options: { mode: "local" }, config: {}, runtime: {} } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugins/plugin-brew && bunx vitest --run tests/unit/brew-tap.test.ts`
Expected: FAIL — `plugin.credentials` is undefined

- [ ] **Step 3: Add credentials and checks to `brewTap`**

In `packages/plugins/plugin-brew/src/brew-tap.ts`, add to the returned `PubmPlugin` object:

```typescript
import { resolvePhases } from "@pubm/core";

export function brewTap(options: BrewTapOptions): PubmPlugin {
  return {
    name: "@pubm/plugin-brew-tap",
    credentials: (ctx) => {
      if (!options.repo) return [];
      const phases = resolvePhases(ctx.options);
      if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];
      return [
        {
          key: "brew-github-token",
          env: "PUBM_BREW_GITHUB_TOKEN",
          label: "GitHub PAT for Homebrew tap",
          tokenUrl: "https://github.com/settings/tokens/new?scopes=repo",
          tokenUrlLabel: "github.com",
          ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
          required: true,
        },
      ];
    },
    checks: (ctx) => {
      if (!options.repo) return [];
      return [
        {
          title: "Checking Homebrew tap token availability",
          phase: "conditions" as const,
          task: async (ctx, task) => {
            const token = ctx.runtime.pluginTokens?.["brew-github-token"];
            if (!token) {
              throw new Error(
                "PUBM_BREW_GITHUB_TOKEN is required for Homebrew tap publishing. Set the environment variable or run with interactive mode.",
              );
            }
            task.output = "Homebrew tap token verified";
          },
        },
      ];
    },
    commands: [/* existing commands unchanged */],
    hooks: {
      afterRelease: async (ctx, releaseCtx) => {
        // ... existing logic, modified in next step
      },
    },
  };
}
```

- [ ] **Step 4: Update `afterRelease` to use `pluginTokens` instead of `resolveGitHubToken`**

In the `afterRelease` hook of `brewTap`, replace the external repo section (lines 123-189):

```typescript
if (options.repo) {
  const { tmpdir } = await import("node:os");
  const { basename, join } = await import("node:path");
  const { execSync } = await import("node:child_process");

  const tmpDir = join(tmpdir(), `pubm-brew-tap-${Date.now()}`);
  const formulaFile = basename(formulaPath);
  const token = ctx.runtime.pluginTokens?.["brew-github-token"];

  const isShorthand = /^[^/]+\/[^/]+$/.test(options.repo);
  const repoUrl = isShorthand
    ? `https://github.com/${options.repo}.git`
    : options.repo;

  const ownerRepoMatch = repoUrl.match(
    /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/,
  );
  const ownerRepo = ownerRepoMatch?.[1] ?? options.repo;

  // Embed PAT in clone URL
  let cloneUrl = repoUrl;
  if (token && repoUrl.startsWith("https://github.com/")) {
    cloneUrl = repoUrl.replace(
      "https://github.com/",
      `https://x-access-token:${token}@github.com/`,
    );
  }

  execSync(`git clone --depth 1 ${cloneUrl} ${tmpDir}`, {
    stdio: "inherit",
  });
  ensureGitIdentity(tmpDir);

  const targetDir = join(tmpDir, "Formula");
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, formulaFile), content);

  execSync(
    [
      `cd ${tmpDir}`,
      `git add Formula/${formulaFile}`,
      `git commit -m "Update ${formulaFile} to ${releaseCtx.version}"`,
    ].join(" && "),
    { stdio: "inherit" },
  );

  try {
    execSync(`cd ${tmpDir} && git push`, { stdio: "inherit" });
  } catch {
    const branch = `pubm/brew-formula-v${releaseCtx.version}`;
    execSync(`cd ${tmpDir} && git checkout -b ${branch}`, {
      stdio: "inherit",
    });
    execSync(`cd ${tmpDir} && git push origin ${branch}`, {
      stdio: "inherit",
    });
    // Pass GH_TOKEN for gh CLI auth
    const ghEnv = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
    execSync(
      `gh pr create --repo ${ownerRepo} --title "chore(brew): update formula to ${releaseCtx.version}" --body "Automated formula update by pubm"`,
      { stdio: "inherit", ...ghEnv },
    );
    console.log(`Created PR on branch ${branch}`);
  }
}
```

Remove the `resolveGitHubToken` import.

- [ ] **Step 4b: Update existing brew-tap tests that mock `resolveGitHubToken`**

The existing `brew-tap.test.ts` extensively mocks `resolveGitHubToken` from `@pubm/core` (lines 6-8, 19-21). Since `afterRelease` now uses `ctx.runtime.pluginTokens` instead:

1. Remove the `resolveGitHubTokenMock` hoisted mock and the `@pubm/core` vi.mock block
2. Update existing `afterRelease` tests to pass `ctx.runtime.pluginTokens` with the token value instead of setting `resolveGitHubTokenMock.mockReturnValue`
3. Ensure the `ctx` mock object includes `runtime: { pluginTokens: { "brew-github-token": "test-token" } }`

- [ ] **Step 5: Run brew-tap tests**

Run: `cd packages/plugins/plugin-brew && bunx vitest --run tests/unit/brew-tap.test.ts`
Expected: PASS

- [ ] **Step 6: Do the same for `brewCore` — add credentials, checks, PAT injection**

Add to `packages/plugins/plugin-brew/src/brew-core.ts`:

- `credentials` field (same key `brew-github-token`, same gating logic)
- `checks` field (condition check for token availability)
- In `afterRelease`: embed PAT in clone URL, pass `GH_TOKEN` to all `execSync` calls using `gh`

```typescript
credentials: (ctx) => {
  const phases = resolvePhases(ctx.options);
  if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];
  return [
    {
      key: "brew-github-token",
      env: "PUBM_BREW_GITHUB_TOKEN",
      label: "GitHub PAT for Homebrew (homebrew-core)",
      tokenUrl: "https://github.com/settings/tokens/new?scopes=repo,workflow",
      tokenUrlLabel: "github.com",
      ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
      required: true,
    },
  ];
},
checks: (ctx) => [{
  title: "Checking Homebrew core token availability",
  phase: "conditions" as const,
  task: async (ctx, task) => {
    const token = ctx.runtime.pluginTokens?.["brew-github-token"];
    if (!token) {
      throw new Error("PUBM_BREW_GITHUB_TOKEN is required for homebrew-core publishing.");
    }
    task.output = "Homebrew core token verified";
  },
}],
```

In `afterRelease`, update:

```typescript
const token = ctx.runtime.pluginTokens?.["brew-github-token"];
const ghEnv = token ? { env: { ...process.env, GH_TOKEN: token } } : {};

// Fork — pass GH_TOKEN
execSync("gh repo fork homebrew/homebrew-core --clone=false", {
  stdio: "pipe",
  ...ghEnv,
});

// Get username — pass GH_TOKEN
const username = execSync("gh api user --jq .login", {
  encoding: "utf-8",
  ...ghEnv,
}).trim();

// Clone with PAT embedded
let cloneUrl = `https://github.com/${username}/homebrew-core.git`;
if (token) {
  cloneUrl = `https://x-access-token:${token}@github.com/${username}/homebrew-core.git`;
}
execSync(`git clone --depth 1 ${cloneUrl} ${tmpDir}`, { stdio: "inherit" });

// Push — token already in clone URL remote

// PR — pass GH_TOKEN
execSync(
  `gh pr create --repo homebrew/homebrew-core --title "${name} ${releaseCtx.version}" --body "..."`,
  { stdio: "inherit", ...ghEnv },
);
```

- [ ] **Step 7: Write/update brew-core tests**

Add credential and check tests to `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts` (same pattern as brew-tap tests).

- [ ] **Step 8: Run all brew plugin tests**

Run: `cd packages/plugins/plugin-brew && bunx vitest --run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/plugins/plugin-brew/src/brew-tap.ts packages/plugins/plugin-brew/src/brew-core.ts packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts packages/plugins/plugin-brew/tests/unit/brew-core.test.ts
git commit -m "feat(plugin-brew): add credentials/checks, use PAT for git push and gh CLI"
```

---

## Task 9: Full Build and Test Verification

**Files:** None (verification only)

- [ ] **Step 1: Run format**

Run: `bun run format`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `bun run test`
Expected: PASS

- [ ] **Step 4: Run coverage**

Run: `bun run coverage`
Expected: Coverage thresholds maintained

- [ ] **Step 5: Commit any format fixes**

If `bun run format` made changes:

```bash
git add -A
git commit -m "chore: format"
```

---

## Task 10: Documentation Updates

**Files:**
- Modify: `website/src/content/docs/reference/plugins.mdx` (+ 6 locale copies)
- Modify: `website/src/content/docs/reference/sdk.mdx` (+ 6 locale copies)
- Modify: `website/src/content/docs/reference/official-plugins.mdx` (+ 6 locale copies)
- Modify: `website/src/content/docs/guides/ci-cd.mdx` (+ 6 locale copies)
- Modify: `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md`

- [ ] **Step 1: Update `reference/plugins.mdx`**

Add sections documenting:
- `PluginTaskContext` interface
- `PluginCredential` interface with all fields
- `PluginCheck` interface
- `credentials` and `checks` fields on `PubmPlugin`
- Example usage

- [ ] **Step 2: Update `reference/sdk.mdx`**

Update the `PubmPlugin` type reference to include new fields.

- [ ] **Step 3: Update `reference/official-plugins.mdx`**

Add brew plugin configuration section:
- `PUBM_BREW_GITHUB_TOKEN` environment variable
- Fine-grained PAT required scopes (`repo` for tap, `repo,workflow` for core)
- GitHub Secrets sync support

- [ ] **Step 4: Update `guides/ci-cd.mdx`**

Add section for brew plugin CI setup:
- Creating a fine-grained PAT
- Adding as GitHub Secret (`PUBM_BREW_GITHUB_TOKEN`)
- Workflow YAML snippet passing the secret

- [ ] **Step 5: Update `plugin-api.md` skill reference**

Add `credentials` and `checks` to the plugin API reference in `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md`.

- [ ] **Step 6: Apply translations to all 6 locales**

For each modified `.mdx` file, apply the same changes to:
- `website/src/content/docs/fr/...`
- `website/src/content/docs/es/...`
- `website/src/content/docs/de/...`
- `website/src/content/docs/zh-cn/...`
- `website/src/content/docs/ko/...`

- [ ] **Step 7: Build docs site**

Run: `bun run build:site`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add website/ plugins/pubm-plugin/
git commit -m "docs: document plugin credentials/checks interface and brew PAT setup"
```

---

## Task 11: Changeset

- [ ] **Step 1: Create changeset for core**

```bash
bunx pubm add --packages packages/core --bump minor --message "Add plugin credentials and checks interface — plugins can now declare required credentials and preflight checks"
```

- [ ] **Step 2: Create changeset for plugin-brew**

```bash
bunx pubm add --packages packages/plugins/plugin-brew --bump minor --message "Add PAT-based authentication for Homebrew tap and homebrew-core publishing"
```

- [ ] **Step 3: Commit changesets**

```bash
git add .changeset/
git commit -m "chore: add changesets for plugin credentials and brew PAT"
```
