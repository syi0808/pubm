---
title: "CLI Phase Option Simplification"
status: "draft"
created: "2026-05-01 00:19 KST"
spec: "20260501-0019-cli-phase-option-simplification.spec.md"
plan_id: "20260501-0019-cli-phase-option-simplification"
---

# Plan: CLI Phase Option Simplification

## Source Spec
- Spec file: `docs/plans/20260501-0019-cli-phase-option-simplification.spec.md`
- Goals covered: remove public release `mode`, keep optional `phase`, preserve full and split release behavior, update tests/docs/generated workflows, add changeset.
- Non-goals preserved: no `pubm release` subcommand, no unrelated release pipeline redesign, no edits to version plan modes or package-manager `--mode` arguments.

## Implementation Strategy
Replace the public `mode + prepare/publish booleans` model with a single optional `phase` field. Treat explicit `phase` as the split workflow signal. Use runtime prompt availability and CI detection only for interactive versus non-interactive behavior, not for selecting the workflow stage.

The code change should start at the option type and phase resolver, then update CLI action seeding, then workflow/plugin branch conditions. Tests should be updated with phase-only expectations instead of retaining compatibility for `--mode`.

## File And Module Map
- Create:
  - `.pubm/changesets/<generated-name>.md`
  - `docs/plans/20260501-0019-cli-phase-option-simplification.spec.md`
  - `docs/plans/20260501-0019-cli-phase-option-simplification.plan.md`
- Modify:
  - `packages/core/src/types/options.ts`
  - `packages/core/src/options.ts`
  - `packages/core/src/index.ts`
  - `packages/core/src/utils/resolve-phases.ts`
  - `packages/core/src/workflow/direct-release-workflow.ts`
  - `packages/core/src/workflow/release-phases/dry-run.ts`
  - `packages/core/src/workflow/release-phases/push-release.ts`
  - `packages/core/src/tasks/snapshot-runner.ts`
  - `packages/pubm/src/cli.ts`
  - `packages/pubm/src/commands/snapshot.ts`
  - `packages/pubm/src/commands/init-workflows.ts`
  - `packages/plugins/plugin-brew/src/brew-core.ts`
  - `packages/plugins/plugin-brew/src/brew-tap.ts`
  - Focused tests under `packages/core/tests`, `packages/pubm/tests`, and `packages/plugins/plugin-brew/tests`
  - Current user-facing docs and workflow files that mention `--mode ci`
- Delete:
  - No source files.
- Leave unchanged:
  - Version plan `mode` values.
  - Changeset prerelease `mode`.
  - Package-manager `yarn install --mode update-lockfile`.
  - Historical planning documents unless a current reference points users to the old CLI.

## Task Breakdown

### Phase 1: Option Model

#### Task 1: Replace public mode booleans with phase
**Files**
- Modify: `packages/core/src/types/options.ts`
- Modify: `packages/core/src/options.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/utils/resolve-phases.ts`
- Test: `packages/core/tests/unit/utils/resolve-phases.test.ts`
- Test: `packages/core/tests/unit/options.test.ts`

- [ ] Update `Options` to include `phase?: ReleasePhase` and remove `mode`, `prepare`, and `publish`.
- [ ] Remove `ReleaseMode` export and remove `mode` from `ResolvedOptions`.
- [ ] Move or export `ReleasePhase` from the options type module so SDK users can import it from `@pubm/core`.
- [ ] Remove `mode: "local"` from `defaultOptions`.
- [ ] Make `resolvePhases(options)` accept `phase` only.

```ts
export function resolvePhases(options: Pick<Options, "phase">): ReleasePhase[] {
  validateOptions(options);
  if (!options.phase) return ["prepare", "publish"];
  return [options.phase];
}
```

- [ ] Validate runtime phase values and throw a clear invalid phase error before any pipeline side effects.
- [ ] Update focused tests:
  - no phase resolves both phases.
  - `"prepare"` resolves prepare only.
  - `"publish"` resolves publish only.
  - invalid string throws.
  - defaults no longer include `mode`.

### Phase 2: CLI Behavior

#### Task 2: Remove CLI mode and seed version plans by phase
**Files**
- Modify: `packages/pubm/src/cli.ts`
- Test: `packages/pubm/tests/unit/cli.test.ts`
- Test: `packages/pubm/tests/contracts/cli/mode-option-contract.test.ts`
- Test: `packages/pubm/tests/contracts/cli/runner-wiring-smoke-contract.test.ts`
- Test: `packages/pubm/tests/e2e/help.test.ts`
- Test: `packages/pubm/tests/e2e/ci-mode.test.ts`

