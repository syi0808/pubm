# Rollback Overhaul Design

## Problem

The current rollback system has critical gaps. When a failure occurs between version file modification and git commit (e.g., `afterVersion` plugin hook failure), modified files are not restored because the rollback handler only checks `commited` and `tagCreated` flags — both still `false` at that point.

Beyond this specific bug, many pipeline operations lack rollback entirely: git push, registry publishes, GitHub Releases, changeset consumption, and plugin side effects.

## Goals

- Every reversible operation in the publish pipeline registers a rollback action
- Rollback executes reliably regardless of where failure occurs
- Users see clear progress during rollback via listr2 tasks
- Plugins can register their own rollback actions
- Destructive rollbacks (registry unpublish) require user confirmation in TTY, auto-execute in CI

## Non-Goals

- Configurable rollback scope (no `RollbackConfig` — registered actions always execute)
- Backward compatibility for `onRollback` plugin hook (removed immediately)

## Design

### 1. `RollbackTracker` Class

Replaces the current module-scoped global state with a class instance injected into `Ctx`.

```typescript
interface RollbackAction<Ctx> {
  label: string;
  fn: (ctx: Ctx) => Promise<void>;
  confirm?: boolean;
}

class RollbackTracker<Ctx> {
  private actions: RollbackAction<Ctx>[] = [];
  private executed = false;

  add(action: RollbackAction<Ctx>): void;

  async execute(ctx: Ctx, options: {
    interactive: boolean;
  }): Promise<void>;

  reset(): void;
}
```

**`add(action)`**: Pushes a rollback action onto the stack.

**`execute(ctx, options)`**:
1. Sets `executed = true` (idempotent — second call is no-op)
2. Reverses the actions array (LIFO)
3. Creates a listr2 task list from the reversed actions
4. For each action:
   - Check `aborted` flag — if true, skip remaining actions
   - If `confirm: true` and `interactive: true` → prompt user before executing
   - If `confirm: true` and `interactive: false` (CI) → execute automatically
   - If `confirm: true` and SIGINT → skip (prompt impossible), add to manual recovery summary
   - On failure → log error, continue to next action
5. After all actions: print summary (succeeded/failed/skipped counts + manual recovery list)

**SIGINT during rollback**: An internal `aborted` flag is set by a SIGINT listener registered at the start of `execute()`. The current action completes, then the loop checks `aborted` before each subsequent action, skipping remaining actions and adding them to the manual recovery summary.

**`reset()`**: Clears actions, resets `executed` and `aborted` flags. For testing only.

### 2. Context Integration

Add `rollback` field to `PubmContext.runtime`:

```typescript
interface PubmRuntime {
  // ... existing fields
  rollback: RollbackTracker<PubmContext>;
}
```

The `RollbackTracker` is constructed independently in `runner.ts` before `ctx` is fully assembled, then assigned to `ctx.runtime.rollback`. The `ctx` reference passed to `execute()` is the same object — this avoids circular type issues since `RollbackTracker<PubmContext>` is parameterized with the already-defined `PubmContext` type.

### 3. `onRollback` Plugin Hook Removal

- Remove `onRollback` from `PubmPluginHooks` type
- Remove `pluginRunner.runHook("onRollback", ctx)` from `runner.ts` catch block
- Plugins register rollback via `ctx.rollback.add()` at the point where they create side effects

### 4. Rollback Registration Points

Listed in pipeline order. Rollback executes in reverse (LIFO).

#### 4.1 Version File Modification

Before writing each manifest file, back up its content:

```typescript
const backup = await Bun.file(manifestPath).text();
ctx.rollback.add({
  label: `Restore ${path.relative(cwd, manifestPath)}`,
  fn: async () => { await Bun.write(manifestPath, backup); },
});
```

Applies to: `package.json`, `jsr.json`, `Cargo.toml`, and any files modified by `beforeVersion`/`afterVersion` plugin hooks.

#### 4.2 Workspace Protocol Resolution

Already has backup mechanism. Migrate to `ctx.rollback.add()`:

```typescript
ctx.rollback.add({
  label: "Restore workspace protocol dependencies",
  fn: async () => { /* restore from workspaceBackups */ },
});
```

#### 4.3 Changeset Consumption and Changelog

Before consuming changesets, back up all changeset files and the changelog:

