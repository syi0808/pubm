# Preflight Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `--preflight` mode that simulates CI publishing locally with token-based auth and dry-run publish, plus `pubm secrets sync` for GitHub Secrets management.

**Architecture:** Preflight runs in two phases: (1) interactive token collection using existing `Db` class, (2) non-interactive pipeline execution with `promptEnabled=false` and tokens injected into `process.env`. Dry-run publish replaces actual publish. A separate `secrets sync` subcommand pushes stored tokens to GitHub Secrets via `gh` CLI.

**Tech Stack:** TypeScript, listr2 (task runner), tinyexec (shell commands), cac (CLI framework), Db class (AES-256-CBC encrypted storage)

---

### Task 1: Add `dryRunPublish()` to Registry base class

**Files:**
- Modify: `src/registry/registry.ts:6-21`

**Step 1: Add default no-op method to Registry base class**

```typescript
// Add after the existing abstract methods (line 19), before closing brace
async dryRunPublish(_manifestDir?: string): Promise<void> {
  // Default no-op: registries that support dry-run override this
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors)

**Step 3: Commit**

```
feat: add dryRunPublish() to Registry base class
```

---

### Task 2: Implement `dryRunPublish()` in NpmRegistry

**Files:**
- Test: `tests/unit/registry/npm.test.ts`
- Modify: `src/registry/npm.ts`

**Step 1: Write the failing test**

Add to `tests/unit/registry/npm.test.ts` inside the `describe("NpmRegistry", ...)` block, after the existing `publish()` describe:

```typescript
describe("dryRunPublish()", () => {
  it("runs npm publish --dry-run", async () => {
    mockStdout("");
    await registry.dryRunPublish();
    expect(mockedExec).toHaveBeenCalledWith(
      "npm",
      ["publish", "--dry-run"],
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it("throws on dry-run failure", async () => {
    mockedExec.mockRejectedValue(new Error("dry-run failed"));
    await expect(registry.dryRunPublish()).rejects.toThrow(
      "Failed to run `npm publish --dry-run`",
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/registry/npm.test.ts`
Expected: FAIL — `dryRunPublish` runs the no-op base method (no exec call)

**Step 3: Write minimal implementation**

Add to `src/registry/npm.ts` in the `NpmRegistry` class, after `publish()`:

```typescript
async dryRunPublish(): Promise<void> {
  try {
    await this.npm(["publish", "--dry-run"]);
  } catch (error) {
    throw new NpmError("Failed to run `npm publish --dry-run`", {
      cause: error,
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/registry/npm.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: implement dryRunPublish() for NpmRegistry
```

---

### Task 3: Implement `dryRunPublish()` in JsrRegisry

**Files:**
- Test: `tests/unit/registry/jsr.test.ts`
- Modify: `src/registry/jsr.ts`

**Step 1: Write the failing test**

Add to `tests/unit/registry/jsr.test.ts` inside the main `describe` block. Note: the test file mocks `tinyexec` and has `mockedExec`. Add after the existing `publish()` describe:

```typescript
describe("dryRunPublish()", () => {
  it("runs jsr publish --dry-run --allow-dirty", async () => {
    mockStdout("");
    await registry.dryRunPublish();
    expect(mockedExec).toHaveBeenCalledWith(
      "jsr",
      ["publish", "--dry-run", "--allow-dirty", "--token", expect.any(String)],
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it("throws on dry-run failure", async () => {
    mockedExec.mockRejectedValue(new Error("dry-run failed"));
    await expect(registry.dryRunPublish()).rejects.toThrow(
      "Failed to run `jsr publish --dry-run`",
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/registry/jsr.test.ts`
Expected: FAIL — `dryRunPublish` is the no-op base method

**Step 3: Write minimal implementation**

Add to `src/registry/jsr.ts` in the `JsrRegisry` class, after `publish()`:

```typescript
async dryRunPublish(): Promise<void> {
  try {
    await exec(
      "jsr",
      ["publish", "--dry-run", "--allow-dirty", "--token", `${JsrClient.token}`],
      { throwOnError: true },
    );
  } catch (error) {
    throw new JsrError("Failed to run `jsr publish --dry-run`", {
      cause: error,
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/registry/jsr.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: implement dryRunPublish() for JsrRegisry
```

---

### Task 4: Implement `dryRunPublish()` in CratesRegistry

**Files:**
- Test: `tests/unit/registry/crates.test.ts`
- Modify: `src/registry/crates.ts`

**Step 1: Write the failing test**

Add to `tests/unit/registry/crates.test.ts` inside the `describe("CratesRegistry", ...)` block, after the existing `publish()` describe:

```typescript
describe("dryRunPublish()", () => {
  it("runs cargo publish --dry-run", async () => {
    mockStdout("");
    await registry.dryRunPublish();
    expect(mockedExec).toHaveBeenCalledWith(
      "cargo",
      ["publish", "--dry-run"],
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it("passes --manifest-path when manifestDir is provided", async () => {
    mockStdout("");
    await registry.dryRunPublish("packages/my-crate");
    expect(mockedExec).toHaveBeenCalledWith(
      "cargo",
      [
        "publish",
        "--dry-run",
        "--manifest-path",
        path.join("packages/my-crate", "Cargo.toml"),
      ],
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it("throws on dry-run failure", async () => {
    mockedExec.mockRejectedValue(new Error("dry-run failed"));
    await expect(registry.dryRunPublish()).rejects.toThrow(
      "Failed to run `cargo publish --dry-run`",
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/registry/crates.test.ts`
Expected: FAIL — base class no-op doesn't call exec

**Step 3: Write minimal implementation**

Add to `src/registry/crates.ts` in the `CratesRegistry` class, after `publish()`:

```typescript
async dryRunPublish(manifestDir?: string): Promise<void> {
  try {
    const args = ["publish", "--dry-run"];
    if (manifestDir) {
      args.push("--manifest-path", path.join(manifestDir, "Cargo.toml"));
    }
    await exec("cargo", args, { throwOnError: true });
  } catch (error) {
    const stderr =
      error instanceof NonZeroExitError ? error.output?.stderr : undefined;
    const message = stderr
      ? `Failed to run \`cargo publish --dry-run\`:\n${stderr}`
      : "Failed to run `cargo publish --dry-run`";
    throw new CratesError(message, { cause: error });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/registry/crates.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: implement dryRunPublish() for CratesRegistry
```

---

### Task 5: Add `preflight` option to types and CLI

**Files:**
- Modify: `src/types/options.ts`
- Modify: `src/cli.ts`

**Step 1: Add `preflight` to Options interface**

In `src/types/options.ts`, add after the `publishOnly` field (around line 72):

```typescript
/**
 * @description Simulate CI publish locally (dry-run with token-based auth)
 * @default false
 */
preflight?: boolean;
```

**Step 2: Add `--preflight` flag to CLI**

In `src/cli.ts`, add to the `publishOptions` array (after `--publish-only`):

```typescript
{
  rawName: "--preflight",
  description: "Simulate CI publish locally (dry-run with token-based auth)",
  options: { type: Boolean },
},
```

Add `preflight` to `CliOptions` interface:

```typescript
preflight?: boolean;
```

In `resolveCliOptions`, pass it through (add after `publishOnly`):

```typescript
preflight: options.preflight,
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```
feat: add --preflight CLI flag and option type
```

---

### Task 6: Create token management utility

**Files:**
- Create: `src/utils/token.ts`
- Create: `tests/unit/utils/token.test.ts`

This utility provides the token mapping (registry -> env var -> db key -> gh secret name) and token loading/injection logic used by both preflight and secrets sync.

**Step 1: Write the failing test**

Create `tests/unit/utils/token.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

import { Db } from "../../../src/utils/db.js";
import {
  TOKEN_CONFIG,
  loadTokensFromDb,
  injectTokensToEnv,
  type TokenEntry,
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
    });
    expect(TOKEN_CONFIG.jsr).toEqual({
      envVar: "JSR_TOKEN",
      dbKey: "jsr-token",
      ghSecretName: "JSR_TOKEN",
      promptLabel: "jsr API token",
    });
    expect(TOKEN_CONFIG.crates).toEqual({
      envVar: "CARGO_REGISTRY_TOKEN",
      dbKey: "cargo-token",
      ghSecretName: "CARGO_REGISTRY_TOKEN",
      promptLabel: "crates.io API token",
    });
  });
});

describe("loadTokensFromDb", () => {
  it("returns tokens found in Db", () => {
    const mockGet = vi.fn((key: string) =>
      key === "npm-token" ? "npm-tok-123" : null,
    );
    mockedDb.mockImplementation(
      () => ({ get: mockGet, set: vi.fn() }) as any,
    );

    const result = loadTokensFromDb(["npm", "jsr"]);
    expect(result).toEqual({ npm: "npm-tok-123" });
  });

  it("skips registries with no token config", () => {
    const mockGet = vi.fn().mockReturnValue(null);
    mockedDb.mockImplementation(
      () => ({ get: mockGet, set: vi.fn() }) as any,
    );

    const result = loadTokensFromDb(["npm", "custom-registry"]);
    expect(mockGet).toHaveBeenCalledTimes(1); // only npm
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/utils/token.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Write implementation**

Create `src/utils/token.ts`:

```typescript
import { Db } from "./db.js";

export interface TokenEntry {
  envVar: string;
  dbKey: string;
  ghSecretName: string;
  promptLabel: string;
}

export const TOKEN_CONFIG: Record<string, TokenEntry> = {
  npm: {
    envVar: "NODE_AUTH_TOKEN",
    dbKey: "npm-token",
    ghSecretName: "NODE_AUTH_TOKEN",
    promptLabel: "npm access token",
  },
  jsr: {
    envVar: "JSR_TOKEN",
    dbKey: "jsr-token",
    ghSecretName: "JSR_TOKEN",
    promptLabel: "jsr API token",
  },
  crates: {
    envVar: "CARGO_REGISTRY_TOKEN",
    dbKey: "cargo-token",
    ghSecretName: "CARGO_REGISTRY_TOKEN",
    promptLabel: "crates.io API token",
  },
};

export function loadTokensFromDb(
  registries: string[],
): Record<string, string> {
  const db = new Db();
  const tokens: Record<string, string> = {};

  for (const registry of registries) {
    const config = TOKEN_CONFIG[registry];
    if (!config) continue;

    const token = db.get(config.dbKey);
    if (token) tokens[registry] = token;
  }

  return tokens;
}

export function injectTokensToEnv(
  tokens: Record<string, string>,
): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const [registry, token] of Object.entries(tokens)) {
    const config = TOKEN_CONFIG[registry];
    if (!config) continue;

    originals[config.envVar] = process.env[config.envVar];
    process.env[config.envVar] = token;
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

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/utils/token.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add token management utility for preflight mode
```

---

### Task 7: Create dry-run publish tasks

**Files:**
- Create: `src/tasks/dry-run-publish.ts`
- Create: `tests/unit/tasks/dry-run-publish.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/tasks/dry-run-publish.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/npm.js", () => ({
  npmRegistry: vi.fn(),
}));
vi.mock("../../../src/registry/jsr.js", () => ({
  jsrRegistry: vi.fn(),
}));
vi.mock("../../../src/registry/crates.js", () => ({
  CratesRegistry: vi.fn(),
}));
vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: vi.fn().mockImplementation(() => ({
    packageName: vi.fn().mockResolvedValue("my-crate"),
  })),
}));

import { npmRegistry } from "../../../src/registry/npm.js";
import { jsrRegistry } from "../../../src/registry/jsr.js";
import { CratesRegistry } from "../../../src/registry/crates.js";
import {
  npmDryRunPublishTask,
  jsrDryRunPublishTask,
  cratesDryRunPublishTask,
  createCratesDryRunPublishTask,
} from "../../../src/tasks/dry-run-publish.js";

const mockedNpmRegistry = vi.mocked(npmRegistry);
const mockedJsrRegistry = vi.mocked(jsrRegistry);
const mockedCratesRegistry = vi.mocked(CratesRegistry);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("npmDryRunPublishTask", () => {
  it("has correct title", () => {
    expect(npmDryRunPublishTask.title).toBe("Dry-run npm publish");
  });

  it("calls dryRunPublish on npm registry", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
    } as any);

    await (npmDryRunPublishTask as any).task({}, { output: "" });
    expect(mockDryRun).toHaveBeenCalled();
  });
});

describe("jsrDryRunPublishTask", () => {
  it("has correct title", () => {
    expect(jsrDryRunPublishTask.title).toBe("Dry-run jsr publish");
  });

  it("calls dryRunPublish on jsr registry", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedJsrRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
    } as any);

    await (jsrDryRunPublishTask as any).task({}, { output: "" });
    expect(mockDryRun).toHaveBeenCalled();
  });
});

describe("cratesDryRunPublishTask", () => {
  it("has correct title", () => {
    expect(cratesDryRunPublishTask.title).toBe("Dry-run crates.io publish");
  });
});

describe("createCratesDryRunPublishTask", () => {
  it("includes package path in title", () => {
    const task = createCratesDryRunPublishTask("packages/my-crate");
    expect(task.title).toBe("Dry-run crates.io publish (packages/my-crate)");
  });

  it("calls dryRunPublish with manifestDir", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedCratesRegistry.mockImplementation(
      () => ({ dryRunPublish: mockDryRun }) as any,
    );

    const task = createCratesDryRunPublishTask("packages/my-crate");
    await (task as any).task({}, { output: "" });
    expect(mockDryRun).toHaveBeenCalledWith("packages/my-crate");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/tasks/dry-run-publish.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Write implementation**

Create `src/tasks/dry-run-publish.ts`:

```typescript
import type { ListrTask } from "listr2";
import { CratesRegistry } from "../registry/crates.js";
import { jsrRegistry } from "../registry/jsr.js";
import { npmRegistry } from "../registry/npm.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import type { Ctx } from "./runner.js";

export const npmDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run npm publish",
  task: async (_, task): Promise<void> => {
    task.output = "Running npm publish --dry-run...";
    const npm = await npmRegistry();
    await npm.dryRunPublish();
  },
};

export const jsrDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run jsr publish",
  task: async (_, task): Promise<void> => {
    task.output = "Running jsr publish --dry-run...";
    const jsr = await jsrRegistry();
    await jsr.dryRunPublish();
  },
};

async function getCrateName(packagePath?: string): Promise<string> {
  const eco = new RustEcosystem(packagePath ?? process.cwd());
  return await eco.packageName();
}

export function createCratesDryRunPublishTask(
  packagePath?: string,
): ListrTask<Ctx> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Dry-run crates.io publish${label}`,
    task: async (_, task): Promise<void> => {
      task.output = "Running cargo publish --dry-run...";
      const packageName = await getCrateName(packagePath);
      const registry = new CratesRegistry(packageName);
      await registry.dryRunPublish(packagePath);
    },
  };
}

export const cratesDryRunPublishTask: ListrTask<Ctx> =
  createCratesDryRunPublishTask();
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/tasks/dry-run-publish.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add dry-run publish tasks for all registries
```

---

### Task 8: Create preflight tasks (token collection + GH Secrets prompt)

**Files:**
- Create: `src/tasks/preflight.ts`
- Create: `tests/unit/tasks/preflight.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/tasks/preflight.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tinyexec", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(() => ({
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
import { Db } from "../../../src/utils/db.js";
import {
  loadTokensFromDb,
  injectTokensToEnv,
} from "../../../src/utils/token.js";
import { collectTokens, syncGhSecrets } from "../../../src/tasks/preflight.js";

const mockedExec = vi.mocked(exec);
const mockedDb = vi.mocked(Db);
const mockedLoadTokens = vi.mocked(loadTokensFromDb);
const mockedInjectTokens = vi.mocked(injectTokensToEnv);

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

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    const mockDbSet = vi.fn();
    mockedDb.mockImplementation(
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

    const tokens = await collectTokens(
      ["custom-registry"],
      mockTask as any,
    );

    expect(tokens).toEqual({});
    expect(mockTask.prompt).not.toHaveBeenCalled();
  });
});

describe("syncGhSecrets", () => {
  it("calls gh secret set for each token", async () => {
    mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

    await syncGhSecrets({ npm: "tok-123", jsr: "tok-456" });

    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "NODE_AUTH_TOKEN", "--body", "tok-123"],
      expect.objectContaining({ throwOnError: true }),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "JSR_TOKEN", "--body", "tok-456"],
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it("throws when gh is not installed", async () => {
    mockedExec.mockRejectedValue(new Error("not found"));

    await expect(syncGhSecrets({ npm: "tok-123" })).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/tasks/preflight.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Write implementation**

Create `src/tasks/preflight.ts`:

```typescript
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { exec } from "tinyexec";
import { AbstractError } from "../error.js";
import { Db } from "../utils/db.js";
import {
  TOKEN_CONFIG,
  loadTokensFromDb,
} from "../utils/token.js";

class PreflightError extends AbstractError {
  name = "Preflight Error";
}

export async function collectTokens(
  registries: string[],
  task: any,
): Promise<Record<string, string>> {
  const existing = loadTokensFromDb(registries);
  const tokens: Record<string, string> = { ...existing };

  for (const registry of registries) {
    const config = TOKEN_CONFIG[registry];
    if (!config || tokens[registry]) continue;

    task.output = `Enter ${config.promptLabel}`;
    const token = await task
      .prompt(ListrEnquirerPromptAdapter)
      .run<string>({
        type: "password",
        message: `Enter ${config.promptLabel}`,
      });

    tokens[registry] = token;
    new Db().set(config.dbKey, token);
  }

  return tokens;
}

export async function syncGhSecrets(
  tokens: Record<string, string>,
): Promise<void> {
  for (const [registry, token] of Object.entries(tokens)) {
    const config = TOKEN_CONFIG[registry];
    if (!config) continue;

    await exec(
      "gh",
      ["secret", "set", config.ghSecretName, "--body", token],
      { throwOnError: true },
    );
  }
}

export async function promptGhSecretsSync(
  tokens: Record<string, string>,
  task: any,
): Promise<void> {
  const shouldSync = await task
    .prompt(ListrEnquirerPromptAdapter)
    .run<boolean>({
      type: "toggle",
      message: "Sync tokens to GitHub Secrets?",
      enabled: "Yes",
      disabled: "No",
    });

  if (shouldSync) {
    task.output = "Syncing tokens to GitHub Secrets...";
    try {
      await syncGhSecrets(tokens);
      task.output = "Tokens synced to GitHub Secrets.";
    } catch (error) {
      throw new PreflightError(
        "Failed to sync tokens to GitHub Secrets. Ensure `gh` CLI is installed and authenticated (`gh auth login`).",
        { cause: error },
      );
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/tasks/preflight.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add preflight token collection and GH Secrets sync
```

---

### Task 9: Integrate preflight mode into runner.ts

**Files:**
- Modify: `src/tasks/runner.ts`
- Modify: `tests/unit/tasks/runner.test.ts`

This is the core integration. When `options.preflight` is set, the runner:
1. Runs token collection (Phase 1 — interactive)
2. Sets `ctx.promptEnabled = false` and injects tokens
3. Runs the pipeline with dry-run publish instead of real publish, skipping bump/push/release

**Step 1: Write the failing tests**

Add to `tests/unit/tasks/runner.test.ts`. First add the new mock at the top (alongside the existing mocks):

```typescript
vi.mock("../../../src/tasks/dry-run-publish.js", () => ({
  npmDryRunPublishTask: {
    title: "Dry-run npm publish",
    task: vi.fn(),
  },
  jsrDryRunPublishTask: {
    title: "Dry-run jsr publish",
    task: vi.fn(),
  },
  cratesDryRunPublishTask: {
    title: "Dry-run crates publish",
    task: vi.fn(),
  },
  createCratesDryRunPublishTask: vi.fn((packagePath?: string) => ({
    title: `Dry-run crates publish (${packagePath})`,
    task: vi.fn(),
  })),
}));
vi.mock("../../../src/tasks/preflight.js", () => ({
  collectTokens: vi.fn(),
  promptGhSecretsSync: vi.fn(),
}));
vi.mock("../../../src/utils/token.js", () => ({
  TOKEN_CONFIG: {
    npm: { envVar: "NODE_AUTH_TOKEN", dbKey: "npm-token", ghSecretName: "NODE_AUTH_TOKEN", promptLabel: "npm access token" },
    jsr: { envVar: "JSR_TOKEN", dbKey: "jsr-token", ghSecretName: "JSR_TOKEN", promptLabel: "jsr API token" },
    crates: { envVar: "CARGO_REGISTRY_TOKEN", dbKey: "cargo-token", ghSecretName: "CARGO_REGISTRY_TOKEN", promptLabel: "crates.io API token" },
  },
  loadTokensFromDb: vi.fn(),
  injectTokensToEnv: vi.fn().mockReturnValue(vi.fn()),
}));
```

Add new imports below existing imports:

```typescript
import { collectTokens, promptGhSecretsSync } from "../../../src/tasks/preflight.js";
import { injectTokensToEnv } from "../../../src/utils/token.js";
```

Add new mocked references:

```typescript
const mockedCollectTokens = vi.mocked(collectTokens);
const mockedPromptGhSecretsSync = vi.mocked(promptGhSecretsSync);
const mockedInjectTokensToEnv = vi.mocked(injectTokensToEnv);
```

Add the test describe block:

```typescript
describe("preflight mode", () => {
  it("runs prerequisites and conditions checks in preflight mode", async () => {
    mockedCollectTokens.mockResolvedValue({ npm: "test-token" });
    mockedInjectTokensToEnv.mockReturnValue(vi.fn());

    const options = createOptions({ preflight: true });
    await run(options);

    expect(mockedPrerequisitesCheckTask).toHaveBeenCalled();
    expect(mockedRequiredConditionsCheckTask).toHaveBeenCalled();
  });

  it("creates task list with dry-run publish instead of real publish", async () => {
    mockedCollectTokens.mockResolvedValue({ npm: "test-token" });
    mockedInjectTokensToEnv.mockReturnValue(vi.fn());

    const options = createOptions({ preflight: true });
    await run(options);

    const callArgs = mockedCreateListr.mock.calls[0];
    const tasks = callArgs[0] as any[];

    expect(Array.isArray(tasks)).toBe(true);
    // Should have: tests, build, dry-run publish (no bump, no push, no release draft)
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe("Running tests");
    expect(tasks[1].title).toBe("Building the project");
    expect(tasks[2].title).toBe("Validating publish (dry-run)");
  });

  it("injects tokens into env and cleans up after pipeline", async () => {
    const cleanupFn = vi.fn();
    mockedCollectTokens.mockResolvedValue({ npm: "test-token" });
    mockedInjectTokensToEnv.mockReturnValue(cleanupFn);

    const options = createOptions({ preflight: true });
    await run(options);

    expect(mockedInjectTokensToEnv).toHaveBeenCalledWith({ npm: "test-token" });
    expect(cleanupFn).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/tasks/runner.test.ts`
Expected: FAIL — preflight mode not implemented in runner.ts

**Step 3: Implement preflight branch in runner.ts**

Modify `src/tasks/runner.ts`. Add imports at the top:

```typescript
import {
  npmDryRunPublishTask,
  jsrDryRunPublishTask,
  cratesDryRunPublishTask,
  createCratesDryRunPublishTask,
} from "./dry-run-publish.js";
import { collectTokens, promptGhSecretsSync } from "./preflight.js";
import { injectTokensToEnv } from "../utils/token.js";
```

Add a `dryRunRegistryTask` function (similar to `registryTask`):

```typescript
function dryRunRegistryTask(registry: string) {
  switch (registry) {
    case "npm":
      return npmDryRunPublishTask;
    case "jsr":
      return jsrDryRunPublishTask;
    case "crates":
      return cratesDryRunPublishTask;
    default:
      return npmDryRunPublishTask;
  }
}
```

Add `collectDryRunPublishTasks` function (similar to `collectPublishTasks`):

```typescript
async function collectDryRunPublishTasks(ctx: Ctx) {
  if (ctx.packages?.length) {
    const nonCratesTasks = ctx.packages.flatMap((pkg: PackageConfig) =>
      pkg.registries
        .filter((reg) => reg !== "crates")
        .map((reg) => dryRunRegistryTask(reg)),
    );

    const cratesPaths = ctx.packages
      .filter((pkg) => pkg.registries.includes("crates"))
      .map((pkg) => pkg.path);

    if (cratesPaths.length === 0) {
      return nonCratesTasks;
    }

    const sortedPaths = await sortCratesByDependencyOrder(cratesPaths);
    const sequentialCratesTask = {
      title: "Dry-run crates.io publish (sequential)",
      task: (_ctx: Ctx, task: { newListr: (...args: any[]) => any }) =>
        task.newListr(
          sortedPaths.map((p) => createCratesDryRunPublishTask(p)),
          { concurrent: false },
        ),
    };

    return [...nonCratesTasks, sequentialCratesTask];
  }
  return collectRegistries(ctx).map(dryRunRegistryTask);
}
```

Modify the `run` function. In the preflight branch, add token collection before the pipeline and use dry-run publish tasks. Add this inside the `run` function, after the `publishOnly` check and before the main `createListr` call. The full modified `run` function structure:

```typescript
export async function run(options: ResolvedOptions): Promise<void> {
  const ctx = <Ctx>{
    ...options,
    promptEnabled: !isCI && process.stdin.isTTY,
  };

  try {
    if (options.contents) process.chdir(options.contents);

    if (options.preflight) {
      // Phase 1: Collect tokens (interactive)
      const preflightListr = createListr<Ctx>({
        title: "Collecting registry tokens",
        task: async (ctx, task): Promise<void> => {
          const registries = collectRegistries(ctx);
          const tokens = await collectTokens(registries, task);
          await promptGhSecretsSync(tokens, task);

          // Phase 2: Inject tokens and switch to non-interactive mode
          const cleanup = injectTokensToEnv(tokens);
          ctx.promptEnabled = false;

          (ctx as any)._cleanupEnv = cleanup;
        },
      });

      await preflightListr.run(ctx);
    }

    if (!options.publishOnly && !options.preflight) {
      await prerequisitesCheckTask({
        skip: options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: options.skipConditionsCheck,
      }).run(ctx);
    }

    if (options.preflight) {
      await prerequisitesCheckTask({
        skip: options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: options.skipConditionsCheck,
      }).run(ctx);
    }

    await createListr<Ctx>(
      options.publishOnly
        ? {
            title: "Publishing",
            task: async (ctx, parentTask): Promise<Listr<Ctx>> =>
              parentTask.newListr(await collectPublishTasks(ctx), {
                concurrent: true,
              }),
          }
        : options.preflight
          ? [
              {
                skip: options.skipTests,
                title: "Running tests",
                task: async (ctx): Promise<void> => {
                  const packageManager = await getPackageManager();
                  try {
                    await exec(packageManager, ["run", ctx.testScript], {
                      throwOnError: true,
                    });
                  } catch (error) {
                    throw new AbstractError(
                      `Test script '${ctx.testScript}' failed. Run \`${packageManager} run ${ctx.testScript}\` locally to see full output.`,
                      { cause: error },
                    );
                  }
                },
              },
              {
                skip: options.skipBuild,
                title: "Building the project",
                task: async (ctx): Promise<void> => {
                  const packageManager = await getPackageManager();
                  try {
                    await exec(packageManager, ["run", ctx.buildScript], {
                      throwOnError: true,
                    });
                  } catch (error) {
                    throw new AbstractError(
                      `Build script '${ctx.buildScript}' failed. Run \`${packageManager} run ${ctx.buildScript}\` locally to see full output.`,
                      { cause: error },
                    );
                  }
                },
              },
              {
                title: "Validating publish (dry-run)",
                task: async (ctx, parentTask): Promise<Listr<Ctx>> =>
                  parentTask.newListr(
                    await collectDryRunPublishTasks(ctx),
                    { concurrent: true },
                  ),
              },
            ]
          : [
              // ... existing normal mode tasks unchanged ...
            ],
    ).run(ctx);

    // Cleanup env after preflight
    if (options.preflight) {
      (ctx as any)._cleanupEnv?.();
    }

    // ... existing success message code ...
  } catch (e: unknown) {
    // Cleanup env on error too
    if (options.preflight) {
      (ctx as any)._cleanupEnv?.();
    }

    consoleError(e as Error);
    await rollback();
    process.exit(1);
  }
}
```

Note: The existing normal mode task array (6 tasks starting with "Running tests") stays exactly as-is. Only the preflight branch is new code.

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/tasks/runner.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: PASS

**Step 6: Commit**

```
feat: integrate preflight mode into pipeline runner
```

---

### Task 10: Wire up preflight in CLI entry point

**Files:**
- Modify: `src/cli.ts`

**Step 1: Add preflight handling in CLI action**

In the `defaultCmd.action` callback in `src/cli.ts`, the preflight mode needs to bypass the CI check and the version requirement. Modify the action handler. After the `isCI` block (line 180-205), add a preflight branch:

The key change: when `--preflight` is set, we don't require a version (the pipeline will skip bump anyway). Set a dummy version to satisfy the type requirement:

```typescript
// Inside the action handler, after: console.clear();
// and after: if (!isCI) { await notifyNewVersion(); }

if (options.preflight) {
  // Preflight doesn't need a real version (no bump/publish)
  context.version = nextVersion || "0.0.0-preflight";
} else if (isCI) {
  // ... existing CI logic ...
} else {
  await requiredMissingInformationTasks().run(context);
}
```

Also pass `preflight` through `resolveCliOptions`. Add to the `resolveCliOptions` function return:

```typescript
preflight: options.preflight,
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run format check**

Run: `pnpm check`
Expected: PASS (or fix any formatting issues with `pnpm format`)

**Step 4: Commit**

```
feat: wire up --preflight flag in CLI entry point
```

---

### Task 11: Add token error recovery to dry-run tasks

**Files:**
- Modify: `src/tasks/dry-run-publish.ts`

When a dry-run publish fails with an auth error, prompt the user to re-enter the token, save it, re-inject into env, and retry.

**Step 1: Update dry-run-publish.ts to handle token errors**

Add imports:

```typescript
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { Db } from "../utils/db.js";
import { TOKEN_CONFIG } from "../utils/token.js";
```

Create a wrapper function for retry logic:

```typescript
async function withTokenRetry(
  registryKey: string,
  task: any,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const config = TOKEN_CONFIG[registryKey];
    if (!config) throw error;

    const message =
      error instanceof Error ? error.message.toLowerCase() : "";
    const isAuthError =
      message.includes("401") ||
      message.includes("403") ||
      message.includes("unauthorized") ||
      message.includes("forbidden") ||
      message.includes("authentication") ||
      message.includes("token") ||
      message.includes("eotp");

    if (!isAuthError) throw error;

    task.output = `Authentication failed. Re-enter ${config.promptLabel}`;
    const newToken = await task
      .prompt(ListrEnquirerPromptAdapter)
      .run<string>({
        type: "password",
        message: `Token expired or invalid. Re-enter ${config.promptLabel}`,
      });

    new Db().set(config.dbKey, newToken);
    process.env[config.envVar] = newToken;

    await action();
  }
}
```

Update each task to wrap the dry-run call with `withTokenRetry`. For example, the npm task becomes:

```typescript
export const npmDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run npm publish",
  task: async (_, task): Promise<void> => {
    task.output = "Running npm publish --dry-run...";
    await withTokenRetry("npm", task, async () => {
      const npm = await npmRegistry();
      await npm.dryRunPublish();
    });
  },
};
```

Apply the same pattern to jsr and crates tasks. For jsr, also update `JsrClient.token` when re-injecting:

```typescript
export const jsrDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run jsr publish",
  task: async (_, task): Promise<void> => {
    task.output = "Running jsr publish --dry-run...";
    await withTokenRetry("jsr", task, async () => {
      const jsr = await jsrRegistry();
      await jsr.dryRunPublish();
    });
  },
};
```

**Step 2: Update tests**

Add a test to `tests/unit/tasks/dry-run-publish.test.ts` for token retry behavior:

```typescript
describe("token error recovery", () => {
  it("retries npm dry-run after re-entering token on auth error", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("403 Forbidden"))
      .mockResolvedValueOnce(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
    } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await (npmDryRunPublishTask as any).task({}, mockTask);
    expect(mockDryRun).toHaveBeenCalledTimes(2);
  });
});
```

**Step 3: Run tests**

Run: `pnpm test tests/unit/tasks/dry-run-publish.test.ts`
Expected: PASS

**Step 4: Commit**

```
feat: add token error recovery to dry-run publish tasks
```

---

### Task 12: Create `pubm secrets sync` command

**Files:**
- Create: `src/commands/secrets.ts`
- Modify: `src/cli.ts`

**Step 1: Write the command**

Create `src/commands/secrets.ts`:

```typescript
import type { CAC } from "cac";
import { color } from "listr2";
import { AbstractError } from "../error.js";
import { loadTokensFromDb, TOKEN_CONFIG } from "../utils/token.js";
import { syncGhSecrets } from "../tasks/preflight.js";

class SecretsError extends AbstractError {
  name = "Secrets Error";
}

export function registerSecretsCommand(cli: CAC): void {
  const secretsCmd = cli.command("secrets", "Manage registry tokens");

  secretsCmd
    .command("sync", "Sync stored tokens to GitHub Secrets")
    .option("--registry <...registries>", "Target registries to sync", {
      type: String,
    })
    .action(async (options: { registry?: string }) => {
      const registries = options.registry?.split(",") ?? Object.keys(TOKEN_CONFIG);
      const tokens = loadTokensFromDb(registries);

      if (Object.keys(tokens).length === 0) {
        console.log(
          "No stored tokens found. Run `pubm --preflight` first to save tokens.",
        );
        return;
      }

      console.log(
        `Syncing ${Object.keys(tokens).length} token(s) to GitHub Secrets...`,
      );

      try {
        await syncGhSecrets(tokens);
        for (const registry of Object.keys(tokens)) {
          const config = TOKEN_CONFIG[registry];
          if (config) {
            console.log(
              `  ${color.green("✓")} ${config.ghSecretName}`,
            );
          }
        }
        console.log("\nDone.");
      } catch (error) {
        throw new SecretsError(
          "Failed to sync secrets. Ensure `gh` CLI is installed and authenticated (`gh auth login`).",
          { cause: error },
        );
      }
    });
}
```

**Step 2: Register in CLI**

In `src/cli.ts`, add import:

```typescript
import { registerSecretsCommand } from "./commands/secrets.js";
```

Add registration alongside other subcommands (around line 146):

```typescript
registerSecretsCommand(cli);
```

**Step 3: Run typecheck and format**

Run: `pnpm typecheck && pnpm check`
Expected: PASS

**Step 4: Commit**

```
feat: add `pubm secrets sync` command
```

---

### Task 13: Full verification

**Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors)

**Step 2: Run linter/formatter**

Run: `pnpm check`
Expected: PASS (or `pnpm format` to fix)

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

**Step 4: Run build**

Run: `pnpm build`
Expected: PASS (builds successfully)

**Step 5: Verify CLI help shows new flags**

Run: `node bin/cli.js --help`
Expected: Should show `--preflight` flag in help output

**Step 6: Final commit if any formatting fixes were needed**

```
style: fix formatting issues
```
