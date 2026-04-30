---
title: "Workflow Preflight Check Operations"
status: "completed"
created: "2026-04-30 20:25 KST"
spec_id: "20260430-2025-workflow-preflight-check-operations"
related_plan: "20260430-2025-workflow-preflight-check-operations.plan.md"
---

# Spec: Workflow Preflight Check Operations

## Summary
The release workflow preflight phase currently calls the legacy runner task factories `prerequisitesCheckTask` and `requiredConditionsCheckTask` from `packages/core/src/tasks/`. The target outcome is to move the workflow preflight checks onto workflow-owned `ReleaseOperation` definitions so the direct release workflow no longer depends on those two task modules.

The migration must be behavior-preserving for release preflight: prerequisites still run before local token collection and before required conditions, CI prepare still collects and injects tokens before non-interactive checks, plugin prerequisite and condition checks still run through the plugin task-context wrapper, and existing skip flags still suppress the matching check group.

## Goals
- Create workflow-owned, runner-neutral preflight check operations for prerequisite checks and required-condition checks.
- Update `packages/core/src/workflow/release-phases/preflight.ts` to use those operations through `runReleaseOperations`.
- Remove direct imports of `packages/core/src/tasks/prerequisites-check.ts` and `packages/core/src/tasks/required-conditions-check.ts` from workflow preflight code.
- Preserve check ordering, nested concurrency where required conditions previously used concurrent subtasks, prompt behavior, skip behavior, plugin check wrapping, and CI/local preflight branching.
- Verify with focused core tests and/or typechecking where feasible.

## Non-Goals
- Do not edit publish or dry-run workflow files.
- Do not remove or rewrite the legacy task modules; other runner paths still reference them.
- Do not change CLI options, public configuration, registry behavior, plugin APIs, or translations.
- Do not alter unrelated runner migration files already present in the dirty worktree.

## Current State
- `packages/core/src/workflow/release-phases/preflight.ts` imports and runs `prerequisitesCheckTask` and `requiredConditionsCheckTask` directly.
- `packages/core/src/workflow/release-operation.ts` defines `ReleaseOperation`, `ReleaseOperationContext`, and `runReleaseOperations`, including sequential and concurrent operation execution.
- Legacy prerequisite checks include branch verification, remote fetch/pull checks, working tree status, commit checks, and plugin prerequisite checks wrapped by `wrapTaskContext`.
- Legacy required-condition checks include registry pings, script validation, git version validation, registry availability checks, plugin condition checks wrapped by `wrapTaskContext`, and independent-mode tag collision checks.
- The worktree already has many unrelated runner migration changes, including untracked workflow release phase files. Those changes must be preserved.

## Audience And Use Cases
- Maintainers completing the release workflow migration away from legacy runner tasks.
- Plugin authors relying on prerequisite and condition plugin checks receiving the same plugin-facing task context.
- CLI users running local prepare, CI prepare, and CI publish flows with the existing skip and prompt semantics.

## Requirements
- The workflow preflight check operations must be defined under the workflow area, preferably `packages/core/src/workflow/release-phases/preflight-checks.ts`.
- The operations must use `ReleaseOperation` and nested `runOperations` rather than `@pubm/runner` task objects or Listr task factories.
- `runLocalPreflight` must run prerequisites first, then early auth token collection, then plugin credential collection, then required conditions.
- `runCiPreparePreflight` must keep token collection, GitHub secret sync, env injection, and prompt disabling before prerequisites and required conditions.
- `runCiPublishPluginCreds` behavior must remain unchanged except for import cleanup if needed.
- Skip options `skipPrerequisitesCheck` and `skipConditionsCheck` must suppress the corresponding top-level check group.
- Plugin checks must call `ctx.runtime.pluginRunner.collectChecks(ctx, "prerequisites" | "conditions")` and execute each check with `wrapTaskContext`.
- Tag collision detection must remain active only for independent versioning without registry-qualified tags, prompt when runtime prompting is enabled, and otherwise throw.

## Interfaces And Contracts
- No public API or CLI contract changes are intended.
- New internal exports may expose factory functions such as `createPrerequisitesCheckOperation` and `createRequiredConditionsCheckOperation` for workflow use and focused tests.
- Existing task modules may remain exported for non-workflow callers and existing tests.
- Registry `checkAvailability` calls continue to receive a task-like context with `title`, `output`, and `prompt`.

## Constraints
- Do not touch publish or dry-run files.
- Do not revert, delete, or normalize unrelated dirty worktree changes.
- Keep implementation scoped to workflow preflight migration and focused tests.
- Use `node:path` for path handling and avoid hardcoded path separators.
- Preserve runner-neutral behavior in the new workflow operation file.

## Acceptance Criteria
- `packages/core/src/workflow/release-phases/preflight.ts` no longer imports `prerequisitesCheckTask` or `requiredConditionsCheckTask`.
- Workflow preflight calls `runReleaseOperations` with workflow-owned preflight check operations.
- The new preflight check operations preserve prerequisite and required-condition behavior from the legacy task factories.
- Plugin checks are wrapped with `wrapTaskContext` before plugin task execution.
- Focused tests or typecheck pass, or any verification blocker is documented with evidence.
- No publish or dry-run files are modified by this work.

## Risks
- Differences between Listr task execution and `ReleaseOperation` execution could change nested concurrency, skip display, or prompt context behavior.
- Registry availability implementations expect a runner-like task context; the operation context must remain compatible with the used methods.
- Existing tests are mostly focused on legacy task modules, so migration-specific coverage may need a new focused workflow test.
- The dirty worktree contains many unrelated changes, increasing the risk of accidental edits outside scope.

## Assumptions
- It is acceptable for the new workflow check operation file to duplicate small error wrapper classes and tag collision logic from legacy task modules to avoid direct workflow dependency on those modules.
- Pure grouping helpers under `packages/core/src/tasks/grouping.ts` may be reused if needed because they are not the legacy check task factories and do not depend on the runner.
- The operation context's `prompt().run`, `title`, and `output` fields are sufficient for existing plugin checks and registry availability checks.

## Open Questions
- None requiring user input before implementation.
