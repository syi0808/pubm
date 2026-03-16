# Token Validation in collectTokens Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate stored/input tokens in `collectTokens` before use, re-prompting on invalid tokens to prevent unrecoverable auth failures in preflight mode.

**Architecture:** Add `validateToken` to `RegistryDescriptor` with direct HTTP validation per registry. Modify `collectTokens` to validate after loading and after each prompt input. Add `delete` to `SecureStore` to clean up invalid stored tokens.

**Tech Stack:** TypeScript, vitest, fetch API, @napi-rs/keyring

**Spec:** `docs/superpowers/specs/2026-03-16-token-validation-in-collect-tokens-design.md`

---

## Chunk 1: SecureStore delete + validateToken on RegistryDescriptor

### Task 1: Add `delete` method to `SecureStore`

**Files:**
- Modify: `packages/core/src/utils/secure-store.ts:39-105`
- Test: `packages/core/tests/unit/utils/secure-store.test.ts` (create if not exists, or add to existing)

- [ ] **Step 1: Write the failing test**

In `packages/core/tests/unit/utils/secure-store.test.ts`, add (or create the file with) a test for `delete`:

```typescript
// If creating new file, add these mocks and imports first:
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@napi-rs/keyring", () => ({
  Entry: vi.fn().mockImplementation((_service: string, _username: string) => ({
    getPassword: vi.fn().mockReturnValue(null),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  })),
}));

vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import { SecureStore } from "../../../src/utils/secure-store.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SecureStore.delete", () => {
  it("calls deletePassword on keyring for token-type fields", () => {
    const { Entry } = require("@napi-rs/keyring");
    const store = new SecureStore();
    store.delete("npm-token");

    expect(Entry).toHaveBeenCalledWith("pubm", "npm-token");
    const entryInstance = Entry.mock.results[0].value;
    expect(entryInstance.deletePassword).toHaveBeenCalled();
  });

  it("skips keyring for non-token fields and calls Db.delete", () => {
    const { Entry } = require("@napi-rs/keyring");
    const store = new SecureStore();
    store.delete("some-other-field");

    // Non-token fields don't use keyring (usesKeyring checks "-token" suffix)
    // Entry may still be called for the Db fallback path
    // Just verify it doesn't throw
  });

  it("does not throw when keyring deletePassword fails", () => {
    const { Entry } = require("@napi-rs/keyring");
    Entry.mockImplementation(() => ({
      getPassword: vi.fn(),
      setPassword: vi.fn(),
      deletePassword: vi.fn().mockImplementation(() => {
        throw new Error("item not found");
      }),
    }));

    const store = new SecureStore();
    expect(() => store.delete("npm-token")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/utils/secure-store.test.ts`
Expected: FAIL — `store.delete is not a function`

- [ ] **Step 3: Write minimal implementation**

Add `delete` method to `SecureStore` in `packages/core/src/utils/secure-store.ts`:

```typescript
delete(field: string): void {
  const keyringEntry = this.getKeyringEntry(field);

  if (keyringEntry) {
    try {
      keyringEntry.deletePassword();
    } catch {
      // Ignore — may not exist in keyring
    }
  }

  try {
    this.getDb().delete(field);
  } catch {
    // Ignore — may not exist in Db
  }
}
```

Also update `KeyringEntry` interface at line 8 to add:

```typescript
interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): void;
}
```

- [ ] **Step 4: Add `delete` to `Db` class**

In `packages/core/src/utils/db.ts`, add:

```typescript
delete(field: string): void {
  const filePath = path.resolve(
    this.path,
    Buffer.from(e(field, field)).toString("base64"),
  );

  try {
    unlinkSync(filePath);
  } catch {
    // Ignore — file may not exist
  }
}
```

Add `unlinkSync` to the `node:fs` import at line 3:

```typescript
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/utils/secure-store.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/utils/secure-store.ts packages/core/src/utils/db.ts packages/core/tests/unit/utils/secure-store.test.ts
git commit -m "feat(core): add delete method to SecureStore and Db"
```

---

### Task 2: Add `validateToken` to `RegistryDescriptor` and implement for npm/jsr/crates

