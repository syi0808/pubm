---
title: "Release Runner Parity"
status: "draft"
created: "2026-05-01 00:31 local"
spec: "20260501-0031-release-runner-parity.spec.md"
plan_id: "20260501-0031-release-runner-parity"
---

# Plan: Release Runner Parity

## Source Spec
- Spec file: `docs/plans/20260501-0031-release-runner-parity.spec.md`
- Goals covered: restore runner-visible progress, compare and close material `main` behavior differences, preserve workflow ownership, add regression coverage, and verify with focused tests.
- Non-goals preserved: do not restore `tasks/runner.ts` as the release owner, do not redesign release UX, do not clean unrelated worktree changes.

## Implementation Strategy
Keep `DirectReleaseWorkflow` as the release algorithm owner, but execute release operations through `@pubm/runner` TaskContexts. The key implementation is a workflow-to-runner projection: each top-level workflow Step remains recorded as a workflow Step, while its release operation is run on a real runner task so `title`, `output`, `prompt`, nested `runOperations`, skip, failure, concurrency, and live command output behave like `main`.

Address parity in two passes:

1. Restore rendering and prompt plumbing for preflight and pipeline operations.
2. Reconcile material semantic drift discovered against `main`: mode-vs-phase preflight routing, release token prompting, concurrent failure behavior, and registry extension-point behavior. Differences that are already intentional fixes must be locked by tests and explicitly documented in test names.

## File And Module Map
- Create:
  - `packages/core/src/workflow/release-operation-task.ts`: adapter from `ReleaseOperation` to `@pubm/runner` tasks and runner-backed contexts.
  - `packages/core/tests/unit/workflow/release-operation-task.test.ts`: adapter unit tests for title/output/prompt/nested/concurrent/skip behavior.
  - `packages/core/tests/unit/tasks/required-missing-information-runner.test.ts`: real-runner integration for required information completion.
- Modify:
  - `packages/core/src/workflow/release-operation.ts`: keep direct executor or move shared helpers; expose direct execution only where tests need it.
  - `packages/core/src/workflow/direct-release-workflow.ts`: run preflight and pipeline phases through runner-backed workflow tasks while recording Step results.
  - `packages/core/src/workflow/release-phases/preflight.ts`: route preflight operation groups through the runner adapter.
  - `packages/core/src/workflow/release-phases/dry-run.ts`: restore `main` dry-run validation enablement semantics.
  - `packages/core/src/workflow/release-phases/push-release.ts`: restore `main` release-token prompt conditions unless a test-proven branch requirement says otherwise.
  - `packages/core/src/workflow/release-phases/publish.ts` and `packages/core/src/workflow/registry-operations.ts`: verify and correct registry operation behavior where main parity requires it.
  - `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`: assert workflow Steps still record in order while runner projection is used.
  - `packages/core/tests/unit/workflow/release-phases/*.test.ts`: add focused parity tests for phase routing and prompt behavior.
  - `packages/pubm/tests/contracts/cli/mode-option-contract.test.ts`: add local no-version handoff from required information to `pubm(ctx)`.
  - `packages/pubm/tests/contracts/cli/runner-wiring-smoke-contract.test.ts`: assert visible post-information runner output in a stable smoke path if the existing helper can do so without hanging.
- Delete:
  - None planned.
- Leave unchanged:
  - `tasks/runner.ts` remains deleted on this branch.
  - Existing semantic release contract scenarios stay behavior-focused.

## Task Breakdown

### Phase 1: Runner Projection

#### Task 1: Add release-operation to runner-task adapter
**Files**
- Create: `packages/core/src/workflow/release-operation-task.ts`
- Modify: `packages/core/src/workflow/release-operation.ts`
- Test: `packages/core/tests/unit/workflow/release-operation-task.test.ts`

- [ ] Step 1: Implement `createReleaseOperationTasks(operations)` and `runReleaseOperationsWithTask(ctx, operations, parentTask, options?)`.
  - Business logic: static/functional `enabled` and `skip` must map to runner `enabled` and `skip`.
  - Data flow: operation `title` and `output` setters must write to the provided `TaskContext`.
  - Prompt flow: `operation.prompt().run(options)` must call `task.prompt().run(options)`.
  - Nesting: `operation.runOperations(children, { concurrent })` must call `task.newListr(createReleaseOperationTasks(children), { concurrent }).run(ctx)`.
  - Skip: in-body `operation.skip(message)` must call `task.skip(message)` in runner-backed mode.

