---
title: "Release Config Redesign"
status: "draft"
created: "2026-05-03 20:24 KST"
spec: "20260503-2024-release-config-redesign.spec.md"
plan_id: "20260503-2024-release-config-redesign"
---

# Plan: Release Config Redesign

## Source Spec

- Spec file: `docs/plans/20260503-2024-release-config-redesign.spec.md`
- Goals covered: nested `release` config, unified release analysis, unversioned change warning policy, Release PR integration, tests, docs.
- Non-goals preserved: no backward compatibility, no fallback bump, no draft PRs, no custom filter API, no release-note redesign.

## Implementation Strategy

Build the new public config shape first, then adapt existing code through a small number of compatibility access helpers only where needed. Replace duplicated source construction with one analyzer that returns versioned recommendations and unversioned changes. Keep the existing version plan shape, but make all callers use the same plan builder. Integrate unversioned changes into Release PR action status without allowing them to create version bumps.

## File And Module Map

- Create:
  - `packages/core/src/release-analysis/analyze.ts`
  - `packages/core/src/release-analysis/types.ts`
- Modify:
  - `packages/core/src/config/types.ts`
  - `packages/core/src/config/defaults.ts`
  - `packages/core/src/version-source/changeset-source.ts`
  - `packages/core/src/version-source/plan.ts`
  - `packages/core/src/tasks/prompts/version-choices.ts`
  - `packages/core/src/tasks/prompts/single-package.ts`
  - `packages/core/src/tasks/prompts/independent-mode.ts`
  - `packages/core/src/workflow/release-pr.ts`
  - `packages/core/src/workflow/release-utils/scope.ts`
  - `packages/core/src/workflow/release-utils/release-pr-overrides.ts`
  - `packages/core/src/index.ts`
  - `packages/pubm/src/commands/version-cmd.ts`
  - `packages/pubm/src/commands/init-workflows.ts`
  - relevant unit, contract, and docs files.
- Leave unchanged:
  - GitHub release note fallback order in `packages/core/src/tasks/release-notes.ts`.

## Task Breakdown

### Phase 1: Config Shape

#### Task 1: Introduce nested release config types
**Files**
- Modify: `packages/core/src/config/types.ts`
- Modify: `packages/core/src/config/defaults.ts`
- Test: `packages/core/tests/unit/config/defaults.test.ts`
- Test: `packages/core/tests/unit/config/types.test.ts`

- [ ] Add `ReleaseConfig`, `ReleaseVersioningConfig`, `ReleaseChangesetsConfig`, `ReleaseCommitsConfig`, and `ReleasePullRequestConfig`.
- [ ] Move release PR fields under `release.pullRequest`.
- [ ] Move versioning, fixed, linked, and update-internal-dependencies fields under `release.versioning`.
- [ ] Resolve defaults:
  - `release.versioning.mode: "independent"`
  - `release.versioning.fixed: []`
  - `release.versioning.linked: []`
  - `release.versioning.updateInternalDependencies: "patch"`
  - `release.changesets.directory: ".pubm/changesets"`
  - `release.commits.format: "conventional"`
  - `release.commits.types: {}`
  - `release.changelog: true`
  - `release.pullRequest.unversionedChanges: "warn"`
- [ ] Remove public `versionSources`, top-level `conventionalCommits`, and top-level `releasePr` from config types.
- [ ] Do not add a `release.pullRequest.enabled` config flag; workflow/action invocation enables Release PR behavior.
- [ ] Run `cd packages/core && bun vitest --run tests/unit/config/defaults.test.ts tests/unit/config/types.test.ts`.

### Phase 2: Shared Release Analysis

#### Task 2: Create shared analyzer output
**Files**
- Create: `packages/core/src/release-analysis/types.ts`
- Create: `packages/core/src/release-analysis/analyze.ts`
- Modify: `packages/core/src/version-source/changeset-source.ts`
- Modify: `packages/core/src/version-source/plan.ts`
- Test: `packages/core/tests/contracts/version-source/version-source.contract.test.ts`

- [ ] Define `ReleaseAnalysis` with `recommendations` and `unversionedChanges`.
- [ ] Always run changeset analysis using `release.changesets.directory`.
- [ ] Always run conventional commit analysis using `release.commits.types`.
- [ ] Detect unversioned commits from the same raw commit range:
  - non-conventional commits
  - conventional commits whose type maps to `false`
  - conventional commits that cannot be mapped to any package in monorepo mode
- [ ] Do not turn unversioned commits into recommendations.
- [ ] Keep changeset-first recommendation merge behavior.
- [ ] Update `applyVersionSourcePlan` to store `ctx.runtime.releaseAnalysis`.
- [ ] Run focused version-source contract tests.

### Phase 3: Unified Plan Builder In Callers