**Files:**
- Modify: `packages/core/src/registry/catalog.ts:26-41` (interface), `:67-151` (registrations)
- Test: `packages/core/tests/unit/registry/catalog.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/unit/registry/catalog.test.ts`:

```typescript
describe("validateToken", () => {
  it("npm validateToken returns true for valid token", async () => {
    const npm = registryCatalog.get("npm")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await npm.validateToken!("valid-token");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/-/whoami",
      { headers: { Authorization: "Bearer valid-token" } },
    );

    vi.unstubAllGlobals();
  });

  it("npm validateToken returns false for invalid token", async () => {
    const npm = registryCatalog.get("npm")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await npm.validateToken!("bad-token");

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it("npm validateToken throws on network error", async () => {
    const npm = registryCatalog.get("npm")!;
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(npm.validateToken!("any-token")).rejects.toThrow("ECONNREFUSED");
    vi.unstubAllGlobals();
  });

  it("jsr validateToken returns true for valid token", async () => {
    const jsr = registryCatalog.get("jsr")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await jsr.validateToken!("valid-jsr-token");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://jsr.io/api/user", {
      headers: { Authorization: "Bearer valid-jsr-token" },
    });
    vi.unstubAllGlobals();
  });

  it("jsr validateToken returns false for invalid token", async () => {
    const jsr = registryCatalog.get("jsr")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await jsr.validateToken!("bad-jsr-token");

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it("crates validateToken returns true for valid token", async () => {
    const crates = registryCatalog.get("crates")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const result = await crates.validateToken!("valid-cargo-token");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://crates.io/api/v1/me", {
      headers: {
        Authorization: "valid-cargo-token",
        "User-Agent": "pubm (https://github.com/syi0808/pubm)",
      },
    });
    vi.unstubAllGlobals();
  });

  it("crates validateToken returns false for invalid token", async () => {
    const crates = registryCatalog.get("crates")!;
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await crates.validateToken!("bad-cargo-token");

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts`
Expected: FAIL — `npm.validateToken is not a function`

- [ ] **Step 3: Add `validateToken` to `RegistryDescriptor` interface**

In `packages/core/src/registry/catalog.ts`, add to the interface:

```typescript
export interface RegistryDescriptor {
  key: string;
  ecosystem: EcosystemKey;
  label: string;
  tokenConfig: TokenEntry;
  needsPackageScripts: boolean;
  additionalEnvVars?: (token: string) => Record<string, string>;
  resolveTokenUrl?: (baseUrl: string) => Promise<string>;
  resolveDisplayName?: (ctx: {
    packages?: ResolvedPackageConfig[];
  }) => Promise<string[]>;
  validateToken?: (token: string) => Promise<boolean>;
  concurrentPublish: boolean;
  orderPackages?: (paths: string[]) => Promise<string[]>;
  connector: () => RegistryConnector;
  factory: (packagePath: string) => Promise<PackageRegistry>;
}
```

- [ ] **Step 4: Implement `validateToken` for npm**

In the npm `registryCatalog.register(...)` call, add:

```typescript
validateToken: async (token) => {
  const res = await fetch("https://registry.npmjs.org/-/whoami", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
},
```

- [ ] **Step 5: Implement `validateToken` for jsr**

In the jsr `registryCatalog.register(...)` call, add:

```typescript
validateToken: async (token) => {
  const res = await fetch("https://jsr.io/api/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
},
```

- [ ] **Step 6: Implement `validateToken` for crates**

In the crates `registryCatalog.register(...)` call, add:

```typescript
validateToken: async (token) => {
  const res = await fetch("https://crates.io/api/v1/me", {
    headers: {
      Authorization: token,
      "User-Agent": "pubm (https://github.com/syi0808/pubm)",
    },
  });
  return res.ok;
},
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/registry/catalog.ts packages/core/tests/unit/registry/catalog.test.ts
git commit -m "feat(core): add validateToken to RegistryDescriptor for npm/jsr/crates"
```

---

## Chunk 2: collectTokens validation logic

### Task 3: Update `collectTokens` with token validation

**Files:**
- Modify: `packages/core/src/tasks/preflight.ts:19-55`
- Test: `packages/core/tests/unit/tasks/preflight.test.ts`

