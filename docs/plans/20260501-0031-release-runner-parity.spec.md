---
title: "Release Runner Parity"
status: "draft"
created: "2026-05-01 00:31 local"
spec_id: "20260501-0031-release-runner-parity"
related_plan: "20260501-0031-release-runner-parity.plan.md"
---

# Spec: Release Runner Parity

## Summary
The runner/workflow migration must preserve the observable behavior of `main` while moving release orchestration into the workflow architecture. A regression was observed where the CLI appears to stop after `✔ Checking required information`; analysis shows the following workflow work still runs, but the workflow path no longer connects release operations to the `@pubm/runner` renderer, so progress and prompts after the version/tag information step are not visible in the same way as `main`.

This work defines the parity target against `main`: local and CI release execution should keep the same task sequencing, renderer/progress surface, prompts, skip/enabled behavior, side effects, error handling, rollback, signal handling, and final output, while retaining the workflow Step and ReleaseRecord architecture introduced on this branch.

## Goals
- Restore visible runner progress for all release phases after required information collection.
- Verify current workflow release behavior against `main` and close all material differences found in the release path.
- Preserve the workflow architecture direction: `DirectReleaseWorkflow` remains the release algorithm owner, and legacy task orchestration does not become the long-term source of truth again.
- Add regression coverage that would catch the observed “stuck at Checking required information” issue and other material parity drift.
- Produce fresh verification evidence through focused tests and the smallest meaningful broader checks.

## Non-Goals
- Reintroduce `tasks/runner.ts` as the primary release orchestrator.
- Redesign release UX, task labels, prompts, or phase ordering beyond matching `main`.
- Change package version selection semantics, registry APIs, changeset behavior, publish behavior, or rollback policy except where required for parity.
- Complete unrelated runner architecture goals such as persisted resume/recovery or external release records.
- Clean up unrelated dirty-worktree changes.

## Current State
- `main:packages/core/src/tasks/runner.ts` executes preflight helpers and then runs test, build, version, publish, dry-run, push, and release tasks through `createListr(...).run(ctx)`, with CI-specific runner options when `isCI` is true.
- Current [packages/core/src/workflow/runner-entry.ts](/Users/sung-yein/Workspace/pubm-runner-migration-guards/packages/core/src/workflow/runner-entry.ts) wires `DirectReleaseWorkflow` with `noopEvents`, `InMemoryReleaseRecord`, and `ProcessSignalController`.
- Current [packages/core/src/workflow/direct-release-workflow.ts](/Users/sung-yein/Workspace/pubm-runner-migration-guards/packages/core/src/workflow/direct-release-workflow.ts) emits workflow step events and records Step results, but step execution delegates to workflow-native `ReleaseOperation` functions that are not rendered by `@pubm/runner`.
- Current [packages/core/src/workflow/release-operation.ts](/Users/sung-yein/Workspace/pubm-runner-migration-guards/packages/core/src/workflow/release-operation.ts) executes operations sequentially or concurrently and exposes `title`, `output`, `prompt`, `runOperations`, and `skip` on an operation context, but those title/output changes are plain object mutations with no renderer event stream.
- Current [packages/pubm/src/cli.ts](/Users/sung-yein/Workspace/pubm-runner-migration-guards/packages/pubm/src/cli.ts) still runs `requiredMissingInformationTasks().run(ctx)` before `pubm(ctx)` for local interactive prepare paths, so the last visible runner frame can be `✔ Checking required information` while the workflow silently continues.
- Existing release contract tests cover semantic release side effects, and workflow unit tests cover Step metadata, but current coverage does not require workflow release operations to be connected to visible runner progress.
- The worktree contains pre-existing modified files across CLI, workflow, tests, plugin-brew, locales, and snapshot code. This work must preserve unrelated changes.

## Audience And Use Cases
- Maintainers running `pubm` locally need the same progress, prompts, and failure visibility as `main`.
- CI users need the same CI renderer output, phase behavior, and failure semantics as `main`.
- Future migration work needs tests that distinguish architecture changes from behavior drift.
- Plugin authors need hook and check behavior to remain compatible with `main`.

