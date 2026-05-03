---
title: "Dry Run Prepare Lockfile Restore"
status: "completed"
created: "2026-05-01 15:39 KST"
spec_id: "20260501-1539-dryrun-prepare-lockfile-restore"
related_plan: "20260501-1539-dryrun-prepare-lockfile-restore.plan.md"
---

# Spec: Dry Run Prepare Lockfile Restore

## Summary
Running `pubm --dry-run --phase prepare` temporarily applies the planned package versions so publish dry-run validation can inspect the same manifests and lockfiles that a real prepare would use. Those temporary changes must be fully restored, including lockfiles, even when validation fails before the existing restore operations run.

## Goals
- Restore version bump changes from `--dry-run --phase prepare` on both success and failure paths.
- Include lockfile changes produced while applying temporary dry-run versions.
- Preserve real `--phase prepare` behavior, where version and lockfile changes are expected release artifacts.
- Add regression coverage for the failure path that currently bypasses the restore operations.

## Non-Goals
- Redesign release phase ordering or the public `--phase` interface.
- Change registry dry-run validation semantics.
- Change package manager lockfile sync commands.
- Add new package manager detection behavior beyond what current ecosystems use.

## Current State
- `DirectReleaseWorkflow` enables dry-run validation for explicit split prepare phases.
- `createDryRunOperations()` applies workspace protocol resolution and `applyVersionsForDryRun()` inside the first dry-run validation operation.
- Successful `--dry-run` runs a later restore operation that calls `writeVersions(ctx, backupVersions)`.
- If the first dry-run validation operation throws, later restore operations are skipped and workflow rollback only covers actions registered before the failure.
- `applyVersionsForDryRun()` records original versions in `ctx.runtime.dryRunVersionBackup` but does not register a rollback action for those temporary writes.
- `writeVersions()` syncs lockfiles as part of manifest version writes.

## Audience And Use Cases
- Maintainers validating split CI prepare locally with `pubm --dry-run --phase prepare`.
- CI or automation that expects dry-run commands to leave the working tree unchanged after failures.

## Requirements
- `applyVersionsForDryRun()` must register rollback before mutating manifests and lockfiles.
- The rollback must restore the versions captured from config and re-run the existing lockfile sync path through `writeVersions()`.
- Successful dry-run cleanup must keep using the existing restore operation and clear `ctx.runtime.dryRunVersionBackup`.
- Real non-dry-run prepare must continue to leave prepared version/lockfile changes in place.
- Tests must prove rollback registration occurs before dry-run version writes and that the rollback restores through `writeVersions()`.

## Interfaces And Contracts
- Public CLI behavior: `pubm --dry-run --phase prepare` should not leave version-bumped lockfiles behind.
- Internal runtime state: `ctx.runtime.dryRunVersionBackup` remains the source of original package versions for dry-run cleanup.
- Internal rollback contract: `ctx.runtime.rollback.add()` actions execute on workflow failure.

## Constraints
- Use existing ecosystem and package manager APIs; do not introduce lockfile-specific parsing.
- Preserve existing tests that assert version phase itself avoids writes in dry-run mode.
- Do not lower coverage thresholds or skip existing checks.

## Acceptance Criteria
- A failing dry-run prepare validation path has a rollback action that restores original versions and lockfiles through `writeVersions()`.
- The focused dry-run phase and manifest-handling unit tests pass.
- No behavior change is introduced for non-dry-run `--phase prepare`.

## Risks
- Registering rollback too late would still leave partial writes after a lockfile sync failure.
- Registering duplicate rollback actions could cause harmless but noisy duplicate restore work if not kept scoped.
- `writeVersions()` restore depends on package manager lockfile sync succeeding; if the package manager is unavailable and lockfile sync is required, rollback can still report a failure.

## Assumptions
- Re-running `writeVersions()` with the original version map is the repository's current intended way to restore lockfile state after dry-run version writes.
- The reported issue occurs when dry-run validation fails before the existing restore operations run.

## Open Questions
- No open product questions block this fix.
