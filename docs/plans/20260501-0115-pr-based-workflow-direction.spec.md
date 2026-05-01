---
title: "PR-Based Workflow Direction"
status: "draft"
created: "2026-05-01 01:15 KST"
spec_id: "20260501-0115-pr-based-workflow-direction"
related_plan: "20260501-0115-pr-based-workflow-direction.plan.md"
---

# Spec: PR-Based Workflow Direction

## Summary

This document records the investigation and product/architecture direction for PR-based release workflows during the runner architecture migration.

The conclusion is that the current `createPr` CLI/config behavior should not remain part of the direct release workflow. It models PR usage as a push fallback inside the direct pipeline, while the intended PR-based workflow is a first-class approval gate owned by `pubm-actions` as the GitHub host/runtime and by pubm core as the release semantics owner.

## Goals

- Record the current mismatch between `createPr` and the intended release-pr architecture.
- Clarify that `createPr` is a legacy CLI/config surface to remove, not a workflow capability to preserve.
- Define the intended responsibility split between pubm core, pubm CLI, and `pubm-actions`.
- Preserve the design conclusion so subsequent implementation planning can remove the old behavior without re-litigating the direction.
- Align future docs around release-pr being an actions-hosted workflow, not a local CLI workflow.

## Non-Goals

- Implement `createPr` removal in this document.
- Design every detail of the future `pubm-actions` release-pr implementation.
- Introduce a new public CLI option for release-pr mode in the current migration pass.
- Replace the existing split CLI + CI workflow using `pubm --phase prepare` and `pubm --phase publish`.
- Change Homebrew plugin PR behavior, which is a plugin-specific post-release integration and not the core release-pr workflow.

## Current State

- The CLI exposes `--create-pr` in `packages/pubm/src/cli.ts`.
- Core config exposes `createPr?: boolean` in `packages/core/src/config/types.ts`.
- The push phase reads `ctx.options.createPr ?? ctx.config.createPr` in `packages/core/src/workflow/release-phases/push-release.ts`.
- When enabled, the current implementation runs the normal prepare path first, then switches the push step from direct base-branch push to `pushViaPr`.
- `pushViaPr` creates a `pubm/version-packages-*` branch, pushes it with `--follow-tags`, opens a GitHub PR, and switches back to the base branch.
- Direct push failure caused by branch protection currently falls back to PR creation.
- Website docs describe `createPr` as a way for the CLI to open a version bump PR.
- Contract tests still include direct-push-fallback-to-version-PR scenarios.
- Obsidian architecture notes describe release-pr as a first-class approval gate, not as a direct workflow push fallback.
- Obsidian migration guardrails state that a pull-request workflow must not create tags, publish packages, or create GitHub Releases before merge.
- Obsidian workflow notes assign GitHub event handling, PR create/update APIs, labels, comments, statuses, outputs, and artifacts to `pubm-actions`, while keeping package selection, version decisions, changelog semantics, ReleaseRecord schema, publication ordering, and rollback semantics in pubm core.

## Audience And Use Cases

- Maintainers planning the runner architecture migration need a clear decision about whether to preserve or remove `createPr`.
- Implementers removing legacy CLI/config surfaces need to know which behavior is intentionally deleted and which future behavior must be handled elsewhere.
- Documentation maintainers need to avoid describing a CLI-driven PR release flow as the recommended PR-based workflow.
- Future `pubm-actions` work needs a stable boundary for what the action owns and what pubm core owns.

## Requirements

