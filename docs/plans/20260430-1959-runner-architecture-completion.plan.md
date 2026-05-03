---
title: "Runner Architecture Completion"
status: "completed"
created: "2026-04-30 19:59 KST"
spec: "20260430-1959-runner-architecture-completion.spec.md"
plan_id: "20260430-1959-runner-architecture-completion"
---

# Plan: Runner Architecture Completion

## Source Spec

- Spec file: `docs/plans/20260430-1959-runner-architecture-completion.spec.md`
- Goals covered: remove direct release dependence on legacy runner/task orchestration, preserve release behavior, move tests to workflow/service contracts, and pass all guardrails.
- Non-goals preserved: no CLI/config/plugin redesign, no release-pr/resume storage, no coverage threshold reduction, no public workflow step exports.

## Implementation Strategy

Finish the migration in deletion-safe phases. First freeze expected behavior so the suite no longer needs legacy task factories as an oracle. Then migrate phase execution into workflow-owned services one boundary at a time. Only after direct workflow no longer imports `tasks/release-phase-service.ts` or `tasks/phases/*`, delete or reduce legacy orchestration files and move task tests to workflow/service tests.

The direct workflow should keep the current step order: `test`, `build`, `version`, `publish`, `dry-run`, `push`, `release`. Each step can call a narrow service function, but the service must be runner-neutral and must not return `Task` objects.

## File And Module Map

- Create:
  - `packages/core/src/workflow/release-operation.ts`
  - `packages/core/src/workflow/registry-operations.ts`
  - `packages/core/src/workflow/release-phases/*`
  - `packages/core/src/workflow/release-utils/*`
  - workflow/service tests as legacy task tests are migrated.
- Modify:
  - `packages/core/src/workflow/direct-release-workflow.ts`
  - `packages/core/src/workflow/release-record.ts`
  - `packages/core/tests/contracts/release/current-runner-contract.test.ts`
  - affected `packages/core/tests/unit/tasks/*` files as they move.
- Delete or reduce:
  - `packages/core/tests/contracts/release/legacy-runner-oracle.ts`
  - `packages/core/src/tasks/release-phase-service.ts`
  - `packages/core/src/tasks/phases/version.ts`
  - `packages/core/src/tasks/phases/publish.ts`
  - `packages/core/src/tasks/phases/dry-run.ts`
  - `packages/core/src/tasks/phases/push-release.ts`
  - `packages/core/src/tasks/phases/test-build.ts`
  - `packages/core/src/tasks/runner.ts` if no compatibility exports remain.

## Task Breakdown

### Phase 1: Freeze Contract Oracle

- [x] Convert migrated runner parity from legacy oracle comparison to frozen semantic expectations for characterized release scenarios.
- [x] Remove the old oracle instead of keeping it as a live compatibility target.
- [x] Add a guard that fails if workflow code imports `tasks/runner`, `tasks/release-phase-service`, or `tasks/phases`.
- [x] Run the release contract suite after oracle replacement and record the baseline.

### Phase 2: Extract Runner-Neutral Services

- [x] Move test/build execution logic from `tasks/phases/test-build.ts` into workflow-owned operations.
- [x] Move version execution logic from `tasks/phases/version.ts` into workflow-owned operations using the pinned version output helpers.
- [x] Move publish and dry-run execution logic out of phase task factories while preserving registry ordering, already-published behavior, and plugin hook order.
- [x] Move push/release execution logic out of `tasks/phases/push-release.ts` while preserving PR fallback, remote tag cleanup, GitHub release creation/deletion, assets, and rollback.
- [x] Keep reusable low-level helpers such as version writing, publish target construction, rollback handlers, and GitHub release helpers when they are not orchestration owners.

### Phase 3: Rewrite Tests Away From Task Shape

- [x] For each deleted phase helper, move tests that assert behavior into workflow/service tests.
- [x] Delete tests that only assert legacy task shape, title mutation, or runner mechanics when equivalent behavior coverage exists.
- [x] Keep behavior tests for dry-run isolation, CI publish, version write/rollback, partial publish rollback, crates ordering/yank, PR fallback, GitHub release/assets failure, prompt cancel, and SIGINT.