```ts
export function createReleaseOperationTasks(
  operations: ReleaseOperation | readonly ReleaseOperation[],
): Task<PubmContext>[] {
  return list.map((operation) => ({
    title: operation.title ?? "background task",
    enabled: operation.enabled,
    skip: operation.skip,
    task: async (ctx, task) => runReleaseOperationWithTask(ctx, operation, task),
  }));
}
```

- [ ] Step 2: Keep the direct `runReleaseOperations` path for workflow unit tests that intentionally do not render, or migrate those tests to the runner-backed adapter where parity requires rendering.
- [ ] Step 3: Unit-test adapter behavior.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/release-operation-task.test.ts`
  - Expected: task lifecycle events include parent/child completion, prompt events use runner prompt provider, and in-body skip marks the task skipped.

#### Task 2: Run workflow pipeline through one runner boundary
**Files**
- Modify: `packages/core/src/workflow/direct-release-workflow.ts`
- Test: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`

- [ ] Step 1: Extend workflow Step execution so each top-level Step can receive the current runner `TaskContext`.
  - Data flow: `runWorkflowStep(step, context, task)` records `stepStarted`, emits `workflow.step.started`, runs the operation on `task`, resolves output/facts, records completion, and emits `workflow.step.completed`.
  - Failure flow: failed runner task records `stepFailed`, emits `workflow.step.failed`, then rethrows so the runner and workflow catch path keep failure/rollback semantics.
- [ ] Step 2: Build one top-level `createListr` task list for the pipeline Steps in the legacy order.
  - Top-level labels must match the operation titles used by `main`: running tests, building project, bumping version, publishing, validating publish, pushing, release.
  - CI mode must use `createCiListrOptions<PubmContext>()`, matching `main`.
- [ ] Step 3: Preserve ReleaseRecord output.
  - The version Step must still use `readPinnedWorkflowVersionStepOutput(ctx) ?? createWorkflowVersionStepOutput(ctx)` after the operation runs.
- [ ] Step 4: Verify tests.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/direct-release-workflow.test.ts`
  - Expected: step order and Step metadata tests still pass, plus a new assertion proves `createListr` or a runner-backed task adapter executes the phase list.

#### Task 3: Route preflight operation groups through runner-backed tasks
**Files**
- Modify: `packages/core/src/workflow/release-phases/preflight.ts`
- Modify: `packages/core/src/workflow/direct-release-workflow.ts`
- Test: `packages/core/tests/unit/workflow/release-phases/preflight.test.ts`
- Test: `packages/core/tests/unit/workflow/release-phases/preflight-check-operations.test.ts`

- [ ] Step 1: Add optional runner-backed execution to `runCiPreparePreflight`, `runLocalPreflight`, and `runCiPublishPluginCreds`.
  - Local preflight should render prerequisites, early token collection, plugin credential collection, and required conditions as separate runner tasks, matching main’s rendered boundaries.
  - CI prepare should render token collection, prerequisites, and required conditions.
- [ ] Step 2: Keep cleanup injection and `ctx.runtime.promptEnabled = false` behavior exactly where main had it for CI prepare.
- [ ] Step 3: Verify preflight tests.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/release-phases/preflight.test.ts tests/unit/workflow/release-phases/preflight-check-operations.test.ts`
  - Expected: existing preflight behavior remains, and runner-backed mode emits task updates.

### Phase 2: Main Semantic Parity

