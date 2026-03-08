# Pretty Error & Log Formatting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make pubm's error output and rollback logs clean, readable, and visually appealing by removing noise (stack traces, duplicate stderr, useless cause chains) and adding styled formatting.

**Architecture:** Rewrite `formatError` in `src/error.ts` to split error messages into summary + detail blocks with dim gutter formatting. Add `rollbackLog`/`rollbackError` helpers in `src/utils/rollback.ts` for styled rollback output. Filter `NonZeroExitError` cause chains that add no value.

**Tech Stack:** listr2 `color` utility (already used), Node.js

---

### Task 1: Rewrite error formatting — tests

**Files:**
- Modify: `tests/unit/error.test.ts`

**Step 1: Update existing tests to match new behavior (no stack traces by default)**

Replace the stack trace test and update cause chain tests:

```typescript
// Replace the existing "should include stack trace information" test
it("should NOT include stack traces by default", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("stack test");

  consoleError(error);

  const output = spy.mock.calls[0][0] as string;
  // Should not contain file paths from stack trace
  expect(output).not.toMatch(/at .+\.\w+:\d+:\d+/);
});

it("should include stack traces when DEBUG=pubm is set", () => {
  const originalDebug = process.env.DEBUG;
  process.env.DEBUG = "pubm";

  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("debug test");

  consoleError(error);

  const output = spy.mock.calls[0][0] as string;
  expect(output).toContain("at");

  process.env.DEBUG = originalDebug;
});
```

**Step 2: Add tests for stderr gutter formatting**

```typescript
it("should format stderr blocks with gutter lines", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new AbstractError(
    "Failed to run `cargo publish --dry-run`:\nerror: failed to prepare\n\nCaused by:\n  no matching package",
  );

  consoleError(error);

  const output = spy.mock.calls[0][0] as string;
  // Summary line should be present
  expect(output).toContain("Failed to run");
  // Detail lines should have gutter
  expect(output).toContain("│");
  expect(output).toContain("error: failed to prepare");
});
```

**Step 3: Add test for cause chain filtering**

```typescript
it("should skip NonZeroExitError in cause chain", async () => {
  const { NonZeroExitError } = await import("tinyexec");
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});

  const cause = new NonZeroExitError({ exitCode: 101 } as any, {
    stdout: "",
    stderr: "",
  });
  const error = new AbstractError("Failed to publish", { cause });

  consoleError(error);

  const output = spy.mock.calls[0][0] as string;
  expect(output).toContain("Failed to publish");
  expect(output).not.toContain("Caused:");
  expect(output).not.toContain("non-zero");
});

it("should show cause chain when cause has meaningful info", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const cause = new AbstractError("network timeout");
  const error = new AbstractError("Failed to ping registry", { cause });

  consoleError(error);

  const output = spy.mock.calls[0][0] as string;
  expect(output).toContain("Caused:");
  expect(output).toContain("network timeout");
});
```

**Step 4: Run tests to verify they fail**

Run: `pnpm vitest --run tests/unit/error.test.ts`
Expected: FAIL — old behavior still shows stack traces and doesn't have gutter formatting

---

### Task 2: Rewrite error formatting — implementation

**Files:**
- Modify: `src/error.ts`

**Step 1: Implement the new `formatError` function**

Replace the entire content of `src/error.ts`:

```typescript
import { color } from "listr2";
import { NonZeroExitError } from "tinyexec";

export class AbstractError extends Error {
  cause?: unknown;

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    // @ts-expect-error
    super(message, { cause });

    this.cause = cause;
  }
}

function replaceCode(code: string): string {
  return code.replace(/`([^`].+)`/g, color.bold(color.underline("$1")));
}

function formatStderr(stderr: string): string {
  return stderr
    .split("\n")
    .map((line) => `  ${color.dim("│")} ${line}`)
    .join("\n");
}

function isNoisyCause(cause: unknown): boolean {
  if (cause instanceof NonZeroExitError) return true;
  if (
    cause instanceof Error &&
    /Process exited with non-zero status/i.test(cause.message)
  )
    return true;
  return false;
}

