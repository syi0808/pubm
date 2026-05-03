---
title: "Workflow Preflight Check Operations"
status: "completed"
created: "2026-04-30 20:25 KST"
spec: "20260430-2025-workflow-preflight-check-operations.spec.md"
plan_id: "20260430-2025-workflow-preflight-check-operations"
---

# Plan: Workflow Preflight Check Operations

## Source Spec
- Spec file: `docs/plans/20260430-2025-workflow-preflight-check-operations.spec.md`
- Goals covered: create workflow-owned preflight check operations, wire workflow preflight to them, preserve behavior and skip/plugin semantics, verify with focused checks.
- Non-goals preserved: no publish or dry-run edits, no legacy task module removal, no public API/config/translation changes, no unrelated dirty worktree cleanup.

## Implementation Strategy
Add a new workflow release phase helper file that mirrors the behavior of the two legacy preflight check task factories using `ReleaseOperation` objects. Keep top-level prerequisite and condition operations so the existing skip flags suppress whole check groups. Use `operation.runOperations` for nested prerequisite checks and for the concurrent condition checks that previously used Listr concurrency. Update `preflight.ts` to call `runReleaseOperations` with these factories and remove direct imports of the two legacy task modules.

Focused tests should validate the migration boundary rather than retest every legacy behavior already covered in task tests: ensure workflow preflight no longer imports the legacy check modules, skip flags suppress the new operations, plugin checks are wrapped, and representative prerequisite/condition behaviors still execute through `ReleaseOperation`.

## File And Module Map
- Create: `packages/core/src/workflow/release-phases/preflight-checks.ts`
- Modify: `packages/core/src/workflow/release-phases/preflight.ts`
- Create or modify tests: `packages/core/tests/unit/workflow/release-phases/preflight-checks.test.ts` if the existing test structure supports this path.
- Create: `docs/plans/20260430-2025-workflow-preflight-check-operations.spec.md`
- Create: `docs/plans/20260430-2025-workflow-preflight-check-operations.plan.md`
- Leave unchanged: `packages/core/src/workflow/release-phases/publish.ts`, `packages/core/src/workflow/release-phases/dry-run.ts`, `packages/core/src/tasks/prerequisites-check.ts`, `packages/core/src/tasks/required-conditions-check.ts`

## Task Breakdown

### Phase 1: Implement Workflow Check Operations

#### Task 1: Add prerequisite operations
**Files**
- Create: `packages/core/src/workflow/release-phases/preflight-checks.ts`

- [x] Define a `PrerequisitesCheckError` matching the existing error name/message behavior.
- [x] Export `createPrerequisitesCheckOperation(skip?: boolean): ReleaseOperation`.
- [x] Inside the top-level operation, create nested operations for:
  - Branch verification, skipped by `ctx.options.anyBranch`.
  - Remote fetch and pull checks.
  - Working tree check that updates `ctx.runtime.cleanWorkingTree`.
  - Commit check against the latest tag.
  - Plugin prerequisite checks from `ctx.runtime.pluginRunner.collectChecks(ctx, "prerequisites")`.
- [x] Use `task.prompt().run`, `task.output`, and `task.title` the same way the legacy task does.
- [x] Wrap plugin operation contexts with `wrapTaskContext` before calling plugin checks.

#### Task 2: Add required-condition operations
**Files**
- Create: `packages/core/src/workflow/release-phases/preflight-checks.ts`

- [x] Define a `RequiredConditionCheckError` matching the existing error name/message behavior.
- [x] Export `detectTagNameCollisions` or keep it internal if tests do not need direct access.
- [x] Export `createRequiredConditionsCheckOperation(skip?: boolean): ReleaseOperation`.
- [x] Inside the top-level operation, run nested condition operations with `{ concurrent: true }`.
- [x] Mirror condition operations for registry pings, script validation, git version validation, registry availability, plugin condition checks, and tag collision detection.
- [x] For registry availability, create nested operations for ecosystem groups and package paths, preserving concurrent execution where the legacy task used nested concurrent Listr groups.
- [x] Preserve tag collision prompt behavior: prompt only when `ctx.runtime.promptEnabled`, set `ctx.runtime.registryQualifiedTags = true` when accepted, throw when declined or non-interactive.

### Phase 2: Wire Workflow Preflight

#### Task 3: Replace legacy task calls
**Files**
- Modify: `packages/core/src/workflow/release-phases/preflight.ts`

- [x] Remove imports of `prerequisitesCheckTask` and `requiredConditionsCheckTask`.
- [x] Import `createPrerequisitesCheckOperation` and `createRequiredConditionsCheckOperation` from `./preflight-checks.js`.
- [x] Replace each `prerequisitesCheckTask(...).run(ctx)` call with `runReleaseOperations(ctx, createPrerequisitesCheckOperation(ctx.options.skipPrerequisitesCheck))`.
- [x] Replace each `requiredConditionsCheckTask(...).run(ctx)` call with `runReleaseOperations(ctx, createRequiredConditionsCheckOperation(ctx.options.skipConditionsCheck))`.
- [x] Keep token collection, cleanup chaining, prompt disabling, early auth collection, and plugin credential collection unchanged.