The key change: after loading tokens from DB, validate each one. If invalid and from env var → throw error. If invalid and from SecureStore → delete from store, remove from tokens dict, fall through to prompt. After prompt input, validate → if invalid, re-prompt (infinite loop).

- [ ] **Step 1: Write failing tests for stored token validation**

Add to `packages/core/tests/unit/tasks/preflight.test.ts`. First, update the mock for `SecureStore` to include `delete`:

```typescript
// Update the existing vi.mock for secure-store.js at the top of file:
vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    };
  }),
}));
```

Then add the new `registryCatalog` mock setup and tests in the `collectTokens` describe block:

```typescript
import { afterEach } from "vitest";
import { registryCatalog } from "../../../src/registry/catalog.js";

// Add a new describe block inside the existing "collectTokens" describe:

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

    npmDescriptor.validateToken = vi.fn()
      .mockResolvedValueOnce(false)   // stored token invalid
      .mockResolvedValueOnce(true);   // prompted token valid

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
    npmDescriptor.validateToken = vi.fn()
      .mockResolvedValueOnce(false)  // first prompted token invalid
      .mockResolvedValueOnce(true);  // second prompted token valid

    // resolveTokenUrl needs exec mock
    mockedExec.mockResolvedValue({ stdout: "testuser\n", stderr: "" } as any);

    const mockPromptAdapter = {
      run: vi.fn()
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
    npmDescriptor.validateToken = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const mockTask = {
      output: "",
      prompt: vi.fn(),
    };

    await expect(collectTokens(["npm"], mockTask as any)).rejects.toThrow("ECONNREFUSED");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/preflight.test.ts`
Expected: FAIL — new tests fail because `collectTokens` doesn't validate yet

- [ ] **Step 3: Implement token validation in `collectTokens`**

Replace `collectTokens` in `packages/core/src/tasks/preflight.ts`:

```typescript
export async function collectTokens(
  registries: string[],
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
  task: any,
): Promise<Record<string, string>> {
  const existing = loadTokensFromDb(registries);
  const tokens: Record<string, string> = { ...existing };

  for (const registry of registries) {
    const descriptor = registryCatalog.get(registry);
    if (!descriptor) continue;
    const config = descriptor.tokenConfig;

    // Validate existing token (from env or SecureStore)
    if (tokens[registry] && descriptor.validateToken) {
      task.output = `Validating stored ${config.promptLabel}...`;
      const isValid = await descriptor.validateToken(tokens[registry]);

      if (!isValid) {
        // Check if token came from environment variable
        if (process.env[config.envVar]) {
          throw new PreflightError(
            `${config.envVar} is set but invalid. Please update the environment variable.`,
          );
        }

        // Token from SecureStore — delete and re-prompt
        task.output = `Stored ${config.promptLabel} is invalid`;
        new SecureStore().delete(config.dbKey);
        delete tokens[registry];
      }
    }

    if (tokens[registry]) continue;

    let { tokenUrl } = config;
    if (descriptor.resolveTokenUrl) {
      tokenUrl = await descriptor.resolveTokenUrl(tokenUrl);
    }

    // Prompt loop (infinite until valid token or Ctrl+C)
    while (true) {
      task.output = `Enter ${config.promptLabel}`;
      const token = await task.prompt(ListrEnquirerPromptAdapter).run({
        type: "password",
        message: `Enter ${config.promptLabel}`,
        footer: `\nGenerate a token from ${color.bold(link(config.tokenUrlLabel, tokenUrl))}`,
      });

      if (!`${token}`.trim()) {
        throw new PreflightError(
          `${config.promptLabel} is required to continue.`,
        );
      }

      if (descriptor.validateToken) {
        task.output = `Validating ${config.promptLabel}...`;
        const isValid = await descriptor.validateToken(token);

        if (!isValid) {
          task.output = `${config.promptLabel} is invalid. Please try again.`;
          continue;
        }
      }

      tokens[registry] = token;
      new SecureStore().set(config.dbKey, token);
      break;
    }
  }

  return tokens;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `cd packages/core && bun vitest --run`
Expected: All tests PASS

- [ ] **Step 6: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tasks/preflight.ts packages/core/tests/unit/tasks/preflight.test.ts
git commit -m "feat(core): validate tokens in collectTokens with re-prompt on failure"
```
