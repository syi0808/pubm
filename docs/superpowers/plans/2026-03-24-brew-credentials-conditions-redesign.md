# Brew Credentials/Checks Conditions Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make brew plugin credentials CI-only and add local git/gh auth checks, so PATs aren't required in local mode and auth failures are caught before `afterRelease`.

**Architecture:** Change `credentials` to return PAT only when `mode === "ci"`. Change `checks` to branch: CI verifies PAT existence, local verifies `gh auth status` + repo access via `execFileSync`. No `afterRelease` changes needed — it already handles token absence.

**Tech Stack:** TypeScript, vitest, `node:child_process` (`execFileSync`)

**Spec:** `docs/superpowers/specs/2026-03-24-brew-credentials-conditions-redesign.md`

---

### Task 1: Update brew-tap credentials tests

**Files:**
- Modify: `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts:645-708` (credentials describe block)

- [ ] **Step 1: Update existing credentials tests to match new conditions**

The existing test "returns credential for external repo" uses `mode: "local"` and expects 1 credential. After the redesign, local mode should return empty. Update existing tests and add new ones:

```typescript
describe("credentials", () => {
  it("returns credential for external repo in CI mode", () => {
    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(1);
    expect(creds[0].key).toBe("brew-github-token");
    expect(creds[0].env).toBe("PUBM_BREW_GITHUB_TOKEN");
  });

  it("returns empty for external repo in local mode", () => {
    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "local", publish: true },
      config: {},
      runtime: { promptEnabled: true },
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(0);
  });

  it("returns empty for same-repo formula", () => {
    const plugin = brewTap({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(0);
  });

  it("returns credential in CI mode regardless of phase", () => {
    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(1);
  });

  it("returns empty in local mode regardless of phase", () => {
    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-tap.test.ts -t "credentials"`
Expected: FAIL — "returns empty for external repo in local mode" fails (current code returns 1 credential for local+repo+publish)

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts
git commit -m "test(plugin-brew): update brew-tap credentials tests for CI-only conditions"
```

---

### Task 2: Update brew-tap credentials implementation

**Files:**
- Modify: `packages/plugins/plugin-brew/src/brew-tap.ts:55-71` (credentials function)

- [ ] **Step 1: Replace credentials condition**

Change the `credentials` function from:

```typescript
credentials: (ctx) => {
  if (!options.repo) return [];
  const phases = resolvePhases(ctx.options);
  // Return credentials for publish phase, or any CI mode (including ci-prepare for GH Secrets sync)
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
```

To:

```typescript
credentials: (ctx) => {
  // PAT is only needed in CI where interactive git/gh auth is unavailable
  if (!options.repo || ctx.options.mode !== "ci") return [];
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
```

The `resolvePhases` import may now be unused in `credentials` — but `checks` still uses it, so keep the import.

- [ ] **Step 2: Run credentials tests to verify they pass**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-tap.test.ts -t "credentials"`
Expected: PASS

- [ ] **Step 3: Run all brew-tap tests to check for regressions**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-tap.test.ts`
Expected: PASS (afterRelease tests are unaffected, existing checks tests may fail — that's expected, we update them next)

- [ ] **Step 4: Commit**

```bash
git add packages/plugins/plugin-brew/src/brew-tap.ts
git commit -m "fix(plugin-brew): restrict brew-tap credentials to CI mode only"
```

---

### Task 3: Update brew-tap checks tests

**Files:**
- Modify: `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts:710-817` (checks describe block)

The mock setup at the top of the file mocks `node:child_process` with only `execSync`. We need to add `execFileSync` to the mock since the new checks code uses it.

- [ ] **Step 1: Update the child_process mock to include execFileSync**

At the top of the file, change:

```typescript
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));
```

To:

```typescript
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));
```

And add the import + mock variable after the existing `execSync` import:

```typescript
import { execFileSync, execSync } from "node:child_process";

