# Splash Screen Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ASCII art splash screen with spinner-based update check to the pubm publish command.

**Architecture:** New `splash.ts` module in CLI package handles all presentation. Core's `notify-new-version.ts` gets a new `checkUpdateStatus()` function returning structured `UpdateStatus` data from update-kit. Core re-exports `color` from listr2 for CLI use. CLI action handler branches on TTY/CI to show splash or fall back to existing behavior.

**Tech Stack:** update-kit (existing), listr2 `color` via `@pubm/core` re-export, ANSI escape sequences for spinner

**Spec:** `docs/superpowers/specs/2026-03-14-splash-screen-design.md`

---

## Chunk 1: Core — checkUpdateStatus function and color re-export

### Task 1: Add `checkUpdateStatus()` to notify-new-version.ts

**Files:**
- Modify: `packages/core/src/utils/notify-new-version.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/unit/utils/notify-new-version.test.ts`

- [ ] **Step 1: Write failing tests for `checkUpdateStatus`**

In `packages/core/tests/unit/utils/notify-new-version.test.ts`, update the mock setup and add tests:

Update hoisted mocks:

```ts
const { mockCheckAndNotify, mockCreate, mockCheckUpdate } = vi.hoisted(() => ({
  mockCheckAndNotify: vi.fn(),
  mockCreate: vi.fn(),
  mockCheckUpdate: vi.fn(),
}));
```

Update `beforeEach` mock return:

```ts
mockCreate.mockResolvedValue({
  checkAndNotify: mockCheckAndNotify,
  checkUpdate: mockCheckUpdate,
});
```

Update import:

```ts
import { checkUpdateStatus, notifyNewVersion } from "../../../src/utils/notify-new-version.js";
```

Add new describe block:

```ts
describe("checkUpdateStatus", () => {
  it("returns update status from UpdateKit with blocking mode", async () => {
    const mockStatus = { kind: "available", current: "1.0.0", latest: "2.0.0" };
    mockCheckUpdate.mockResolvedValue(mockStatus);

    const status = await checkUpdateStatus();

    expect(mockCreate).toHaveBeenCalledWith({
      appName: "pubm",
      currentVersion: PUBM_VERSION,
      sources: [{ type: "npm", packageName: "pubm" }],
    });
    expect(mockCheckUpdate).toHaveBeenCalledWith("blocking");
    expect(status).toEqual(mockStatus);
  });

  it("returns undefined when check fails", async () => {
    mockCheckUpdate.mockRejectedValue(new Error("network error"));

    const status = await checkUpdateStatus();

    expect(status).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/utils/notify-new-version.test.ts`
Expected: FAIL — `checkUpdateStatus` is not exported

- [ ] **Step 3: Implement `checkUpdateStatus`**

In `packages/core/src/utils/notify-new-version.ts`:

```ts
import type { UpdateStatus } from "update-kit";
import { UpdateKit } from "update-kit";
import { PUBM_VERSION } from "./pubm-metadata.js";

async function createKit(): Promise<UpdateKit> {
  return UpdateKit.create({
    appName: "pubm",
    currentVersion: PUBM_VERSION,
    sources: [{ type: "npm", packageName: "pubm" }],
  });
}

export async function checkUpdateStatus(): Promise<UpdateStatus | undefined> {
  try {
    const kit = await createKit();
    return await kit.checkUpdate("blocking");
  } catch {
    return undefined;
  }
}

export async function notifyNewVersion(): Promise<void> {
  const kit = await createKit();
  const banner = await kit.checkAndNotify();
  if (banner) console.error(banner);
}
```

- [ ] **Step 4: Export `checkUpdateStatus` and re-export `color` from core index**

In `packages/core/src/index.ts`:

Update the notify-new-version export line:
```ts
export { checkUpdateStatus, notifyNewVersion } from "./utils/notify-new-version.js";
```

