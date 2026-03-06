# Error Handling Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Comprehensive error handling sweep across the pubm publish pipeline — fix logic bugs, stabilize rollbacks, prevent infinite loops, add auto-recovery, improve error messages, and remove silent failures.

**Architecture:** Six sequential phases, each independently testable and committable. Each phase targets a specific category of error handling gaps. Tests use vitest with mocked dependencies (tinyexec, node:fs, global fetch).

**Tech Stack:** TypeScript, vitest, tinyexec, listr2

---

### Task 1: Fix `cleanWorkingTree` flag logic bug

**Files:**
- Modify: `src/tasks/prerequisites-check.ts:104-125`
- Test: `tests/unit/tasks/prerequisites-check.test.ts`

**Step 1: Write the failing test**

Add a test that verifies `cleanWorkingTree` remains `false` when the working tree is dirty and the user skips:

```typescript
it("sets cleanWorkingTree to false when working tree is dirty and user skips", async () => {
  // Mock git.status() to return non-empty (dirty)
  // Mock prompt to return true (skip)
  // Assert ctx.cleanWorkingTree === false after task
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/tasks/prerequisites-check.test.ts -t "cleanWorkingTree"`
Expected: FAIL — `ctx.cleanWorkingTree` is `true` (the bug)

**Step 3: Fix the implementation**

In `src/tasks/prerequisites-check.ts`, change lines 104-125 from:

```typescript
task: async (ctx, task): Promise<void> => {
  if (await git.status()) {
    // ... prompt logic ...
    ctx.cleanWorkingTree = false;
  }

  ctx.cleanWorkingTree = true;  // BUG: unconditional
},
```

To:

```typescript
task: async (ctx, task): Promise<void> => {
  if (await git.status()) {
    // ... prompt logic (unchanged) ...
    ctx.cleanWorkingTree = false;
    return;
  }

  ctx.cleanWorkingTree = true;
},
```