- [ ] Remove `CliOptions.mode`, `ResolvedCliMode`, `resolveCliMode`, and Commander `--mode`.
- [ ] Map CLI `--phase <phase>` to `Options.phase`.
- [ ] Keep `skipReleaseDraft` true for `phase === "publish"` because publish-only should not create a new draft URL from the prepare half.
- [ ] Extract manifest-version plan seeding into a small internal helper used by publish-only.
- [ ] Extract CI version-source recommendation seeding into a small internal helper used by bare `pubm` in CI.
- [ ] Branch action handling by phases:
  - explicit version always seeds a version plan first.
  - publish-only seeds from manifests and skips missing-information prompts.
  - CI full release with no explicit version analyzes configured version sources and fails with the existing version-required message if no plan is produced.
  - prepare-only and local full release run missing-information tasks when needed.
- [ ] Update CLI contracts so expected options use `phase: "prepare" | "publish"` and no `mode`, `prepare`, or `publish`.
- [ ] Update help tests to assert `--mode` is absent and `--phase` remains present.

### Phase 3: Workflow And Plugin Runtime Branches

#### Task 3: Replace workflow mode checks
**Files**
- Modify: `packages/core/src/workflow/direct-release-workflow.ts`
- Modify: `packages/core/src/workflow/release-phases/dry-run.ts`
- Modify: `packages/core/src/workflow/release-phases/push-release.ts`
- Modify: `packages/core/src/tasks/snapshot-runner.ts`
- Modify: `packages/pubm/src/commands/snapshot.ts`
- Test: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`
- Test: `packages/core/tests/unit/workflow/release-phases/dry-run.test.ts`
- Test: `packages/core/tests/unit/workflow/release-phases/push-release.test.ts`
- Test: `packages/core/tests/unit/tasks/snapshot-runner.test.ts`
- Test: `packages/pubm/tests/unit/commands/snapshot.test.ts`

- [ ] In `DirectReleaseWorkflow`, compute:
  - `const splitPhase = ctx.options.phase !== undefined`
  - `const prepareOnly = ctx.options.phase === "prepare"`
  - `const publishOnly = ctx.options.phase === "publish"`
  - `const nonInteractive = !ctx.runtime.promptEnabled`
- [ ] Run CI/split prepare preflight for `prepareOnly`.
- [ ] Run local preflight for full releases with prepare.
- [ ] Run publish plugin credentials for `publishOnly`.
- [ ] Pass `splitPhase` or `nonInteractive` booleans into dry-run and GitHub release operations instead of mode strings.
- [ ] Enable prepare dry-run validation when `dryRun || prepareOnly`, preserving the old split prepare validation.
- [ ] Suppress interactive GitHub release token prompts when the runtime is non-interactive or the command is an explicit split phase.
- [ ] Remove snapshot command hardcoded `mode: "local"` and snapshot runner `ctx.options.mode` branch. Snapshot behavior should remain local/full unless a future snapshot phase option is introduced.

#### Task 4: Replace Homebrew plugin mode checks
**Files**
- Modify: `packages/plugins/plugin-brew/src/brew-core.ts`
- Modify: `packages/plugins/plugin-brew/src/brew-tap.ts`
- Test: `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts`
- Test: `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts`
- Test: `packages/plugins/plugin-brew/tests/contracts/external-boundary.test.ts`

- [ ] Introduce local helpers in plugin files or a shared module:
  - split release: `ctx.options.phase !== undefined`
  - token auth required: split release or `ctx.runtime.promptEnabled === false`
- [ ] Use token auth for explicit split phases and non-interactive runs.
- [ ] Keep local GitHub CLI checks for interactive full releases that include publish.
- [ ] Update plugin tests from `{ mode: "ci" }` to phase or prompt-enabled driven contexts.

### Phase 4: Generated Workflows, Docs, And Changeset

#### Task 5: Update generated and checked-in workflows
**Files**
- Modify: `packages/pubm/src/commands/init-workflows.ts`
- Modify: `packages/pubm/tests/unit/commands/init-workflows.test.ts`
- Modify: `.github/workflows/release.yml`

- [ ] Replace generated publish commands:
  - `bunx pubm --phase publish`
  - `pnpm exec pubm --phase publish`
  - `yarn pubm --phase publish`
  - `npx pubm --phase publish`
  - `pubm --phase publish`
- [ ] Update tests to assert the new commands and absence of `--mode ci`.
- [ ] Update the repository release workflow to use `bunx pubm --phase publish`.

#### Task 6: Update current user-facing docs
**Files**
- Modify: `README.md`
- Modify: `website/src/content/docs/**/reference/cli.mdx`
- Modify: `website/src/content/docs/**/reference/sdk.mdx`
- Modify: `website/src/content/docs/**/guides/ci-cd.mdx`
- Modify: `website/src/content/docs/**/guides/troubleshooting.mdx`
- Modify: `website/src/content/docs/**/guides/changesets.mdx`
- Modify: `website/src/content/docs/**/reference/official-plugins.mdx`
- Modify: `plugins/pubm-plugin/skills/publish-setup/SKILL.md`
- Modify: `plugins/pubm-plugin/skills/publish-setup/references/*.md`
- Modify: `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md`
- Modify: `packages/core/src/i18n/locales/*.json`

- [ ] Replace current commands using `--mode ci --phase prepare` with `--phase prepare`.
- [ ] Replace current commands using `--mode ci --phase publish` with `--phase publish`.
- [ ] Remove CLI option docs for `--mode`.
- [ ] Remove SDK docs for `ReleaseMode` and `Options.mode`.
- [ ] Update `cli.option.phase` wording if needed so help text explains prepare/publish.
- [ ] Remove `cli.option.mode` locale keys if no tests require a fixed key set.
- [ ] Keep unrelated `--mode update-lockfile` and versioning mode docs unchanged.

#### Task 7: Add changeset
**Files**
- Create: `.pubm/changesets/<generated-name>.md`

- [ ] Add a minor or major changeset for `packages/core`, `packages/pubm`, and `packages/plugins/plugin-brew`.
- [ ] Message should state that release workflow options were simplified to phase-only and `--mode` was removed.

## Interfaces, Data Flow, And State
- CLI input `--phase <phase>` flows to `Options.phase`.
- `resolveOptions` preserves `phase` only when the user supplied it.
- `resolvePhases` derives the executable phase list from `phase`.
- CLI publish-only reads manifest versions into `ctx.runtime.versionPlan` before calling `pubm(ctx)`.
- CI full release analyzes configured version sources into `ctx.runtime.versionPlan` before calling `pubm(ctx)`.
- Direct workflow uses `ctx.options.phase` to select split stage behavior and `ctx.runtime.promptEnabled` for interactive prompting.
- Plugin-brew uses split phase and prompt availability to choose token-based or local GitHub CLI behavior.

## Edge Cases And Failure Modes
- `--phase invalid` must fail without calling `pubm`.
- Bare `pubm` in CI without explicit version and without recommendations must keep the existing version-required error.
- `--phase publish` must not parse latest tags for version selection.
- `--phase prepare` must run split prepare preflight and cleanup before printing prepare-complete output.
- Local full release must not require `PUBM_BREW_GITHUB_TOKEN` when GitHub CLI auth is available.
- Explicit split phase must not accidentally open interactive GitHub release token prompts in publish-only automation.

## Test And Verification Matrix
- Requirement: no public CLI `--mode`.
  - Test or command: `cd packages/pubm && bun vitest --run tests/e2e/help.test.ts`
  - Expected result: passes and help output excludes `--mode`.
- Requirement: phase resolution contract.
  - Test or command: `cd packages/core && bun vitest --run tests/unit/utils/resolve-phases.test.ts`
  - Expected result: phase-only tests pass.
- Requirement: CLI publish-only reads manifests.
  - Test or command: `cd packages/pubm && bun vitest --run tests/unit/cli.test.ts tests/e2e/ci-mode.test.ts tests/contracts/cli/runner-wiring-smoke-contract.test.ts`
  - Expected result: publish-only cases pass without `--mode`.
- Requirement: workflow split behavior.
  - Test or command: `cd packages/core && bun vitest --run tests/unit/workflow/direct-release-workflow.test.ts tests/unit/workflow/release-phases/dry-run.test.ts tests/unit/workflow/release-phases/push-release.test.ts`
  - Expected result: prepare-only and publish-only branch tests pass.
- Requirement: Homebrew token behavior.
  - Test or command: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-core.test.ts tests/unit/brew-tap.test.ts tests/contracts/external-boundary.test.ts`
  - Expected result: split and non-interactive contexts require PAT, interactive full contexts use local auth checks.
- Requirement: generated workflow command.
  - Test or command: `cd packages/pubm && bun vitest --run tests/unit/commands/init-workflows.test.ts`
  - Expected result: workflow output uses `--phase publish` and omits `--mode ci`.
- Requirement: repository-wide quality.
  - Test or command: `bun run format && bun run typecheck && bun run check && bun run test && bun run coverage`
  - Expected result: all commands pass.
- Requirement: no stale current references.
  - Test or command: `rg -n -e "--mode ci" README.md website/src/content/docs plugins/pubm-plugin .github packages/pubm/src packages/pubm/tests packages/core/src packages/core/tests packages/plugins`
  - Expected result: no current references except unrelated or historical contexts explicitly reviewed.

## Rollout And Review
- Review focus:
  - Public API break: `ReleaseMode`, `Options.mode`, `Options.prepare`, and `Options.publish` are removed intentionally.
  - Split workflow preservation: explicit `phase` keeps old CI split semantics even when run locally.
  - Plugin compatibility: Homebrew credentials depend on split phase or non-interactive runtime, not the removed mode string.
  - Documentation consistency: CLI examples and generated workflow output must match.
- Rollback notes:
  - Reverting this change would require restoring `ReleaseMode`, `--mode`, boolean phase options, and old docs/tests together.

## Assumptions
- A breaking changeset is acceptable because removing `--mode` and SDK `Options.mode` changes the public interface.
- `phase` is the only public selector for split release workflow stages.
- Explicit split phases should prefer automation-safe token behavior over local interactive prompts.
