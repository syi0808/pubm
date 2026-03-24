# Rollback Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global rollback module with a class-based `RollbackTracker`, register rollback actions at every pipeline stage (version files, changesets, git, registries, GitHub Release, plugins), remove the `onRollback` plugin hook, and add comprehensive E2E tests.

**Architecture:** `RollbackTracker<PubmContext>` class injected into `ctx.runtime.rollback`. Actions registered via `ctx.runtime.rollback.add()` at each side-effect point. Execution is LIFO sequential (not parallel — ordering matters, e.g., git commit reset must happen before file restores). Destructive actions (registry unpublish) prompt for confirmation in TTY, auto-execute in CI. `onRollback` plugin hook removed; plugins use `ctx.runtime.rollback.add()` directly.

**Tech Stack:** TypeScript, vitest, listr2, Bun

**Spec:** `docs/superpowers/specs/2026-03-25-rollback-overhaul-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/utils/rollback.ts` | `RollbackTracker` class (replaces current module) |
| `packages/core/src/context.ts` | Add `rollback` field to `PubmRuntime` |
| `packages/core/src/tasks/runner.ts` | Initialize tracker, migrate all rollback registrations, update catch/SIGINT |
| `packages/core/src/utils/listr.ts` | Update `externalSignalHandler` to use tracker |
| `packages/core/src/registry/package-registry.ts` | Add `unpublish` + `supportsUnpublish` to base class |
| `packages/core/src/registry/npm.ts` | Implement `unpublish` via `npm unpublish` |
| `packages/core/src/registry/crates.ts` | Implement `unpublish` via `cargo yank` |
| `packages/core/src/plugin/types.ts` | Remove `onRollback` from `PluginHooks` |
| `packages/core/src/plugin/runner.ts` | Remove `runHook("onRollback")` exclusion handling |
| `packages/plugins/plugin-external-version-sync/src/index.ts` | Add file backup rollback via `ctx.rollback.add()` |
| `packages/plugins/plugin-brew/src/index.ts` | Add PR close rollback via `ctx.rollback.add()` |
| `packages/core/tests/unit/utils/rollback.test.ts` | Rewrite tests for `RollbackTracker` |
| `packages/core/tests/e2e/rollback.test.ts` | New E2E test suite (17 scenarios) |

---

## Task 1: `RollbackTracker` Class — Tests

**Files:**
- Create: `packages/core/tests/unit/utils/rollback.test.ts` (rewrite)

- [ ] **Step 1: Write failing tests for `RollbackTracker.add()` and `execute()`**

Replace the entire test file. The new tests cover:
- `add()` pushes actions
- `execute()` runs actions in LIFO order (reverse of registration)
- `execute()` is idempotent (second call is no-op)
- `execute()` with empty actions does nothing
- Actions that throw don't stop subsequent actions
- `confirm: true` actions are skipped when `interactive: false` and `sigint: true`
- `confirm: true` actions execute when `interactive: false` and `sigint: false` (CI)
- `confirm: true` actions prompt when `interactive: true` (mock prompt)
- `reset()` clears state for re-execution
- Summary counts (succeeded/failed/skipped)

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RollbackTracker } from "../../../src/utils/rollback.js";

// Suppress listr2 output in tests
vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn(),
  createCiListrOptions: vi.fn(),
}));

type TestCtx = { id: number };