Add `return;` after `ctx.cleanWorkingTree = false;` so the unconditional `true` at the bottom only runs when the tree is clean.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/tasks/prerequisites-check.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: correct cleanWorkingTree flag logic in prerequisites check
```

---

### Task 2: Fix `getScopeAndName` returning undefined strings

**Files:**
- Modify: `src/utils/package-name.ts:11-17`
- Test: `tests/unit/utils/package-name.test.ts`

**Step 1: Update the existing test expectations**

The existing tests expect `["undefined", "undefined"]` for invalid inputs. Change these to expect the function to throw:

```typescript
describe("getScopeAndName", () => {
  it("returns scope and name for valid scoped packages", () => {
    expect(getScopeAndName("@scope/package")).toEqual(["scope", "package"]);
    expect(getScopeAndName("@myOrg/myPkg")).toEqual(["myOrg", "myPkg"]);
  });

  it("throws for unscoped packages", () => {
    expect(() => getScopeAndName("package")).toThrow("Invalid scoped package name");
  });

  it("throws for empty string", () => {
    expect(() => getScopeAndName("")).toThrow("Invalid scoped package name");
  });

  it("throws for non-matching scoped formats", () => {
    expect(() => getScopeAndName("@my-org/my-pkg")).toThrow("Invalid scoped package name");
    expect(() => getScopeAndName("@scope/name.with.dots")).toThrow("Invalid scoped package name");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/utils/package-name.test.ts -t "getScopeAndName"`
Expected: FAIL — function returns instead of throwing

**Step 3: Fix the implementation**

In `src/utils/package-name.ts`, change:

```typescript
export function getScopeAndName(packageName: string): [string, string] {
  const matches = packageName.match(/^@([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)$/);

  if (!matches) {
    throw new Error(
      `Invalid scoped package name: '${packageName}'. Expected format: @scope/name`,
    );
  }

  return [matches[1], matches[2]];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/utils/package-name.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: throw on invalid scoped package name in getScopeAndName
```

---

### Task 3: Fix copy-paste error message in `git.tags()`

**Files:**
- Modify: `src/git.ts:41`
- Test: `tests/unit/git.test.ts`

**Step 1: Write the failing test**

```typescript
it("throws with correct error message when git tag -l fails", async () => {
  // Mock git execution to reject
  await expect(git.tags()).rejects.toThrow("Failed to run `git tag -l`");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/git.test.ts -t "tags"`
Expected: FAIL — error message says "git config --get user.name"

**Step 3: Fix the implementation**

In `src/git.ts:41`, change:

```typescript
throw new GitError("Failed to run `git config --get user.name`", {
```

To:

```typescript
throw new GitError("Failed to run `git tag -l`", {
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/git.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: correct error message for git tag -l failure
```

---

### Task 4: Fix `isPackageNameAvaliable` returning true on network error

**Files:**
- Modify: `src/registry/crates.ts:93-103`
- Test: `tests/unit/registry/crates.test.ts`

**Step 1: Write the failing test**

```typescript
it("throws when fetch fails due to network error", async () => {
  mockedFetch.mockRejectedValue(new Error("network error"));
  await expect(registry.isPackageNameAvaliable()).rejects.toThrow();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/registry/crates.test.ts -t "isPackageNameAvaliable"`
Expected: FAIL — returns `true` instead of throwing

**Step 3: Fix the implementation**

In `src/registry/crates.ts`, change `isPackageNameAvaliable`:

```typescript
async isPackageNameAvaliable(): Promise<boolean> {
  try {
    const response = await fetch(
      `${this.registry}/api/v1/crates/${this.packageName}`,
      { headers: this.headers },
    );
    return !response.ok;
  } catch (error) {
    throw new CratesError(
      `Failed to check package name availability on crates.io`,
      { cause: error },
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/registry/crates.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: throw on network error in crates isPackageNameAvaliable
```

---

### Task 5: Add exit code on CLI error

**Files:**
- Modify: `src/cli.ts:214-216`
- Test: `tests/unit/cli.test.ts`

**Step 1: Write the failing test**

```typescript
it("sets process.exitCode to 1 on error", async () => {
  // Mock pubm to throw
  // Run CLI action
  // Assert process.exitCode === 1
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/cli.test.ts -t "exitCode"`
Expected: FAIL

**Step 3: Fix the implementation**

In `src/cli.ts`, in the catch block (line 214-216), add `process.exitCode = 1`:

```typescript
} catch (e) {
  consoleError(e as Error);
  process.exitCode = 1;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/cli.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: set process.exitCode on CLI error for CI environments
```

---

### Task 6: Phase 1 complete — run full test suite

Run: `pnpm test`
Expected: All tests pass

Commit (if any adjustments were needed):

```
fix: phase 1 logic bug fixes adjustments
```

---

### Task 7: Stabilize rollback with `Promise.allSettled`

**Files:**
- Modify: `src/utils/rollback.ts`
- Test: `tests/unit/utils/rollback.test.ts`

**Step 1: Write the failing test**

```typescript
it("continues executing remaining rollbacks when one throws", async () => {
  const fn1 = vi.fn().mockRejectedValue(new Error("rollback 1 failed"));
  const fn2 = vi.fn().mockResolvedValue(undefined);
  const fn3 = vi.fn().mockResolvedValue(undefined);

  addRollback(fn1, {});
  addRollback(fn2, {});
  addRollback(fn3, {});

  await rollback();

  expect(fn1).toHaveBeenCalledOnce();
  expect(fn2).toHaveBeenCalledOnce();
  expect(fn3).toHaveBeenCalledOnce();
});

it("logs failed rollback operations", async () => {
  const spy = vi.spyOn(console, "error");
  const fn1 = vi.fn().mockRejectedValue(new Error("cleanup failed"));

  addRollback(fn1, {});

  await rollback();

  expect(spy).toHaveBeenCalledWith(
    expect.stringContaining("Rollback operation failed"),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/utils/rollback.test.ts`
Expected: FAIL — `Promise.all` aborts on first rejection

**Step 3: Fix the implementation**

Replace `src/utils/rollback.ts`:

```typescript
type Rollback<Ctx extends {}> = (ctx: Ctx) => Promise<unknown>;

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
const rollbacks: { fn: Rollback<any>; ctx: unknown }[] = [];

export function addRollback<Ctx extends {}>(
  rollback: Rollback<Ctx>,
  context: Ctx,
): void {
  rollbacks.push({ fn: rollback, ctx: context });
}

let called = false;

export async function rollback(): Promise<void> {
  if (called) return void 0;

  called = true;

  if (rollbacks.length <= 0) return void 0;

  console.log("Rollback...");

  const results = await Promise.allSettled(
    rollbacks.map(({ fn, ctx }) => fn(ctx)),
  );

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `Rollback operation failed: ${failure.reason instanceof Error ? failure.reason.message : failure.reason}`,
      );
    }
    console.log(
      "Rollback completed with errors. Some operations may require manual recovery.",
    );
  } else {
    console.log("Rollback completed");
  }
}
```

**Step 4: Update existing tests**

The existing test `'logs "Rollback..." and "Rollback completed"'` still passes (success case logs same messages). Update the test `"executes multiple rollbacks concurrently via Promise.all"` — it should still pass since `Promise.allSettled` also runs concurrently.

**Step 5: Run test to verify it passes**

Run: `pnpm test -- tests/unit/utils/rollback.test.ts`
Expected: PASS

**Step 6: Commit**

```
fix: use Promise.allSettled for rollback stability
```

---

### Task 8: Wrap rollback callbacks in runner.ts with try-catch

**Files:**
- Modify: `src/tasks/runner.ts:115-128`
- Test: `tests/unit/tasks/runner.test.ts`

**Step 1: Write the failing test**

```typescript
it("rollback continues when git.deleteTag throws", async () => {
  // Mock git operations where deleteTag throws but reset/stash should still run
  // Verify reset and stash are still called
});
```

**Step 2: Fix the implementation**

In `src/tasks/runner.ts`, wrap the rollback callback internals:

```typescript
addRollback(async () => {
  if (tagCreated) {
    try {
      console.log("Deleting tag...");
      await git.deleteTag(`${await git.latestTag()}`);
    } catch (error) {
      console.error(
        `Failed to delete tag: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  if (commited) {
    try {
      console.log("Reset commits...");
      await git.reset();
      await git.stash();
      await git.reset("HEAD^", "--hard");
      await git.popStash();
    } catch (error) {
      console.error(
        `Failed to reset commits: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}, ctx);
```

**Step 3: Run test to verify it passes**

Run: `pnpm test -- tests/unit/tasks/runner.test.ts`
Expected: PASS

**Step 4: Commit**

```
fix: wrap rollback callbacks with try-catch in runner
```

---

### Task 9: Add max retry to JSR token input loop

**Files:**
- Modify: `src/tasks/jsr.ts:52-68`
- Test: `tests/unit/tasks/jsr.test.ts`

**Step 1: Write the failing test**

```typescript
it("throws after 3 failed token attempts", async () => {
  // Mock jsr.client.user() to always return null (invalid token)
  // Mock prompt to return a token string
  // Assert that after 3 attempts, it throws
});
```

**Step 2: Fix the implementation**

In `src/tasks/jsr.ts`, replace the `while (true)` loop:

```typescript
if (ctx.promptEnabled) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    JsrClient.token = await task
      .prompt(ListrEnquirerPromptAdapter)
      .run<string>({
        type: "password",
        message: `Please enter the jsr ${color.bold("API token")}${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`,
        footer: `\nGenerate a token from ${color.bold(link("jsr.io", "https://jsr.io/account/tokens/create/"))}. ${color.red("You should select")} ${color.bold("'Interact with the JSR API'")}.`,
      });

    try {
      if (await jsr.client.user()) break;

      if (attempt < maxAttempts) {
        task.output =
          "The jsr API token is invalid. Please re-enter a valid token.";
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.message.includes("ENOTFOUND"))
      ) {
        throw new JsrAvailableError(
          "JSR API is unreachable. Check your network connection.",
          { cause: error },
        );
      }

      if (attempt < maxAttempts) {
        task.output =
          "The jsr API token is invalid. Please re-enter a valid token.";
      }
    }

    if (attempt === maxAttempts) {
      throw new JsrAvailableError(
        "JSR token verification failed after 3 attempts.",
      );
    }
  }
}
```

**Step 3: Run test to verify it passes**

Run: `pnpm test -- tests/unit/tasks/jsr.test.ts`
Expected: PASS

**Step 4: Commit**

```
fix: limit JSR token input to 3 attempts with network error distinction
```

---

### Task 10: Add max retry to npm OTP input loop

**Files:**
- Modify: `src/tasks/npm.ts:58-78`
- Test: `tests/unit/tasks/npm.test.ts`

**Step 1: Write the failing test**

```typescript
it("throws after 3 failed OTP attempts", async () => {
  // Mock npm.publish() to always return false (OTP needed)
  // Assert throws after 3 attempts
});
```

**Step 2: Fix the implementation**

In `src/tasks/npm.ts`, replace the OTP loop:

```typescript
if (ctx.promptEnabled) {
  let result = await npm.publish();

  if (!result) {
    task.title = "Running npm publish (OTP code needed)";
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      result = await npm.publish(
        await task.prompt(ListrEnquirerPromptAdapter).run<string>({
          type: "password",
          message: `npm OTP code${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`,
        }),
      );

      if (result) break;

      if (attempt < maxAttempts) {
        task.output = "2FA failed. Please try again.";
      }
    }

    if (!result) {
      throw new NpmAvailableError(
        "OTP verification failed after 3 attempts.",
      );
    }

    task.title = "Running npm publish (2FA passed)";
  }
}
```

**Step 3: Run test to verify it passes**

Run: `pnpm test -- tests/unit/tasks/npm.test.ts`
Expected: PASS

**Step 4: Commit**

```
fix: limit npm OTP input to 3 attempts
```

---

### Task 11: Auto npm login on `npm whoami` failure

**Files:**
- Modify: `src/tasks/npm.ts:19-48`
- Test: `tests/unit/tasks/npm.test.ts`

**Step 1: Write tests**

```typescript
it("attempts npm login when not logged in and TTY is available", async () => {
  // Mock isLoggedIn to return false first, then true after login
  // Mock execSync for npm login
  // Assert npm login was called
});

it("shows CI-specific message when not logged in and not TTY", async () => {
  // Mock isLoggedIn to return false
  // ctx.promptEnabled = false
  // Assert error message mentions NODE_AUTH_TOKEN
});
```

**Step 2: Fix the implementation**

In `src/tasks/npm.ts`, modify `npmAvailableCheckTasks`:

```typescript
export const npmAvailableCheckTasks: ListrTask<Ctx> = {
  title: "Checking npm avaliable for publising",
  skip: (ctx) => !!ctx.preview,
  task: async (ctx): Promise<void> => {
    const npm = await npmRegistry();

    if (!(await npm.isLoggedIn())) {
      if (ctx.promptEnabled) {
        try {
          await exec("npm", ["login"], {
            throwOnError: true,
            nodeOptions: { stdio: "inherit" },
          });
        } catch (error) {
          throw new NpmAvailableError(
            "npm login failed. Please run `npm login` manually and try again.",
            { cause: error },
          );
        }

        if (!(await npm.isLoggedIn())) {
          throw new NpmAvailableError(
            "Still not logged in after npm login. Please verify your credentials.",
          );
        }
      } else {
        throw new NpmAvailableError(
          "Not logged in to npm. Set NODE_AUTH_TOKEN in your CI environment. For GitHub Actions, add it as a repository secret.",
        );
      }

      return void 0;
    }

    // ... rest of existing checks unchanged ...
  },
};
```

Add the `exec` import from `tinyexec` at the top of `src/tasks/npm.ts`.

**Step 3: Run test to verify it passes**

Run: `pnpm test -- tests/unit/tasks/npm.test.ts`
Expected: PASS

**Step 4: Commit**

```
feat: auto npm login on whoami failure with CI-specific guidance
```

---

### Task 12: Improve CI token error message in npm publish

**Files:**
- Modify: `src/tasks/npm.ts:80-86`

**Step 1: Fix the implementation**

Change the error message:

```typescript
if (!npmTokenEnv) {
  throw new NpmAvailableError(
    "NODE_AUTH_TOKEN not found in environment variables. Set it in your CI configuration:\n" +
      "  GitHub Actions: Add NODE_AUTH_TOKEN as a repository secret\n" +
      "  Other CI: Export NODE_AUTH_TOKEN with your npm access token",
  );
}
```

**Step 2: Run tests**

Run: `pnpm test -- tests/unit/tasks/npm.test.ts`
Expected: PASS (update any test that matches the old exact error message)

**Step 3: Commit**

```
fix: improve CI token error message with setup instructions
```

---

### Task 13: Classify npm publish errors beyond EOTP

**Files:**
- Modify: `src/registry/npm.ts:141-182`
- Test: `tests/unit/registry/npm.test.ts`

**Step 1: Write tests**

```typescript
it("throws descriptive error for 403 forbidden", async () => {
  mockedExec.mockRejectedValue(
    Object.assign(new Error(), {
      output: { stderr: "403 Forbidden" },
    }),
  );
  await expect(registry.publish()).rejects.toThrow("forbidden");
});

it("throws descriptive error for rate limit", async () => {
  mockedExec.mockRejectedValue(
    Object.assign(new Error(), {
      output: { stderr: "429 Too Many Requests" },
    }),
  );
  await expect(registry.publish()).rejects.toThrow("rate");
});
```

**Step 2: Fix the implementation**

In `src/registry/npm.ts`, enhance the catch block in `publish()` and `publishProvenance()`. Extract a helper method:

```typescript
private classifyPublishError(error: unknown): NpmError {
  if (error instanceof NonZeroExitError) {
    const stderr = error.output?.stderr ?? "";

    if (stderr.includes("EOTP")) {
      return new NpmError("OTP required for publishing", { cause: error });
    }
    if (stderr.includes("403") || stderr.includes("Forbidden")) {
      return new NpmError(
        "Permission denied (403 Forbidden). Check your npm access token permissions.",
        { cause: error },
      );
    }
    if (stderr.includes("429") || stderr.includes("Too Many Requests")) {
      return new NpmError(
        "Rate limited by npm registry. Please wait and try again.",
        { cause: error },
      );
    }
  }

  return new NpmError("Failed to publish to npm", { cause: error });
}
```

Update `publish()` and `publishProvenance()` to use this helper for non-EOTP errors while keeping the existing EOTP → `return false` behavior.

**Step 3: Run tests**

Run: `pnpm test -- tests/unit/registry/npm.test.ts`
Expected: PASS

**Step 4: Commit**

```
feat: classify npm publish errors (403, rate limit, EOTP)
```

---

### Task 14: Add JSON parse error handling in npm registry

**Files:**
- Modify: `src/registry/npm.ts:80-97, 107-120`
- Test: `tests/unit/registry/npm.test.ts`

**Step 1: Write tests**

```typescript
it("throws descriptive error when collaborators returns invalid JSON", async () => {
  mockedExec.mockResolvedValue({ stdout: "not json", stderr: "" } as any);
  await expect(registry.collaborators()).rejects.toThrow(
    "Unexpected response from npm registry",
  );
});
```

**Step 2: Fix the implementation**

Wrap `JSON.parse()` calls in `collaborators()` and `distTags()`:

```typescript
async collaborators(): Promise<Record<string, string>> {
  try {
    const output = await this.npm([
      "access", "list", "collaborators", this.packageName, "--json",
    ]);

    try {
      return JSON.parse(output);
    } catch {
      throw new NpmError(
        `Unexpected response from npm registry for collaborators of '${this.packageName}'`,
      );
    }
  } catch (error) {
    if (error instanceof NpmError) throw error;
    throw new NpmError(
      `Failed to run \`npm access list collaborators ${this.packageName} --json\``,
      { cause: error },
    );
  }
}
```

Apply same pattern to `distTags()`.

**Step 3: Run tests**

Run: `pnpm test -- tests/unit/registry/npm.test.ts`
Expected: PASS

**Step 4: Commit**

```
fix: handle JSON parse errors in npm registry methods
```

---

### Task 15: Improve JSR API response error messages

**Files:**
- Modify: `src/registry/jsr.ts` (createScope, deleteScope, createPackage, deletePackage methods)
- Test: `tests/unit/registry/jsr.test.ts`

**Step 1: Write tests**

```typescript
it("throws with API error details when createScope returns non-2xx", async () => {
  mockedFetch.mockResolvedValue({
    status: 400,
    ok: false,
    json: async () => ({ message: "scope already exists" }),
  });
  await expect(client.createScope("test")).rejects.toThrow("scope already exists");
});
```

**Step 2: Fix the implementation**

For `createScope`, `deleteScope`, `createPackage`, `deletePackage` — when the response is not the expected status, parse the body for an error message:

```typescript
async createScope(scope: string): Promise<boolean> {
  try {
    const response = await this.fetch("/scopes", {
      method: "POST",
      body: JSON.stringify({ scope }),
    });

    if (response.status === 200 || response.status === 201) return true;

    let detail = "";
    try {
      const body = await response.json();
      detail = body.message || body.error || JSON.stringify(body);
    } catch {}

    throw new JsrError(
      `Failed to create scope '${scope}': HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
    );
  } catch (error) {
    if (error instanceof JsrError) throw error;
    throw new JsrError(`Failed to fetch \`${this.apiEndpoint}/scopes\``, {
      cause: error,
    });
  }
}
```

Apply same pattern to `deleteScope`, `createPackage`, `deletePackage`.

**Step 3: Run tests**

Run: `pnpm test -- tests/unit/registry/jsr.test.ts`
Expected: PASS

**Step 4: Commit**

```
feat: include API error details in JSR registry error messages
```

---

### Task 16: Distinguish 404 vs server error in crates.io registry

**Files:**
- Modify: `src/registry/crates.ts:42-63`
- Test: `tests/unit/registry/crates.test.ts`

**Step 1: Write tests**

```typescript
it("throws 'Crate not found' for 404", async () => {
  mockedFetch.mockResolvedValue({ ok: false, status: 404 });
  await expect(registry.version()).rejects.toThrow("not found");
});

it("throws 'crates.io API error' for 5xx", async () => {
  mockedFetch.mockResolvedValue({ ok: false, status: 500 });
  await expect(registry.version()).rejects.toThrow("API error");
});
```

**Step 2: Fix the implementation**

```typescript
async version(): Promise<string> {
  try {
    const response = await fetch(
      `${this.registry}/api/v1/crates/${this.packageName}`,
      { headers: this.headers },
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new CratesError(`Crate '${this.packageName}' not found on crates.io`);
      }
      throw new CratesError(
        `crates.io API error (HTTP ${response.status}) for crate '${this.packageName}'`,
      );
    }

    const data = (await response.json()) as {
      crate: { max_version: string };
    };
    return data.crate.max_version;
  } catch (error) {
    if (error instanceof CratesError) throw error;
    throw new CratesError(
      `Cannot reach crates.io to fetch version for '${this.packageName}'`,
      { cause: error },
    );
  }
}
```

**Step 3: Run tests**

Run: `pnpm test -- tests/unit/registry/crates.test.ts`
Expected: PASS

**Step 4: Commit**

```
feat: distinguish 404 vs server error in crates.io version check
```

---

### Task 17: Wrap test/build script failures with context

**Files:**
- Modify: `src/tasks/runner.ts:78-87`
- Test: `tests/unit/tasks/runner.test.ts`

**Step 1: Fix the implementation**

In the "Running tests" task, wrap the exec call:

```typescript
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
```

**Step 2: Run tests**

Run: `pnpm test -- tests/unit/tasks/runner.test.ts`
Expected: PASS

**Step 3: Commit**

```
fix: wrap test script failure with actionable error message
```

---

### Task 18: Add file write error context in `replaceVersion`

**Files:**
- Modify: `src/utils/package.ts:223-256`
- Test: `tests/unit/utils/package.test.ts`

**Step 1: Fix the implementation**

Wrap `writeFile` calls in `replaceVersion`:

```typescript
export async function replaceVersion(version: string): Promise<string[]> {
  const results = await Promise.all([
    (async () => {
      const packageJsonPath = await findOutFile("package.json");

      if (!packageJsonPath) return void 0;

      const packageJson = (await readFile(packageJsonPath)).toString();

      try {
        await writeFile(
          packageJsonPath,
          packageJson.replace(versionRegex, `$1${version}$2`),
        );
      } catch (error) {
        throw new AbstractError(
          `Failed to write version to package.json: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }

      return "package.json";
    })(),
    (async () => {
      const jsrJsonPath = await findOutFile("jsr.json");

      if (!jsrJsonPath) return void 0;

      const jsrJson = (await readFile(jsrJsonPath)).toString();

      try {
        await writeFile(
          jsrJsonPath,
          jsrJson.replace(versionRegex, `$1${version}$2`),
        );
      } catch (error) {
        throw new AbstractError(
          `Failed to write version to jsr.json: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }

      return "jsr.json";
    })(),
  ]);

  return results.filter((v) => v) as unknown as string[];
}
```

**Step 2: Run tests**

Run: `pnpm test -- tests/unit/utils/package.test.ts`
Expected: PASS

**Step 3: Commit**

```
fix: add file write error context in replaceVersion
```

---

### Task 19: Distinguish token read failures in `db.ts`

**Files:**
- Modify: `src/utils/db.ts:41-57`
- Test: `tests/unit/utils/db.test.ts`

**Step 1: Write tests**

```typescript
it("returns null and warns on decryption failure", () => {
  const db = new Db();
  // Write corrupted data directly
  const spy = vi.spyOn(console, "warn");

  // Manually write bad data to the store
  const { writeFileSync } = require("node:fs");
  // ... set up corrupted encrypted file ...

  const result = db.get("token");
  expect(result).toBeNull();
  expect(spy).toHaveBeenCalledWith(expect.stringContaining("corrupted"));
});
```

**Step 2: Fix the implementation**

In `src/utils/db.ts`, improve the `get` method:

```typescript
get(field: string): string | null {
  const filePath = path.resolve(
    this.path,
    Buffer.from(e(field, field)).toString("base64"),
  );

  try {
    readFileSync(filePath);
  } catch {
    return null; // File not found
  }

  try {
    return d(
      Buffer.from(readFileSync(filePath)).toString(),
      field,
    );
  } catch {
    console.warn(
      `Stored token for '${field}' appears corrupted. It will be re-requested.`,
    );
    return null;
  }
}
```

**Step 3: Run tests**

Run: `pnpm test -- tests/unit/utils/db.test.ts`
Expected: PASS

**Step 4: Commit**

```
fix: distinguish file-not-found from decryption failure in Db.get
```

---

### Task 20: Add write error handling in `db.ts`

**Files:**
- Modify: `src/utils/db.ts:20-31, 33-39`
- Test: `tests/unit/utils/db.test.ts`

**Step 1: Write test**

```typescript
it("throws with context when writeFileSync fails", () => {
  const { writeFileSync } = require("node:fs");
  vi.mocked(writeFileSync).mockImplementation(() => {
    throw new Error("EACCES: permission denied");
  });

  const db = new Db();
  expect(() => db.set("token", "value")).toThrow("Failed to save token");
});
```

**Step 2: Fix the implementation**

Wrap `writeFileSync` and `mkdirSync` in the constructor:

```typescript
constructor() {
  try {
    if (!statSync(this.path).isDirectory()) {
      mkdirSync(this.path);
    }
  } catch {
    try {
      mkdirSync(this.path);
    } catch (error) {
      throw new Error(
        `Failed to create token storage directory at '${this.path}': ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

set(field: string, value: unknown): void {
  try {
    writeFileSync(
      path.resolve(this.path, Buffer.from(e(field, field)).toString("base64")),
      Buffer.from(e(`${value}`, field)),
      { encoding: "binary" },
    );
  } catch (error) {
    throw new Error(
      `Failed to save token for '${field}': ${error instanceof Error ? error.message : error}`,
    );
  }
}
```

**Step 3: Run tests**

Run: `pnpm test -- tests/unit/utils/db.test.ts`
Expected: PASS

**Step 4: Commit**

```
fix: add error handling for db write operations
```

---

### Task 21: Disambiguate null returns in JSR registry

**Files:**
- Modify: `src/registry/jsr.ts:220-239` (package method)
- Test: `tests/unit/registry/jsr.test.ts`

**Step 1: Write test**

```typescript
it("returns null for 404 but throws for server errors", async () => {
  mockedFetch.mockResolvedValue({ ok: false, status: 404 });
  expect(await client.package("@scope/name")).toBeNull();

  mockedFetch.mockResolvedValue({ ok: false, status: 500 });
  await expect(client.package("@scope/name")).rejects.toThrow();
});
```

**Step 2: Fix the implementation**

In `JsrClient.package()`:

```typescript
async package(
  packageName: string,
): Promise<JsrApi.Scopes.Packages.Package | null> {
  const [scope, name] = getScopeAndName(packageName);

  try {
    const response = await this.fetch(`/scopes/${scope}/packages/${name}`);

    if (response.status === 404) return null;

    if (!response.ok) {
      throw new JsrError(
        `JSR API error (HTTP ${response.status}) for package '${packageName}'`,
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof JsrError) throw error;
    throw new JsrError(
      `Failed to fetch \`${this.apiEndpoint}/scopes/${scope}/packages/${name}\``,
      { cause: error },
    );
  }
}
```

**Step 3: Run tests**

Run: `pnpm test -- tests/unit/registry/jsr.test.ts`
Expected: PASS

**Step 4: Commit**

```
fix: disambiguate null returns vs API errors in JSR package lookup
```

---

### Task 22: Log warning for silent npm fallback in package manager detection

**Files:**
- Modify: `src/utils/package-manager.ts:17-18`
- Test: `tests/unit/utils/package-manager.test.ts`

**Step 1: Write test**

```typescript
it("logs warning when no lock file is found and defaults to npm", async () => {
  // Mock findOutFile to always return null
  const spy = vi.spyOn(console, "warn");

  const pm = await getPackageManager();

  expect(pm).toBe("npm");
  expect(spy).toHaveBeenCalledWith(
    expect.stringContaining("No lock file found"),
  );
});
```

**Step 2: Fix the implementation**

```typescript
export async function getPackageManager(): Promise<PackageManager> {
  for (const [packageManager, lockFiles] of Object.entries(lockFile)) {
    for (const lockFile of lockFiles) {
      if (await findOutFile(lockFile)) return packageManager as PackageManager;
    }
  }

  console.warn("No lock file found, defaulting to npm.");
  return "npm";
}
```

**Step 3: Run tests**

Run: `pnpm test -- tests/unit/utils/package-manager.test.ts`
Expected: PASS

**Step 4: Commit**

```
fix: log warning when defaulting to npm without lock file
```

---

### Task 23: Final verification — full test suite

Run: `pnpm test`
Expected: All tests pass

Run: `pnpm check`
Expected: No lint/format errors

Run: `pnpm typecheck`
Expected: No type errors

Fix any issues found, then commit:

```
chore: final adjustments for error handling improvements
```

---

### Task 24: Commit the implementation plan and wrap up

Commit the plan document if not already committed. Verify all phases are complete:

- Phase 1: Logic bug fixes (Tasks 1-6)
- Phase 2: Rollback stability (Tasks 7-8)
- Phase 3: Infinite loop prevention (Tasks 9-10)
- Phase 4: Auto-recovery logic (Tasks 11-12)
- Phase 5: Error message improvement (Tasks 13-18)
- Phase 6: Silent failure removal (Tasks 19-22)
- Final verification (Task 23)
