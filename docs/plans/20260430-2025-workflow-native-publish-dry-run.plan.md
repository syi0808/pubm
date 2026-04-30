---
title: "Workflow Native Publish Dry Run"
status: "completed"
created: "2026-04-30 20:25 KST"
spec: "20260430-2025-workflow-native-publish-dry-run.spec.md"
plan_id: "20260430-2025-workflow-native-publish-dry-run"
---

# Plan: Workflow Native Publish Dry Run

## Source Spec
- Spec file: `docs/plans/20260430-2025-workflow-native-publish-dry-run.spec.md`
- Goals covered: remove workflow publish/dry-run legacy task factory usage; preserve registry publish, dry-run, skip, prompt, rollback, ordering, concurrency, workspace restore, and plugin hook behavior.
- Non-goals preserved: no preflight edits; no registry descriptor API removal; no unrelated runner or snapshot refactors.

## Implementation Strategy
Add one workflow-owned helper module that constructs per-package `ReleaseOperation` objects from `registryCatalog` descriptors and `descriptor.factory`. Keep phase files responsible for grouping, ordering, concurrency, workspace restore, and plugin hooks. Move only the runtime behavior needed by workflow publish and dry-run into the helper, borrowing logic from legacy tasks without calling those task creators.

Use registry-key and capability-based branching for npm-compatible, JSR, crates, and generic `PackageRegistry` behavior. Private npm-compatible registries should benefit from descriptor factories returning custom npm registry instances while using npm publish semantics.

## File And Module Map
- Create: `packages/core/src/workflow/registry-operations.ts`
- Modify: `packages/core/src/workflow/release-phases/publish.ts`
- Modify: `packages/core/src/workflow/release-phases/dry-run.ts`
- Leave unchanged: `packages/core/src/workflow/release-phases/preflight.ts`, registry classes, legacy task modules, plugin registration, catalog descriptor shape.

## Task Breakdown

### Phase 1: Workflow Helper

#### Task 1: Add native publish and dry-run operation factories
**Files**
- Create: `packages/core/src/workflow/registry-operations.ts`

- [x] Define `createRegistryPublishOperation(registryKey, packageKey)` and `createRegistryDryRunOperation(registryKey, packageKey, siblingKeys?)`, each returning `ReleaseOperation`.
- [x] Resolve descriptor with `registryCatalog.get(registryKey)` and construct the registry with `descriptor.factory(pathFromKey(packageKey))`.
- [x] Set operation titles from package key or registry label, then update title/output with registry package names once factories resolve.
- [x] Throw a clear error when the descriptor is missing because workflow cannot publish without a registry descriptor.

#### Task 2: Preserve publish behavior
**Files**
- Create: `packages/core/src/workflow/registry-operations.ts`

- [x] Implement already-published pre-check with `getPackageVersion(ctx, packageKey)` and `registry.isVersionPublished(version)`.
- [x] Implement npm-compatible publish:
  - prompt mode: call `publish(ctx.runtime.npmOtp, ctx.runtime.tag)`, prompt up to 3 OTP attempts through `operation.prompt().run`, share `ctx.runtime.npmOtpPromise`, store `ctx.runtime.npmOtp`, and avoid double publishing by the OTP creator.
  - CI mode: require `process.env.NODE_AUTH_TOKEN`, call `publishProvenance(ctx.runtime.tag)`, and throw the existing 2FA/credential messages on false or missing token.
  - fallback skip when publish errors report previously published versions.
  - register unpublish rollback using descriptor `unpublishLabel`, `registry.supportsUnpublish`, `ctx.runtime.promptEnabled`, and `ctx.config.rollback.dangerouslyAllowUnpublish`.
- [x] Implement JSR publish:
  - in CI mode, set `JsrClient.token` from `process.env.JSR_TOKEN` when the client has no token.
  - call `publish()`, handle `packageCreationUrls` in prompt mode by opening the first URL, prompting enter up to 3 times, and retrying.
  - fail in non-interactive mode with the package creation URLs.
  - fallback skip when publish errors report already published versions.
- [x] Implement crates publish:
  - call `publish()`, skip on already-published pre-check, and fallback skip when errors include `is already uploaded`.
  - register yank rollback with descriptor `unpublishLabel` and the same no-op/confirm behavior as legacy tasks.
- [x] Implement generic publish:
  - call `publish()`, skip already-published versions, fallback skip on generic already-published errors, and register rollback only when `supportsUnpublish` is true.

### Phase 2: Dry-Run Behavior

#### Task 3: Preserve dry-run behavior
**Files**
- Create: `packages/core/src/workflow/registry-operations.ts`

- [x] Implement `withTokenRetry` in workflow helper using descriptor `tokenConfig`, auth error detection, shared `ctx.runtime.tokenRetryPromises`, `operation.prompt().run`, `SecureStore.set`, and `process.env`.
- [x] For JSR token retry, also update `JsrClient.token` with the refreshed token before retrying.
- [x] Implement npm dry-run by calling `dryRunPublish(ctx.runtime.tag)` after already-published skip.
- [x] Implement JSR dry-run by calling `dryRunPublish()` after already-published skip.
- [x] Implement crates dry-run by copying proactive sibling dependency detection through `RustEcosystem.dependencies()`, sibling crate names, sibling version checks, and reactive missing/version mismatch error parsing.
- [x] Implement generic dry-run by calling `dryRunPublish()` with token retry and already-published skip.

