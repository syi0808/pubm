# TUI Improvement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a central `ui.ts` theme module with chalk, migrate all console output to use it, and fix badge readability issues.

**Architecture:** Single `ui.ts` module in `packages/core/src/utils/` provides theme constants (badges, labels) and output functions (`success`, `info`, `warn`, `error`, `hint`, `debug`). Existing `cli.ts` is deleted, its exports (`warningBadge`, `link()`) moved into `ui.ts`. CLI subcommands and core modules migrate from raw `console.log/error` to `ui.*()` calls. listr2 task title/output keeps using `listr2.color` for renderer compatibility.

**Tech Stack:** chalk 5 (ESM), vitest, listr2 (unchanged internally)

---

## Chunk 1: Core ui.ts module

### Task 1: Add chalk dependency

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Install chalk**

Run: `cd packages/core && bun add chalk`

- [ ] **Step 2: Verify installation**

Run: `cd packages/core && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json bun.lock
git commit -m "deps(core): add chalk for TUI theming"
```

### Task 2: Create ui.ts with theme constants and output functions

**Files:**
- Create: `packages/core/src/utils/ui.ts`
- Create: `packages/core/tests/unit/utils/ui.test.ts`

- [ ] **Step 1: Write failing tests for theme constants**

```ts
// packages/core/tests/unit/utils/ui.test.ts
import { describe, expect, it } from "vitest";
import { ui } from "../../../src/utils/ui";

describe("ui theme constants", () => {
  describe("badges", () => {
    it("ERROR badge contains ERROR text", () => {
      expect(ui.badges.ERROR).toContain("ERROR");
    });

    it("ROLLBACK badge contains ROLLBACK text", () => {
      expect(ui.badges.ROLLBACK).toContain("ROLLBACK");
    });

    it("badge() creates a badge with custom text", () => {
      const result = ui.badge("TypeError");
      expect(result).toContain("TypeError");
    });
  });

  describe("labels", () => {
    it("WARNING label contains WARNING text", () => {
      expect(ui.labels.WARNING).toContain("WARNING");
    });

    it("NOTE label contains NOTE text", () => {
      expect(ui.labels.NOTE).toContain("NOTE");
    });

    it("INFO label contains INFO text", () => {
      expect(ui.labels.INFO).toContain("INFO");
    });

    it("SUCCESS label contains SUCCESS text", () => {
      expect(ui.labels.SUCCESS).toContain("SUCCESS");
    });

    it("HINT label contains HINT text", () => {
      expect(ui.labels.HINT).toContain("HINT");
    });

    it("DRY_RUN label contains dry-run text", () => {
      expect(ui.labels.DRY_RUN).toContain("dry-run");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/utils/ui.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write failing tests for output functions**

Add to `packages/core/tests/unit/utils/ui.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ui output functions", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("success() writes to stdout", () => {
    ui.success("done");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("done");
  });

  it("info() writes to stdout", () => {
    ui.info("scanning");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("scanning");
  });

  it("warn() writes to stderr", () => {
    ui.warn("caution");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("caution");
  });

  it("error() writes to stderr", () => {
    ui.error("failed");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("failed");
  });

  it("hint() writes to stdout", () => {
    ui.hint("try this");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("try this");
  });

  it("debug() does not output when DEBUG is unset", () => {
    const origDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    ui.debug("hidden");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    if (origDebug !== undefined) process.env.DEBUG = origDebug;
  });

  it("debug() outputs when DEBUG=pubm", () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = "pubm";
    ui.debug("visible");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("visible");
    if (origDebug !== undefined) process.env.DEBUG = origDebug;
    else delete process.env.DEBUG;
  });
});
```

- [ ] **Step 4: Write failing tests for link() and formatNote()**

Add to `packages/core/tests/unit/utils/ui.test.ts`:

```ts
describe("link", () => {
  it("produces OSC 8 hyperlink escape sequence", () => {
    const result = ui.link("click", "https://example.com");
    expect(result).toBe(
      "\u001B]8;;https://example.com\u0007click\u001B]8;;\u0007",
    );
  });
});

