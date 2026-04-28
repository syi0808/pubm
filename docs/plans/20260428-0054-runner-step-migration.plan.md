---
title: "Runner Step Migration"
status: "draft"
created: "2026-04-28 00:54 KST"
spec: "20260428-0054-runner-step-migration.spec.md"
plan_id: "20260428-0054-runner-step-migration"
---

# Plan: Runner Step Migration

## Source Spec

- Spec file: `docs/plans/20260428-0054-runner-step-migration.spec.md`
- Goals covered:
  - Keep `runner-entry.ts` as the vNext contract target.
  - Add an internal Step contract with `id`, input/output metadata, `run`, emitted facts, and compensation expectations.
  - Preserve direct release behavior while moving orchestration boundaries.
  - Verify behavior through semantic contract records instead of Listr task shape.
- Non-goals preserved:
  - Do not remove `tasks/runner.ts`.
  - Do not build listr2 adapter scaffolding for the post-PR #35 migration.
  - Do not export new Step APIs publicly.
  - Do not introduce release-pr, resume publish, or persistent recovery workflows in this slice.
  - Do not change user-facing CLI/API/plugin behavior.

## Implementation Strategy

Start with an internal type-level and wrapper-level migration, not a behavioral rewrite. The first code slice should make `DirectReleaseWorkflow` build domain-oriented Step descriptors, then execute those descriptors through the runner boundary that exists after PR #35 is merged. This creates the architecture hook without changing release semantics.

The earlier pre-PR #35 plan assumed a temporary `ListrViewAdapter` bridge because the current branch still contains listr2 task plumbing. That bridge is not part of the intended migration once PR #35 lands. After rebasing on PR #35, inspect the changed runner boundary first and wire Step execution into that boundary directly instead of adding or preserving a listr2 adapter.

The first concrete Step target should be `version`, because it is where version truth, manifest materialization, changelog writes, changeset consumption, commit/tag creation, and rollback descriptors converge. The first pass should wrap the existing `createVersionTask` helper without changing its logic. Only after parity is proven should internal logic move into services such as `GitService`, `EcosystemProvider`, and a future `ReleaseRecordStore`.

## File And Module Map

- Create:
  - `packages/core/tests/unit/workflow/step-contract.test.ts`
  - `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`
- Modify:
  - `packages/core/src/workflow/types.ts`
  - `packages/core/src/workflow/direct-release-workflow.ts`
  - the runner boundary file introduced or changed by PR #35, discovered with `rg -n "runner|Workflow|Step|execute|task" packages/core/src/workflow packages/core/src/tasks packages/core/src`
  - `packages/core/tests/contracts/release/current-runner-contract.test.ts`
- Delete:
  - No files.
- Leave unchanged:
  - `packages/core/src/tasks/runner.ts`
  - `packages/core/src/tasks/phases/version.ts` during the wrapper slice
  - `packages/core/src/tasks/phases/push-release.ts` during the wrapper slice
  - Public exports in `packages/core/src/index.ts`

## Task Breakdown

### Phase 1: Baseline And Contract Guard

#### Task 1: Confirm the local verification runtime

**Files**
- Modify: none
- Test: none

- [ ] Step 1: Check the default Node runtime.
  - Command: `node -v`
  - Expected: `v24.x` or newer for direct Vitest 4 execution.

- [ ] Step 2: If the default Node is older, use the temporary Node 24 runner for focused Vitest commands.
  - Command from `packages/core`: `bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/contracts/release/current-runner-contract.test.ts`
  - Expected: 25 release contract tests pass.

- [ ] Step 3: Keep `bun run typecheck` as the repo-level type baseline.
  - Command from repo root: `bun run typecheck`
  - Expected: all Turbo typecheck/build tasks pass.

#### Task 2: Keep migrated parity scenarios explicit

**Files**
- Modify: `packages/core/tests/contracts/release/current-runner-contract.test.ts`
- Test: `packages/core/tests/contracts/release/current-runner-contract.test.ts`

- [ ] Step 1: Inspect the migrated runner parity list at the bottom of the contract file.
  - Current expected list:
    - `local-independent-crates-order-and-yank`
    - `local-private-registry-boundary`
    - `local-push-fallback-version-pr`
    - `github-release-create-fails-after-push`

