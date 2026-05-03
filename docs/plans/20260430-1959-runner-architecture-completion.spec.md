---
title: "Runner Architecture Completion"
status: "completed"
created: "2026-04-30 19:59 KST"
spec_id: "20260430-1959-runner-architecture-completion"
related_plan: "20260430-1959-runner-architecture-completion.plan.md"
---

# Spec: Runner Architecture Completion

## Summary

Complete the runner architecture migration by making the direct release workflow own release orchestration through internal workflow steps, services, and release records. The end state removes the legacy runner orchestration path and keeps behavior compatibility through semantic contracts, failure injection, and full repository verification.

This spec supersedes the first-slice scope in `20260428-0054-runner-step-migration.*`, which explicitly kept `tasks/runner.ts` and phase helpers as wrappers. The new target is final cleanup: legacy orchestration must either be deleted or reduced to non-orchestrating compatibility exports, and tests must move from task-shape assertions to behavior and workflow contracts.

## Goals

- Route release execution through `packages/core/src/workflow/runner-entry.ts` and `DirectReleaseWorkflow`.
- Remove legacy release orchestration ownership from `packages/core/src/tasks/runner.ts`, `tasks/release-phase-service.ts`, and `tasks/phases/*`.
- Keep release behavior stable for package selection, version decisions, filesystem writes, git refs, registry targets, GitHub releases, prompts, plugin hook order, rollback, SIGINT, and final state.
- Keep workflow step contracts internal and free of listr2 or runner rendering concepts.
- Move or replace tests that depend on legacy task factories with workflow/service/behavior tests.
- Preserve guardrails: public export checks, listr leakage checks, semantic contract parity, failure injection, typecheck, check, test, and coverage.

## Non-Goals

- Do not redesign CLI flags, config schema, registry semantics, plugin hook names, or user-facing output unless a test proves the old behavior was impossible to preserve.
- Do not introduce release-pr, persistent resume storage, or pubm-actions workflows in this completion pass.
- Do not lower coverage thresholds or delete behavioral tests to make the migration easier.
- Do not expose workflow step types from `@pubm/core`.

## Completion State

- `packages/core/src/tasks/runner.ts`, `tasks/release-phase-service.ts`, `tasks/phases/*`, and `tasks/runner-utils/*` are deleted.
- `DirectReleaseWorkflow` owns the release step list, workflow events, and release record integration. Release steps run through workflow-native `ReleaseOperation` implementations under `packages/core/src/workflow/release-phases/*`.
- Direct publish and dry-run no longer consume registry `taskFactory` wrappers. They use descriptor factories and workflow registry operations.
- Snapshot publishing is migrated off `createListr` and registry task factories. `runSnapshotPipeline` now uses workflow-native preflight operations, test/build operations, publish operations, and tag operations.
- Release contracts execute `workflow/runner-entry.ts` directly and use frozen semantic expectations instead of the deleted `legacy-runner-oracle.ts`.
- Task-shape runner tests were removed or rewritten as workflow/service/contract tests. Reusable non-orchestration task helper tests remain where those helpers still exist as compatibility or registry utilities.
- Workflow leakage and public export guards are automated in `packages/core/tests/unit/workflow/step-contract.test.ts`.

## Requirements

- The direct workflow must run without importing `tasks/runner.ts`, `tasks/release-phase-service.ts`, or `tasks/phases/*`.
- `packages/core/src/workflow/*` must not import listr2, Listr types, task runner types, or legacy task factories.
- The remaining `tasks/*` modules may continue to exist only when they are reusable non-orchestration helpers, registry task factories, or compatibility exports used outside direct release.
- Every side-effecting step must expose emitted facts and compensation expectations before the effect boundary is migrated.
- Release behavior contracts must remain semantic, not task-tree based.
- The legacy oracle must be replaced by frozen semantic expectations or a non-legacy workflow contract before deleting task phase orchestration.
- Deleting or reducing legacy tests must be paired with workflow/service tests that preserve the same behavior.

## Interfaces And Contracts

- Internal workflow interfaces: `Workflow`, `WorkflowStep`, `WorkflowServices`, `WorkflowReleaseRecord`, and workflow events.
- External behavior contracts: `packages/core/tests/contracts/release/current-runner-contract.test.ts` and scenario fixtures.
- Effect boundaries: git, registry, GitHub release, filesystem/changelog/changeset mutation, prompt, env, plugin hooks, signal, cleanup, and rollback compensation.
- Public exports: `packages/core/src/index.ts` must not expose internal workflow step contracts.

## Constraints

- Worktree currently contains the previous version-step migration slice and its tests.
- Node 24 is the supported local verification runtime for focused Vitest runs in this branch.
- Rollback behavior remains backed by `RollbackTracker` for this completion pass unless a fact-backed compensation replacement fully lands in the same patch; direct workflow must still record compensation expectations.
- Internal refactors must be small enough that a deliberate mutation in a migrated boundary causes a contract failure.

## Acceptance Criteria

- `packages/core/src/workflow/*` contains no imports from `tasks/runner.ts`, `tasks/release-phase-service.ts`, `tasks/phases/*`, listr2, or runner task types.
- `packages/core/src/tasks/runner.ts` is deleted or contains no release orchestration, signal handling, success/error handling, phase scheduling, or rollback execution ownership.
- Direct release executes through workflow steps and workflow-owned services.
- Release contract scenarios pass against frozen expectations or the workflow engine without using legacy task factories as an oracle.
- Task-shape tests that asserted legacy runner internals are removed or rewritten as workflow/service/behavior tests.
- Guard commands pass: public export `rg`, listr leakage `rg`, focused workflow/release contracts, `bun run typecheck`, `bun run check`, `bun run test`, and `bun run coverage`.
- At least one intentional fault injection for a migrated side-effect boundary fails before the fault is reverted and passes after revert.

## Risks

- Deleting phase task helpers too early can remove behavior that is still only tested through task unit tests.
- Sharing helper logic between frozen expectations and workflow implementation can weaken parity checks.
- A full ReleaseRecord store is outside this pass, so rollback truth may still partly live in `ctx.runtime.rollback`.
- Registry task factories are still runner-shaped because registry descriptors expose task factories; they must be separated from direct release orchestration carefully.

## Assumptions

- Internal behavior-preserving refactors do not need a changeset.
- The safest deletion order is oracle/test migration first, then service implementation, then task phase deletion.
- Existing registry/npm/jsr/crates task modules may remain if they are plugin/registry reusable factories, but direct release must no longer depend on phase orchestration helpers.

## Resolved Questions

- Registry descriptor `taskFactory` remains as a compatibility surface for registry/plugin task tests and non-direct-release callers. Direct release and snapshot publish paths no longer consume it.

## Verification Result

- Public export guard: no matches.
- Workflow and snapshot release-pipeline leakage guard: no matches for legacy runner, phase, runner-utils, listr, or runner task types.
- Focused contracts: release contract and snapshot contract passed.
- Fault injection: temporarily disabling npm rollback registration caused release contract failures; reverting the fault made the contract pass again.
- Full repository checks passed: `bun run format`, `bun run typecheck`, `bun run check`, `bun run test`, and `bun run coverage`.