const mockedExecFileSync = vi.mocked(execFileSync);
```

- [ ] **Step 2: Replace the checks describe block**

Replace the entire `describe("checks", ...)` block with tests covering all four scenarios from the decision matrix:

```typescript
describe("checks", () => {
  it("returns CI PAT check when mode is ci and repo is set", () => {
    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(1);
    expect(checks[0].phase).toBe("conditions");
    expect(checks[0].title).toContain("token");
  });

  it("CI PAT check throws when token is missing", async () => {
    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = { runtime: { pluginTokens: {} } } as any;
    const taskObj = { output: "" } as any;

    await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
      "PUBM_BREW_GITHUB_TOKEN is required",
    );
  });

  it("CI PAT check succeeds when token is present", async () => {
    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {
      runtime: { pluginTokens: { "brew-github-token": "ghp_abc" } },
    } as any;
    const taskObj = { output: "" } as any;

    await checks[0].task(taskCtx, taskObj);
    expect(taskObj.output).toBe("Homebrew tap token verified");
  });

  it("returns empty checks for CI when repo is not set", () => {
    const plugin = brewTap({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(0);
  });

  it("returns empty checks for local mode without repo", () => {
    const plugin = brewTap({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(0);
  });

  it("returns gh auth check for local mode with repo", () => {
    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(1);
    expect(checks[0].phase).toBe("conditions");
    expect(checks[0].title).toContain("git/gh access");
  });

  it("local check passes when gh auth and repo access succeed", async () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {} as any;
    const taskObj = { output: "" } as any;

    await checks[0].task(taskCtx, taskObj);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["auth", "status"],
      { stdio: "pipe" },
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["repo", "view", "user/homebrew-test", "--json", "name"],
      { stdio: "pipe" },
    );
    expect(taskObj.output).toContain("Access to user/homebrew-test verified");
  });

  it("local check throws when gh auth fails", async () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (args?.[0] === "auth") throw new Error("not logged in");
      return Buffer.from("");
    });

    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {} as any;
    const taskObj = { output: "" } as any;

    await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
      "GitHub CLI is not authenticated",
    );
  });

  it("local check throws when repo access fails", async () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (args?.[0] === "repo") throw new Error("not found");
      return Buffer.from("");
    });

    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {} as any;
    const taskObj = { output: "" } as any;

    await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
      "Cannot access tap repository",
    );
  });

  it("local check extracts owner/repo from full GitHub URL", async () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "https://github.com/user/homebrew-test.git",
    });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {} as any;
    const taskObj = { output: "" } as any;

    await checks[0].task(taskCtx, taskObj);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["repo", "view", "user/homebrew-test", "--json", "name"],
      { stdio: "pipe" },
    );
  });

  it("local check skips repo view for non-GitHub URL and only verifies gh auth", async () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "https://gitlab.com/group/homebrew-tap.git",
    });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {} as any;
    const taskObj = { output: "" } as any;

    await checks[0].task(taskCtx, taskObj);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["auth", "status"],
      { stdio: "pipe" },
    );
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(taskObj.output).toBe("GitHub CLI authenticated");
  });

  it("returns empty checks when local mode and phases do not include publish", () => {
    mockedResolvePhases.mockReturnValueOnce(["prepare"]);

    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(0);
  });

  it("returns checks in CI mode even when phases only include prepare", () => {
    mockedResolvePhases.mockReturnValueOnce(["prepare"]);

    const plugin = brewTap({
      formula: "Formula/test.rb",
      repo: "user/homebrew-test",
    });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run checks tests to verify they fail**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-tap.test.ts -t "checks"`
Expected: FAIL — new local check tests fail because the implementation still uses old logic

- [ ] **Step 4: Commit failing tests**

```bash
git add packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts
git commit -m "test(plugin-brew): update brew-tap checks tests for local gh auth verification"
```

---

### Task 4: Update brew-tap checks implementation

**Files:**
- Modify: `packages/plugins/plugin-brew/src/brew-tap.ts:72-92` (checks function)

- [ ] **Step 1: Replace checks function**

Change the `checks` function from:

```typescript
checks: (ctx) => {
  if (!options.repo) return [];
  const phases = resolvePhases(ctx.options);
  // Return checks for publish phase, or any CI mode (including ci-prepare for GH Secrets sync)
  if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];
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
```

To:

```typescript
checks: (ctx) => {
  const phases = resolvePhases(ctx.options);
  if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];

  // CI: verify PAT exists (only relevant when repo is set)
  if (ctx.options.mode === "ci") {
    if (!options.repo) return [];
    return [
      {
        title: "Checking Homebrew tap token availability",
        phase: "conditions" as const,
        task: async (ctx, task) => {
          const token = ctx.runtime.pluginTokens?.["brew-github-token"];
          if (!token) {
            throw new Error(
              "PUBM_BREW_GITHUB_TOKEN is required for Homebrew tap publishing.",
            );
          }
          task.output = "Homebrew tap token verified";
        },
      },
    ];
  }

  // Local, !repo: no checks needed — git push uses existing auth,
  // gh pr create is only a fallback
  if (!options.repo) return [];

  // Local, repo: verify gh auth + repo access
  const targetRepo = options.repo;
  return [
    {
      title: "Checking git/gh access for Homebrew tap",
      phase: "conditions" as const,
      task: async (_ctx, task) => {
        const { execFileSync } = await import("node:child_process");

        try {
          execFileSync("gh", ["auth", "status"], { stdio: "pipe" });
          task.output = "GitHub CLI authenticated";
        } catch {
          throw new Error(
            "GitHub CLI is not authenticated. Run `gh auth login` first.",
          );
        }

        const repoName = /^[^/]+\/[^/]+$/.test(targetRepo)
          ? targetRepo
          : targetRepo.match(
              /github\.com[/:]([^/]+\/[^/.]+)/,
            )?.[1];
        if (repoName) {
          try {
            execFileSync(
              "gh",
              ["repo", "view", repoName, "--json", "name"],
              { stdio: "pipe" },
            );
            task.output = `Access to ${repoName} verified`;
          } catch {
            throw new Error(
              `Cannot access tap repository '${targetRepo}'. Check your GitHub permissions.`,
            );
          }
        }
      },
    },
  ];
},
```

- [ ] **Step 2: Run all brew-tap tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-tap.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/plugins/plugin-brew/src/brew-tap.ts
git commit -m "fix(plugin-brew): add local gh auth checks for brew-tap, CI-only PAT check"
```

---

### Task 5: Update brew-core credentials tests

**Files:**
- Modify: `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts:335-377` (credentials describe block)

- [ ] **Step 1: Update credentials tests**

Replace the `describe("credentials", ...)` block:

```typescript
describe("credentials", () => {
  it("returns credential in CI mode", () => {
    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(1);
    expect(creds[0].key).toBe("brew-github-token");
    expect(creds[0].env).toBe("PUBM_BREW_GITHUB_TOKEN");
  });

  it("returns empty in local mode", () => {
    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "local", publish: true },
      config: {},
      runtime: { promptEnabled: true },
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(0);
  });

  it("returns credential in CI mode regardless of phase", () => {
    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(1);
  });

  it("returns empty in local mode regardless of phase", () => {
    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const creds = plugin.credentials!(ctx);
    expect(creds).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-core.test.ts -t "credentials"`
Expected: FAIL — "returns empty in local mode" fails

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/plugins/plugin-brew/tests/unit/brew-core.test.ts
git commit -m "test(plugin-brew): update brew-core credentials tests for CI-only conditions"
```

---

### Task 6: Update brew-core credentials implementation

**Files:**
- Modify: `packages/plugins/plugin-brew/src/brew-core.ts:58-75` (credentials function)

- [ ] **Step 1: Replace credentials condition**

Change the `credentials` function from:

```typescript
credentials: (ctx) => {
  const phases = resolvePhases(ctx.options);
  // Return credentials for publish phase, or any CI mode (including ci-prepare for GH Secrets sync)
  if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];
  return [
    {
      key: "brew-github-token",
      env: "PUBM_BREW_GITHUB_TOKEN",
      label: "GitHub PAT for Homebrew (homebrew-core)",
      tokenUrl:
        "https://github.com/settings/tokens/new?scopes=repo,workflow",
      tokenUrlLabel: "github.com",
      ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
      required: true,
    },
  ];
},
```

To:

```typescript
credentials: (ctx) => {
  // PAT is only needed in CI where interactive gh auth is unavailable
  if (ctx.options.mode !== "ci") return [];
  return [
    {
      key: "brew-github-token",
      env: "PUBM_BREW_GITHUB_TOKEN",
      label: "GitHub PAT for Homebrew (homebrew-core)",
      tokenUrl:
        "https://github.com/settings/tokens/new?scopes=repo,workflow",
      tokenUrlLabel: "github.com",
      ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
      required: true,
    },
  ];
},
```

The `resolvePhases` import is still used by `checks`, so keep it.

- [ ] **Step 2: Run credentials tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-core.test.ts -t "credentials"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/plugins/plugin-brew/src/brew-core.ts
git commit -m "fix(plugin-brew): restrict brew-core credentials to CI mode only"
```

