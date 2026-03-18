# CLI Mode/Phase Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `--preview`, `--preflight`, `--ci`, `--publish-only` with a unified `--mode local|ci` + `--phase prepare|publish` + `--dry-run` system.

**Architecture:** The Options type gains `mode`, `prepare`, `publish`, `dryRun` fields while removing four legacy flags. The runner's deeply nested ternary (`ci ? [...] : publishOnly ? [...] : [...]`) is replaced by a flat task list with skip conditions derived from `resolvePhases()` and `mode`. CLI flags change accordingly with validation.

**CLI vs SDK interface note:** The CLI uses `--phase <prepare|publish>` (single option) to avoid a naming conflict with Commander's `--no-publish`. The SDK uses `prepare?: boolean` and `publish?: boolean` as independent fields. The `resolveCliOptions` function maps between them.

**Tech Stack:** TypeScript, Commander.js, vitest, listr2

**Spec:** `docs/superpowers/specs/2026-03-18-cli-mode-phase-redesign.md`

---

### Task 1: Update Options types

**Files:**
- Modify: `packages/core/src/types/options.ts`

- [ ] **Step 1: Write failing test for new type shape**

In `packages/core/tests/unit/tasks/runner.test.ts`, add a type-level test that verifies the new options shape compiles. For now, just confirm the old fields are still present (they'll be removed in the next step).

Actually, since this is a type-only change, skip the test — type errors will surface via `bun run typecheck`.

- [ ] **Step 2: Update the Options interface**

In `packages/core/src/types/options.ts`, replace:

```typescript
// Remove these fields:
preview?: boolean;        // line 23
publishOnly?: boolean;    // line 68
ci?: boolean;             // line 73
preflight?: boolean;      // line 78

// Add these fields:
mode?: ReleaseMode;
prepare?: boolean;
publish?: boolean;         // NOTE: conflicts with existing field name — see step 3
dryRun?: boolean;
```

**IMPORTANT:** There's already a `skipPublish` field. The new `publish` boolean is a phase selector (different from `skipPublish`). However, the CLI currently has `--no-publish` which maps to `skipPublish: true`. The new `--publish` flag is a phase selector. These must coexist:
- `--publish` (phase) → `options.publish = true`
- `--no-publish` (skip) → `options.skipPublish = true`

Add the `ReleaseMode` type above the interface:

```typescript
export type ReleaseMode = "local" | "ci";
```

Remove `preview`, `ci`, `preflight`, `publishOnly` from both `Options` and `ResolvedOptions`.

Add `mode`, `prepare`, `dryRun` to `Options`. For `publish` as a phase flag, use a different field name to avoid confusion with `skipPublish`: use `publishPhase` or keep `publish` but document clearly. Given the spec uses `publish`, keep it as `publish` — the CLI mapping will differentiate.

```typescript
export type ReleaseMode = "local" | "ci";

export interface Options {
  testScript?: string;
  buildScript?: string;
  branch?: string;
  anyBranch?: boolean;
  skipTests?: boolean;
  skipBuild?: boolean;
  skipPublish?: boolean;
  skipReleaseDraft?: boolean;
  skipPrerequisitesCheck?: boolean;
  skipConditionsCheck?: boolean;
  mode?: ReleaseMode;
  prepare?: boolean;
  publish?: boolean;
  dryRun?: boolean;
  snapshot?: string | boolean;
  tag?: string;
  contents?: string;
  saveToken?: boolean;
  packages?: PackageConfig[];
}
```

Update `ResolvedOptions` — add required `mode: ReleaseMode` field. `prepare`, `publish`, `dryRun` stay optional (they may not be set in all contexts):

```typescript
export interface ResolvedOptions extends Options {
  testScript: string;
  buildScript: string;
  branch: string;
  tag: string;
  saveToken: boolean;
  mode: ReleaseMode;
  packages?: PackageConfig[];
}
```

- [ ] **Step 3: Run typecheck to find all compilation errors**

Run: `bun run typecheck`

This will surface every file that references the removed fields (`preview`, `ci`, `preflight`, `publishOnly`). Note them — they'll be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/options.ts
git commit -m "refactor: replace preview/preflight/ci/publishOnly with mode/phase/dryRun in Options type"
```

---

### Task 2: Add phase resolution and validation logic

**Files:**
- Modify: `packages/core/src/options.ts`
- Create: `packages/core/src/utils/resolve-phases.ts`
- Create: `packages/core/tests/unit/utils/resolve-phases.test.ts`

- [ ] **Step 1: Write failing tests for resolvePhases**

Create `packages/core/tests/unit/utils/resolve-phases.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolvePhases, validateOptions } from "../../../src/utils/resolve-phases.js";