#### Task 4: Restore mode-based CI/local routing semantics
**Files**
- Modify: `packages/core/src/workflow/direct-release-workflow.ts`
- Modify: `packages/core/src/workflow/release-phases/dry-run.ts`
- Test: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`
- Test: `packages/core/tests/unit/workflow/release-phases/dry-run.test.ts`

- [ ] Step 1: Ensure CI prepare/publish preflight routing is keyed by `mode === "ci"` and phase membership, matching `main`.
- [ ] Step 2: Ensure local `--phase prepare` does not run CI token/GitHub secret sync.
- [ ] Step 3: Restore dry-run validation enablement to `!skipDryRun && (dryRun || (mode === "ci" && hasPrepare))`.
- [ ] Step 4: Verify routing.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/direct-release-workflow.test.ts tests/unit/workflow/release-phases/dry-run.test.ts`
  - Expected: local phase-only paths route as local; CI phase paths route as CI.

#### Task 5: Restore release token prompt parity
**Files**
- Modify: `packages/core/src/workflow/release-phases/push-release.ts`
- Test: `packages/core/tests/unit/workflow/release-phases/push-release.test.ts`

- [ ] Step 1: Match main behavior: no GitHub token in non-CI release mode should offer the select prompt before browser fallback.
- [ ] Step 2: Keep prompt visibility tied to runner-backed `task.prompt().run`.
- [ ] Step 3: Verify prompt/fallback branches.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/release-phases/push-release.test.ts`
  - Expected: local mode prompts; CI mode does not; browser fallback remains available.

#### Task 6: Decide and lock down registry and concurrency drift
**Files**
- Modify: `packages/core/src/workflow/release-operation.ts`
- Modify: `packages/core/src/workflow/release-operation-task.ts`
- Modify: `packages/core/src/workflow/release-phases/publish.ts`
- Modify: `packages/core/src/workflow/registry-operations.ts`
- Test: `packages/core/tests/unit/workflow/release-operation-task.test.ts`
- Test: `packages/core/tests/unit/workflow/registry-operations.test.ts`
- Test: `packages/core/tests/contracts/release/current-runner-contract.test.ts`

- [ ] Step 1: Compare runner concurrent behavior by test: if `@pubm/runner` continues siblings and aggregates errors, keep current semantics; otherwise adjust direct concurrent executor to match runner-backed behavior.
- [ ] Step 2: Preserve main-compatible extension points for registry publishing.
  - If descriptors still expose `taskFactory`, workflow publish/dry-run must either call the same effective behavior or prove factory-based behavior is the new intended contract through tests.
  - Private registry dry-run/publish must use configured URL and token env behavior.
- [ ] Step 3: Avoid passing tags to built-in JSR/crates if tests show observable argument drift; keep tag propagation for npm/private registries where main passed tags.
- [ ] Step 4: Verify registry behavior.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/registry-operations.test.ts tests/contracts/release/current-runner-contract.test.ts`
  - Expected: registry command ledger remains main-compatible.

### Phase 3: Regression Coverage

#### Task 7: Add required-information real-runner regression
**Files**
- Create: `packages/core/tests/unit/tasks/required-missing-information-runner.test.ts`
- Optionally modify: `packages/runner/tests/unit/executor.test.ts`

- [ ] Step 1: Add a unit test that uses the real `@pubm/runner` with a queued prompt provider and event sink.
- [ ] Step 2: Assert `Checking required information` reaches `task.completed` and `task.closed` after a nested prompt.
- [ ] Step 3: Add a runner executor regression if the core test does not already cover nested prompt completion deeply enough.
- [ ] Step 4: Verify.
  - Command: `cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information-runner.test.ts`
  - Command: `cd packages/runner && bun vitest --run tests/unit/executor.test.ts`
  - Expected: required information completes and nested prompt lifecycle remains correct.

#### Task 8: Add CLI no-version handoff regression
**Files**
- Modify: `packages/pubm/tests/contracts/cli/mode-option-contract.test.ts`
- Optionally modify: `packages/pubm/tests/contracts/cli/runner-wiring-smoke-contract.test.ts`

- [ ] Step 1: Add a local no-explicit-version CLI contract where mocked `requiredMissingInformationTasks().run(ctx)` sets a version plan.
- [ ] Step 2: Assert `requiredMissingInformationTasks().run(ctx)` happens before `pubm(ctx)` and `pubm(ctx)` receives the populated plan.
- [ ] Step 3: If the smoke helper can safely time out, add a real CLI dry-run smoke that asserts output contains at least one post-information task title such as `Running tests`, `Building the project`, or `Bumping version`.
- [ ] Step 4: Verify.
  - Command: `cd packages/pubm && bun vitest --run tests/contracts/cli/mode-option-contract.test.ts tests/contracts/cli/runner-wiring-smoke-contract.test.ts`
  - Expected: CLI handoff and smoke tests pass.