---

### Task 7: Update brew-core checks tests

**Files:**
- Modify: `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts:379-457` (checks describe block)

- [ ] **Step 1: Update the child_process mock to include execFileSync**

Same as brew-tap: update the mock at the top of the file:

```typescript
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));
```

Add import:

```typescript
import { execFileSync, execSync } from "node:child_process";

const mockedExecFileSync = vi.mocked(execFileSync);
```

- [ ] **Step 2: Replace the checks describe block**

```typescript
describe("checks", () => {
  it("returns CI PAT check when mode is ci", () => {
    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(1);
    expect(checks[0].phase).toBe("conditions");
    expect(checks[0].title).toContain("token");
  });

  it("CI PAT check throws when token is missing", async () => {
    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = { runtime: { pluginTokens: {} } } as any;
    const taskObj = { output: "" } as any;

    await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
      "PUBM_BREW_GITHUB_TOKEN is required",
    );
  });

  it("CI PAT check succeeds when token is present", async () => {
    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {
      runtime: { pluginTokens: { "brew-github-token": "tkn" } },
    } as any;
    const taskObj = { output: "" } as any;

    await checks[0].task(taskCtx, taskObj);
    expect(taskObj.output).toBe("Homebrew core token verified");
  });

  it("returns gh auth + homebrew-core access check in local mode", () => {
    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(1);
    expect(checks[0].phase).toBe("conditions");
    expect(checks[0].title).toContain("GitHub CLI access");
  });

  it("local check passes when gh auth and homebrew-core access succeed", async () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {} as any;
    const taskObj = { output: "" } as any;

    await checks[0].task(taskCtx, taskObj);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["auth", "status"],
      { stdio: "pipe" },
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["repo", "view", "homebrew/homebrew-core", "--json", "name"],
      { stdio: "pipe" },
    );
    expect(taskObj.output).toContain("Access to homebrew/homebrew-core verified");
  });

  it("local check throws when gh auth fails", async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not logged in");
    });

    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {} as any;
    const taskObj = { output: "" } as any;

    await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
      "GitHub CLI is not authenticated",
    );
  });

  it("local check throws when homebrew-core access fails", async () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (args?.[0] === "repo") throw new Error("not found");
      return Buffer.from("");
    });

    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    const taskCtx = {} as any;
    const taskObj = { output: "" } as any;

    await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
      "Cannot access homebrew/homebrew-core",
    );
  });

  it("returns empty checks when local mode and phases do not include publish", () => {
    mockedResolvePhases.mockReturnValueOnce(["prepare"]);

    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "local" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(0);
  });

  it("returns checks in CI mode even when phases only include prepare", () => {
    mockedResolvePhases.mockReturnValueOnce(["prepare"]);

    const plugin = brewCore({ formula: "Formula/test.rb" });
    const ctx = {
      options: { mode: "ci" },
      config: {},
      runtime: {},
    } as any;

    const checks = plugin.checks!(ctx);
    expect(checks).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run checks tests to verify they fail**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-core.test.ts -t "checks"`