function formatError(error: AbstractError | string): string {
  if (!(error instanceof Error)) return `${error}`;

  const rawMessage =
    typeof error.message === "string"
      ? error.message
      : /* v8 ignore next */ String(error);

  // Split message into summary + stderr detail
  const newlineIndex = rawMessage.indexOf("\n");
  let summary: string;
  let detail: string | undefined;

  if (newlineIndex !== -1) {
    summary = rawMessage.slice(0, newlineIndex);
    detail = rawMessage.slice(newlineIndex + 1);
  } else {
    summary = rawMessage;
  }

  let result = `${color.bgRed(` ${error.name} `)}${color.reset("")} ${replaceCode(summary)}\n`;

  if (detail) {
    result += `\n${formatStderr(detail)}\n`;
  }

  // Stack trace only in debug mode
  if (process.env.DEBUG === "pubm" && error.stack) {
    result += error.stack
      .split("\n")
      .slice(1)
      .join("\n")
      .replace(/at/g, color.dim("at"))
      .replace(/\(([^(].+)\)/g, `(${color.blue("$1")})`);
  }

  // Show cause only if meaningful
  if (error.cause && !isNoisyCause(error.cause)) {
    result += `\n${color.dim("Caused by:")} `;
    result += formatError(error.cause as AbstractError);
  }

  return result;
}

export function consoleError(error: string | Error): void {
  let errorText = "\n";

  if (typeof error === "string") {
    errorText += replaceCode(error);
  } else if (error instanceof Error) {
    errorText += formatError(error);
  } else {
    errorText += error;
  }

  console.error(`${errorText}\n`);
}
```

**Step 2: Run tests to verify they pass**

Run: `pnpm vitest --run tests/unit/error.test.ts`
Expected: PASS

**Step 3: Run full test suite to check for regressions**

Run: `pnpm test`
Expected: PASS — no regressions

**Step 4: Commit**

```
git add src/error.ts tests/unit/error.test.ts
git commit -m "refactor: rewrite error formatting with gutter-style stderr and no stack traces"
```

---

### Task 3: Style rollback messages — tests

**Files:**
- Modify: `tests/unit/utils/rollback.test.ts`

**Step 1: Update existing rollback log tests**

The test at line 41 checks for exact strings `"Rollback..."` and `"Rollback completed"`. Update these to match new styled output. Also add tests for the new `rollbackLog` and `rollbackError` helpers.

```typescript
// Update the existing test (line 41-49):
it("logs styled rollback start and completion", async () => {
  const spy = vi.spyOn(console, "log");
  const fn = vi.fn().mockResolvedValue(undefined);

  addRollback(fn, {});
  await rollback();

  const startCall = spy.mock.calls.find((c) =>
    (c[0] as string).includes("Rolling back"),
  );
  const doneCall = spy.mock.calls.find((c) =>
    (c[0] as string).includes("Rollback completed"),
  );
  expect(startCall).toBeDefined();
  expect(doneCall).toBeDefined();
});

// Update the partial completion test (line 109-124):
it("logs styled error completion message when some rollbacks fail", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  const fn1 = vi.fn().mockRejectedValue(new Error("oops"));
  const fn2 = vi.fn().mockResolvedValue(undefined);

  addRollback(fn1, {});
  addRollback(fn2, {});

  await rollback();

  const errorCompletion = logSpy.mock.calls.find((c) =>
    (c[0] as string).includes("Rollback completed with errors"),
  );
  expect(errorCompletion).toBeDefined();
});

// Update the failed rollback log test (line 95-107):
it("logs styled failed rollback operations", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  const fn = vi.fn().mockRejectedValue(new Error("disk full"));

  addRollback(fn, {});
  await rollback();

  const failCall = errorSpy.mock.calls.find((c) =>
    (c[0] as string).includes("disk full"),
  );
  expect(failCall).toBeDefined();
});
```

**Step 2: Add tests for `rollbackLog` and `rollbackError` helpers**

```typescript
describe("rollbackLog", () => {
  it("logs sub-operation with arrow prefix", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    rollbackLog("Deleting tag");

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("↩");
    expect(output).toContain("Deleting tag");
  });
});

describe("rollbackError", () => {
  it("logs error with cross prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    rollbackError("Failed to delete tag");

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("✗");
    expect(output).toContain("Failed to delete tag");
  });
});
```

Note: `rollbackLog` and `rollbackError` must also be imported in the `beforeEach` block alongside `addRollback` and `rollback`.

**Step 3: Run tests to verify they fail**

Run: `pnpm vitest --run tests/unit/utils/rollback.test.ts`
Expected: FAIL — rollbackLog/rollbackError don't exist yet, strings don't match

---

### Task 4: Style rollback messages — implementation

**Files:**
- Modify: `src/utils/rollback.ts`

**Step 1: Implement styled rollback**

Replace the content of `src/utils/rollback.ts`:

```typescript
import { color } from "listr2";

type Rollback<Ctx extends {}> = (ctx: Ctx) => Promise<unknown>;

// biome-ignore lint/suspicious/noExplicitAny: generic rollback storage requires any
const rollbacks: { fn: Rollback<any>; ctx: unknown }[] = [];

export function addRollback<Ctx extends {}>(
  rollback: Rollback<Ctx>,
  context: Ctx,
): void {
  rollbacks.push({ fn: rollback, ctx: context });
}

export function rollbackLog(message: string): void {
  console.log(`  ${color.yellow("↩")} ${message}`);
}

export function rollbackError(message: string): void {
  console.error(`  ${color.red("✗")} ${message}`);
}

let called = false;