## Requirements
- Local interactive release must show runner-rendered progress for preflight and pipeline phases after required information collection.
- CI release must keep CI renderer behavior equivalent to `main`, including phase task logging and failure visibility.
- Prompts issued during preflight, version tag collision handling, version tag deletion, token collection, plugin credential collection, registry OTP or auth retry flows, push fallback, and release-related flows must remain reachable and visible.
- Skip, enabled, and concurrency behavior must match `main` for prerequisites, required conditions, test, build, version, publish, dry-run, push, release, plugin checks, and nested registry operations.
- Errors must surface with the same user-facing failure information and rollback behavior as `main`.
- SIGINT handling must remain equivalent to `main`: cleanup and non-interactive rollback run before process exit.
- The final success output for CI prepare, dry-run, and publish must match the branch’s current intended output while preserving main-compatible version summaries.
- Workflow events and ReleaseRecord metadata may continue to exist, but they must not replace user-visible runner progress.
- Tests must verify both semantic side effects and visible runner integration.

## Interfaces And Contracts
- CLI behavior: `pubm [version]`, `--mode`, `--phase`, `--dry-run`, `--no-tests`, `--no-build`, `--no-publish`, `--no-dry-run-validation`, `--skip-release`, `--create-pr`, and registry filtering must keep main-equivalent release execution behavior.
- Runner contract: release tasks after required information collection must be projected into `@pubm/runner` tasks with title/output/prompt/subtask updates visible to the selected renderer.
- Workflow contract: `DirectReleaseWorkflow.describe(ctx)` and Step result recording must remain internal workflow metadata and must not leak as public core exports.
- Release operation contract: workflow-native operations may remain the implementation unit only if their context updates are rendered and prompt behavior is preserved.
- Test contract: parity tests should compare behavior and observable progress, not exact private implementation shape except where a renderer bridge is the intended compatibility boundary.

## Constraints
- Do not revert user or previous-agent changes in the dirty worktree.
- Use existing repo patterns, `@pubm/runner`, and current workflow release phase modules where practical.
- Keep changes focused to release runner parity and tests.
- Preserve coverage thresholds; do not lower coverage.
- Avoid changing public APIs unless needed for internal testability and migration compatibility.
- No changeset is required unless the final code changes user-facing behavior relative to the current branch release candidate; if added, it must describe the restored user-facing release progress.

## Acceptance Criteria
- Running the local release path no longer leaves users with only `✔ Checking required information` while subsequent release work is executing silently.
- A focused test proves that after `requiredMissingInformationTasks` or equivalent setup, the release pipeline emits visible runner task lifecycle/progress for at least the first post-information phase and the full pipeline phase list.
- CI mode uses CI-compatible runner output for workflow release phases.
- Focused parity tests pass for operation sequencing, prompts, skips, errors, and rollback cases identified as divergent from `main`.
- Existing release contract tests continue to pass.
- Existing workflow Step and ReleaseRecord tests continue to pass.
- Typecheck passes for affected packages.
- Any unavoidable difference from `main` is explicitly documented with rationale and covered by tests.

## Risks
- Reconnecting renderer output could accidentally reintroduce legacy task orchestration ownership instead of a workflow-owned projection.
- Nested concurrent operations may render differently from `main` if operation nesting is flattened or if child operation updates are not mapped to runner subtasks.
- Prompt handling can deadlock or become visually hidden if workflow operation prompts bypass the root renderer prompt capture.
- Error and rollback handling can double-render or double-execute if runner task failures and workflow catch blocks both own failure semantics.
- CI output can become noisy or lose title-change logging if runner options differ from `main`.
- Existing dirty-worktree changes may already encode intended behavior unrelated to this parity fix.

## Assumptions
- `main` is available locally and is the behavior oracle for release execution.
- The observed stuck output is a renderer/progress parity regression, not a completed-process hang in `requiredMissingInformationTasks`.
- The preferred fix is to project workflow steps and release operations through `@pubm/runner`, not to abandon the workflow architecture.
- Contract tests can use mocks and event sinks to prove runner integration without performing real package publishing.

## Open Questions
- No product-scope questions remain after the user clarified that exact `main` behavior is the target. Implementation should preserve the legacy nested runner task shape wherever practical and must explicitly justify any unavoidable difference with a parity test.
- Preflight and pipeline phases are both in scope because `main` rendered both through `@pubm/runner` boundaries.
