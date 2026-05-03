---
title: "CLI Phase Option Simplification"
status: "draft"
created: "2026-05-01 00:19 KST"
spec_id: "20260501-0019-cli-phase-option-simplification"
related_plan: "20260501-0019-cli-phase-option-simplification.plan.md"
---

# Spec: CLI Phase Option Simplification

## Summary
The release command should stop exposing two overlapping concepts, `mode` and `phase`, for the same workflow split. Bare `pubm` is the default full release command, and `--phase prepare` / `--phase publish` are the only public controls for the split workflow.

The change removes `mode` from the CLI and SDK options surface, preserves the existing split-workflow behavior through `phase`, and keeps runtime automation decisions inferred from the execution environment and prompt availability instead of user-provided mode strings.

## Goals
- Remove public `mode` support from the `pubm` CLI, SDK `Options`, resolved options, generated workflows, user-facing docs, plugin docs, and current tests.
- Keep `phase?: "prepare" | "publish"` as the public split-workflow selector.
- Keep bare `pubm` as the full release path. The command must remain `pubm`, not `pubm release`.
- Preserve old split-workflow semantics:
  - `pubm --phase prepare` performs the prepare half that collects credentials, validates, versions, tags, pushes, and stops before publish.
  - `pubm --phase publish` performs the publish/release half from manifest versions without requiring latest-tag parsing for the version decision.
- Preserve full release semantics:
  - Local full release remains interactive where a terminal allows it.
  - CI full release remains non-interactive and derives versions from configured version sources or an explicit version argument.
- Keep unrelated `mode` concepts intact, including version plan modes, changeset prerelease modes, package manager install modes, renderer modes, and test scenario metadata.
- Update tests and documentation so users and contracts describe the new phase-only workflow.

## Non-Goals
- Do not change the release pipeline phase order beyond the minimum needed to replace `mode` branching.
- Do not rename `pubm` to a subcommand form.
- Do not remove or redesign `dryRun`, `skipDryRun`, `skipPublish`, `skipReleaseDraft`, `releaseDraft`, registry filtering, rollback, or plugin hooks.
- Do not alter version plan modes such as `"single"`, `"fixed"`, and `"independent"`.
- Do not migrate unrelated historical planning documents unless they are current user-facing references.

## Current State
- `packages/pubm/src/cli.ts` registers `--mode <mode>` and maps `mode === "ci"` to `Options.mode = "ci"`, otherwise `"local"`.
- `packages/core/src/types/options.ts` exports `ReleaseMode`, `Options.mode`, `Options.prepare`, `Options.publish`, and `ResolvedOptions.mode`.
- `packages/core/src/options.ts` defaults `mode` to `"local"`.
- `packages/core/src/utils/resolve-phases.ts` derives phases from `prepare` and `publish` booleans and rejects `mode: "ci"` without an explicit phase.
- `packages/core/src/workflow/direct-release-workflow.ts` uses `ctx.options.mode` to select CI prepare preflight, local preflight, CI publish plugin credentials, dry-run validation, and release-token prompting behavior.
- `packages/core/src/workflow/release-phases/dry-run.ts` enables prepare dry-run validation when `mode === "ci" && hasPrepare`.
- `packages/core/src/workflow/release-phases/push-release.ts` suppresses interactive GitHub token prompts when `mode === "ci"`.
- `packages/plugins/plugin-brew` uses `ctx.options.mode` to decide whether Homebrew PAT credentials and CI token checks are required.
- Generated GitHub Actions release workflows and the repository release workflow run `pubm --mode ci --phase publish`.
- Current tests and docs assert or explain `--mode ci --phase prepare/publish`.

## Audience And Use Cases
- CLI users running a normal release with `pubm`.
- Maintainers using a split workflow where a local prepare step writes secrets and pushes release refs, and CI later runs `pubm --phase publish`.
- CI users running a full non-interactive release with an explicit version or configured version sources.
- SDK and plugin authors reading `Options` and `ctx.options`.

## Requirements
- CLI:
  - `pubm --help` must no longer list `--mode`.
  - `pubm --phase prepare` and `pubm --phase publish` must be accepted.
  - Invalid `--phase` values must fail before the release pipeline runs.
  - Existing `pubm [version]` behavior must remain intact.