describe("isDebug", () => {
  it("returns true when DEBUG=pubm", () => {
    const orig = process.env.DEBUG;
    process.env.DEBUG = "pubm";
    expect(ui.isDebug()).toBe(true);
    if (orig !== undefined) process.env.DEBUG = orig;
    else delete process.env.DEBUG;
  });

  it("returns false when DEBUG is unset", () => {
    const orig = process.env.DEBUG;
    delete process.env.DEBUG;
    expect(ui.isDebug()).toBe(false);
    if (orig !== undefined) process.env.DEBUG = orig;
  });
});

describe("formatNote", () => {
  it("formats hint note with emoji and label", () => {
    const result = ui.formatNote("hint", "use patch");
    expect(result).toContain("💡");
    expect(result).toContain("Hint:");
    expect(result).toContain("use patch");
  });

  it("formats suggest note with emoji and label", () => {
    const result = ui.formatNote("suggest", "try minor");
    expect(result).toContain("📦");
    expect(result).toContain("Suggest:");
    expect(result).toContain("try minor");
  });

  it("formats warning note with emoji and label", () => {
    const result = ui.formatNote("warning", "already published");
    expect(result).toContain("⚠");
    expect(result).toContain("Warning:");
    expect(result).toContain("already published");
  });
});
```

- [ ] **Step 5: Implement ui.ts**

```ts
// packages/core/src/utils/ui.ts
import chalk from "chalk";

// --- Theme constants ---

function badge(text: string): string {
  return chalk.bgRed.white.bold(` ${text} `);
}

const badges = {
  ERROR: badge("ERROR"),
  ROLLBACK: badge("ROLLBACK"),
} as const;

const labels = {
  WARNING: chalk.yellow.bold("WARNING"),
  NOTE: chalk.blue.bold("NOTE"),
  INFO: chalk.cyan("INFO"),
  SUCCESS: chalk.green.bold("SUCCESS"),
  HINT: chalk.magenta("HINT"),
  DRY_RUN: chalk.gray.bold("[dry-run]"),
} as const;

// --- Helpers ---

function isDebug(): boolean {
  return process.env.DEBUG === "pubm";
}

function link(text: string, url: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}

type NoteType = "hint" | "suggest" | "warning";

const noteConfig: Record<NoteType, { emoji: string; label: string; style: (s: string) => string }> = {
  hint: { emoji: "💡", label: "Hint:", style: chalk.magenta },
  suggest: { emoji: "📦", label: "Suggest:", style: chalk.blue },
  warning: { emoji: "⚠", label: "Warning:", style: chalk.yellow },
};

function formatNote(type: NoteType, message: string): string {
  const cfg = noteConfig[type];
  return `${cfg.emoji} ${cfg.style(cfg.label)} ${message}`;
}

// --- Output functions ---

function success(message: string): void {
  console.log(`${chalk.green("✓")} ${message}`);
}

function info(message: string): void {
  console.log(`${labels.INFO} ${message}`);
}

function warn(message: string): void {
  console.error(`${labels.WARNING} ${message}`);
}

function error(message: string): void {
  console.error(`${badges.ERROR} ${message}`);
}

function hint(message: string): void {
  console.log(`${noteConfig.hint.emoji} ${chalk.magenta("Hint:")} ${message}`);
}

function debug(message: string): void {
  if (!isDebug()) return;
  console.error(`${chalk.gray("DEBUG")} ${message}`);
}