describe("resolvePhases", () => {
  it("returns both phases for local mode without explicit phase", () => {
    expect(resolvePhases({})).toEqual(["prepare", "publish"]);
  });

  it("returns both phases for explicit local mode without phase", () => {
    expect(resolvePhases({ mode: "local" })).toEqual(["prepare", "publish"]);
  });

  it("returns prepare only when --prepare is set", () => {
    expect(resolvePhases({ prepare: true })).toEqual(["prepare"]);
  });

  it("returns publish only when --publish is set", () => {
    expect(resolvePhases({ publish: true })).toEqual(["publish"]);
  });

  it("throws when ci mode has no phase", () => {
    expect(() => resolvePhases({ mode: "ci" })).toThrow(
      "CI mode requires --prepare or --publish",
    );
  });

  it("returns prepare for ci mode with --prepare", () => {
    expect(resolvePhases({ mode: "ci", prepare: true })).toEqual(["prepare"]);
  });

  it("returns publish for ci mode with --publish", () => {
    expect(resolvePhases({ mode: "ci", publish: true })).toEqual(["publish"]);
  });
});

describe("validateOptions", () => {
  it("throws when both --prepare and --publish are set", () => {
    expect(() => validateOptions({ prepare: true, publish: true })).toThrow(
      "Cannot specify both --prepare and --publish",
    );
  });

  it("throws when ci mode has no phase", () => {
    expect(() => validateOptions({ mode: "ci" })).toThrow(
      "CI mode requires --prepare or --publish",
    );
  });

  it("throws when --snapshot is used with ci mode", () => {
    expect(() =>
      validateOptions({ mode: "ci", prepare: true, snapshot: true }),
    ).toThrow("Cannot use --snapshot with --mode ci");
  });

  it("allows local mode with snapshot", () => {
    expect(() => validateOptions({ snapshot: true })).not.toThrow();
  });

  it("allows local mode without any phase", () => {
    expect(() => validateOptions({})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/utils/resolve-phases.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement resolvePhases and validateOptions**

Create `packages/core/src/utils/resolve-phases.ts`:

```typescript
import type { Options } from "../types/options.js";

export type ReleasePhase = "prepare" | "publish";

export function resolvePhases(options: Pick<Options, "mode" | "prepare" | "publish">): ReleasePhase[] {
  const mode = options.mode ?? "local";

  if (options.prepare && options.publish) {
    throw new Error("Cannot specify both --prepare and --publish. Omit both to run the full pipeline.");
  }

  if (mode === "ci" && !options.prepare && !options.publish) {
    throw new Error("CI mode requires --prepare or --publish. Example: pubm --mode ci --prepare");
  }

  if (options.prepare) return ["prepare"];
  if (options.publish) return ["publish"];

  return ["prepare", "publish"];
}

export function validateOptions(options: Pick<Options, "mode" | "prepare" | "publish" | "snapshot">): void {
  const mode = options.mode ?? "local";

  if (options.prepare && options.publish) {
    throw new Error("Cannot specify both --prepare and --publish. Omit both to run the full pipeline.");
  }

  if (mode === "ci" && !options.prepare && !options.publish) {
    throw new Error("CI mode requires --prepare or --publish. Example: pubm --mode ci --prepare");
  }

  if (options.snapshot && mode === "ci") {
    throw new Error("Cannot use --snapshot with --mode ci.");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/utils/resolve-phases.test.ts`
Expected: PASS

- [ ] **Step 5: Update options.ts to set mode default**

In `packages/core/src/options.ts`, add `mode: "local"` to `defaultOptions`:

```typescript
export const defaultOptions: Partial<Options> = {
  testScript: "test",
  buildScript: "build",
  branch: "main",
  tag: "latest",
  mode: "local",
};
```

- [ ] **Step 6: Export resolvePhases from core index**

Add exports to `packages/core/src/index.ts`:

```typescript
export { resolvePhases, validateOptions } from "./utils/resolve-phases.js";
export type { ReleasePhase } from "./utils/resolve-phases.js";
```

Also verify that `ReleaseMode` is exported from `packages/core/src/index.ts` via the types re-export. If not, add:

```typescript
export type { ReleaseMode } from "./types/options.js";
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/utils/resolve-phases.ts packages/core/tests/unit/utils/resolve-phases.test.ts packages/core/src/options.ts packages/core/src/index.ts
git commit -m "feat: add resolvePhases and validateOptions for mode/phase system"
```

---

### Task 3: Update CLI flags

**Files:**
- Modify: `packages/pubm/src/cli.ts`

- [ ] **Step 1: Update CliOptions interface**

Replace old fields with new ones:

```typescript
interface CliOptions {
  version: string;
  testScript: string;
  buildScript: string;
  mode?: "local" | "ci";
  prepare?: boolean;
  // Note: 'publish' here conflicts with the --no-publish boolean.
  // Commander stores --no-publish as publish: false.
  // The phase flag --publish needs a different Commander name.
  // Use --publish-phase or handle in resolveCliOptions.
  publishPhase?: boolean;
  dryRun?: boolean;
  branch: string;
  anyBranch?: boolean;
  preCheck: boolean;
  conditionCheck: boolean;
  tests: boolean;
  build: boolean;
  publish: boolean; // This is the --no-publish flag (Commander negated option)
  snapshot?: string | boolean;
  releaseDraft: boolean;
  tag: string;
  contents?: string;
  registry?: string;
  saveToken: boolean;
}
```

**IMPORTANT naming conflict:** Commander's `--no-publish` creates `publish: false`. A new `--publish` phase flag would overwrite this. Solutions:
- (a) Name the phase flag `--publish-only` → but that's the old name we're removing
- (b) Name the phase flag `--publish-phase` → ugly
- (c) Keep `--publish` for the phase, rename skip to `--skip-publish` → breaking but cleaner

Given that all skip flags already have `--skip-X` alternatives (`--no-tests` → `--skip-tests`), use `--skip-publish` instead of `--no-publish`. This avoids the naming conflict. However, this is an additional breaking change beyond the spec.

**Alternative:** Use `--phase prepare` / `--phase publish` as a single `--phase` option:

```typescript
.option("--mode <mode>", "Release mode: local or ci", "local")
.option("--phase <phase>", "Pipeline phase: prepare or publish")
.option("--dry-run", "Run without side effects")
```

This avoids the `--publish` naming conflict entirely. The `--no-publish` (skip) stays as is. `--phase publish` is unambiguous.

**Decision: Use `--phase` approach** — it's cleaner and avoids breaking `--no-publish`.

Update CliOptions:

```typescript
interface CliOptions {
  version: string;
  testScript: string;
  buildScript: string;
  mode?: string;
  phase?: string;
  dryRun?: boolean;
  branch: string;
  anyBranch?: boolean;
  preCheck: boolean;
  conditionCheck: boolean;
  tests: boolean;
  build: boolean;
  publish: boolean; // --no-publish (Commander negated)
  snapshot?: string | boolean;
  releaseDraft: boolean;
  tag: string;
  contents?: string;
  registry?: string;
  saveToken: boolean;
}
```

- [ ] **Step 2: Update resolveCliOptions**

```typescript
export function resolveCliOptions(
  options: Omit<CliOptions, "version">,
): Partial<Options> {
  return {
    testScript: (options as any).testScript,
    buildScript: (options as any).buildScript,
    mode: options.mode as ReleaseMode | undefined,
    prepare: options.phase === "prepare" ? true : undefined,
    publish: options.phase === "publish" ? true : undefined,
    dryRun: options.dryRun,
    branch: options.branch,
    anyBranch: options.anyBranch,
    skipPublish: !options.publish,
    skipReleaseDraft: !options.releaseDraft,
    skipTests: !options.tests,
    skipBuild: !options.build,
    skipPrerequisitesCheck: !options.preCheck,
    skipConditionsCheck: !options.conditionCheck,
    snapshot: options.snapshot,
    tag: options.tag,
    contents: options.contents,
    saveToken: options.saveToken,
  };
}
```

- [ ] **Step 3: Update Commander flag definitions**

Replace old flags:

```typescript
// REMOVE:
// .option("-p, --preview", "Show tasks without actually executing publish")
// .option("--publish-only", "Run only publish task for latest tag")
// .option("--ci", "CI mode: publish from latest tag and create GitHub Release with assets")
// .option("--preflight", "Simulate CI publish locally (dry-run with token-based auth)")

// ADD:
.option("--mode <mode>", "Release mode: local (default) or ci")
.option("--phase <phase>", "Pipeline phase: prepare or publish (local mode runs both by default)")
.option("--dry-run", "Validate without side effects (version bump rolls back, publish uses registry dry-run)")
```

- [ ] **Step 4: Update action handler validation**

Replace the `options.snapshot && options.preflight` check:

```typescript
.action(async (nextVersion, options) => {
  console.clear();

  const cliOptions = resolveOptions(resolveCliOptions(options));
  validateOptions(cliOptions); // from @pubm/core — throws on invalid combos

  // ... rest of handler
})
```

- [ ] **Step 5: Update the pre-publish version resolution logic in action handler**

The current handler has branching for `preflight`, `ci`, `publishOnly`. Rewrite using mode/phase:

```typescript
const mode = cliOptions.mode ?? "local";
const phases = resolvePhases(cliOptions);

if (mode === "ci" && phases.includes("prepare")) {
  // CI prepare: collect tokens interactively, then run pipeline
  await requiredMissingInformationTasks().run(ctx);
} else if (mode === "ci" && phases.includes("publish")) {
  // CI publish: read version from package.json (same as old --ci / --publish-only logic)
  // ... version resolution from manifest
} else if (mode === "local" && phases.includes("publish") && !phases.includes("prepare")) {
  // Local publish-only: read version from package.json (same as old --publish-only)
  // ... version resolution from manifest
} else if (isCI && mode === "local") {
  // BACKWARD COMPATIBILITY: isCI detected but --mode not explicitly set.
  // This handles the case where pubm runs in a CI environment without --mode ci
  // (e.g., changesets-based CI workflows that call `pubm` directly).
  // isCI does NOT auto-set mode — mode is always explicit per spec.
  // But we still need to check for pending changesets.
  // ... existing changeset detection logic
} else {
  // Local mode: interactive prompts
  await requiredMissingInformationTasks().run(ctx);
}
```

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: Errors only from runner.ts and tests (not yet updated)

- [ ] **Step 7: Commit**

```bash
git add packages/pubm/src/cli.ts
git commit -m "refactor: replace CLI flags with --mode/--phase/--dry-run"
```

---

### Task 4: Rewrite runner branching logic

This is the largest task. The runner (`packages/core/src/tasks/runner.ts`, 1506 lines) has three code paths via a ternary: `ci ? [...] : publishOnly ? [...] : [...]`. These need to be unified into a single task list with skip conditions.

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Add imports and compute resolved mode/phases at top of run()**

At the top of `run()`, after `ctx.runtime.promptEnabled` assignment:

```typescript
const mode = ctx.options.mode ?? "local";
const phases = resolvePhases(ctx.options);
const dryRun = !!ctx.options.dryRun;
const hasPrepare = phases.includes("prepare");
const hasPublish = phases.includes("publish");
```

Import `resolvePhases` from `../utils/resolve-phases.js`.

- [ ] **Step 2: Replace the preflight token collection block (lines 620-642)**

Current: `if (ctx.options.preflight) { ... token collection ... }`

Replace with:

```typescript
if (mode === "ci" && hasPrepare) {
  // CI prepare: collect tokens for all registries
  await createListr<PubmContext>({
    title: "Collecting registry tokens",
    task: async (ctx, task): Promise<void> => {
      const registries = collectRegistries(ctx.config);
      const tokens = await collectTokens(registries, task);
      await promptGhSecretsSync(tokens, task);
      cleanupEnv = injectTokensToEnv(tokens);
      ctx.runtime.promptEnabled = false;
    },
  }).run(ctx);

  await prerequisitesCheckTask({
    skip: ctx.options.skipPrerequisitesCheck,
  }).run(ctx);

  await requiredConditionsCheckTask({
    skip: ctx.options.skipConditionsCheck,
  }).run(ctx);
}
```

- [ ] **Step 3: Replace the local prerequisites block (lines 644-667)**

Current: `if (!ctx.options.publishOnly && !ctx.options.ci && !ctx.options.preflight) { ... }`

Replace with:

```typescript
if (mode === "local" && hasPrepare) {
  await prerequisitesCheckTask({
    skip: ctx.options.skipPrerequisitesCheck,
  }).run(ctx);

  // Collect JSR token early if JSR registry is configured
  const registries = collectRegistries(ctx.config);
  if (registries.includes("jsr") && ctx.runtime.promptEnabled) {
    await createListr<PubmContext>({
      title: "Ensuring JSR authentication",
      task: async (_ctx, task): Promise<void> => {
        const tokens = await collectTokens(["jsr"], task);
        cleanupEnv = injectTokensToEnv(tokens);
        if (tokens.jsr) {
          JsrClient.token = tokens.jsr;
        }
      },
    }).run(ctx);
  }

  await requiredConditionsCheckTask({
    skip: ctx.options.skipConditionsCheck,
  }).run(ctx);
}
```

- [ ] **Step 4: Replace the main pipeline ternary (lines 672-1463)**

The current structure is:
```typescript
ctx.options.ci ? [CI tasks] : ctx.options.publishOnly ? [publish-only tasks] : [full pipeline tasks]
```

Replace with a **single flat task array**. Each task uses skip conditions based on `hasPrepare`, `hasPublish`, `dryRun`, and `mode`:

```typescript
const pipelineListrOptions =
  mode === "ci" || isCI ? createCiListrOptions<PubmContext>() : undefined;

await createListr<PubmContext>(
  [
    // === PREPARE PHASE TASKS ===
    {
      skip: !hasPrepare || ctx.options.skipTests,
      title: "Running tests",
      task: async (ctx, task) => { /* existing test task body */ },
    },
    {
      skip: !hasPrepare || ctx.options.skipBuild,
      title: "Building the project",
      task: async (ctx, task) => { /* existing build task body */ },
    },
    {
      title: "Bumping version",
      skip: !hasPrepare,
      task: async (ctx, task) => {
        // Existing version bump logic, but with dry-run support:
        // If dryRun:
        //   - Write manifest versions (same as normal)
        //   - Consume changesets (same as normal)
        //   - Generate changelog (same as normal)
        //   - Skip git add + commit
        //   - Skip git tag
        //   - Restore manifest files to original
      },
    },
    // === PUBLISH PHASE TASKS ===
    {
      skip: (ctx) =>
        !hasPublish || !!ctx.options.skipPublish || dryRun,
      title: "Publishing",
      task: async (ctx, parentTask) => { /* existing real publish task body */ },
    },
    {
      skip: (ctx) =>
        !hasPublish || !!ctx.options.skipPublish || dryRun || !ctx.runtime.workspaceBackups?.size,
      title: "Restoring workspace protocols",
      task: (ctx) => { /* existing restore task */ },
    },
    {
      skip: (ctx) =>
        !hasPublish || !!ctx.options.skipPublish || dryRun,
      title: "Running post-publish hooks",
      task: async (ctx, task) => { /* existing hooks task */ },
    },
    // === DRY-RUN PUBLISH (for --dry-run or ci prepare) ===
    {
      skip: !dryRun && !(mode === "ci" && hasPrepare),
      title: "Validating publish (dry-run)",
      task: async (ctx, parentTask) => { /* existing dry-run publish task body */ },
    },
    {
      skip: (ctx) =>
        (!dryRun && !(mode === "ci" && hasPrepare)) || !ctx.runtime.workspaceBackups?.size,
      title: "Restoring workspace protocols",
      task: (ctx) => { /* existing restore task */ },
    },
    // === PUSH & RELEASE DRAFT ===
    {
      title: "Pushing tags to GitHub",
      skip: !hasPrepare || dryRun,
      task: async (ctx, task) => { /* existing push task body */ },
    },
    {
      skip: (ctx) =>
        !hasPublish ||
        !!ctx.options.skipReleaseDraft ||
        dryRun,
      title: "Creating release draft on GitHub",
      task: async (ctx, task) => {
        // For local mode: existing release draft (opens URL)
        // For ci mode with publish: existing GitHub Release creation (with assets)
      },
    },
  ],
  pipelineListrOptions,
).run(ctx);
```

**Key behavioral differences by mode:**

For the release draft task, the `ci + publish` path creates a full GitHub Release (with assets), while the `local` path opens a draft URL. This distinction needs to be preserved inside the task body using `mode === "ci"`.

For the "CI GitHub Release" (current `ctx.options.ci` branch, lines 694-867), merge it into the release draft task with a mode check:

```typescript
{
  skip: (ctx) => {
    if (dryRun) return true;
    if (mode === "ci" && hasPublish) return !!ctx.options.skipReleaseDraft;
    if (mode === "local" && hasPublish) return !!ctx.options.skipReleaseDraft;
    return true; // skip for prepare-only
  },
  title: mode === "ci" ? "Creating GitHub Release" : "Creating release draft on GitHub",
  task: async (ctx, task) => {
    if (mode === "ci") {
      // Full GitHub Release with assets (existing ci branch logic)
    } else {
      // Open release draft URL (existing local branch logic)
    }
  },
}
```

- [ ] **Step 5: Add dry-run rollback logic to version bump task**

Inside the "Bumping version" task, after writing versions and before git operations, add:

```typescript
if (dryRun) {
  // Rollback: restore original manifest versions
  task.output = "Dry-run: restoring original manifest versions...";
  // Collect original versions before writeVersions
  const originalVersions = new Map(
    ctx.config.packages.map((pkg) => [pkg.path, pkg.version]),
  );
  await writeVersions(ctx, originalVersions);
  return; // Skip git commit + tag
}
```

The original versions need to be captured **before** `writeVersions` is called. Restructure the version bump to:
1. Save original versions
2. Write new versions
3. If dryRun:
   - **Skip** `deleteChangesetFiles` (changesets should be preserved for the real run)
   - **Skip** `writeChangelogToFile` (avoid leaving stale changelog changes)
   - **Skip** `git.stage()`, `git.commit()`, `git.createTag()`
   - Restore original manifest versions via `writeVersions(ctx, originalVersions)`
   - Return early
4. If not dryRun: proceed with changeset consumption, changelog generation, git add, commit, tag

**Note on rollback handler safety:** The existing `addRollback` handler checks `if (tagCreated)` and `if (commited)` flags before performing cleanup. In dry-run mode, these flags are never set to `true` since git operations are skipped, so the rollback handler is safe to leave in place (it becomes a no-op).

- [ ] **Step 6: Update the completion message (lines 1481-1490)**

Replace:

```typescript
if (ctx.options.preflight) {
  cleanupEnv?.();
  console.log(`...Preflight check passed...`);
} else {
  console.log(`...Successfully published...`);
}
```

With:

```typescript
if (mode === "ci" && hasPrepare && !hasPublish) {
  cleanupEnv?.();
  console.log(
    `\n\n✅ CI prepare completed. Release tags pushed — CI should pick up the publish.\n`,
  );
} else if (dryRun) {
  console.log(
    `\n\n✅ Dry-run completed. No side effects were applied.\n`,
  );
} else {
  console.log(
    `\n\n🚀 Successfully published ${parts.join(", ")} ${ui.chalk.blueBright(formatVersionSummary(ctx))} 🚀\n`,
  );
}
```

- [ ] **Step 7: Update shouldRenderLiveCommandOutput**

Replace `!ctx.options.ci` with mode check:

```typescript
function shouldRenderLiveCommandOutput(ctx: PubmContext): boolean {
  return ctx.options.mode !== "ci" && !isCI && Boolean(process.stdout.isTTY);
}
```

- [ ] **Step 8: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (or errors only in test files)

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor: rewrite runner with mode/phase/dryRun branching"
```

---

### Task 5: Update core tests

**Files:**
- Modify: `packages/core/tests/unit/tasks/runner.test.ts` (1772 lines)
- Modify: `packages/core/tests/unit/tasks/runner-coverage.test.ts` (3312 lines)

- [ ] **Step 1: Search and replace option references in runner.test.ts**

Replace all instances of the old option names in test setups:
- `preview: true` → `dryRun: true`
- `preflight: true` → `mode: "ci", prepare: true`
- `ci: true` → `mode: "ci", publish: true`
- `publishOnly: true` → `publish: true` (in local mode context)

Also update any assertion strings that reference old option names.

- [ ] **Step 2: Search and replace option references in runner-coverage.test.ts**

Same replacements as step 1.

- [ ] **Step 3: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner.test.ts tests/unit/tasks/runner-coverage.test.ts`
Expected: PASS (some may need further adjustment based on new skip conditions)

- [ ] **Step 4: Fix any failing tests**

Adjust skip condition expectations and task execution order to match new flat pipeline structure.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tests/unit/tasks/
git commit -m "test: update runner tests for mode/phase/dryRun"
```

---

### Task 6: Update CLI tests

**Files:**
- Modify: `packages/pubm/tests/unit/cli.test.ts` (800 lines)
- Modify: `packages/pubm/tests/e2e/ci-mode.test.ts`
- Modify: `packages/pubm/tests/e2e/error-handling.test.ts`
- Modify: `packages/pubm/tests/e2e/help.test.ts`
- Modify: `packages/pubm/tests/e2e/cross-registry-name.test.ts`
- Modify: `packages/pubm/tests/unit/utils/binary-runner.test.ts`

- [ ] **Step 1: Update cli.test.ts**

Replace old option assertions:
- `--preview` → `--dry-run`
- `--preflight` → `--mode ci --phase prepare`
- `--ci` → `--mode ci --phase publish`
- `--publish-only` → `--phase publish`

Update `resolveCliOptions` test cases to verify new mapping.

- [ ] **Step 2: Update e2e tests**

In `ci-mode.test.ts`, `error-handling.test.ts`, `cross-registry-name.test.ts`:
- Replace CLI flag strings passed to the binary
- Update expected behavior assertions

In `help.test.ts`:
- Update expected help text output to match new flags

- [ ] **Step 3: Run all CLI tests**

Run: `cd packages/pubm && bun vitest --run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/pubm/tests/
git commit -m "test: update CLI tests for mode/phase/dryRun flags"
```

---

### Task 7: Run full test suite and fix coverage

**Files:** Various

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: PASS

- [ ] **Step 2: Run coverage check**

Run: `bun run coverage`
Expected: PASS (thresholds met). If `resolve-phases.ts` is new, ensure it has full coverage.

- [ ] **Step 3: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address test failures and coverage gaps from mode/phase refactor"
```

---

### Task 8: Update website documentation (English only)

**Files:**
- Modify: `website/src/content/docs/reference/cli.mdx`
- Modify: `website/src/content/docs/reference/sdk.mdx`
- Modify: `website/src/content/docs/reference/plugins.mdx`
- Modify: `website/src/content/docs/reference/official-plugins.mdx`
- Modify: `website/src/content/docs/guides/ci-cd.mdx`
- Modify: `website/src/content/docs/guides/quick-start.mdx`
- Modify: `website/src/content/docs/guides/troubleshooting.mdx`
- Modify: `website/src/content/docs/guides/configuration.mdx`
- Modify: `website/src/content/docs/guides/coding-agents.mdx`
- Modify: `website/src/content/docs/guides/changesets.mdx`

- [ ] **Step 1: Rewrite cli.mdx**

Key changes:
- Flag table: remove `--preview`, `--publish-only`, `--ci`, `--preflight`; add `--mode`, `--phase`, `--dry-run`
- "Preview mode" section → "Dry-run mode" section
- "Preflight mode" section → "CI prepare" section
- CI mode section → rewrite with `--mode ci --phase publish`
- Update all example commands
- Update the "Execution modes" section

Specific line updates:
- Line 74: `pubm minor --preview` → `pubm minor --dry-run`
- Line 84: flag table row for `--preview` → `--dry-run`
- Lines 105-107: remove old rows, add new rows
- Lines 129-151: rewrite mode sections
- Lines 204, 315-332: update examples

- [ ] **Step 2: Rewrite ci-cd.mdx**

Key changes:
- Title/description: keep "CI/CD"
- "Recommended release model": `pubm --preflight` → `pubm --mode ci --phase prepare`, `pubm --ci` → `pubm --mode ci --phase publish`
- "What preflight does" → "What CI prepare does"
- All GitHub Actions examples: `pubm --ci` → `pubm --mode ci --phase publish`
- Line 35: remove reference to `pubm patch --preview`

- [ ] **Step 3: Update sdk.mdx**

Replace option names in the Options table:
- `preview` → `dryRun`
- `preflight` → `prepare` (with mode context)
- `ci` → `mode: "ci"` + `publish: true`
- `publishOnly` → `publish: true`
- Update code examples

- [ ] **Step 4: Update remaining guides**

- `quick-start.mdx` line 56: update "preflight" reference
- `troubleshooting.mdx`: replace `pubm patch --preview` with `pubm --dry-run`, `pubm --preflight` with `pubm --mode ci --phase prepare`
- `configuration.mdx` line 284: "preview releases" wording is fine (refers to pre-release concept, not the flag)
- `coding-agents.mdx`: update `publish-preview` skill references
- `changesets.mdx` line 93: `pubm --ci` → `pubm --mode ci --phase publish`
- `plugins.mdx` line 102: update option list
- `official-plugins.mdx` line 217: "preview-first" is conceptual, may not need change

- [ ] **Step 5: Commit**

```bash
git add website/src/content/docs/
git commit -m "docs: update website documentation for mode/phase/dryRun CLI"
```

---

### Task 9: Update plugin documentation

**Files:**
- Modify: `plugins/pubm-plugin/skills/publish-setup/SKILL.md`
- Modify: `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`
- Modify: `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md`
- Modify: `plugins/pubm-plugin/INSTALLATION.md`
- Modify: `plugins/pubm-plugin/PLUGIN_INSTALLATION.md`

- [ ] **Step 1: Update SKILL.md**

- Line 216: `"ci:release": "pubm --ci"` → `"ci:release": "pubm --mode ci --phase publish"`
- Lines 248-249: update guidance text

- [ ] **Step 2: Rewrite ci-templates.md**

This file has extensive CI template examples. All instances of:
- `pubm --ci` → `pubm --mode ci --phase publish`
- `--publish-only` → `--phase publish`
- "What `--ci` Does" → "What `--mode ci --phase publish` does"
- "What `--publish-only` Does" → "What `--phase publish` does"

- [ ] **Step 3: Update plugin-api.md, INSTALLATION.md, PLUGIN_INSTALLATION.md**

In `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md`: update any references to `preview`, `ci`, `preflight` in the plugin API context documentation.

In `plugins/pubm-plugin/INSTALLATION.md` and `plugins/pubm-plugin/PLUGIN_INSTALLATION.md`: update any references to `preview`/`preflight` options.

- [ ] **Step 4: Commit**

```bash
git add plugins/pubm-plugin/
git commit -m "docs: update plugin documentation for mode/phase/dryRun CLI"
```

---

### Task 10: Update remaining files

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Update README.md**

- Line 60: update preflight description
- Line 63: `pubm --preflight` → `pubm --mode ci --phase prepare`

- [ ] **Step 2: Update package.json scripts**

```json
"release": "pubm --mode ci --phase prepare",
"release:ci": "pubm --mode ci --phase publish"
```

- [ ] **Step 3: Update release.yml**

Line 41: `bunx pubm --ci` → `bunx pubm --mode ci --phase publish`

- [ ] **Step 4: Commit**

```bash
git add README.md package.json .github/workflows/release.yml
git commit -m "chore: update README, scripts, and CI workflow for mode/phase CLI"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full pre-commit checklist**

```bash
bun run format
bun run typecheck
bun run test
bun run coverage
```

All must pass.

- [ ] **Step 2: Create changeset**

```bash
bunx pubm add --packages packages/core --bump major --message "Replace --preview, --preflight, --ci, --publish-only with --mode/--phase/--dry-run system"
bunx pubm add --packages packages/pubm --bump major --message "Replace --preview, --preflight, --ci, --publish-only with --mode/--phase/--dry-run system"
```

This is a major version bump since all four flags are removed (breaking changes).

- [ ] **Step 3: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for CLI mode/phase redesign (major)"
```
