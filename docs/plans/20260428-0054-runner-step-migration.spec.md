---
title: "Runner Step Migration"
status: "draft"
created: "2026-04-28 00:54 KST"
spec_id: "20260428-0054-runner-step-migration"
related_plan: "20260428-0054-runner-step-migration.plan.md"
---

# Spec: Runner Step Migration

## Summary

Move the vNext direct release shell from the current runner boundary toward the workflow-first architecture described in the architecture notes. The first migration slice should keep existing release behavior intact while introducing an internal Step contract that can carry typed input/output intent, emitted facts, and compensation boundaries without exporting a new public API.

This work exists because the current `DirectReleaseWorkflow` already provides a migration entrypoint, but most release semantics still live in `tasks/phases/*` helpers and `PubmContext.runtime`. The safe path is to wrap existing behavior first, prove parity through the release behavior contract suite, then replace helper internals with service/provider implementations in small increments.

## Goals

- Keep `packages/core/src/workflow/runner-entry.ts` as the default vNext contract target.
- Introduce an internal workflow Step shape that can represent `id`, input/output metadata, `run`, emitted facts, and compensation expectations.
- Preserve existing behavior for direct release scenarios while changing only the internal orchestration boundary.
- Make the next migration slice testable through runner-neutral semantic records rather than Listr task shape.
- Establish a clear path from current phase helpers to `ReleaseRecord`, service/provider boundaries, and recovery semantics.
- Record the final logical and physical completion criteria for the full runner architecture migration.

## Non-Goals

- Do not remove `packages/core/src/tasks/runner.ts`.
- Do not build or preserve a listr2 adapter as part of the post-PR #35 migration path.
- Do not export the new Step contract from `@pubm/core`.
- Do not introduce release-pr, resume publish, or persistent recovery workflows in this first slice.
- Do not change CLI flags, SDK exports, plugin APIs, registry behavior, tag naming, rollback behavior, or user-facing release output.

## Current State

- Branch `feat/runner-migration-guards` has a vNext entry at `packages/core/src/workflow/runner-entry.ts` that instantiates `DirectReleaseWorkflow`, `ListrViewAdapter`, and `ProcessSignalController`.
- `DirectReleaseWorkflow` in `packages/core/src/workflow/direct-release-workflow.ts` mirrors `packages/core/src/tasks/runner.ts`: it resolves phases, runs preflight helpers, builds test/build/version/publish/dry-run/push/release task groups, delegates them to `services.view.run`, handles SIGINT, runs success/error hooks, and executes rollback.
- `packages/core/src/workflow/types.ts` currently defines `WorkflowStep` as `{ id, tasks(ctx) }`, which is renderable-task oriented rather than domain-step oriented.
- `ListrViewAdapter` is the only current workflow adapter and converts `WorkflowStep.tasks()` output into Listr tasks.
- Planning update from 2026-04-28: once PR #35 is merged, the migration should continue from the changed runner baseline. In that baseline, a listr2 adapter is no longer needed and should not be introduced as migration scaffolding.
- The release contract suite compares the current runner and migrated runner through semantic records. It filters out raw `step.*`, `compatibilityShim.*`, and `migratedRunner.*` events, then compares side effects, compensations, prompts, release requests, changeset state, and final state.
- The contract suite currently has 17 release behavior scenarios and 25 tests, including local direct release, dry-run isolation, CI publish, partial publish rollback, monorepo fixed/independent, crates order/yank, private registry, PR push fallback, GitHub release assets, release failure, prompt cancel, SIGINT rollback, snapshot restore, compatibility shim parity, and migrated runner parity.
- Architecture notes define Workflow as a Step composition algorithm, Step as a concrete input/output and emitted-fact contract, Service as the owner of external effects, and ReleaseRecord as the persisted release fact log.
- The migration map classifies current behavior as `KEEP` for release decisions and registry/versioning semantics, `WRAP` for `PubmContext.runtime`, auth, git, ecosystem, registry, rollback, release assets, listr2, prompt, and signal boundaries, and `NEW` for event streams, ReleaseRecord, Step contracts, Direct Release Workflow, Resume/Recovery, release-pr, pubm-actions, and behavior contracts.
- Baseline evidence on 2026-04-28: `bun run typecheck` passed after installing dependencies. `bun vitest --run tests/contracts/release/current-runner-contract.test.ts` fails under local Node v18 because `node:util.styleText` is unavailable, but the same contract file passes with `bunx node@24 ../../node_modules/vitest/vitest.mjs --run tests/contracts/release/current-runner-contract.test.ts`.