### Phase 4: Delete Legacy Orchestration

- [x] Remove direct workflow imports of `tasks/release-phase-service.ts` and `tasks/phases/*`.
- [x] Delete or reduce `tasks/release-phase-service.ts`.
- [x] Delete phase files that no longer own behavior and update imports.
- [x] Delete `tasks/runner.ts` after confirming `src/index.ts` and snapshot callers import `workflow/runner-entry.ts` or runner-neutral helpers directly.

### Phase 5: Guardrails And Fault Injection

- [x] Run public export guard:
  - `rg -n "\\b(WorkflowStep|WorkflowStepResult|WorkflowFactDescriptor|WorkflowCompensationExpectation|WorkflowReleaseRecord|WorkflowVersionStepOutput)\\b" packages/core/src/index.ts`
  - Expected: no matches.
- [x] Run workflow legacy leakage guard:
  - `rg -n "tasks/runner|tasks/release-phase-service|tasks/phases|from ['\\\"][^'\\\"]*listr|listr2|@pubm/runner|ListrTask|Task<" packages/core/src/workflow`
  - Expected: no matches.
- [x] Run focused workflow and release contracts.
- [x] Inject one temporary fault in a migrated side-effect boundary, confirm failure, revert it, and rerun the focused contract.
- [x] Run `bun run typecheck`, `bun run check`, `bun run test`, and `bun run coverage`.

## Completion Notes

- Snapshot publishing was included in the final migration scope because it is also a release pipeline. `runSnapshotPipeline` no longer uses `createListr`, legacy preflight task factories, or registry `taskFactory` publish tasks.
- The remaining `@pubm/runner` usage is outside the migrated direct/snapshot release workflow boundary: registry compatibility task factories, prompt utilities, and runner package tests remain as existing public/internal compatibility surfaces.
- The intentional fault injection was performed by temporarily disabling npm rollback registration in `packages/core/src/workflow/registry-operations.ts`. `tests/contracts/release/current-runner-contract.test.ts` failed on rollback/compensation expectations, then passed after the fault was reverted.

## Interfaces, Data Flow, And State

- `runner-entry.ts` creates `DirectReleaseWorkflow`, `InMemoryReleaseRecord`, and signal services.
- `DirectReleaseWorkflow` builds domain steps and executes them with workflow services.
- Workflow-owned services perform effects behind typed methods and record facts/compensation expectations.
- `PubmContext.runtime.versionPlan` remains compatibility input for version decision but pinned workflow output is the record used by subsequent workflow facts.

## Edge Cases And Failure Modes

- Dry-run must not write manifests, commit, tag, push, publish, or create releases.
- CI publish must read manifest-pinned versions and avoid version writes.
- Tag overwrite prompt cancellation must restore manifests and prevent publish.
- GitHub release failure after push must rollback registry publish, local tag, remote tag, commit, and manifest writes.
- Partial registry publish failure must rollback successful publishes in the existing policy order.
- SIGINT after publish must execute non-confirm rollback and exit through the interrupt path.

## Test And Verification Matrix

- Requirement: behavior compatibility.
  - Command: `cd packages/core && bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/contracts/release/current-runner-contract.test.ts`
  - Expected: all release contract tests pass.
- Requirement: no public workflow API.
  - Command: public export guard from Phase 5.
  - Expected: no matches.
- Requirement: no legacy workflow imports.
  - Command: workflow legacy leakage guard from Phase 5.
  - Expected: no matches.
- Requirement: repo health.
  - Commands: `bun run typecheck`, `bun run check`, `bun run test`, `bun run coverage`.
  - Expected: all pass without lowering thresholds.

## Rollout And Review

- Review focus: deleted files have replacement behavior tests, workflow code has no task runner imports, and contract guardrails still catch injected faults.
- No changeset is expected unless a user-visible release behavior changes.

## Assumptions

- The current version-step output slice remains part of this completion work.
- Work may proceed in multiple local patches, but final completion requires all phases above to pass.