```typescript
// Back up changeset files (deleted during consumption)
const changesetFiles = getChangesetFiles(cwd);
const changesetBackups = new Map<string, string>();
for (const file of changesetFiles) {
  changesetBackups.set(file, await Bun.file(file).text());
}
ctx.rollback.add({
  label: `Restore ${changesetBackups.size} changeset file(s)`,
  fn: async () => {
    for (const [filePath, content] of changesetBackups) {
      await Bun.write(filePath, content);
    }
  },
});

// Back up changelog file (modified during consumption)
const changelogPath = path.join(cwd, "CHANGELOG.md");
if (await Bun.file(changelogPath).exists()) {
  const changelogBackup = await Bun.file(changelogPath).text();
  ctx.rollback.add({
    label: "Restore CHANGELOG.md",
    fn: async () => { await Bun.write(changelogPath, changelogBackup); },
  });
}
```

The backup is captured in the runner before calling `deleteChangesetFiles()` and `writeChangelogToFile()` — not inside those functions.

#### 4.4 Git Commit

After `git.commit()` succeeds:

```typescript
ctx.rollback.add({
  label: "Reset git commit",
  fn: async () => {
    await git.reset();
    const status = await git.status();
    if (status.dirty) await git.stash();
    await git.reset("HEAD^", "--hard");
    if (status.dirty) await git.popStash();
  },
});
```

**Note on redundancy with file-restore actions**: In LIFO order, git commit rollback (`git reset HEAD^ --hard`) executes before file-restore actions (4.1, 4.3). The `git reset --hard` already restores files to their pre-commit state, making subsequent file restores a no-op. This is intentional — file-restore actions serve as a safety net if `git reset --hard` fails (the error is logged and execution continues to the next action).

#### 4.5 Git Tag

After each `git.createTag()` succeeds:

```typescript
ctx.rollback.add({
  label: `Delete local tag ${tagName}`,
  fn: async () => { await git.deleteTag(tagName); },
});
```

#### 4.6 Registry Publish

After each registry `publish()` succeeds, if the registry implements `unpublish`:

```typescript
ctx.rollback.add({
  label: `Unpublish ${packageName}@${version} from ${registryName}`,
  fn: async () => { await registry.unpublish(packageName, version); },
  confirm: true,
});
```

#### 4.7 Git Push (Tags)

After `git push --follow-tags` or `git push --tags` succeeds:

```typescript
for (const tag of pushedTags) {
  ctx.rollback.add({
    label: `Delete remote tag ${tag}`,
    fn: async () => { await git.pushDelete("origin", tag); },
  });
}
```

#### 4.8 Git Push (Commits)

Before pushing, capture the current HEAD SHA. After push succeeds, register force-push rollback using the saved SHA (not `HEAD^`, which only handles single-commit scenarios):

```typescript
const prePushSha = await git.revParse("HEAD^");  // or count commits to reset
ctx.rollback.add({
  label: `Force push to revert remote ${branch}`,
  fn: async () => { await git.push("-f", "origin", `${prePushSha}:${branch}`); },
  confirm: true,
});
```

This handles monorepo independent mode where multiple commits may be created before push.

#### 4.9 GitHub Release

After GitHub Release creation:

```typescript
ctx.rollback.add({
  label: `Delete GitHub Release ${releaseTag}`,
  fn: async () => { await deleteGitHubRelease(releaseId); },
});
```

#### 4.10 Plugin Side Effects

Plugins register their own rollback at their hook execution time:

```typescript
// Example: plugin-brew
hooks: {
  afterPublish: async (ctx) => {
    const pr = await createHomebrewPR();
    ctx.rollback.add({
      label: `Close Homebrew PR #${pr.number}`,
      fn: async () => { await closePR(pr.number); },
      confirm: true,
    });
  },
}
```

### 5. Registry `unpublish` Method

Add method to `PackageRegistry` abstract class with a default no-op implementation:

```typescript
abstract class PackageRegistry {
  // ... existing methods
  async unpublish(packageName: string, version: string): Promise<void> {
    // Default: no-op. Registries that support unpublish override this.
  }
}
```

Call sites check if the registry has a meaningful `unpublish` implementation via a separate `supportsUnpublish` flag or by checking if the method is overridden.

**NpmPackageRegistry**: `npm unpublish <pkg>@<version>` — may fail (72h limit, permissions). Rollback label: "Unpublish".

**JsrPackageRegistry**: Not overridden — no API support for version-level deletion.

**CratesPackageRegistry**: `cargo yank --vers <version> <crate>` — marks version as yanked (does not delete). Rollback label: "Yank" (not "Unpublish", since yank prevents new resolution but existing lockfiles still work).

**CustomPackageRegistry**: Extends `NpmPackageRegistry`, inherits `unpublish` automatically.

If a registry does not support unpublish, no rollback action is registered. Registries without unpublish that had successful publishes appear in the manual recovery summary.

### 6. listr2 Rollback UX

Success:
```
✖ Publishing @pubm/core@1.2.3 to jsr