#### Task 3: Replace duplicated source construction
**Files**
- Modify: `packages/core/src/tasks/prompts/version-choices.ts`
- Modify: `packages/core/src/tasks/prompts/single-package.ts`
- Modify: `packages/core/src/tasks/prompts/independent-mode.ts`
- Modify: `packages/pubm/src/commands/version-cmd.ts`
- Test: prompt and version command tests that reference source analysis.

- [ ] Make `analyzeAllSources` call the shared analyzer and return recommendations.
- [ ] Use `createVersionPlanFromRecommendations` for interactive accept paths.
- [ ] Ensure fixed and linked grouping is applied consistently in CI and interactive accept.
- [ ] Replace user-facing “changesets recommended” copy where recommendations can come from commits.
- [ ] Update `pubm changesets version` to use the shared analyzer and nested config.

### Phase 4: Release PR Unversioned Policy

#### Task 4: Wire unversioned warning/fail behavior
**Files**
- Modify: `packages/core/src/workflow/release-pr.ts`
- Modify: `packages/core/src/workflow/release-utils/scope.ts`
- Modify: `packages/core/src/workflow/release-utils/release-pr-overrides.ts`
- Modify: `packages/pubm/src/commands/init-workflows.ts`
- Modify as needed: `/Users/sung-yein/Workspace/pubm-actions/src/pubm/config.ts`
- Modify as needed: `/Users/sung-yein/Workspace/pubm-actions/src/release-pr/main.ts`
- Test: `packages/core/tests/unit/workflow/release-pr.test.ts`
- Test as needed: `/Users/sung-yein/Workspace/pubm-actions/tests/release-pr-workflow.test.ts`

- [ ] Replace `ctx.config.releasePr` references with `ctx.config.release.pullRequest`.
- [ ] Replace release PR grouping inheritance with `release.versioning`.
- [ ] Expose unversioned status to action code after `applyVersionSourcePlan`.
- [ ] If no version plan exists and unversioned changes exist:
  - `"ignore"`: return no pending release without warning.
  - `"warn"`: return no pending release plus a clear warning.
  - `"fail"`: fail with a clear error.
- [ ] Keep versioned release PR behavior unchanged.

### Phase 5: Docs And Generated Config

#### Task 5: Update docs and generated workflows
**Files**
- Modify: `website/src/content/docs/guides/configuration.mdx`
- Modify: translated configuration pages where release config is documented.
- Modify: `website/src/content/docs/guides/changesets.mdx`
- Modify: translated changesets pages where `versionSources` appears.
- Modify: `website/src/content/docs/reference/cli.mdx`
- Modify: translated CLI reference pages where `versionSources` appears.
- Modify: `README.md` if it documents old config keys.
- Add: changeset file under `.pubm/changesets/`.

- [ ] Replace `releasePr` docs with `release.pullRequest`.
- [ ] Replace `versionSources` and `conventionalCommits` docs with `release.changesets` and `release.commits`.
- [ ] Document unversioned change handling and default `"warn"`.
- [ ] Update generated config examples.
- [ ] Add a breaking-change changeset for `packages/core` and `packages/pubm`.

## Interfaces, Data Flow, And State

- Config load resolves user config to `ResolvedPubmConfig.release`.
- Shared release analysis produces recommendations and unversioned changes.
- Plan builder consumes only recommendations.
- Release materialization still writes versions and consumes changesets only when changeset recommendations were selected.
- Release PR action reads the analysis result from runtime after context load.

## Edge Cases And Failure Modes

- Commit-only repositories with `fix:` commits should still get patch release PRs.
- Repositories with only `docs:` or non-conventional commits should warn and open no PR by default.
- Fixed versioning should expand version plans to all release packages.
- Linked groups should still apply after changeset and commit recommendations merge.
- Same-path multi-ecosystem changesets must preserve package keys.
- Conventional commits cannot reliably distinguish same-path multi-ecosystem package keys in this pass.

## Test And Verification Matrix

- Config defaults: `cd packages/core && bun vitest --run tests/unit/config/defaults.test.ts tests/unit/config/types.test.ts`
- Source contracts: `cd packages/core && bun vitest --run tests/contracts/version-source/version-source.contract.test.ts`
- Release PR: `cd packages/core && bun vitest --run tests/unit/workflow/release-pr.test.ts tests/unit/workflow/release-utils/scope.test.ts`
- CLI version command: relevant `packages/pubm` tests after file discovery.
- Full checks: `bun run format`, `bun run typecheck`, `bun run test`, `bun run build`.

## Rollout And Review

- Review public config docs carefully because this is a breaking config redesign.
- Review Release PR action behavior in `pubm-actions` after core changes, rebuild action bundles if needed.
- QA should include one changeset release and one conventional-commit release after implementation.

## Assumptions

- No compatibility aliases are required for old public config names.
- `release.commits.format` remains `"conventional"` only in this pass.
- Default unversioned behavior is warning without PR creation.