Add color re-export (near existing listr-related exports):
```ts
export { color } from "listr2";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/utils/notify-new-version.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full core test suite and type check**

Run: `cd packages/core && bun vitest --run && bun run typecheck`
Expected: All PASS

- [ ] **Step 7: Commit**

```
git add packages/core/src/utils/notify-new-version.ts packages/core/src/index.ts packages/core/tests/unit/utils/notify-new-version.test.ts
git commit -m "feat(core): add checkUpdateStatus and re-export color from listr2"
```

---

## Chunk 2: CLI — splash.ts module

### Task 2: Create splash module with showSplash

**Files:**
- Create: `packages/pubm/src/splash.ts`
- Create: `packages/pubm/tests/unit/splash.test.ts`

- [ ] **Step 1: Write failing tests for `showSplash`**

Create `packages/pubm/tests/unit/splash.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("showSplash", () => {
  it("writes ASCII art logo to stderr", async () => {
    const { showSplash } = await import("../../src/splash.js");

    showSplash("1.0.0");

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("pubm");
  });

  it("includes version in output", async () => {
    const { showSplash } = await import("../../src/splash.js");

    showSplash("1.2.3");

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("1.2.3");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/pubm && bun vitest --run tests/unit/splash.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `showSplash`**

Create `packages/pubm/src/splash.ts`:

```ts
import { color } from "@pubm/core";

const LOGO = `              _
 _ __  _   _ | |__   _ __ ___
| '_ \\| | | || '_ \\ | '_ \` _ \\
| |_) | |_| || |_) || | | | | |
| .__/ \\__,_||_.__/ |_| |_| |_|
|_|`;

export function showSplash(version: string): void {
  const versionLine = `v${version}`;
  const logoLines = LOGO.split("\n");
  const maxWidth = Math.max(...logoLines.map((l) => l.length));
  const paddedVersion = versionLine.padStart(maxWidth);

  process.stderr.write(`${color.dim(LOGO)}\n${color.bold(paddedVersion)}\n\n`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/pubm && bun vitest --run tests/unit/splash.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add packages/pubm/src/splash.ts packages/pubm/tests/unit/splash.test.ts
git commit -m "feat(cli): add showSplash function with ASCII art logo"
```

### Task 3: Add showSplashWithUpdateCheck

**Files:**
- Modify: `packages/pubm/src/splash.ts`
- Modify: `packages/pubm/tests/unit/splash.test.ts`

- [ ] **Step 1: Write failing tests for `showSplashWithUpdateCheck`**

Add to `packages/pubm/tests/unit/splash.test.ts` (before the existing describe blocks):

```ts
const { mockCheckUpdateStatus } = vi.hoisted(() => ({
  mockCheckUpdateStatus: vi.fn(),
}));

vi.mock("@pubm/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pubm/core")>();
  return {
    ...actual,
    checkUpdateStatus: mockCheckUpdateStatus,
  };
});
```

Add new describe block (after existing tests):

```ts
describe("showSplashWithUpdateCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows Ready when no update available", async () => {
    mockCheckUpdateStatus.mockResolvedValue({ kind: "up-to-date", current: "1.0.0" });

    const { showSplashWithUpdateCheck } = await import("../../src/splash.js");
    const promise = showSplashWithUpdateCheck("1.0.0");
    await vi.runAllTimersAsync();
    await promise;

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("Ready");
  });

  it("shows update available message when update exists", async () => {
    mockCheckUpdateStatus.mockResolvedValue({
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    });

    const { showSplashWithUpdateCheck } = await import("../../src/splash.js");
    const promise = showSplashWithUpdateCheck("1.0.0");
    await vi.runAllTimersAsync();
    await promise;

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("2.0.0");
  });

  it("shows Ready when check fails", async () => {
    mockCheckUpdateStatus.mockResolvedValue(undefined);

    const { showSplashWithUpdateCheck } = await import("../../src/splash.js");
    const promise = showSplashWithUpdateCheck("1.0.0");
    await vi.runAllTimersAsync();
    await promise;

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("Ready");
  });
});
```

Add `afterEach` import at the top:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/pubm && bun vitest --run tests/unit/splash.test.ts`
Expected: FAIL — `showSplashWithUpdateCheck` not exported

- [ ] **Step 3: Implement `showSplashWithUpdateCheck`**

Add to `packages/pubm/src/splash.ts`:

```ts
import { checkUpdateStatus, color } from "@pubm/core";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

function clearLine(): void {
  process.stderr.write("\r\x1b[K");
}

export async function showSplashWithUpdateCheck(version: string): Promise<void> {
  showSplash(version);

  let frameIndex = 0;
  const spinner = setInterval(() => {
    clearLine();
    process.stderr.write(` ${SPINNER_FRAMES[frameIndex]} Checking for updates...`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  }, SPINNER_INTERVAL);

  try {
    const status = await checkUpdateStatus();

    clearInterval(spinner);
    clearLine();

    if (status?.kind === "available") {
      process.stderr.write(
        ` ${color.green("✓")} Update available: ${status.current} → ${color.bold(status.latest)} (npm i -g pubm)\n\n`,
      );
    } else {
      process.stderr.write(` ${color.green("✓")} Ready\n\n`);
    }
  } catch {
    clearInterval(spinner);
    clearLine();
    process.stderr.write(` ${color.green("✓")} Ready\n\n`);
  }
}
```

Update the import at the top to merge both imports from `@pubm/core`:
```ts
import { checkUpdateStatus, color } from "@pubm/core";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/pubm && bun vitest --run tests/unit/splash.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```
git add packages/pubm/src/splash.ts packages/pubm/tests/unit/splash.test.ts
git commit -m "feat(cli): add showSplashWithUpdateCheck with spinner and update notification"
```

---

## Chunk 3: CLI — integrate splash into action handler

### Task 4: Integrate splash screen into cli.ts

**Files:**
- Modify: `packages/pubm/src/cli.ts`
- Test: `packages/pubm/tests/unit/cli.test.ts` (existing, verify no regressions)

- [ ] **Step 1: Read existing cli.test.ts to understand current test patterns**

Read `packages/pubm/tests/unit/cli.test.ts` to understand how the action handler is tested and whether `notifyNewVersion` is mocked.

- [ ] **Step 2: Modify cli.ts action handler**

In `packages/pubm/src/cli.ts`:

Add import:
```ts
import { showSplashWithUpdateCheck } from "./splash.js";
```

Replace:
```ts
console.clear();

if (options.snapshot && options.preflight) {
  throw new Error("Cannot use --snapshot and --preflight together.");
}

if (!isCI) {
  await notifyNewVersion();
}
```

With:
```ts
console.clear();

if (options.snapshot && options.preflight) {
  throw new Error("Cannot use --snapshot and --preflight together.");
}

if (!isCI && process.stderr.isTTY) {
  await showSplashWithUpdateCheck(PUBM_VERSION);
} else if (!isCI) {
  await notifyNewVersion();
}
```

- [ ] **Step 3: Run existing CLI tests**

Run: `cd packages/pubm && bun vitest --run tests/unit/cli.test.ts`
Expected: PASS (existing tests should still pass)

- [ ] **Step 4: Run full project checks**

Run: `bun run typecheck && bun run test`
Expected: All PASS

- [ ] **Step 5: Commit**

```
git add packages/pubm/src/cli.ts
git commit -m "feat(cli): integrate splash screen into publish command"
```

### Task 5: Final format check

- [ ] **Step 1: Run format and full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All PASS

- [ ] **Step 2: Commit if format changes**

```
git add packages/pubm/src/splash.ts packages/pubm/tests/unit/splash.test.ts packages/core/src/utils/notify-new-version.ts packages/core/src/index.ts
git commit -m "style: format splash screen files"
```
