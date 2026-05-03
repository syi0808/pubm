---
title: "Release Config Redesign"
status: "draft"
created: "2026-05-03 20:24 KST"
spec_id: "20260503-2024-release-config-redesign"
related_plan: "20260503-2024-release-config-redesign.plan.md"
---

# Spec: Release Config Redesign

## Summary

pubm's release configuration should use one concrete `release` domain instead of separate top-level `versionSources`, `conventionalCommits`, `versioning`, `fixed`, `linked`, `changelog`, and `releasePr` concepts. Users should not choose abstract source strategies. pubm should always inspect changesets and conventional commits, apply configured parsing rules, and treat changes without a semver bump as unversioned changes.

Release PRs should remain version-plan driven. If versioned changes exist, pubm opens or updates release PRs with version and changelog changes. If only unversioned changes exist, pubm should not invent a fallback bump; by default it should warn and report that no release PR was opened.

## Goals

- Replace the public release-related config shape with a nested `release` object.
- Remove the public `versionSources` strategy model and the top-level `conventionalCommits` model.
- Move release PR settings under `release.pullRequest`.
- Move versioning, fixed groups, linked groups, and internal dependency bump settings under `release.versioning`.
- Keep changesets and conventional commits always available as release analysis inputs without boolean enable flags.
- Keep changeset-specific config limited to the changeset file source, starting with `release.changesets.directory`.
- Keep commit-specific config limited to conventional commit parsing, starting with `release.commits.types`.
- Treat non-conventional commits, ignored conventional commit types, and unmatched package changes as unversioned changes.
- Default unversioned change handling to `warn`.
- Use one shared analyzer and plan builder path for CI, interactive recommendations, `pubm changesets version`, and Release PR preparation.

## Non-Goals

- Preserve backward compatibility for `versionSources`, top-level `conventionalCommits`, or top-level `releasePr`.
- Add `all-commits` as a version bump source.
- Add fallback bump behavior for unversioned commits.
- Add draft Release PR behavior for unversioned-only changes.
- Redesign GitHub release note generation beyond preserving the current changelog, conventional commit, raw commit, and compare-link fallback behavior.
- Add custom JavaScript filter or resolver APIs in this pass.

## Current State

- `versionSources` is currently `"all" | "changesets" | "commits"` and defaults to `"all"`.
- `"all"` means changesets plus conventional commits, not all commits.
- `ConventionalCommitSource` ignores non-conventional commits and conventional commit types mapped to `false`.
- Raw commits are currently used only as a GitHub release-note fallback.
- Changelog file generation in release materialization runs only when changesets were consumed.
- Release PR preparation requires `ctx.runtime.versionPlan`; without a version plan, no release PR can be prepared.
- Source construction is duplicated in `packages/core/src/version-source/plan.ts`, `packages/core/src/tasks/prompts/version-choices.ts`, and `packages/pubm/src/commands/version-cmd.ts`.
- Interactive accept and CI planning do not consistently use the same fixed and linked group logic.

## Audience And Use Cases

- Maintainers using changeset files as explicit release records.
- Maintainers using conventional commits for automatic semver bump recommendations.
- Maintainers using release PR automation who expect warning feedback when code changed but pubm cannot infer a version bump.
- Monorepo maintainers who need fixed and linked grouping to affect CLI, CI, and release PR workflows consistently.

## Requirements

- Public config should expose `release.versioning`, `release.changesets`, `release.commits`, `release.changelog`, and `release.pullRequest`.
- `release.changesets` must be an object and should not include an enable flag.
- `release.commits` must be an object and should not include an enable flag.
- `release.pullRequest.unversionedChanges` must support `"ignore" | "warn" | "fail"` and default to `"warn"`.
- Existing changeset files must still drive version bumps, changelog entries, changeset consumption, and release PR materialization.
- Existing releasable conventional commits must still drive version bumps when no changeset recommendation already covers the package.
- Changeset recommendations must continue to win over conventional commit recommendations for the same package key or package path.
- Unversioned changes must never create a version plan or bump versions by themselves.
- Release PR actions must expose a clear status when unversioned changes exist but no versioned release exists.
- Documentation must describe the new release config and remove `versionSources` references.

## Interfaces And Contracts

- Config file shape:
  - `release.versioning.mode`
  - `release.versioning.fixed`
  - `release.versioning.linked`
  - `release.versioning.updateInternalDependencies`
  - `release.changesets.directory`
  - `release.commits.format`
  - `release.commits.types`
- `release.changelog`
- `release.pullRequest.grouping`
- `release.pullRequest.fixed`
- `release.pullRequest.linked`
  - `release.pullRequest.branchTemplate`
  - `release.pullRequest.titleTemplate`
  - `release.pullRequest.label`
  - `release.pullRequest.bumpLabels`
  - `release.pullRequest.unversionedChanges`
- Internal release analysis should return both versioned recommendations and unversioned change records.
- `ResolvedPubmConfig` should keep derived compatibility fields only if needed to contain the blast radius, but public types should prefer the nested `release` structure.

## Constraints

- Backward compatibility is not required.
- File edits should stay scoped to release config, release source analysis, release PR behavior, tests, docs, and action type shims as needed.
- Do not lower coverage thresholds.
- Use package keys for multi-ecosystem package identity wherever recommendations can distinguish them.
- Do not create version commits or release PRs for unversioned-only changes.

## Acceptance Criteria

- `versionSources` and top-level `conventionalCommits` are removed from public config types and docs.
- `releasePr` is replaced by `release.pullRequest` in public config types and docs.
- Default resolved config contains nested release defaults with `pullRequest.unversionedChanges: "warn"`.
- Release PR behavior is enabled by the workflow/action invocation, not by a config flag.
- Changeset-based release PR creation still works.
- Conventional-commit-based release PR creation still works.
- Non-conventional or ignored-type commits produce unversioned warnings but no version plan.
- `release.pullRequest.unversionedChanges: "ignore"` suppresses the warning.
- `release.pullRequest.unversionedChanges: "fail"` fails Release PR automation when only unversioned changes are present.
- CI and interactive recommendation paths use the same analyzer and version plan builder for fixed and linked groups.
- Focused unit and contract tests pass.
- Typecheck and repository formatting checks pass.

## Risks

- Large config shape changes may require many tests and docs to be updated together.
- Action bundles depend on core public exports and local type shims, so pubm-actions may need follow-up updates.
- Changelog generation currently writes only changeset-derived changelog entries; conventional-commit-only versioning may still rely on GitHub release note fallback rather than committed changelog entries.
- Unversioned change detection must avoid warning on release PR self-updates after the release branch already contains only version files.

## Assumptions

- `release.changesets.directory` defaults to `.pubm/changesets`.
- `release.commits.format` supports only `"conventional"` in this pass.
- Default commit type mapping remains `feat: minor`, `fix: patch`, `perf: patch`, and common maintenance types mapped to `false`.
- Default behavior is changesets plus releasable conventional commits, with changesets winning on overlap.
- Release notes fallback order remains unchanged.

## Open Questions

- Should `pubm changesets version` be renamed in a future breaking release now that it versions from both changesets and conventional commits by default?