describe("RollbackTracker", () => {
  let tracker: RollbackTracker<TestCtx>;
  const ctx: TestCtx = { id: 1 };

  beforeEach(() => {
    tracker = new RollbackTracker();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("add", () => {
    it("accepts actions without throwing", () => {
      expect(() =>
        tracker.add({
          label: "test",
          fn: async () => {},
        }),
      ).not.toThrow();
    });
  });

  describe("execute", () => {
    it("runs actions in LIFO order", async () => {
      const order: number[] = [];
      tracker.add({ label: "first", fn: async () => { order.push(1); } });
      tracker.add({ label: "second", fn: async () => { order.push(2); } });
      tracker.add({ label: "third", fn: async () => { order.push(3); } });

      await tracker.execute(ctx, { interactive: false });

      expect(order).toEqual([3, 2, 1]);
    });

    it("is idempotent — second call is a no-op", async () => {
      const fn = vi.fn();
      tracker.add({ label: "test", fn });

      await tracker.execute(ctx, { interactive: false });
      await tracker.execute(ctx, { interactive: false });

      expect(fn).toHaveBeenCalledOnce();
    });

    it("does nothing when no actions registered", async () => {
      // Should not throw
      await tracker.execute(ctx, { interactive: false });
    });

    it("continues when an action throws", async () => {
      const fn1 = vi.fn().mockRejectedValue(new Error("fail"));
      const fn2 = vi.fn();
      tracker.add({ label: "will-succeed", fn: fn2 });
      tracker.add({ label: "will-fail", fn: fn1 });

      await tracker.execute(ctx, { interactive: false });

      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it("passes ctx to each action", async () => {
      const fn = vi.fn();
      tracker.add({ label: "test", fn });

      await tracker.execute(ctx, { interactive: false });

      expect(fn).toHaveBeenCalledWith(ctx);
    });
  });

  describe("confirm actions", () => {
    it("auto-executes confirm actions in CI (interactive: false, sigint: false)", async () => {
      const fn = vi.fn();
      tracker.add({ label: "unpublish", fn, confirm: true });

      await tracker.execute(ctx, { interactive: false });

      expect(fn).toHaveBeenCalledOnce();
    });

    it("skips confirm actions on SIGINT", async () => {
      const fn = vi.fn();
      tracker.add({ label: "unpublish", fn, confirm: true });

      await tracker.execute(ctx, { interactive: false, sigint: true });

      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("allows re-execution after reset", async () => {
      const fn = vi.fn();
      tracker.add({ label: "test", fn });

      await tracker.execute(ctx, { interactive: false });
      expect(fn).toHaveBeenCalledOnce();

      tracker.reset();
      tracker.add({ label: "test2", fn });
      await tracker.execute(ctx, { interactive: false });

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/utils/rollback.test.ts`
Expected: FAIL — `RollbackTracker` not exported from `rollback.ts`

---

## Task 2: `RollbackTracker` Class — Implementation

**Files:**
- Modify: `packages/core/src/utils/rollback.ts` (complete rewrite)

- [ ] **Step 3: Implement `RollbackTracker` class**

Replace the entire file:

```typescript
import { ui } from "./ui.js";

export interface RollbackAction<Ctx> {
  label: string;
  fn: (ctx: Ctx) => Promise<void>;
  confirm?: boolean;
}

export interface RollbackExecuteOptions {
  interactive: boolean;
  sigint?: boolean;
}

export interface RollbackResult {
  succeeded: number;
  failed: number;
  skipped: number;
  manualRecovery: string[];
}

export class RollbackTracker<Ctx> {
  private actions: RollbackAction<Ctx>[] = [];
  private executed = false;
  private aborted = false;

  add(action: RollbackAction<Ctx>): void {
    this.actions.push(action);
  }

  get size(): number {
    return this.actions.length;
  }

  async execute(ctx: Ctx, options: RollbackExecuteOptions): Promise<RollbackResult> {
    const result: RollbackResult = {
      succeeded: 0,
      failed: 0,
      skipped: 0,
      manualRecovery: [],
    };

    if (this.executed) return result;
    this.executed = true;

    if (this.actions.length === 0) return result;

    // Listen for SIGINT during rollback
    const onSigint = () => { this.aborted = true; };
    process.on("SIGINT", onSigint);

    console.log(
      `\n${ui.chalk.yellow("⟲")} ${ui.chalk.yellow("Rolling back...")}`,
    );

    const reversed = [...this.actions].reverse();

    for (const action of reversed) {
      if (this.aborted) {
        result.skipped++;
        result.manualRecovery.push(action.label);
        continue;
      }

      // Skip confirm actions on SIGINT-triggered rollback (no prompt possible)
      if (action.confirm && options.sigint) {
        console.log(`  ${ui.chalk.dim("⊘")} Skipped: ${action.label} (requires confirmation)`);
        result.skipped++;
        result.manualRecovery.push(action.label);
        continue;
      }

      // In interactive mode, prompt for confirm actions
      // (TODO: integrate with listr2 prompt in Task 5)

      try {
        console.log(`  ${ui.chalk.yellow("↩")} ${action.label}`);
        await action.fn(ctx);
        console.log(`  ${ui.chalk.green("✓")} ${action.label}`);
        result.succeeded++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  ${ui.chalk.red("✖")} ${action.label} — ${msg}`);
        result.failed++;
        result.manualRecovery.push(action.label);
      }
    }

    process.removeListener("SIGINT", onSigint);

    // Summary
    const total = result.succeeded + result.failed + result.skipped;
    if (result.failed > 0 || result.skipped > 0) {
      const parts = [`${result.succeeded}/${total}`];
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      console.log(
        `${ui.chalk.red("✖")} ${ui.chalk.red("Rollback completed with errors")} (${parts.join(", ")})`,
      );
      if (result.manualRecovery.length > 0) {
        console.log(`  Manual recovery needed:`);
        for (const item of result.manualRecovery) {
          console.log(`    • ${item}`);
        }
      }
    } else {
      console.log(
        `${ui.chalk.green("✓")} Rollback completed (${result.succeeded}/${total})`,
      );
    }

    return result;
  }

  reset(): void {
    this.actions = [];
    this.executed = false;
    this.aborted = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/utils/rollback.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/rollback.ts packages/core/tests/unit/utils/rollback.test.ts
git commit -m "feat(core): replace global rollback module with RollbackTracker class"
```

---

## Task 3: Context Integration

**Files:**
- Modify: `packages/core/src/context.ts:63-80` — Add `rollback` to runtime type
- Modify: `packages/core/src/context.ts:88-94` — Initialize in `createContext()`

- [ ] **Step 6: Add `rollback` to `PubmRuntime` type**

In `packages/core/src/context.ts`:
- Add import: `import { RollbackTracker } from "./utils/rollback.js";`
- Add field to runtime type at line 79 (before closing `}`):
  ```typescript
  rollback: RollbackTracker<PubmContext>;
  ```
- Initialize in `createContext()` at line 88-94, add to runtime object:
  ```typescript
  rollback: new RollbackTracker<PubmContext>(),
  ```

- [ ] **Step 7: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: PASS (may have errors from callers still using old API — those are fixed in next tasks)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/context.ts
git commit -m "feat(core): add RollbackTracker to PubmContext runtime"
```

---

## Task 4: Remove `onRollback` Plugin Hook

**Files:**
- Modify: `packages/core/src/plugin/types.ts:29` — Remove `onRollback` line
- Modify: `packages/core/src/tasks/runner.ts:1692` — Remove `runHook("onRollback")` call
- Modify: `packages/core/src/plugin/runner.ts:24-25` — Remove `"onRollback"` from `Exclude` union if present

- [ ] **Step 9: Remove `onRollback` from `PluginHooks` interface**

In `packages/core/src/plugin/types.ts`, delete line 29:
```typescript
  onRollback?: HookFn;
```

- [ ] **Step 10: Remove `onRollback` invocation from runner catch block**

In `packages/core/src/tasks/runner.ts`, delete line 1692:
```typescript
    await ctx.runtime.pluginRunner.runHook("onRollback", ctx);
```

Note: `onRollback` is NOT in the `Exclude` union at `plugin/runner.ts:25` (`Exclude<HookName, "onError" | "afterRelease">`), so no change needed in that file.

- [ ] **Step 11: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/plugin/types.ts packages/core/src/tasks/runner.ts
git commit -m "fix(core): remove deprecated onRollback plugin hook"
```

---

## Task 5: Migrate Runner Rollback — SIGINT + Catch Block

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:38-46` — Update imports
- Modify: `packages/core/src/tasks/runner.ts:539-544` — SIGINT handler
- Modify: `packages/core/src/tasks/runner.ts:1683-1694` — Catch block
- Modify: `packages/core/src/utils/listr.ts:13,71` — Update externalSignalHandler

- [ ] **Step 13: Update runner imports**

In `packages/core/src/tasks/runner.ts`, replace lines 41-46:
```typescript
import {
  addRollback,
  rollback,
  rollbackError,
  rollbackLog,
} from "../utils/rollback.js";
```
With:
```typescript
import { RollbackTracker } from "../utils/rollback.js";
```

- [ ] **Step 14: Update SIGINT handler**

Replace lines 539-544:
```typescript
  const onSigint = async () => {
    cleanupEnv?.();
    await rollback();
    process.exit(130);
  };
```
With:
```typescript
  const onSigint = async () => {
    cleanupEnv?.();
    await ctx.runtime.rollback.execute(ctx, { interactive: false, sigint: true });
    process.exit(130);
  };
```

- [ ] **Step 15: Update catch block**

Replace lines 1683-1694:
```typescript
  } catch (e: unknown) {
    process.removeListener("SIGINT", onSigint);
    cleanupEnv?.();

    await ctx.runtime.pluginRunner.runErrorHook(ctx, e as Error);

    consoleError(e as Error);
    await rollback();

    await ctx.runtime.pluginRunner.runHook("onRollback", ctx);

    process.exit(1);
  }
```
With:
```typescript
  } catch (e: unknown) {
    process.removeListener("SIGINT", onSigint);
    cleanupEnv?.();

    await ctx.runtime.pluginRunner.runErrorHook(ctx, e as Error);

    consoleError(e as Error);
    await ctx.runtime.rollback.execute(ctx, {
      interactive: ctx.runtime.promptEnabled,
    });

    process.exit(1);
  }
```

- [ ] **Step 16: Update listr.ts externalSignalHandler**

In `packages/core/src/utils/listr.ts`:
- Remove the import of `rollback` (line 13)
- Remove line 71 (`listr.externalSignalHandler = rollback;`)
- The SIGINT handling is now fully managed by the runner's `onSigint` handler, not listr2's internal signal handler.

Note: The listr2 patch's `externalSignalHandler` was only used for SIGINT → rollback. Since the runner's `process.on("SIGINT")` handler already calls `ctx.runtime.rollback.execute()`, we can remove this coupling.

- [ ] **Step 17: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: Errors from remaining old `addRollback`/`rollbackLog`/`rollbackError` usages (fixed in next tasks)

- [ ] **Step 18: Commit**

```bash
git add packages/core/src/tasks/runner.ts packages/core/src/utils/listr.ts
git commit -m "feat(core): migrate runner SIGINT and catch block to RollbackTracker"
```

---

## Task 6: Migrate Version Bump Rollback

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:917-968` — Replace old rollback with per-action registration

This is the biggest migration. The old code registers a single `addRollback()` with flags. The new code registers individual rollback actions at each side-effect point.

- [ ] **Step 19: Remove old version bump rollback block**

Delete lines 917-968 (the entire `addRollback(async () => { ... }, ctx)` block).

- [ ] **Step 20: Register version file backup rollback (single mode)**

Before `writeVersions` call at line 983, add backup:

```typescript
// Back up manifest files before version write
for (const pkg of ctx.config.packages) {
  const absPath = path.resolve(ctx.cwd, pkg.path);
  const ecosystem = requirePackageEcosystem(pkg);
  const descriptor = ecosystemCatalog.get(ecosystem);
  if (!descriptor) continue;
  const eco = new descriptor.ecosystemClass(absPath);
  for (const manifestFile of eco.manifestFiles()) {
    const manifestPath = path.resolve(absPath, manifestFile);
    const file = Bun.file(manifestPath);
    if (await file.exists()) {
      const backup = await file.text();
      ctx.runtime.rollback.add({
        label: `Restore ${path.relative(ctx.cwd, manifestPath)}`,
        fn: async () => { await Bun.write(manifestPath, backup); },
      });
    }
  }
}
```

Note: `eco.manifestFiles()` returns relative filenames (e.g., `["package.json", "jsr.json"]`). Resolve them against the package's absolute path to get full paths.

- [ ] **Step 21: Register changeset file + changelog backup rollback (single mode)**

Before `writeChangelogToFile` and `deleteChangesetFiles` calls (around lines 1001-1002), add:

```typescript
if (changesets.length > 0) {
  // Back up changeset files
  const changesetsDir = path.join(ctx.cwd, ".pubm", "changesets");
  const changesetBackups = new Map<string, string>();
  for (const changeset of changesets) {
    const filePath = path.join(changesetsDir, `${changeset.id}.md`);
    if (existsSync(filePath)) {
      changesetBackups.set(filePath, readFileSync(filePath, "utf-8"));
    }
  }
  if (changesetBackups.size > 0) {
    ctx.runtime.rollback.add({
      label: `Restore ${changesetBackups.size} changeset file(s)`,
      fn: async () => {
        for (const [fp, content] of changesetBackups) {
          await Bun.write(fp, content);
        }
      },
    });
  }

  // Back up changelog
  const changelogPath = path.join(ctx.cwd, "CHANGELOG.md");
  const changelogFile = Bun.file(changelogPath);
  if (await changelogFile.exists()) {
    const changelogBackup = await changelogFile.text();
    ctx.runtime.rollback.add({
      label: "Restore CHANGELOG.md",
      fn: async () => { await Bun.write(changelogPath, changelogBackup); },
    });
  }

  // Now perform the actual operations
  const entries = buildChangelogEntries(changesets, pkgPath);
  const changelogContent = generateChangelog(plan.version, entries);
  writeChangelogToFile(process.cwd(), changelogContent);
  deleteChangesetFiles(process.cwd(), changesets);
}
```

- [ ] **Step 22: Register git commit rollback (single mode)**

After `git.commit()` succeeds (line 1038-1039), add:

```typescript
const commit = await git.commit(tagName);
ctx.runtime.rollback.add({
  label: "Reset git commit",
  fn: async () => {
    await git.reset();
    const dirty = (await git.status()) !== "";
    if (dirty) await git.stash();
    await git.reset("HEAD^", "--hard");
    if (dirty) await git.popStash();
  },
});
```

Remove the `commited = true` flag — no longer needed.

- [ ] **Step 23: Register git tag rollback (single mode)**

After `git.createTag()` succeeds (line 1041), add:

```typescript
await git.createTag(tagName, commit);
ctx.runtime.rollback.add({
  label: `Delete local tag ${tagName}`,
  fn: async () => { await git.deleteTag(tagName); },
});
```

Remove the `tagCreated = true` flag — no longer needed.

- [ ] **Step 24: Repeat steps 20-23 for fixed mode (lines 1043-1112)**

Same pattern: backup version files before `writeVersions` (line 1051), backup changesets before deletion (lines 1071-1073), register commit rollback after `git.commit()`, register tag rollback after `git.createTag()`.

- [ ] **Step 25: Repeat steps 20-23 for independent mode (lines 1113-1206)**

Same pattern, but with per-package tags. Each `git.createTag()` call (line 1203) registers its own rollback:

```typescript
for (const [pkgPath, pkgVersion] of plan.packages) {
  if (isReleaseExcluded(ctx.config, pkgPath)) continue;
  const pkgName = getPackageName(ctx, pkgPath);
  const tag = `${pkgName}@${pkgVersion}`;
  await git.createTag(tag, commit);
  ctx.runtime.rollback.add({
    label: `Delete local tag ${tag}`,
    fn: async () => { await git.deleteTag(tag); },
  });
}
```

- [ ] **Step 26: Remove leftover `tagCreated`/`commited` variables and imports**

Remove `let tagCreated = false;` (line 910), `let commited = false;` (line 911), and all references to `rollbackLog`, `rollbackError` in the file.

- [ ] **Step 27: Run typecheck and tests**

Run: `cd packages/core && bun run typecheck && bun vitest --run`
Expected: PASS (all existing tests should still pass)

- [ ] **Step 28: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "feat(core): migrate version bump rollback to per-action RollbackTracker registration"
```

---

## Task 7: Migrate Workspace Protocol Rollback

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:213-246`

- [ ] **Step 29: Migrate `resolveWorkspaceProtocols` rollback**

Replace the `addRollback(...)` call in `resolveWorkspaceProtocols` (lines 236-245) with `ctx.runtime.rollback.add()`:

```typescript
if (allBackups.size > 0) {
  ctx.runtime.workspaceBackups = allBackups;
  ctx.runtime.rollback.add({
    label: "Restore workspace protocol dependencies",
    fn: async () => {
      for (const pkg of ctx.config.packages) {
        const absPath = path.resolve(ctx.cwd, pkg.path);
        const ecosystem = requirePackageEcosystem(pkg);
        const descriptor = ecosystemCatalog.get(ecosystem);
        if (!descriptor) continue;
        const eco = new descriptor.ecosystemClass(absPath);
        eco.restorePublishDependencies(allBackups);
      }
    },
  });
}
```

Note: The `restoreManifests(backups)` calls at runner.ts lines 1241-1246 and 1287-1291 are the **normal post-publish restore** (not error rollback). These are part of the happy path — after publish succeeds, workspace protocols are restored. Leave them untouched.

- [ ] **Step 30: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: PASS

- [ ] **Step 31: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "feat(core): migrate workspace protocol rollback to RollbackTracker"
```

---

## Task 8: Migrate JSR Scope/Package Rollback

**Files:**
- Modify: `packages/core/src/registry/jsr.ts:15,261-268`

- [ ] **Step 32: Migrate JSR rollback to `ctx.runtime.rollback.add()`**

Replace the `addRollback(...)` call at lines 261-268:

```typescript
// Old:
addRollback(async (rollbackCtx: PubmContext): Promise<void> => {
  if (rollbackCtx.runtime.packageCreated) {
    await this.client.deletePackage(this.packageName);
  }
  if (rollbackCtx.runtime.scopeCreated) {
    await this.client.deleteScope(`${getScope(this.packageName)}`);
  }
}, ctx);
```

With:
```typescript
ctx.runtime.rollback.add({
  label: `Delete JSR package ${this.packageName}`,
  fn: async (rollbackCtx) => {
    if (rollbackCtx.runtime.packageCreated) {
      await this.client.deletePackage(this.packageName);
    }
    if (rollbackCtx.runtime.scopeCreated) {
      await this.client.deleteScope(`${getScope(this.packageName)}`);
    }
  },
});
```

Update the import from `import { addRollback } from "../utils/rollback.js";` — remove it (no longer needed).

- [ ] **Step 33: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: PASS

- [ ] **Step 34: Commit**

```bash
git add packages/core/src/registry/jsr.ts
git commit -m "feat(core): migrate JSR scope/package rollback to RollbackTracker"
```

---

## Task 9: Registry `unpublish` Method

**Files:**
- Modify: `packages/core/src/registry/package-registry.ts:9-42`
- Modify: `packages/core/src/registry/npm.ts`
- Modify: `packages/core/src/registry/crates.ts`

- [ ] **Step 35: Write tests for registry unpublish**

Create test expectations in existing registry test files (or new ones) for:
- `NpmPackageRegistry.unpublish()` calls `npm unpublish <pkg>@<version>`
- `CratesPackageRegistry.unpublish()` calls `cargo yank --vers <version>`
- `PackageRegistry.supportsUnpublish` is `false` by default, `true` for npm/crates

- [ ] **Step 36: Add `unpublish` + `supportsUnpublish` to `PackageRegistry` base class**

In `packages/core/src/registry/package-registry.ts`, add after `dryRunPublish` (line 27):

```typescript
  get supportsUnpublish(): boolean {
    return false;
  }

  async unpublish(_packageName: string, _version: string): Promise<void> {
    // Default no-op. Registries that support unpublish override this.
  }
```

- [ ] **Step 37: Implement `unpublish` in `NpmPackageRegistry`**

In `packages/core/src/registry/npm.ts`, add method:

```typescript
  override get supportsUnpublish(): boolean {
    return true;
  }

  async unpublish(packageName: string, version: string): Promise<void> {
    await exec("npm", ["unpublish", `${packageName}@${version}`], {
      cwd: this.packagePath,
      throwOnError: true,
    });
  }
```

- [ ] **Step 38: Implement `unpublish` in `CratesPackageRegistry`**

In `packages/core/src/registry/crates.ts`, add method:

```typescript
  override get supportsUnpublish(): boolean {
    return true;
  }

  async unpublish(_packageName: string, version: string): Promise<void> {
    const args = ["yank", "--vers", version];
    if (this.packagePath) {
      args.push("--manifest-path", path.join(this.packagePath, "Cargo.toml"));
    }
    await exec("cargo", args, { throwOnError: true });
  }
```

- [ ] **Step 39: Run typecheck and tests**

Run: `cd packages/core && bun run typecheck && bun vitest --run`
Expected: PASS

- [ ] **Step 40: Commit**

```bash
git add packages/core/src/registry/package-registry.ts packages/core/src/registry/npm.ts packages/core/src/registry/crates.ts
git commit -m "feat(core): add unpublish support to PackageRegistry (npm, crates)"
```

---

## Task 10: Register Publish Rollback in Runner

**Files:**
- Modify: `packages/core/src/tasks/runner.ts` — publish task section (~lines 1211-1231)

- [ ] **Step 41: Register registry unpublish rollback after each successful publish**

The publish tasks are created by `collectPublishTasks()`. Find where individual registry `publish()` calls succeed and add rollback registration after each. This requires modifying the publish task creation functions.

Find the `createNpmPublishTask`, `createJsrPublishTask`, `createCratesPublishTask` functions (likely in separate files under `packages/core/src/tasks/`). After each `registry.publish()` succeeds, add:

```typescript
if (registry.supportsUnpublish) {
  const registryName = (registry.constructor as typeof PackageRegistry).registryType;
  const label = registryName === "crates" ? "Yank" : "Unpublish";
  ctx.runtime.rollback.add({
    label: `${label} ${registry.packageName}@${version} from ${registryName}`,
    fn: async () => { await registry.unpublish(registry.packageName, version); },
    confirm: true,
  });
}
```

Note: Locate the exact publish task creation files by searching for `createNpmPublishTask` or `registry.publish()` calls. The files are likely:
- `packages/core/src/tasks/npm.ts`
- `packages/core/src/tasks/jsr.ts`
- `packages/core/src/tasks/crates.ts`

- [ ] **Step 42: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: PASS

- [ ] **Step 43: Commit**

```bash
git add packages/core/src/tasks/
git commit -m "feat(core): register registry unpublish rollback after successful publish"
```

---

## Task 11: Register Git Push Rollback

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:1326-1348` — Push tags task
- Modify: `packages/core/src/git.ts` — May need `revParse()` and `pushDelete()` methods

- [ ] **Step 44: Add `revParse()`, `pushDelete()`, and `forcePush()` to Git class, update `push()` signature**

Check `packages/core/src/git.ts` for these methods. The existing `push(options?: string)` only accepts a single string arg. Add new methods for multi-arg operations:

```typescript
async revParse(rev: string): Promise<string> {
  const { stdout } = await this.exec(["rev-parse", rev]);
  return stdout.trim();
}

async pushDelete(remote: string, ref: string): Promise<void> {
  await this.exec(["push", remote, "--delete", ref]);
}

async forcePush(remote: string, refspec: string): Promise<void> {
  await this.exec(["push", "-f", remote, refspec]);
}
```

- [ ] **Step 45: Register push rollback in the push task**

In the push task (lines 1329-1348), capture pre-push state and register rollback after push succeeds:

```typescript
task: async (ctx, task): Promise<void> => {
  task.output = "Running plugin beforePush hooks...";
  await ctx.runtime.pluginRunner.runHook("beforePush", ctx);
  const git = new Git();

  // Capture pre-push HEAD for rollback
  const prePushSha = await git.revParse("HEAD");

  task.output = "Executing `git push --follow-tags`...";
  const result = await git.push("--follow-tags");

  if (!result) {
    task.title += " (Only tags were pushed because the release branch is protected.)";
    task.output = "Protected branch detected. Falling back to `git push --tags`.";
    await git.push("--tags");
  }

  // Register tag rollback
  const plan = requireVersionPlan(ctx);
  if (plan.mode === "independent") {
    for (const [pkgPath, pkgVersion] of plan.packages) {
      if (isReleaseExcluded(ctx.config, pkgPath)) continue;
      const pkgName = getPackageName(ctx, pkgPath);
      const tag = `${pkgName}@${pkgVersion}`;
      ctx.runtime.rollback.add({
        label: `Delete remote tag ${tag}`,
        fn: async () => { await git.pushDelete("origin", tag); },
      });
    }
  } else {
    const tagName = `v${plan.version}`;
    ctx.runtime.rollback.add({
      label: `Delete remote tag ${tagName}`,
      fn: async () => { await git.pushDelete("origin", tagName); },
    });
  }

  // Register commit push rollback (if --follow-tags pushed commits)
  if (result) {
    const branch = await git.currentBranch();
    ctx.runtime.rollback.add({
      label: `Force push to revert remote ${branch}`,
      fn: async () => { await git.forcePush("origin", `${prePushSha}:${branch}`); },
      confirm: true,
    });
  }

  task.output = "Running plugin afterPush hooks...";
  await ctx.runtime.pluginRunner.runHook("afterPush", ctx);
  task.output = "Push step completed.";
},
```

- [ ] **Step 46: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: PASS

- [ ] **Step 47: Commit**

```bash
git add packages/core/src/tasks/runner.ts packages/core/src/git.ts
git commit -m "feat(core): register git push rollback (remote tags + force push)"
```

---

## Task 12: Register GitHub Release Rollback

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:1350-1650` — GitHub Release task

- [ ] **Step 48: Register GitHub Release delete rollback**

Find where `createGitHubRelease()` is called and returns a result with `releaseId`. After success, add:

```typescript
ctx.runtime.rollback.add({
  label: `Delete GitHub Release ${tagName}`,
  fn: async () => {
    // Use GitHub API to delete the release
    // The exact implementation depends on the GitHub API wrapper used
    await deleteGitHubRelease(releaseId);
  },
});
```

Note: Check how `createGitHubRelease` is implemented and what it returns. The delete function may need to be created if it doesn't exist. Search for the GitHub release implementation (likely in `packages/core/src/utils/github-release.ts` or `packages/core/src/assets/`). If `deleteGitHubRelease()` doesn't exist, implement it using the GitHub API: `DELETE /repos/{owner}/{repo}/releases/{release_id}`. Add the function in the same file as `createGitHubRelease`.

- [ ] **Step 49: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: PASS

- [ ] **Step 50: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "feat(core): register GitHub Release delete rollback"
```

---

## Task 13: Plugin Rollback — external-version-sync

**Files:**
- Modify: `packages/plugins/plugin-external-version-sync/src/index.ts`

- [ ] **Step 51: Add file backup before sync, register rollback**

In the `afterVersion` hook, before modifying each target file, back it up and register rollback:

```typescript
afterVersion: async (ctx) => {
  const plan = ctx.runtime.versionPlan;
  // ... resolve version ...

  for (const target of options.targets) {
    const filePath = path.resolve(ctx.cwd, target.path);
    // Back up before modification
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const backup = await file.text();
      ctx.runtime.rollback.add({
        label: `Restore ${target.path}`,
        fn: async () => { await Bun.write(filePath, backup); },
      });
    }

    try {
      syncVersionInFile(filePath, version, target);
    } catch (error) {
      errors.push(...);
    }
  }
  // ...
},
```

- [ ] **Step 52: Run typecheck and tests**

Run: `cd packages/plugins/plugin-external-version-sync && bun run typecheck && bun vitest --run`
Expected: PASS

- [ ] **Step 53: Commit**

```bash
git add packages/plugins/plugin-external-version-sync/src/index.ts
git commit -m "feat(plugin-external-version-sync): register file backup rollback"
```

---

## Task 14: Plugin Rollback — plugin-brew

**Files:**
- Modify: `packages/plugins/plugin-brew/src/index.ts` (or `brew-tap.ts`/`brew-core.ts`)

- [ ] **Step 54: Register PR close rollback after brew PR creation**

Find where the Homebrew PR is created. After success, add:

```typescript
ctx.runtime.rollback.add({
  label: `Close Homebrew PR #${prNumber}`,
  fn: async () => {
    // Close the PR via GitHub API
    await closePR(prNumber);
  },
  confirm: true,
});
```

Note: The exact location and PR closing mechanism depends on how plugin-brew creates PRs. Check `brew-tap.ts` and `brew-core.ts` for the PR creation logic.

- [ ] **Step 55: Run typecheck and tests**

Run: `cd packages/plugins/plugin-brew && bun run typecheck && bun vitest --run`
Expected: PASS

- [ ] **Step 56: Commit**

```bash
git add packages/plugins/plugin-brew/
git commit -m "feat(plugin-brew): register PR close rollback"
```

---

## Task 15: Cleanup — Remove Old Rollback Exports

**Files:**
- Modify: `packages/core/src/utils/rollback.ts` — Ensure only `RollbackTracker` and related types are exported
- Check: `packages/core/src/index.ts` — Update public API exports if `addRollback`/`rollback` were exported

- [ ] **Step 57: Verify no remaining usages of old API**

Run: `grep -r "addRollback\|rollbackLog\|rollbackError\|from.*rollback.*import.*rollback[^T]" packages/core/src/ packages/plugins/`
Expected: No matches (all migrated to `RollbackTracker`)

- [ ] **Step 58: Update public API exports**

Check `packages/core/src/index.ts` for any exports of old rollback functions. Replace with `RollbackTracker` export if appropriate for the public API.

- [ ] **Step 59: Run full build and test**

Run: `bun run build && bun run typecheck && bun run test`
Expected: ALL PASS

- [ ] **Step 60: Commit**

```bash
git add packages/core/src/utils/rollback.ts packages/core/src/index.ts
git commit -m "chore(core): remove old rollback API, update exports"
```

---

## Task 16: E2E Rollback Tests

**Files:**
- Create: `packages/core/tests/e2e/rollback.test.ts`

This is the largest test task. Each test scenario creates a mock pipeline that fails at a specific point and verifies rollback behavior.

- [ ] **Step 61: Set up E2E test infrastructure**

Create the test file with shared helpers:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RollbackTracker } from "../../src/utils/rollback.js";
import type { PubmContext } from "../../src/context.js";

// Helper to create a minimal PubmContext for testing
function createTestContext(overrides?: Partial<PubmContext>): PubmContext {
  // ... minimal context with rollback tracker
}

// Helper to simulate pipeline stages
// Each stage registers rollback actions and may throw
```

- [ ] **Step 62: Failure point test #1 — beforeVersion plugin hook failure**

```typescript
it("rollback: beforeVersion hook failure leaves clean state", async () => {
  // Nothing should be modified before beforeVersion
  // Verify: no rollback actions registered, clean state
});
```

- [ ] **Step 63: Failure point test #2 — partial version file write**

```typescript
it("rollback: partial version file write restores successful writes", async () => {
  // Register backup for file A, write A, register backup for file B, fail on B
  // Verify: file A is restored
});
```

- [ ] **Step 64: Failure point test #3 — afterVersion hook failure (original bug)**

```typescript
it("rollback: afterVersion hook failure restores all version files", async () => {
  // Write version files, register backups, then afterVersion throws
  // Verify: all version files restored to original content
});
```

- [ ] **Step 65: Failure point tests #4-10**

Implement remaining failure point tests following the same pattern:
- #4: After changeset consumption, before git commit
- #5: After git commit, before git tag
- #6: After git tag, before publish
- #7: First registry publish succeeds, second fails
- #8: After git push, before GitHub Release
- #9: After GitHub Release creation
- #10: Plugin-registered rollback

- [ ] **Step 66: Edge case tests #11-17**

Implement edge case tests:
- #11: Rollback action itself fails → remaining continue
- #12: SIGINT triggers rollback → confirms skipped
- #13: Double execution → second is no-op
- #14: unpublish permission denied → failure logged
- #15: Workspace protocol + version rollback together
- #16: Monorepo partial publish failure → all rolled back
- #17: Monorepo unpublish order → dependents before dependencies

- [ ] **Step 67: Run E2E tests**

Run: `cd packages/core && bun vitest --run tests/e2e/rollback.test.ts`
Expected: ALL PASS

- [ ] **Step 68: Commit**

```bash
git add packages/core/tests/e2e/rollback.test.ts
git commit -m "test(core): add comprehensive E2E rollback test suite (17 scenarios)"
```

---

## Task 17: Final Validation

- [ ] **Step 69: Run full pre-commit checklist**

```bash
bun run format
bun run typecheck
bun run test
bun run coverage
```

Expected: ALL PASS, coverage thresholds maintained.

- [ ] **Step 70: Commit any format fixes (if needed)**

Stage only files that were changed by `bun run format`. Use `git diff --name-only` to identify them and add specifically.

- [ ] **Step 71: Create changeset**

```bash
bunx pubm add --packages packages/core --bump minor --message "overhaul rollback system: class-based RollbackTracker with per-action registration, LIFO execution, registry unpublish support, and removal of onRollback plugin hook"
bunx pubm add --packages packages/plugins/plugin-external-version-sync --bump patch --message "register file backup rollback for version sync targets"
bunx pubm add --packages packages/plugins/plugin-brew --bump patch --message "register PR close rollback for Homebrew formula updates"
```

- [ ] **Step 72: Commit changesets**

```bash
git add .pubm/changesets/
git commit -m "chore: add changesets for rollback overhaul"
```