- [ ] Step 2: Add `partial-publish-failure-rollback` to migrated parity before changing Step execution.
  - Reason: this scenario proves rollback after a successful registry publish and catches compensation ordering regressions.

- [ ] Step 3: Run the contract file before implementation.
  - Command from `packages/core`: `bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/contracts/release/current-runner-contract.test.ts`
  - Expected: all tests pass before code movement.

### Phase 2: Internal Step Contract

#### Task 3: Split domain steps from runner mechanics

**Files**
- Modify: `packages/core/src/workflow/types.ts`
- Test: `packages/core/tests/unit/workflow/step-contract.test.ts`

- [ ] Step 1: Add internal Step types without exporting them from `packages/core/src/index.ts`.

```ts
export interface WorkflowFactDescriptor {
  name: string;
  target?: string;
  detail?: Record<string, unknown>;
}

export interface WorkflowCompensationExpectation {
  name: string;
  target?: string;
  before: string;
}

export interface WorkflowStepResult<O = unknown> {
  output: O;
  facts?: readonly WorkflowFactDescriptor[];
}

export interface WorkflowStepContext {
  ctx: PubmContext;
  services: WorkflowServices;
}

export interface WorkflowStep<I = unknown, O = unknown> {
  id: string;
  input?: I;
  output?: O;
  emittedFacts?: readonly WorkflowFactDescriptor[];
  compensation?: readonly WorkflowCompensationExpectation[];
  run(input: I, context: WorkflowStepContext): Promise<WorkflowStepResult<O>>;
}

```

- [ ] Step 2: Inspect the post-PR #35 runner boundary before wiring execution.
  - Command: `rg -n "runner|Workflow|Step|execute|task" packages/core/src/workflow packages/core/src/tasks packages/core/src`
  - Expected: identify the non-listr runner entry or executor that should drive Step execution.

- [ ] Step 3: Change `Workflow.describe` to return `readonly WorkflowStep[]`.
  - Compatibility note: `describe` becomes a domain graph description. Runner scheduling or rendering should stay outside the Step contract.

- [ ] Step 4: Add unit tests that prove the new types are internal by checking `packages/core/src/index.ts` does not export `WorkflowStep`.
  - Command: `rg -n "WorkflowStep|WorkflowFactDescriptor|WorkflowCompensationExpectation" packages/core/src/index.ts`
  - Expected: no matches.

### Phase 3: Post-PR #35 Runner Wrapper

#### Task 4: Wrap existing phase behavior as Step descriptors without listr2

**Files**
- Modify: `packages/core/src/workflow/direct-release-workflow.ts`
- Test: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`

- [ ] Step 1: Add a local helper in `direct-release-workflow.ts` that builds a domain Step descriptor around existing phase behavior without introducing `ListrTask`, `tasks(ctx)`, or a listr2 adapter.

```ts
interface LegacyRunnerStepDefinition<I = unknown, O = unknown> {
  id: string;
  input: I;
  output?: O;
  emittedFacts?: readonly WorkflowFactDescriptor[];
  compensation?: readonly WorkflowCompensationExpectation[];
  run(input: I, context: WorkflowStepContext): Promise<WorkflowStepResult<O>>;
}

function createLegacyRunnerStep<I, O>(
  definition: LegacyRunnerStepDefinition<I, O>,
): WorkflowStep<I, O> {
  return {
    id: definition.id,
    input: definition.input,
    output: definition.output,
    emittedFacts: definition.emittedFacts,
    compensation: definition.compensation,
    run: definition.run,
  };
}
```

- [ ] Step 2: Wire the Step list into the post-PR #35 runner boundary in the same grouping/order the changed runner expects.
  - Data flow: `createPipelineSteps(...) -> WorkflowStep[] -> post-PR #35 runner/executor boundary`.
  - Reason: the wrapper slice should preserve scheduling, prompt, and signal behavior while removing the listr2 adapter assumption.

- [ ] Step 3: Ensure `describe(ctx)` returns the domain Step list.
  - Expected: callers can inspect step ids and metadata without seeing runner task internals.

- [ ] Step 4: Unit test that `describe(ctx)` returns the expected direct release step ids in order:
  - `test`
  - `build`
  - `version`
  - `publish`
  - `dry-run`
  - `push`
  - `release`

