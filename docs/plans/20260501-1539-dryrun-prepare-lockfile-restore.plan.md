---
title: "Dry Run Prepare Lockfile Restore"
status: "completed"
created: "2026-05-01 15:39 KST"
spec: "20260501-1539-dryrun-prepare-lockfile-restore.spec.md"
plan_id: "20260501-1539-dryrun-prepare-lockfile-restore"
---

# Plan: Dry Run Prepare Lockfile Restore

## Source Spec
- Spec file: `docs/plans/20260501-1539-dryrun-prepare-lockfile-restore.spec.md`
- Goals covered: restore dry-run prepare version and lockfile writes on success and failure; preserve real prepare behavior; add regression coverage.
- Non-goals preserved: no phase redesign, no registry dry-run behavior changes, no lockfile command changes.

## Implementation Strategy
Keep the existing success-path restore operations. Add failure-path protection by registering a rollback action inside `applyVersionsForDryRun()` before it calls `writeVersions()` for the temporary dry-run version map. The rollback action will call the same `writeVersions(ctx, backupVersions)` path used by successful dry-run restore, so lockfile restoration stays aligned with current ecosystem behavior.

## File And Module Map
- Modify: `packages/core/src/workflow/release-utils/manifest-handling.ts`
- Modify: `packages/core/tests/unit/workflow/release-utils/manifest-handling.test.ts`
- Modify: `packages/core/tests/unit/workflow/release-phases/dry-run.test.ts`
- Leave unchanged: CLI option parsing, version phase writes, package manager lockfile commands, registry dry-run operations.

## Task Breakdown

### Phase 1: Regression Tests

#### Task 1: Prove dry-run version writes register rollback before mutation
**Files**
- Modify: `packages/core/tests/unit/workflow/release-utils/manifest-handling.test.ts`

- [x] Capture rollback actions in the manifest-handling test context.
- [x] Add a test that calls `applyVersionsForDryRun()` with a version plan and asserts:
  - one restore action is registered,
  - registration happens before the temporary `writeVersions()` call,
  - executing the action calls `writeVersions(ctx, originalVersions)`.

#### Task 2: Prove dry-run phase failure leaves rollback available
**Files**
- Modify: `packages/core/tests/unit/workflow/release-phases/dry-run.test.ts`

- [x] Mock `applyVersionsForDryRun()` to register a rollback action and then throw from the dry-run operation path.
- [x] Assert the first validation operation rejects and that rollback actions remain registered for the workflow catch path.

### Phase 2: Implementation

#### Task 3: Register dry-run version restore rollback
**Files**
- Modify: `packages/core/src/workflow/release-utils/manifest-handling.ts`

- [x] Build `backupVersions` before any mutation.
- [x] Assign `ctx.runtime.dryRunVersionBackup = backupVersions`.
- [x] Register `ctx.runtime.rollback.add({ label, fn })` before calling `writeVersions(ctx, newVersions)`.
- [x] In the rollback function, call `writeVersions(rollbackCtx, backupVersions)` so manifests and lockfiles are restored through the existing sync path.
- [x] Keep the existing success-path restore operation unchanged.

## Interfaces, Data Flow, And State
- `applyVersionsForDryRun(ctx)`:
  - reads original versions from `ctx.config.packages`,
  - stores them in `ctx.runtime.dryRunVersionBackup`,
  - registers rollback using that same map,
  - writes temporary versions through `writeVersions()`.
- On workflow failure, `ctx.runtime.rollback.execute()` calls the registered restore action.
- On success, `createDryRunOperations(...)[2]` restores versions and clears `dryRunVersionBackup` as before.

## Edge Cases And Failure Modes
- If `writeVersions()` fails after partially mutating files, rollback has already been registered.
- If rollback restore fails because a required package manager command fails, rollback reports the failure through existing rollback reporting.
- If `applyVersionsForDryRun()` is called without a version plan, it still returns without registering rollback or writing files.

## Test And Verification Matrix
- Requirement: rollback is registered before dry-run version writes.
  - Test or command: `cd packages/core && bun vitest --run tests/unit/workflow/release-utils/manifest-handling.test.ts`
  - Expected result: pass.

- Requirement: dry-run phase tests still pass with restore behavior.
  - Test or command: `cd packages/core && bun vitest --run tests/unit/workflow/release-phases/dry-run.test.ts`
  - Expected result: pass.

- Requirement: TypeScript remains valid for changed core files.
  - Test or command: `cd packages/core && bun run typecheck`
  - Expected result: pass.

## Rollout And Review
- Review focus: rollback registration order, accidental behavior changes for non-dry-run prepare, and whether the restore path includes lockfile sync.
- No migration or documentation update is required because this restores intended dry-run behavior.

## Assumptions
- The smallest reliable fix is to reuse `writeVersions()` for rollback rather than adding lockfile-specific snapshot and restore logic.
