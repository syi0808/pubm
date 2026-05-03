---
title: "Workflow Native Publish Dry Run"
status: "completed"
created: "2026-04-30 20:25 KST"
spec_id: "20260430-2025-workflow-native-publish-dry-run"
related_plan: "20260430-2025-workflow-native-publish-dry-run.plan.md"
---

# Spec: Workflow Native Publish Dry Run

## Summary
The workflow release phases for publish and dry-run validation must stop delegating registry work through legacy runner task factories. Publish and dry-run should execute through workflow-native `ReleaseOperation` implementations that use `registryCatalog` descriptors and each descriptor's `factory` to construct the appropriate `PackageRegistry`.

This migration keeps user-facing release behavior unchanged while removing the workflow dependency on `releaseOperationFromLegacyTask`, `descriptor.taskFactory`, `createPublishTask`, and `createDryRunTask`.

## Goals
- Remove `packages/core/src/workflow` publish/dry-run usage of legacy task conversion and registry task factories.
- Publish packages through registry descriptor factories while preserving npm, JSR, crates.io, private npm-compatible, and generic registry behavior.
- Dry-run publish packages through registry descriptor factories while preserving token retry prompts and crates sibling dependency skip behavior.
- Preserve publish grouping by ecosystem, registry order, package order, and descriptor concurrency settings.
- Preserve workspace protocol restoration and plugin publish hooks already present in workflow phases.

## Non-Goals
- Do not edit preflight phase files.
- Do not remove legacy task factories from registry descriptors or plugin registration; other code and tests still use those contracts.
- Do not refactor unrelated runner, snapshot, migration, or preflight code.
- Do not change registry command implementations in `packages/core/src/registry`.

## Current State
- `packages/core/src/workflow/release-phases/publish.ts` imports `releaseOperationFromLegacyTask` and creates per-package operations from `descriptor.taskFactory.createPublishTask`.
- `packages/core/src/workflow/release-phases/dry-run.ts` imports `releaseOperationFromLegacyTask` and creates per-package operations from `descriptor.taskFactory.createDryRunTask`.
- `registryCatalog` descriptors already expose `factory(packagePath)` and registry metadata such as `label`, `concurrentPublish`, `orderPackages`, `tokenConfig`, and `unpublishLabel`.
- Existing task modules implement important behavior: npm OTP/provenance publish and rollback, JSR publish token/package-creation handling, crates publish/yank rollback, dry-run token retry, and crates sibling dry-run skipping.
- The repository has uncommitted runner migration changes owned by other work. This scope is limited to workflow publish/dry-run migration files and any new workflow helper.

## Audience And Use Cases
- CLI users running local publish, CI publish, and dry-run validation should see the same registry behavior after the workflow migration.
- Maintainers need the workflow layer to stop depending on legacy runner task factories so the runner migration can complete safely.

## Requirements
- Workflow publish and dry-run phases must call `registryCatalog.get(registryKey)?.factory(pathFromKey(packageKey))` for per-package registry operations.
- Publish must skip already-published versions before publishing and must also treat registry "already published" publish errors as skips where existing tasks did so.
- npm publish must preserve prompt-mode OTP reuse/retry, CI `NODE_AUTH_TOKEN` requirement, `publishProvenance` behavior, dist-tag passing, and unpublish rollback registration.
- JSR publish must preserve CI `JSR_TOKEN` loading, publish retry after web package creation prompts, non-interactive package creation failure messaging, and already-published skips.
- crates publish must preserve dependency ordering through descriptor `orderPackages`, sequential execution through `concurrentPublish: false`, already-published skips, already-uploaded fallback skips, and yank rollback registration.
- Dry-run must preserve token retry prompts for npm, JSR, crates, including shared retry promises and secure-store/env updates.
- crates dry-run must preserve proactive and reactive sibling dependency skips.
- Workspace protocol restore, dry-run version restore, and plugin hooks must remain in the existing phase flow.

## Interfaces And Contracts
- `createPublishTasks` and `createDryRunTasks` continue returning `ReleaseOperation[]` with the same enablement and phase-level restore behavior.
- `ReleaseOperationContext` remains the workflow context used for title, output, prompt, nested operation execution, and skip signaling.
- No public CLI options, config schema, registry classes, or plugin descriptor shape change.

## Constraints
- Do not edit preflight files or other workers' unrelated changes.
- Use existing registry classes and factory behavior rather than shelling out directly from the phase files.
- Keep private npm-compatible registries on the descriptor factory path.
- Keep changes localized under `packages/core/src/workflow/release-phases` and new workflow helper files unless focused tests require minor updates.

## Acceptance Criteria
- No file under `packages/core/src/workflow` uses `releaseOperationFromLegacyTask`, `descriptor.taskFactory`, `createPublishTask`, or `createDryRunTask` for publish/dry-run execution.
- Focused tests covering release contract, dry-run unit behavior, relevant registry publish behavior, or typecheck pass when feasible in the current dirty worktree.
- A source search confirms the removed workflow dependencies are absent from workflow publish/dry-run code.
- Changed files remain within the requested ownership scope except for required planning documents.

## Risks
- Reimplementing legacy task behavior can miss small title/output, prompt, rollback, or skip details.
- Tests may rely on mocked task factories and need to be adapted by their owning migration work; this implementation should prefer native descriptor factories.
- Concurrent npm OTP and dry-run token retry behavior can regress if shared runtime promises are not preserved.
- JSR token cache behavior can regress if retry only updates environment variables and not the client token.

## Assumptions
- `registryCatalog` descriptors used by workflow publish/dry-run always provide a `factory`, as required by `RegistryDescriptor`.
- Unknown plugin/private registries can use generic `PackageRegistry.publish`, `dryRunPublish`, `isVersionPublished`, and optional `unpublish` support unless they are npm-compatible private registries, which are handled by the descriptor factory returning npm behavior.
- Exact runner UI task semantics are less important than preserving registry side effects, skips, prompts, rollback actions, and phase ordering.

## Open Questions
- None. The user supplied the ownership boundary and target behavior.