- [ ] Step 5: Unit test that `DirectReleaseWorkflow.run` passes Step execution through the post-PR #35 runner boundary in the same order as `describe(ctx)`.

### Phase 4: Version Step Metadata

#### Task 5: Add first version Step input/output/fact descriptors

**Files**
- Modify: `packages/core/src/workflow/direct-release-workflow.ts`
- Test: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`

- [ ] Step 1: Add metadata only to the `version` wrapper step.
  - Input fields:
    - `hasPrepare`
    - `dryRun`
    - `versionPlanMode`
  - Output fields:
    - `summary`
  - Emitted fact descriptors:
    - `VersionDecisionObserved`
    - `ReleaseFilesMaterialized`
    - `ReleaseReferenceLocalTagCreated`
  - Compensation expectations:
    - `RestoreManifest` before manifest write
    - `RestoreChangesetFiles` before changeset deletion
    - `RestoreChangelog` before changelog write
    - `ResetGitCommit` after commit creation
    - `DeleteLocalTag` after local tag creation

- [ ] Step 2: Represent skipped facts through metadata instead of emitting runtime events for this wrapper slice.
  - `dryRun: true` means `ReleaseFilesMaterialized`, `ResetGitCommit`, and `DeleteLocalTag` remain descriptors but no production fact event is emitted.

- [ ] Step 3: Unit test `version` metadata for single/fixed/independent plans using minimal mock contexts.
  - Expected: `versionPlanMode` matches `ctx.runtime.versionPlan.mode`.
  - Expected: output summary matches the same helper summary used by success output.

#### Task 6: Keep semantic parity records stable

**Files**
- Modify: `packages/core/tests/contracts/release/current-runner-contract.test.ts`
- Test: `packages/core/tests/contracts/release/current-runner-contract.test.ts`

- [ ] Step 1: Do not include workflow metadata-only descriptors in `ReleaseBehaviorRecord`.
  - Reason: the current runner cannot emit the new metadata, so parity comparison should stay behavior-focused until both adapters report the same fact stream.

- [ ] Step 2: If runtime `WorkflowEventSink` emission is introduced in this slice, filter new metadata-only events out of parity records with a narrow prefix such as `workflowStep.described`.
  - Expected: side effects, compensations, prompts, release requests, changeset state, and final state remain the comparison source of truth.

### Phase 5: Failure Injection Proof

#### Task 7: Prove the guard catches a version-side regression

**Files**
- Temporary local modification only during verification:
  - `packages/core/src/tasks/phases/version.ts` or `packages/core/src/tasks/runner-utils/rollback-handlers.ts`
- Test: `packages/core/tests/contracts/release/current-runner-contract.test.ts`

- [ ] Step 1: After the wrapper migration passes, temporarily remove a version rollback registration in a local patch, such as `registerTagRollback(ctx, tagName)` after tag creation.

- [ ] Step 2: Run the focused contract scenario.
  - Command from `packages/core`: `bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/contracts/release/current-runner-contract.test.ts -t "tag-overwrite-prompt-cancel-rolls-back|github-release-create-fails-after-push|partial-publish-failure-rollback"`
  - Expected: at least one scenario fails because compensation labels or final state differ.

- [ ] Step 3: Revert only the temporary intentional fault.
  - Command: inspect with `git diff`; restore the temporary hunk manually with `apply_patch`.
  - Expected: no temporary regression remains.

- [ ] Step 4: Re-run the full contract file.
  - Command from `packages/core`: `bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/contracts/release/current-runner-contract.test.ts`
  - Expected: all tests pass.

### Phase 6: Review And Full Verification

#### Task 8: Run focused and repo-level checks

**Files**
- Modify: none
- Test:
  - `packages/core/tests/unit/workflow/step-contract.test.ts`
  - `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`
  - `packages/core/tests/contracts/release/current-runner-contract.test.ts`

- [ ] Step 1: Run focused workflow unit tests.
  - Command from `packages/core`: `bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/unit/workflow/step-contract.test.ts tests/unit/workflow/direct-release-workflow.test.ts`
  - Expected: all focused workflow tests pass.

- [ ] Step 2: Run the release contract suite.
  - Command from `packages/core`: `bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/contracts/release/current-runner-contract.test.ts`
  - Expected: all 25 current tests pass, plus any added migrated parity coverage.

- [ ] Step 3: Run typecheck.
  - Command from repo root: `bun run typecheck`
  - Expected: all Turbo typecheck/build tasks pass.

- [ ] Step 4: Run formatting/lint check.
  - Command from repo root: `bun run check`
  - Expected: Biome/Turbo check tasks pass.

- [ ] Step 5: Run the full test suite with Node 24 available.
  - Command from repo root with a Node 24 environment: `bun run test`
  - Expected: all package test tasks pass.

- [ ] Step 6: Run coverage with Node 24 available.
  - Command from repo root with a Node 24 environment: `bun run coverage`
  - Expected: coverage thresholds remain at or above the existing package thresholds.

## Interfaces, Data Flow, And State

- `runner-entry.ts` remains the external vNext entry and wires `DirectReleaseWorkflow` to the post-PR #35 runner boundary and signal handling.
- `DirectReleaseWorkflow.describe(ctx)` becomes the internal domain graph surface.
- `DirectReleaseWorkflow.run(ctx, services)` still performs preflight, cleanup, SIGINT, plugin hooks, success/error handling, and runner-bound Step execution.
- Runner scheduling receives domain `WorkflowStep[]` or a direct projection from it, not listr2 tasks.
- The version Step metadata reads from `ctx.runtime.versionPlan` but does not make `ReleaseRecord` the runtime source of truth in this slice.
- The release contract suite remains the behavior oracle until `ReleaseRecord` fact storage exists.

## Edge Cases And Failure Modes

- `dryRun` must not execute real manifest/tag/publish/release side effects.
- `ci publish` must keep using manifest-pinned versions and must not rewrite versions.
- Existing prompt cancellation in tag overwrite must still roll back the same compensation stack.
- SIGINT after publish must execute non-confirm rollback work and exit through code 130.
- A failed GitHub release after push must preserve remote tag rollback and force revert behavior.
- Partial publish failure must unpublish/yank successful registry publishes according to existing rollback policy.
- New metadata events must not make migrated parity fail unless they represent real semantic differences that the current runner can also record.

## Test And Verification Matrix

- Requirement: vNext entry remains default migrated target.
  - Test or command: `bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/contracts/release/current-runner-contract.test.ts -t "migrated runner"`
  - Expected result: migrated runner scenarios compare equal to current runner.

- Requirement: internal Step contract is not public API.
  - Test or command: `rg -n "WorkflowStep|WorkflowFactDescriptor|WorkflowCompensationExpectation" packages/core/src/index.ts`
  - Expected result: no matches.

- Requirement: version wrapper preserves behavior.
  - Test or command: full release contract suite from `packages/core`.
  - Expected result: all contract tests pass with unchanged side effects, compensations, prompts, release requests, changeset state, and final state.

- Requirement: listr2 is not part of the post-PR #35 migration path.
  - Test or command: `rg -n "from \"listr2\"|from 'listr2'|ListrTask" packages/core/src/workflow`
  - Expected result: no matches in new workflow or Step code after rebasing on PR #35.

- Requirement: intentional rollback bug is caught.
  - Test or command: temporary fault injection plus focused contract run from Phase 5.
  - Expected result: contract failure before the temporary fault is reverted, then pass after revert.

## Rollout And Review

- Keep the migration behind existing `runner-entry.ts`; no CLI switch or user-facing mode change is needed.
- Review focus:
  - No public exports added.
  - No import from `tasks/runner.ts` in `packages/core/src/workflow/*`.
  - No behavior drift in release contract records.
  - No Listr type dependency or listr2 adapter introduced in new domain Step types or workflow code after PR #35.
  - No weakened rollback registration order around version writes, commit/tag creation, registry publish, push, or GitHub release creation.
- Changeset decision:
  - No changeset is needed for a pure internal wrapper with no user-facing behavior change.
  - Add a patch changeset if any observable CLI output, release behavior, plugin hook timing, rollback behavior, or config behavior changes.

## Assumptions

- Node 24 is the correct verification runtime for Vitest 4 in this repository.
- The first implementation slice should prioritize `version` metadata, while `push/release` remains the next side-effect boundary after the Step contract is stable.
- `ReleaseRecordStore` should not be introduced until the Step wrapper and semantic contract comparison are stable.
- PR #35 will change the runner baseline before architecture migration proceeds; the implementation should inspect that merged runner and avoid listr2 adapter work.