## Audience And Use Cases

- Maintainers migrating release execution internals without losing behavior.
- Future agents or contributors who need to implement one migration slice without rediscovering architecture intent.
- Contract tests that must verify current runner and vNext workflow equivalence.
- Future workflow runtimes that need event/fact streams independent of listr2.

## Requirements

- The vNext direct release entry must continue to execute through `packages/core/src/workflow/runner-entry.ts`.
- The new Step contract must remain under `packages/core/src/workflow/` or another non-exported internal module.
- Existing phase helpers may be wrapped at first; behavior must not change during the wrapper step.
- `WorkflowStep` or its replacement must distinguish domain execution metadata from runner/rendering mechanics. After PR #35, do not add a listr2 adapter boundary; integrate with the new runner boundary from that PR.
- Every side-effecting migrated step must have an explicit compensation expectation before the side effect boundary is moved.
- Runner parity must be measured by semantic behavior records, not by Listr task titles, nesting, indexes, or renderer output.
- Failure and interruption scenarios must remain first-class verification targets, especially rollback LIFO behavior, prompt cancellation, SIGINT rollback, and post-publish failure recovery.
- Any changes that affect user-visible release behavior must add a changeset; internal planning and pure internal wrappers do not require one unless they alter observable behavior.

## Interfaces And Contracts

- Internal workflow contract: `Workflow`, `WorkflowStep`, `WorkflowRunResult`, `WorkflowServices`, `WorkflowEventSink`, `SignalController`, and the post-PR #35 runner boundary. `TaskViewAdapter` is pre-PR #35 context only.
- Current compatibility contract: `ReleaseBehaviorScenario`, `ReleaseBehaviorRecord`, and `SemanticLedger` in `packages/core/tests/contracts/release/*`.
- External effect boundaries to preserve: filesystem writes, changelog writes, changeset deletion, git reset/stage/commit/tag/push, PR fallback, registry publish/unpublish/yank, GitHub release create/delete, release asset upload, plugin hooks, prompts, env injection, cleanup, and rollback.
- Architecture target contracts: Step input/output metadata, emitted facts, compensation descriptors, ReleaseRecord facts, service/provider calls, and workflow event stream.

## Constraints

- `tasks/runner.ts` remains as the legacy runner and current behavior oracle.
- Listr task factories can remain only as pre-PR #35 historical context. The post-PR #35 migration must not depend on `ListrTask` or a new listr2 adapter.
- `ReleaseRecord` must be treated as a persisted fact log, not a future work plan.
- Version truth must not be recomputed after a version decision is recorded.
- Direct release must not silently fall back into release-pr mode; PR behavior is a separate workflow strategy.
- Snapshot is a release channel/profile policy, not a separate top-level architecture pattern for this direct-release slice.
- The local verification environment needs Node 24 for Vitest 4 compatibility; local Node v18 is insufficient for the contract suite.

## Acceptance Criteria

- A first implementation slice can be completed without changing the public CLI/API surface.
- `runner-entry.ts` remains the migrated runner entry used by the release contract suite.
- `DirectReleaseWorkflow` can describe or execute internal Step metadata without importing `tasks/runner.ts`.
- Post-PR #35 workflow and Step code do not introduce listr2-specific types or adapter scaffolding.
- The migrated runner parity tests continue to pass for the currently selected scenarios.
- The external boundary scenarios continue to pass: crates order/yank, private registry, push fallback, GitHub release creation failure.
- A deliberate small behavior bug in a migrated side-effect boundary, such as a missing release cleanup, wrong tag, or missing rollback registration, causes the contract suite to fail before the bug is reverted.
- The plan for the first slice identifies exact files, tests, and verification commands.

## Risks

- Adding Step abstractions without moving ownership can increase complexity while preserving the old coupling.
- Renaming the existing `WorkflowStep` too broadly can create churn in the adapter and obscure the intended migration.
- Moving version/push/release behavior before compensation semantics are fixed can weaken rollback guarantees.
- Contract tests can give false confidence if new facts/events are not included in semantic comparison or if they are filtered away.
- Local Node v18 can produce misleading test failures unrelated to release behavior.
- Keeping pre-PR #35 listr2 adapter assumptions in the plan can send implementation toward obsolete scaffolding after the runner changes.