### Phase 3: Phase File Migration

#### Task 4: Replace legacy factories in publish phase
**Files**
- Modify: `packages/core/src/workflow/release-phases/publish.ts`

- [x] Remove `releaseOperationFromLegacyTask` import.
- [x] Import `createRegistryPublishOperation` from the new helper.
- [x] Replace `createPublishOperationForPath` logic with the helper while leaving grouping, ordering, concurrency, before/after hooks, and workspace restore intact.

#### Task 5: Replace legacy factories in dry-run phase
**Files**
- Modify: `packages/core/src/workflow/release-phases/dry-run.ts`

- [x] Remove `releaseOperationFromLegacyTask` import.
- [x] Import `createRegistryDryRunOperation` from the new helper.
- [x] Replace `createDryRunOperationForPath` logic with the helper while leaving grouping, sibling key selection, concurrency, workspace restore, lockfile sync, and version restore intact.

### Phase 4: Verification And Review

#### Task 6: Search and static verification
**Files**
- Inspect: `packages/core/src/workflow/**/*.ts`

- [x] Run `rg -n "releaseOperationFromLegacyTask|descriptor\\.taskFactory|createPublishTask|createDryRunTask" packages/core/src/workflow`.
- [x] Expected: no publish/dry-run workflow usage remains; any remaining hit must be unrelated or removed.

#### Task 7: Focused tests
**Files**
- Relevant tests under `packages/core/tests`

- [x] Run focused release contract test if feasible:
  - Command: `cd packages/core && bun vitest --run tests/contracts/release/current-runner-contract.test.ts`
  - Expected: pass or fail only for unrelated in-progress migration conflicts, recorded with evidence.
- [x] Run dry-run unit tests:
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/release-phases/dry-run.test.ts tests/unit/tasks/dry-run-publish.test.ts`
  - Expected: pass or fail only where legacy-task tests need migration updates outside this scope, recorded with evidence.
- [x] Run registry publish tests:
  - Command: `cd packages/core && bun vitest --run tests/unit/tasks/npm.test.ts tests/unit/tasks/jsr.test.ts tests/unit/tasks/crates.test.ts`
  - Expected: pass because registry class/task behavior should remain unchanged.
- [x] Run focused typecheck if feasible:
  - Command: `cd packages/core && bun run typecheck`
  - Expected: pass or record blockers from other worktree changes.

## Interfaces, Data Flow, And State
- Phase files collect ecosystem and registry groups from `ctx.config`.
- Per-package helpers use `packageKey -> pathFromKey(packageKey) -> descriptor.factory(packagePath) -> PackageRegistry`.
- Runtime shared state preserved:
  - `ctx.runtime.npmOtp`, `ctx.runtime.npmOtpPromise`
  - `ctx.runtime.tokenRetryPromises`
  - `ctx.runtime.workspaceBackups`
  - `ctx.runtime.dryRunVersionBackup`
  - `ctx.runtime.rollback`
- No public API or configuration contract changes.

## Edge Cases And Failure Modes
- Already-published versions should skip before commands run.
- Already-published errors from npm/JSR/crates should skip after command failure.
- npm OTP prompt should be shared among concurrent npm publish operations.
- npm CI provenance fallback remains inside `NpmPackageRegistry.publishProvenance`.
- JSR package creation URLs should be opened and retried only in prompt mode.
- crates dry-run must skip unpublished sibling dependency failures instead of failing the whole validation.
- Rollback actions must remain no-op in CI unless dangerous unpublish is enabled.

## Test And Verification Matrix
- Requirement: no legacy workflow bridge usage.
- Test or command: `rg -n "releaseOperationFromLegacyTask|descriptor\\.taskFactory|createPublishTask|createDryRunTask" packages/core/src/workflow`
- Expected result: no relevant workflow hits.

- Requirement: publish/dry-run grouping and restore flows unchanged.
- Test or command: `cd packages/core && bun vitest --run tests/contracts/release/current-runner-contract.test.ts tests/unit/workflow/release-phases/dry-run.test.ts`
- Expected result: pass or documented unrelated migration conflict.

- Requirement: registry publish/dry-run behavior preserved.
- Test or command: `cd packages/core && bun vitest --run tests/unit/tasks/dry-run-publish.test.ts tests/unit/tasks/npm.test.ts tests/unit/tasks/jsr.test.ts tests/unit/tasks/crates.test.ts`
- Expected result: pass because registry task modules remain unchanged; workflow helper behavior reviewed against those tests.

- Requirement: TypeScript validity.
- Test or command: `cd packages/core && bun run typecheck`
- Expected result: pass or documented blocker from existing dirty migration state.

## Rollout And Review
- Review focus: behavior parity for npm OTP/provenance, JSR package creation, crates sibling dry-run skip, rollback action registration, and descriptor factory usage.
- Rollback note: changes are isolated to workflow publish/dry-run and one helper; reverting these files restores legacy task-factory delegation if needed.

## Assumptions
- Existing tests may still focus on legacy task modules while the workflow migration adds native behavior; this implementation will not delete those modules.
- Workflow operation `skip()` is primarily a UI signal, so title/output updates and avoiding registry side effects are the important observable skip semantics.