export const ui = {
  badge,
  badges,
  labels,
  chalk,
  success,
  info,
  warn,
  error,
  hint,
  debug,
  link,
  isDebug,
  formatNote,
} as const;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/utils/ui.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/utils/ui.ts packages/core/tests/unit/utils/ui.test.ts
git commit -m "feat(core): add central ui.ts theme module with chalk"
```

### Task 3: Export ui from core index and delete cli.ts

**Files:**
- Modify: `packages/core/src/index.ts`
- Delete: `packages/core/src/utils/cli.ts`
- Delete: `packages/core/tests/unit/utils/cli.test.ts`

- [ ] **Step 1: Add ui export to index.ts**

In `packages/core/src/index.ts`, add:
```ts
export { ui } from "./utils/ui.js";
```

Keep the existing `export { color } from "listr2"` — it's still used by listr2 task code.

- [ ] **Step 2: Update all cli.ts imports to use ui.ts**

Replace imports in these files:

**`packages/core/src/registry/jsr.ts`** — change:
```ts
import { warningBadge } from "../utils/cli.js";
```
to:
```ts
import { ui } from "../utils/ui.js";
```
Then replace all `warningBadge` usages with `ui.labels.WARNING` in prompt messages. This is a deliberate visual change: the old `warningBadge` used `bgYellow` background color (which had readability issues); the new `WARNING` label uses yellow text only per the spec. E.g.:
```ts
message: `${ui.labels.WARNING} jsr is not installed. Do you want to install jsr?`,
```

**`packages/core/src/tasks/prerequisites-check.ts`** — change:
```ts
import { warningBadge } from "../utils/cli.js";
```
to:
```ts
import { ui } from "../utils/ui.js";
```
Then replace all `${warningBadge}` with `${ui.labels.WARNING}` in prompt messages (lines 39, 65, 86, 111, 142).

**`packages/core/src/tasks/runner.ts`** — change:
```ts
import { link } from "../utils/cli.js";
```
to:
```ts
import { ui } from "../utils/ui.js";
```
Then replace `link(` calls with `ui.link(`.

**`packages/core/src/tasks/preflight.ts`** — change:
```ts
import { link } from "../utils/cli.js";
```
to:
```ts
import { ui } from "../utils/ui.js";
```
Then replace `link(` calls with `ui.link(`.

- [ ] **Step 3: Delete cli.ts and its test**

```bash
rm packages/core/src/utils/cli.ts
rm packages/core/tests/unit/utils/cli.test.ts
```

- [ ] **Step 4: Build and run tests**

Run: `cd packages/core && bun run build && bun vitest --run`
Expected: Build succeeds, all tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core): replace cli.ts with ui.ts, export ui from index"
```

## Chunk 2: Core module migration (error.ts, rollback.ts, runner.ts, notes)

### Task 4: Migrate error.ts to use chalk via ui.ts

**Files:**
- Modify: `packages/core/src/error.ts`

- [ ] **Step 1: Replace listr2 color import with ui import**

In `packages/core/src/error.ts`, change:
```ts
import { color } from "listr2";
```
to:
```ts
import { ui } from "./utils/ui.js";
```

- [ ] **Step 2: Replace all color usages with chalk via ui.chalk**

Apply these replacements throughout the file:
- `color.bold(color.underline("$1"))` → `ui.chalk.bold(ui.chalk.underline("$1"))`
- `color.dim("│")` → `ui.chalk.dim("│")`
- `color.bgRed(` ${error.name} `)` → `ui.badge(error.name)` (line 55: replace `` `${color.bgRed(` ${error.name} `)}${color.reset("")}` `` with `` `${ui.badge(error.name)}` ``). Note: use `ui.badge()` (the function) to preserve the dynamic error name, NOT `ui.badges.ERROR` which is hardcoded
- `color.dim("at")` → `ui.chalk.dim("at")`
- `color.blue("$1")` → `ui.chalk.blue("$1")`
- `color.dim("Caused by:")` → `ui.chalk.dim("Caused by:")`
- `process.env.DEBUG === "pubm"` → `ui.isDebug()`

- [ ] **Step 3: Build and run tests**

Run: `cd packages/core && bun run build && bun vitest --run`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/error.ts
git commit -m "refactor(core): migrate error.ts from listr2 color to chalk via ui"
```

### Task 5: Migrate rollback.ts to use chalk via ui.ts

**Files:**
- Modify: `packages/core/src/utils/rollback.ts`

- [ ] **Step 1: Replace listr2 color import with ui import**

In `packages/core/src/utils/rollback.ts`, change:
```ts
import { color } from "listr2";
```
to:
```ts
import { ui } from "./ui.js";
```

- [ ] **Step 2: Replace all color usages**

- Line 16: `color.yellow("↩")` → `ui.chalk.yellow("↩")`
- Line 20: `color.red("✗")` → `ui.chalk.red("✗")`
- Line 32: `color.yellow("⟲")` and `color.yellow("Rolling back...")` → `ui.chalk.yellow("⟲")` and `ui.chalk.yellow("Rolling back...")`
- Line 51: `color.red("✗")` and `color.red("Rollback completed with errors.")` → `ui.chalk.red("✗")` and `ui.chalk.red("Rollback completed with errors.")`
- Line 54: `color.green("✓")` → `ui.chalk.green("✓")`

- [ ] **Step 3: Build and run tests**

Run: `cd packages/core && bun run build && bun vitest --run`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/utils/rollback.ts
git commit -m "refactor(core): migrate rollback.ts from listr2 color to chalk via ui"
```

### Task 6: Migrate runner.ts success messages

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Add ui import if not already present**

Should already have `import { ui } from "../utils/ui.js"` from Task 3. If not, add it.

- [ ] **Step 2: Replace color usages in success messages**

- Line 552: `color.bold(name)` → `ui.chalk.bold(name)`
- Line 557: `color.blueBright(...)` → `ui.chalk.blueBright(...)`
- Line 1299: `color.bold(name)` → `ui.chalk.bold(name)`
- Line 1312: `color.blueBright(formatVersionSummary(ctx))` → `ui.chalk.blueBright(formatVersionSummary(ctx))`

**Important:** After replacing these 4 usages, check if `color` from `listr2` is still used elsewhere in `runner.ts` for listr2 task titles/output. If `color` is no longer used, remove it from the listr2 import to avoid a Biome lint failure for unused imports. Keep the other listr2 imports (`Listr`, etc.).

- [ ] **Step 3: Build and run tests**

Run: `cd packages/core && bun run build && bun vitest --run`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): migrate runner.ts success messages to chalk via ui"
```

### Task 7: Migrate notes formatting in required-missing-information.ts

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`

- [ ] **Step 1: Add ui import**

```ts
import { ui } from "../utils/ui.js";
```

- [ ] **Step 2: Replace note formatting**

- Line 43: Replace `💡 ${dependencyLabel} ${bumpedDependencies.join(", ")} bumped, suggest at least patch -> ${suggestedVersion}` with:
```ts
ui.formatNote("hint", `${dependencyLabel} ${bumpedDependencies.join(", ")} bumped, suggest at least patch -> ${suggestedVersion}`)
```

- Line 486: Replace `📦 ${changesetLabel} suggests ${bump.bumpType} -> ${bump.newVersion}` with:
```ts
ui.formatNote("suggest", `${changesetLabel} suggests ${bump.bumpType} -> ${bump.newVersion}`)
```

- Line 656: Replace `📦 changesets suggest ${bump.bumpType} -> ${bump.newVersion}` with:
```ts
ui.formatNote("suggest", `changesets suggest ${bump.bumpType} -> ${bump.newVersion}`)
```

- [ ] **Step 3: Build and run tests**

Run: `cd packages/core && bun run build && bun vitest --run`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tasks/required-missing-information.ts
git commit -m "refactor(core): migrate notes to ui.formatNote() with emoji+label pattern"
```

## Chunk 3: CLI subcommand migration

### Task 8: Migrate CLI subcommands to ui output functions

**Files:**
- Modify: `packages/pubm/src/commands/add.ts`
- Modify: `packages/pubm/src/commands/changelog.ts`
- Modify: `packages/pubm/src/commands/status.ts`
- Modify: `packages/pubm/src/commands/sync.ts`
- Modify: `packages/pubm/src/commands/update.ts`
- Modify: `packages/pubm/src/commands/version-cmd.ts`
- Modify: `packages/pubm/src/commands/migrate.ts`
- Modify: `packages/pubm/src/commands/secrets.ts`
- Modify: `packages/pubm/src/commands/init.ts`
- Modify: `packages/pubm/src/cli.ts`

- [ ] **Step 1: Add ui import to each command file**

Add `import { ui } from "@pubm/core"` to each file that needs it. For files already importing from `@pubm/core`, add `ui` to the existing import.

- [ ] **Step 2: Migrate add.ts**

- Line 27: `console.log(`Created empty changeset: ${filePath}`)` → `ui.success(`Created empty changeset: ${filePath}`)`
- Line 46: `console.log(`Created changeset: ${filePath}`)` → `ui.success(`Created changeset: ${filePath}`)`
- Line 70: `console.log(`📦 ${pkg.name} (v${pkg.version})`)` → keep as-is (interactive prompt display, not a status message)
- Line 88: `console.log("No packages selected. Aborting.")` → `ui.warn("No packages selected. Aborting.")`
- Line 133: `console.log(`Created changeset: ${filePath}`)` → `ui.success(`Created changeset: ${filePath}`)`

- [ ] **Step 3: Migrate changelog.ts**

- Line 67: `console.log("No pending changesets...")` → `ui.info("No pending changesets to generate changelog from.")`
- Line 71: `console.log(result)` → keep as-is (raw content output, not a status message)
- Line 74: `console.log("\nChangelog written to CHANGELOG.md")` → `ui.success("Changelog written to CHANGELOG.md")`
- If `[dry-run]` output exists, prefix with `ui.labels.DRY_RUN`

- [ ] **Step 4: Migrate status.ts**

- Line 15: `console.log("No changesets found.")` → `ui.info("No changesets found.")`
- Line 18: `console.log("No pending changesets.")` → `ui.info("No pending changesets.")`
- Line 22: `console.log("Pending changesets:")` → `ui.info("Pending changesets:")`
- Lines 24-26: Keep indented detail output as `console.log` (data rows, not status)
- Line 29: Keep verbose detail as `console.log` (data rows)

- [ ] **Step 5: Migrate sync.ts**

- Line 175: `console.log("No version found...")` → `ui.warn("No version found in package.json.")`
- Line 179: `console.log("Scanning...")` → `ui.info("Scanning for version references...")`
- Line 184: `console.log("No version references found...")` → `ui.info("No version references found outside of manifest files.")`
- Line 188: `console.log(`Found ${refs.length}...`)` → `ui.success(`Found ${refs.length} version reference(s):`)`
- Lines 192-213: Keep as `console.log` (data output)

- [ ] **Step 6: Migrate update.ts**

- Line 21: `process.stderr.write(...)` → keep as-is (progress callback)
- Line 23: `console.error(`${p.phase}...`)` → `ui.info(`${p.phase}...`)`
- Line 30: `console.log(`Updated from...`)` → `ui.success(`Updated from ${result.fromVersion} to ${result.toVersion}`)`
- Line 38: `console.error("Update failed:...")` → `ui.error(`Update failed: ${error.message}`)`

- [ ] **Step 7: Migrate version-cmd.ts**

- Line 41, 57: `console.log("No changesets found.")` → `ui.info("No changesets found.")`
- Line 89-90: `console.log(`${name}: ${currentVersion} → ...`)` → keep as `console.log` (data row)
- Line 98: `console.log(`[dry-run] Would write version...`)` → `console.log(`${ui.labels.DRY_RUN} Would write version ${newVersion}`)`
- Line 99: `console.log(`[dry-run] Changelog:...`)` → `console.log(`${ui.labels.DRY_RUN} Changelog:\n${changelogContent}`)`
- Line 133-134: `console.log(`\nConsumed...`)` → `ui.success(`Consumed ${changesets.length} changeset(s) and committed version bump.`)`

- [ ] **Step 8: Migrate migrate.ts**

- Line 12: `console.error(result.error)` → `ui.error(String(result.error))`
- Line 16: `console.log(`Migrated...`)` → `ui.success(`Migrated ${result.migratedFiles.length} changeset files.`)`
- Line 18-19: `console.log("Note: ...")` → `ui.hint("Note: .changeset/config.json detected. Please manually create pubm.config.ts.")`

- [ ] **Step 9: Migrate secrets.ts**

- Line 20-21: `console.log("No stored tokens found...")` → `ui.info("No stored tokens found. Run \`pubm --preflight\` first to save tokens.")`
- Line 26: `console.log(`Syncing...`)` → `ui.info(`Syncing ${Object.keys(tokens).length} token(s) to GitHub Secrets...`)`
- Line 30: `console.log("Done!...")` → `ui.success("Tokens synced to GitHub Secrets.")`
- Line 32: `consoleError(e)` → keep as-is (already using core's error handler)

- [ ] **Step 10: Migrate init.ts**

- Line 22: `console.log("Created .pubm/changesets/")` → `ui.success("Created .pubm/changesets/")`
- Line 37: `console.log("Created pubm.config.ts")` → `ui.success("Created pubm.config.ts")`
- Line 45: `console.log("Updated .gitignore...")` → `ui.success("Updated .gitignore (changeset files tracked)")`
- Line 49: `console.log("Created .github/...")` → `ui.success("Created .github/workflows/changeset-check.yml")`
- Lines 52-56: Multi-line success → `ui.success("pubm initialized successfully.")` + keep instructions as `console.log`
- Line 59: `console.log("pubm initialized successfully.")` → `ui.success("pubm initialized successfully.")`

- [ ] **Step 11: Migrate cli.ts**

- Line 291: `console.log("Changesets detected:")` → `ui.info("Changesets detected:")`
- Lines 293-295: Keep as `console.log` (data rows)

- [ ] **Step 12: Build and run all tests**

Run: `bun run build && bun run test`
Expected: Build succeeds, all tests pass

- [ ] **Step 13: Commit**

```bash
git add packages/pubm/src/
git commit -m "refactor(cli): migrate all subcommands to ui output functions"
```

## Chunk 4: --no-color support and final verification

### Task 9: Add --no-color flag support

**Files:**
- Modify: `packages/pubm/src/cli.ts`

- [ ] **Step 1: Add --no-color option to Commander**

In `packages/pubm/src/cli.ts`, after the program is created, add handling for `--no-color`:

Use `ui.chalk` from `@pubm/core` (chalk is NOT a dependency of `packages/pubm`):

```ts
import { ui } from "@pubm/core";

// After program definition:
program.option("--no-color", "Disable colored output");
program.hook("preAction", (thisCommand) => {
  if (thisCommand.opts().noColor) {
    process.env.NO_COLOR = "1";  // Also disables listr2's colorette
    ui.chalk.level = 0;
  }
});
```

Note: Setting `process.env.NO_COLOR = "1"` covers both chalk and listr2's internal colorette. Check if Commander already provides a `--no-color` option natively. If so, just hook into it.

- [ ] **Step 2: Build and verify**

Run: `bun run build && bun run test`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add packages/pubm/src/cli.ts
git commit -m "feat(cli): add --no-color flag support for chalk"
```

### Task 10: Final verification

- [ ] **Step 1: Run format check**

Run: `bun run format`

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors

- [ ] **Step 3: Run all tests**

Run: `bun run test`
Expected: All pass

- [ ] **Step 4: Run coverage**

Run: `bun run coverage`
Expected: Coverage thresholds met (95% lines/functions/statements, 90% branches)

- [ ] **Step 5: Fix any issues found**

- [ ] **Step 6: Final commit if needed**

```bash
git add -A
git commit -m "chore: fix lint/format issues from TUI migration"
```