## Final Completion Criteria

The full migration is complete when release execution semantics are owned by `Workflow`, `Step`, `Service`, and `ReleaseRecord`, and the legacy runner can be removed without changing current release behavior or failure/recovery behavior.

### Logical Criteria

- Workflow owns the release algorithm. Direct release is expressed as concrete Step composition such as resolve packages, decide versions, validate, materialize, create reference, publish, announce, and complete.
- Step owns a concrete contract. Each side-effecting Step exposes `id`, input, output, emitted facts, and compensation expectations instead of being a renamed task helper.
- ReleaseRecord is the release truth. Selected packages, decided versions, materialized files, created references, publish attempts, announcements, and recovery markers are persisted as facts instead of living only in `PubmContext.runtime`.
- Version truth is pinned. After version decision is recorded, publish, resume, finalize, and recovery paths do not recompute versions from manifests, CLI input, changesets, or commits.
- Service/provider boundaries own external effects. Git, registry, GitHub release, filesystem mutation, auth, prompt, process env, and signal behavior are fakeable through service/provider contracts.
- Compensation-before-mutation is enforced. A side-effecting operation cannot run unless its compensation descriptor or non-compensable/manual-recovery fact is recorded first.
- Renderer and runner mechanics do not own release meaning. Output rendering, prompt display, task scheduling, and signal plumbing consume workflow events but do not decide version, publish, release, or rollback semantics.
- Resume and recovery can run from persisted facts. They use ReleaseRecord facts and compensation descriptors, not process memory from the original run.
- Behavior compatibility is proven by semantic contracts. The preserved surface is package selection, versioning, file changes, registry targets, git references, release artifacts, plugin ordering, prompts, rollback, recovery, and final state, not legacy task tree shape.

### Physical Criteria

- `packages/core/src/index.ts` routes release execution through the workflow entry, not through `packages/core/src/tasks/runner.ts`.
- `packages/core/src/tasks/runner.ts` is deleted or reduced to a compatibility shim with no phase orchestration, signal handling, success/error handling, or rollback execution ownership.
- `packages/core/src/workflow/*` and future Step modules do not import listr2 or `ListrTask`. After PR #35, there is no listr2 adapter migration target.
- Legacy phase files such as `tasks/phases/version.ts`, `tasks/phases/publish.ts`, `tasks/phases/push-release.ts`, and `tasks/phases/dry-run.ts` no longer own release semantics.
- `ctx.runtime.versionPlan` can exist only as compatibility input or temporary execution state; it is not the source of truth for publish, release, resume, or recovery.
- Rollback is fact/descriptor based. `RollbackTracker` is removed from the semantic core or remains only as a compatibility facade over compensation facts.
- Direct calls to Git, registry APIs, GitHub release APIs, filesystem mutation, process env, process exit, and prompts are outside workflow/Step domain logic and sit behind services/providers.
- The engine contract suite no longer requires the legacy runner as an oracle. It can run against frozen semantic expectations and the new workflow engine.
- Failure injection coverage exists for version-write failure, changelog/changeset mutation failure, tag-after-commit failure, partial publish failure, GitHub release or asset failure, rollback-handler failure, SIGINT during publish, and SIGINT during recovery.
- `bun run typecheck`, `bun run check`, `bun run test`, `bun run coverage`, and focused workflow contract suites pass under the repository-supported Node runtime.

## Assumptions

- The first practical slice should start with the direct release workflow, not release-pr or recovery.
- The safest first target is a wrapper-level Step contract around version or push/release, with no behavior change.
- `version` is the best starting point when the goal is to pin version truth and materialization facts; `push/release` is the best starting point when the goal is external side-effect and rollback boundary coverage.
- For the immediate next slice, prioritize `version` because it is the earliest domain boundary where ReleaseRecord version truth, file mutation, changelog changes, git tag creation, and rollback descriptors meet.

## Open Questions

- Should the first implementation slice migrate only `version`, or should it include `push/release` in the same branch once the Step contract exists?
- Should semantic fact emission be added to the production workflow event stream first, or should it be introduced first inside the contract harness as a comparison-only adapter?
- What persistent ReleaseRecord storage format should be used when the fact log moves from test ledger into runtime behavior?