Expected: FAIL — local check tests fail because implementation still uses old logic

- [ ] **Step 4: Commit failing tests**

```bash
git add packages/plugins/plugin-brew/tests/unit/brew-core.test.ts
git commit -m "test(plugin-brew): update brew-core checks tests for local gh auth verification"
```

---

### Task 8: Update brew-core checks implementation

**Files:**
- Modify: `packages/plugins/plugin-brew/src/brew-core.ts:75-94` (checks function)

- [ ] **Step 1: Replace checks function**

Change the `checks` function from:

```typescript
checks: (ctx) => {
  const phases = resolvePhases(ctx.options);
  // Return checks for publish phase, or any CI mode (including ci-prepare for GH Secrets sync)
  if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];
  return [
    {
      title: "Checking Homebrew core token availability",
      phase: "conditions" as const,
      task: async (ctx, task) => {
        const token = ctx.runtime.pluginTokens?.["brew-github-token"];
        if (!token) {
          throw new Error(
            "PUBM_BREW_GITHUB_TOKEN is required for homebrew-core publishing.",
          );
        }
        task.output = "Homebrew core token verified";
      },
    },
  ];
},
```

To:

```typescript
checks: (ctx) => {
  const phases = resolvePhases(ctx.options);
  if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];

  // CI: verify PAT exists
  if (ctx.options.mode === "ci") {
    return [
      {
        title: "Checking Homebrew core token availability",
        phase: "conditions" as const,
        task: async (ctx, task) => {
          const token = ctx.runtime.pluginTokens?.["brew-github-token"];
          if (!token) {
            throw new Error(
              "PUBM_BREW_GITHUB_TOKEN is required for homebrew-core publishing.",
            );
          }
          task.output = "Homebrew core token verified";
        },
      },
    ];
  }

  // Local: verify gh auth + homebrew-core access (needed for fork + PR)
  return [
    {
      title: "Checking GitHub CLI access for homebrew-core",
      phase: "conditions" as const,
      task: async (_ctx, task) => {
        const { execFileSync } = await import("node:child_process");

        try {
          execFileSync("gh", ["auth", "status"], { stdio: "pipe" });
          task.output = "GitHub CLI authenticated";
        } catch {
          throw new Error(
            "GitHub CLI is not authenticated. Run `gh auth login` first.",
          );
        }

        try {
          execFileSync(
            "gh",
            ["repo", "view", "homebrew/homebrew-core", "--json", "name"],
            { stdio: "pipe" },
          );
          task.output = "Access to homebrew/homebrew-core verified";
        } catch {
          throw new Error(
            "Cannot access homebrew/homebrew-core. Check your GitHub permissions.",
          );
        }
      },
    },
  ];
},
```

- [ ] **Step 2: Run all brew-core tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-core.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/plugins/plugin-brew/src/brew-core.ts
git commit -m "fix(plugin-brew): add local gh auth checks for brew-core, CI-only PAT check"
```

---

### Task 9: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run all plugin-brew tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run`
Expected: All tests PASS

- [ ] **Step 2: Run format check**

Run: `bun run format`
Expected: No errors

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 4: Run coverage**

Run: `cd packages/plugins/plugin-brew && bun vitest --run --coverage`
Expected: Coverage meets thresholds (90% lines/functions/statements/branches)

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests PASS across the monorepo

- [ ] **Step 6: Commit any format fixes if needed**

```bash
git add -A
git commit -m "chore: format fixes"
```