### Phase 3: Focused Tests And Verification

#### Task 4: Add migration-focused tests
**Files**
- Create: `packages/core/tests/unit/workflow/release-phases/preflight-checks.test.ts`

- [x] Test top-level skip behavior by running each operation with skip enabled and verifying representative side effects do not occur.
- [x] Test prerequisite plugin checks call `collectChecks(ctx, "prerequisites")` and invoke plugin checks through `wrapTaskContext`.
- [x] Test condition plugin checks call `collectChecks(ctx, "conditions")` and invoke plugin checks through `wrapTaskContext`.
- [x] Test tag collision behavior for independent versioning: accepted prompt sets `ctx.runtime.registryQualifiedTags`, declined or non-interactive throws.
- [x] Test a representative prerequisite check such as wrong branch confirmation switches branch through `Git.switch`.

#### Task 5: Run verification
**Files**
- Review: `packages/core/src/workflow/release-phases/preflight.ts`
- Review: `packages/core/src/workflow/release-phases/preflight-checks.ts`
- Review: changed tests and planning docs

- [x] Run focused preflight tests:
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/release-phases/preflight-checks.test.ts tests/unit/tasks/prerequisites-check.test.ts tests/unit/tasks/required-conditions-check.test.ts`
  - Expected: tests pass.
- [x] Run release contract if feasible:
  - Command: `cd packages/core && bun vitest --run tests/contracts/release/current-runner-contract.test.ts`
  - Expected: tests pass.
- [x] Run typecheck if focused tests do not cover TypeScript integration:
  - Command: `bun run typecheck`
  - Expected: no type errors.
- [x] Confirm workflow preflight no longer imports the legacy check factories:
  - Command: `rg "prerequisitesCheckTask|requiredConditionsCheckTask" packages/core/src/workflow/release-phases/preflight.ts packages/core/src/workflow/release-phases/preflight-checks.ts`
  - Expected: no matches.
- [x] Confirm publish and dry-run files were not changed by this work:
  - Command: `git diff -- packages/core/src/workflow/release-phases/publish.ts packages/core/src/workflow/release-phases/dry-run.ts`
  - Expected: no diff attributable to this task.

## Interfaces, Data Flow, And State
- `runCiPreparePreflight` continues to collect tokens, sync GitHub secrets, inject token env vars, and set `ctx.runtime.promptEnabled = false` before running both preflight check groups.
- `runLocalPreflight` continues to run prerequisites before early auth token collection and required conditions after plugin credential collection.
- New operation factories return `ReleaseOperation` and are internal to workflow release phases.
- Plugin checks receive `PluginTaskContext` via `wrapTaskContext`, preserving the plugin-facing `title`, `output`, and `prompt` interface.
- Required-condition registry availability receives the operation context as the task-like object.

## Edge Cases And Failure Modes
- Whole-group skip flags must prevent nested operations and plugin checks from running.
- Branch prompt rejection, fetch prompt rejection, pull prompt rejection, dirty working tree rejection, and no-commit rejection must throw the same user-facing messages.
- Script validation must avoid duplicate workspace-level validation for packages without per-package overrides, matching legacy behavior.
- Registry ping and availability grouping must preserve ecosystem and registry grouping.
- Concurrent condition checks can reject before every in-flight check settles, matching the practical behavior of Promise-based concurrent execution.
- Tag collisions must only fail independent versioning when tags are not registry-qualified and duplicate names span ecosystems.

## Test And Verification Matrix
- Requirement: no workflow dependency on the two legacy check task modules.
  - Test or command: `rg "prerequisitesCheckTask|requiredConditionsCheckTask" packages/core/src/workflow/release-phases/preflight.ts packages/core/src/workflow/release-phases/preflight-checks.ts`
  - Expected result: no matches.
- Requirement: skip flags suppress matching check group.
  - Test or command: focused `preflight-checks.test.ts`.
  - Expected result: representative Git or registry side effects do not run when skip is true.
- Requirement: plugin checks remain wrapped.
  - Test or command: focused `preflight-checks.test.ts`.
  - Expected result: `wrapTaskContext` is called and plugin check receives the wrapped context.
- Requirement: tag collision behavior preserved.
  - Test or command: focused `preflight-checks.test.ts`.
  - Expected result: accepted prompt sets runtime state; declined/non-interactive path throws.
- Requirement: TypeScript integration works.
  - Test or command: `bun run typecheck` or focused package typecheck if available.
  - Expected result: no type errors.

## Rollout And Review
- Review should focus on behavior parity with the legacy task factories and on avoiding imports from the two legacy check task modules in workflow preflight.
- No runtime rollout or migration step is required because this is an internal implementation migration.
- Existing legacy task modules remain for snapshot or other non-workflow callers.

## Assumptions
- The operation runner is the intended execution primitive for workflow release phase checks.
- Existing helper imports from pure utility-like modules are acceptable if they do not reintroduce direct dependency on the two legacy check task factories.
- Focused unit tests plus typecheck are sufficient for this scoped migration unless unrelated dirty worktree changes block broader verification.