- `createPr` must be treated as a legacy direct-workflow feature and removed from CLI, config, options, docs, and tests in a subsequent implementation pass.
- Direct workflow must not automatically convert a protected-branch push failure into a PR-based workflow. It should fail with a clear error or policy signal.
- PR-based release must be modeled as a distinct release strategy with an approval gate, not as a push transport option.
- PR-based release must not create release tags, publish packages, or create GitHub Releases before the release PR is merged.
- pubm core must remain the owner of release semantics, including version decisions, changelog/proposal semantics, ReleaseRecord schema, publish ordering, and rollback/recovery semantics.
- `pubm-actions` must act as the GitHub host/runtime: event payload reader, token provider, PR API executor, labels/comments/status manager, workflow output producer, and artifact/storage provider.
- The future product path should favor a workflow installer command, tentatively `pubm workflow install github`, rather than asking users to run PR-release commands manually.
- CLI usage for release-pr should remain limited to installation, preview, dry-run, or debug paths unless a future product decision explicitly changes that.

## Interfaces And Contracts

- CLI surface to remove:
  - `pubm --create-pr`
- Config surface to remove:
  - `createPr: true`
- Internal direct workflow behavior to remove:
  - direct push fallback to PR creation
  - direct workflow branching based on `createPr`
- Documentation to revise:
  - CLI reference entries for `--create-pr`
  - configuration reference entries for `createPr`
  - CI/CD guide sections that describe CLI-created version PRs as a supported workflow
  - generated or plugin skill documentation that recommends `createPr`
- Future release-pr interfaces to design separately:
  - `PullRequestProvider`
  - `ReleaseRecordStore`
  - proposal create/update step
  - finalize release step
  - publication continuation step
  - workflow installer command

## Constraints

- The current architecture migration should keep direct release and split CLI + CI behavior small and verifiable.
- Removing `createPr` is a breaking CLI/config change and needs a changeset when implemented.
- PR-based release must not be implemented by reusing direct workflow push semantics after tags already exist.
- ReleaseRecord must be the source of truth for release lineage; a GitHub PR is only the review/proposal surface.
- `pubm-actions` can be strongly coupled to pubm core, but it must not become the domain owner.
- The future design should avoid multiplying top-level workflows for every combination of direct, PR, snapshot, publish-only, and retry. Profiles and continuation/recovery paths should absorb combinations where appropriate.

## Acceptance Criteria

- A future implementation removes `createPr` from CLI help and config references.
- A future implementation removes `createPr` from the public Options/Config type surface.
- Direct release no longer opens a version PR, either by explicit option or by protected-branch fallback.
- Tests no longer assert that direct release falls back to PR creation.
- New or updated tests assert that direct release does not perform PR side effects.
- Documentation no longer recommends CLI-created version PRs as the PR-based workflow.
- PR-based workflow documentation points to `pubm-actions` and the future workflow installer path.
- Any future release-pr implementation has a contract that merge-before-tag/publish/release is enforced.

## Risks

- Removing `createPr` can surprise existing users who used it for protected branches.
- If documentation is not updated in the same pass, users may still follow obsolete `createPr` guidance.
- If direct workflow keeps PR fallback semantics, protected branch behavior can silently bypass the intended approval gate.
- If `pubm-actions` owns too much domain logic, release semantics can split across packages and make retry, rollback, and publication continuation brittle.
- If release-pr is implemented as a CLI-first workflow, it can duplicate GitHub Action responsibilities and produce unclear UX.

## Assumptions

- The prior product decision was to remove `createPr` rather than preserve it as a public workflow option.
- PR-based release is primarily a GitHub-hosted workflow driven by `pubm-actions`.
- The CLI remains important for local direct release, split prepare, split publish, setup, and future workflow installation.
- `pubm-actions` can call pubm core APIs once the core workflow/service/provider boundaries are stable enough.
- Homebrew formula PR behavior remains separate because it happens after a release exists and belongs to plugin behavior.

## Open Questions

- What deprecation path is acceptable for `createPr`: immediate removal in the next breaking changeset, or one release cycle with a warning?
- Should direct push failure report a generic git error, or a pubm-specific protected-branch message that points users toward the future `pubm-actions` workflow?
- What minimal `ReleaseRecord` persistence is required before release-pr can safely move into `pubm-actions`?
- Should `pubm init` evolve into the workflow installer, or should `pubm workflow install github` be introduced as a separate command?