export async function rollback(): Promise<void> {
  if (called) return void 0;

  called = true;

  if (rollbacks.length <= 0) return void 0;

  console.log(`\n${color.yellow("⟲")} ${color.yellow("Rolling back...")}`);

  const results = await Promise.allSettled(
    rollbacks.map(({ fn, ctx }) => fn(ctx)),
  );

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      rollbackError(
        failure.reason instanceof Error
          ? failure.reason.message
          : failure.reason,
      );
    }
    console.log(
      `${color.red("✗")} ${color.red("Rollback completed with errors.")} Some operations may require manual recovery.`,
    );
  } else {
    console.log(`${color.green("✓")} Rollback completed`);
  }
}
```

**Step 2: Run rollback tests to verify they pass**

Run: `pnpm vitest --run tests/unit/utils/rollback.test.ts`
Expected: PASS

**Step 3: Commit**

```
git add src/utils/rollback.ts tests/unit/utils/rollback.test.ts
git commit -m "refactor: style rollback messages with colored icons"
```

---

### Task 5: Use rollback log helpers in runner.ts

**Files:**
- Modify: `src/tasks/runner.ts`

**Step 1: Update imports**

Add `rollbackLog` and `rollbackError` to the existing import from `../utils/rollback.js`:

```typescript
import { addRollback, rollback, rollbackLog, rollbackError } from "../utils/rollback.js";
```

**Step 2: Replace plain console.log/error calls in the rollback callback (lines 238-261)**

Replace:
```typescript
console.log("Deleting tag...");
```
With:
```typescript
rollbackLog("Deleting tag");
```

Replace:
```typescript
console.error(
  `Failed to delete tag: ${error instanceof Error ? error.message : error}`,
);
```
With:
```typescript
rollbackError(
  `Failed to delete tag: ${error instanceof Error ? error.message : error}`,
);
```

Replace:
```typescript
console.log("Reset commits...");
```
With:
```typescript
rollbackLog("Resetting commits");
```

Replace:
```typescript
console.error(
  `Failed to reset commits: ${error instanceof Error ? error.message : error}`,
);
```
With:
```typescript
rollbackError(
  `Failed to reset commits: ${error instanceof Error ? error.message : error}`,
);
```

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: PASS

**Step 4: Commit**

```
git add src/tasks/runner.ts
git commit -m "refactor: use rollback log helpers in runner"
```

---

### Task 6: Clean up cargo stderr noise

**Files:**
- Modify: `src/registry/crates.ts`
- Modify: `tests/unit/registry/crates.test.ts`

**Step 1: Add a stderr cleaning helper to crates.ts**

Add this function before the `CratesRegistry` class:

```typescript
function cleanCargoStderr(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      // Remove noise lines
      if (trimmed === "Updating crates.io index") return false;
      if (trimmed === "") return false;
      return true;
    })
    .join("\n");
}
```

**Step 2: Use it in `publish` and `dryRunPublish`**

In both methods, replace `${stderr}` with `${cleanCargoStderr(stderr)}`.

In `publish` (line 86):
```typescript
const message = stderr
  ? `Failed to run \`cargo publish\`:\n${cleanCargoStderr(stderr)}`
  : "Failed to run `cargo publish`";
```

In `dryRunPublish` (line 103):
```typescript
const message = stderr
  ? `Failed to run \`cargo publish --dry-run\`:\n${cleanCargoStderr(stderr)}`
  : "Failed to run `cargo publish --dry-run`";
```

**Step 3: Add test for stderr cleaning**

In `tests/unit/registry/crates.test.ts`, add a test to verify noise lines are removed:

```typescript
it("filters noise lines from cargo stderr", async () => {
  const { NonZeroExitError } = await import("tinyexec");
  const error = new NonZeroExitError({ exitCode: 101 } as any, {
    stdout: "",
    stderr:
      "    Updating crates.io index\nwarning: manifest has no description\n    Updating crates.io index\nerror: failed to prepare local package",
  });
  mockedExec.mockRejectedValue(error);

  try {
    await registry.dryRunPublish();
  } catch (e: any) {
    expect(e.message).not.toContain("Updating crates.io index");
    expect(e.message).toContain("warning: manifest has no description");
    expect(e.message).toContain("error: failed to prepare local package");
  }
});
```

**Step 4: Run tests**

Run: `pnpm vitest --run tests/unit/registry/crates.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/registry/crates.ts tests/unit/registry/crates.test.ts
git commit -m "refactor: filter noise lines from cargo stderr output"
```

---

### Task 7: Final verification

**Step 1: Run format and lint**

Run: `pnpm format`

**Step 2: Run typecheck**

Run: `pnpm typecheck`

**Step 3: Run full test suite with coverage**

Run: `pnpm coverage`
Expected: PASS with coverage thresholds met

**Step 4: Final commit if format changed anything**

```
git add -u
git commit -m "chore: format"
```