⟲ Rolling back...
  ✓ Unpublished @pubm/core@1.2.3 from npm
  ✓ Deleted remote tag v1.2.3
  ✓ Deleted local tag v1.2.3
  ✓ Reset git commit
  ✓ Restored changeset files
  ✓ Restored package.json
✓ Rollback completed (6/6)
```

With failures:
```
  ✖ Unpublish @pubm/core@1.2.3 from npm — 403 Forbidden
  ✓ Deleted remote tag v1.2.3
  ...
✖ Rollback completed with errors (5/6)
  Manual recovery needed:
    • @pubm/core@1.2.3 remains published on npm
```

SIGINT with skipped confirms:
```
  ⊘ Skipped: Unpublish @pubm/core@1.2.3 from npm (requires confirmation)
  ✓ Deleted remote tag v1.2.3
  ...
✓ Rollback completed (5/6, 1 skipped)
  Manual recovery needed:
    • @pubm/core@1.2.3 may need manual unpublish from npm
```

### 7. SIGINT Handling

- `process.on("SIGINT")` calls `ctx.rollback.execute(ctx, { interactive: false })`
- `confirm: true` actions are skipped (no prompt possible) and added to manual recovery summary
- If SIGINT fires during rollback execution: complete current action, skip remaining, print summary

### 8. Monorepo Rollback

- All-or-nothing: if any package fails, all packages are rolled back
- Registry unpublish order: dependents first, then dependencies (reverse of publish order)
- This is naturally handled by LIFO since publish order is dependencies-first

### 9. Error Flow

```
Pipeline task throws
  → listr2 stops pipeline
  → Error propagates to runner.ts catch block
  → ctx.runtime.pluginRunner.runErrorHook(ctx, error)
  → consoleError(error)
  → ctx.rollback.execute(ctx, { interactive })
  → process.exit(1)
```

## E2E Test Plan

### Failure Point Tests

| # | Failure Point | Rollback Verified |
|---|---|---|
| 1 | `beforeVersion` plugin hook | Nothing changed — clean state |
| 2 | Version file write (partial) | Successfully written files restored |
| 3 | `afterVersion` plugin hook | All version files restored |
| 4 | After changeset consumption, before git commit | Version files + changeset files restored |
| 5 | After git commit, before git tag | Commit reset + files restored |
| 6 | After git tag, before publish | Tag deleted + commit reset + files restored |
| 7 | First registry publish succeeds, second fails | First unpublished + full git rollback |
| 8 | After git push, before GitHub Release | Remote tags deleted + local rollback |
| 9 | After GitHub Release creation | Release deleted + remote + local rollback |
| 10 | Plugin-registered rollback | Plugin rollback action executed |

### Edge Case Tests

| # | Scenario | Verified |
|---|---|---|
| 11 | Rollback action itself fails | Remaining actions continue, failure summary printed |
| 12 | SIGINT triggers rollback | All non-confirm actions execute, confirms skipped |
| 13 | Double execution | Second call is no-op |
| 14 | unpublish permission denied / timeout | Failure logged + manual recovery listed |
| 15 | Workspace protocol restore + version rollback together | Both restored correctly |
| 16 | Monorepo partial publish failure | All packages rolled back (all-or-nothing) |
| 17 | Monorepo unpublish order | Dependents unpublished before dependencies |

## Files to Modify

- `packages/core/src/utils/rollback.ts` — Replace with `RollbackTracker` class
- `packages/core/src/context.ts` — Add `rollback` to `PubmRuntime`
- `packages/core/src/tasks/runner.ts` — Initialize tracker, migrate all rollback registrations, update catch/SIGINT
- `packages/core/src/manifest/write-versions.ts` — Add backup capture before writing version files (or wrap calls in runner)
- `packages/core/src/registry/package-registry.ts` — Add `unpublish` default no-op method
- `packages/core/src/registry/npm.ts` — Implement `unpublish`
- `packages/core/src/registry/crates.ts` — Implement `unpublish` (yank)
- `packages/core/src/registry/jsr.ts` — No `unpublish` (not supported)
- `packages/core/src/plugin/types.ts` — Remove `onRollback` hook
- `packages/core/src/plugin/runner.ts` — Remove `onRollback` invocation
- `packages/plugins/plugin-brew/src/index.ts` — Add `ctx.rollback.add()` for PR close
- `packages/plugins/plugin-external-version-sync/src/index.ts` — Add `ctx.rollback.add()` for file restore
- `packages/core/src/changeset/reader.ts` — Confirm changeset file list is available before deletion for backup
- `packages/core/tests/unit/utils/rollback.test.ts` — Rewrite for `RollbackTracker`
- `packages/core/tests/e2e/rollback/` — New E2E test suite (17 scenarios)