### Phase 4: Full Verification And Review

#### Task 9: Run focused and package-level checks
**Files**
- No direct edits.

- [ ] Step 1: Run core focused suites.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow tests/unit/tasks/required-missing-information-runner.test.ts tests/contracts/release/current-runner-contract.test.ts`
  - Expected: all pass.
- [ ] Step 2: Run pubm CLI contract suites touched.
  - Command: `cd packages/pubm && bun vitest --run tests/contracts/cli/mode-option-contract.test.ts tests/contracts/cli/runner-wiring-smoke-contract.test.ts`
  - Expected: all pass.
- [ ] Step 3: Run typecheck.
  - Command: `bun run typecheck`
  - Expected: no type errors.
- [ ] Step 4: Run tests if time and runtime permit.
  - Command: `bun run test`
  - Expected: all tests pass.

## Interfaces, Data Flow, And State
- Workflow Step state remains in `WorkflowReleaseRecord`; rendering is an execution projection, not the domain source of truth.
- `ReleaseOperationContext` in runner-backed mode writes directly through `TaskContext`, so operation title/output updates emit runner events.
- Nested release operations become nested runner tasks through `TaskContext.newListr`.
- Direct `runReleaseOperations` remains available for tests and non-rendered service-style execution, but production release execution should use runner-backed mode.
- `ctx.runtime.promptEnabled`, cleanup functions, rollback registrations, token injection, version pins, and plugin hooks remain on `PubmContext`.

## Edge Cases And Failure Modes
- A prompt inside a nested operation must use the root renderer prompt capture and complete the child and parent tasks.
- An operation calling `skip()` after setting title/output must render as skipped, not success.
- Concurrent child operations must preserve runner-compatible scheduling and error reporting.
- Workflow failure must not run rollback twice. Runner failure should bubble to `DirectReleaseWorkflow.run`, which owns plugin error hooks, cleanup, rollback, and exit.
- SIGINT must remove listeners and execute non-interactive rollback once.
- CI runner output must not accidentally use the live TTY renderer.

## Test And Verification Matrix
- Requirement: visible release progress after required information.
  - Test or command: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts` with runner-backed phase events.
  - Expected result: post-information phase tasks emit runner lifecycle/output events.
- Requirement: nested prompt completion.
  - Test or command: `packages/core/tests/unit/tasks/required-missing-information-runner.test.ts`.
  - Expected result: parent and child required-info tasks complete and close.
- Requirement: local no-version handoff.
  - Test or command: `packages/pubm/tests/contracts/cli/mode-option-contract.test.ts`.
  - Expected result: required-info run precedes `pubm(ctx)` and versionPlan is passed.
- Requirement: main phase routing.
  - Test or command: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`.
  - Expected result: mode controls CI preflight behavior.
- Requirement: release token prompt parity.
  - Test or command: `packages/core/tests/unit/workflow/release-phases/push-release.test.ts`.
  - Expected result: local no-token release prompts before browser fallback.
- Requirement: release side-effect parity.
  - Test or command: `packages/core/tests/contracts/release/current-runner-contract.test.ts`.
  - Expected result: scenario ledger matches expected side effects.

## Rollout And Review
- Review focus: avoid reintroducing legacy release orchestration ownership; verify the new adapter is a projection layer over workflow Steps and ReleaseOperations.
- Review focus: check every `ReleaseOperationContext` title/output/prompt mutation now has a runner-backed execution path in production.
- Rollback note: if adapter complexity becomes risky, a temporary compatibility path can execute the old task phase factories, but only behind tests and only as a short-lived bridge because the Spec excludes making `tasks/runner.ts` the long-term owner.

## Assumptions
- `main` remains the local behavior oracle.
- Exact visible task labels should match existing i18n keys rather than hardcoded English where possible.
- User-facing renderer parity is higher priority than preserving current branch’s silent workflow execution.