- SDK/options:
  - `ReleaseMode` must no longer be exported.
  - `Options` and `ResolvedOptions` must no longer include `mode`, `prepare`, or `publish`.
  - `Options.phase` must express the public split selector.
  - Resolved default options must not synthesize a default phase.
- Workflow behavior:
  - No core workflow code should depend on `ctx.options.mode`.
  - Explicit `phase` should represent split workflow behavior.
  - Environment and prompt availability should drive interactive versus non-interactive credential behavior.
  - Publish-only phase should seed the version plan from package manifests.
  - Prepare-only phase should keep prepare completion messaging and cleanup behavior.
- Plugins:
  - Homebrew plugin credential and checks logic must work without `ctx.options.mode`.
  - Explicit split phases and non-interactive full CI releases must require token-based Homebrew behavior.
  - Local full releases must keep local GitHub CLI auth checks where applicable.
- Generated workflows:
  - CI workflow generation must emit `pubm --phase publish` commands without `--mode ci`.
  - The repository release workflow must use the same command shape.
- Documentation:
  - Current README, website docs, and pubm plugin skill references must remove user-facing `--mode` instructions.
  - CLI and SDK references must describe `phase` as the only workflow split selector.
- Tests:
  - Contract, unit, and e2e tests must be updated to assert phase-only behavior.
  - Guardrails must still catch wrong publish-only version seeding, missing prepare cleanup, token-check regression, and accidental `--mode` help reintroduction.

## Interfaces And Contracts
- CLI command:
  - Full release: `pubm [version]`
  - Prepare phase: `pubm [version] --phase prepare`
  - Publish phase: `pubm --phase publish`
- SDK options:
  - `phase?: "prepare" | "publish"`
  - No public `mode`, `prepare`, or `publish` options.
- Workflow phase contract:
  - `phase` omitted resolves to `["prepare", "publish"]`.
  - `phase: "prepare"` resolves to `["prepare"]`.
  - `phase: "publish"` resolves to `["publish"]`.
- Generated CI workflow:
  - Package-manager command wrappers remain the same, with only `--mode ci` removed.

## Constraints
- This is a breaking public interface cleanup and needs a changeset.
- The migration must avoid touching unrelated `mode` fields that are not release execution options.
- The codebase uses Bun workspaces and strict TypeScript; all packages must typecheck after removing `ReleaseMode`.
- Documentation translations should stay structurally aligned across locales when current reference pages are edited.
- Existing architecture migration guardrails and runner contracts remain part of the verification surface.

## Acceptance Criteria
- `rg` finds no user-facing or public API references to `pubm --mode`, `Options.mode`, or `ReleaseMode` outside historical docs or unrelated concepts.
- `bun run typecheck` passes.
- `bun run check` passes.
- `bun run test` passes.
- `bun run coverage` passes without lowering thresholds.
- Focused CLI, workflow, Homebrew plugin, and generated workflow tests pass.
- `pubm --help` does not show `--mode` and does show `--phase`.
- Generated release workflows use `pubm --phase publish`.
- A changeset describes the user-facing CLI/SDK option cleanup.

## Risks
- Removing `mode` can accidentally lose split prepare behavior because old `--mode ci --phase prepare` was allowed outside a CI environment.
- Removing `mode` can accidentally re-enable interactive prompts inside publish-only CI phases.
- Homebrew plugins can miss PAT collection if their old `ctx.options.mode === "ci"` checks are replaced only with `isCI`.
- Tests that use unrelated version-plan `mode` values can be over-edited.
- Existing docs contain both current instructions and historical plans; broad search-and-replace could corrupt historical context or unrelated package-manager commands.

## Assumptions
- Explicit `phase` means the split release workflow stage, regardless of whether the command is launched locally or inside CI.
- Bare `pubm` remains the only full release entry point and can infer interactivity from runtime environment.
- Historical planning documents do not need edits unless they are current user-facing instructions.
- Keeping `phase` optional in resolved options is clearer than defaulting it to a synthetic `"full"` value.

## Open Questions
- None. The user has selected `pubm` as the command form and `phase` as the only remaining workflow split option.
