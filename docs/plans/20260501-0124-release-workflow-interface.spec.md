---
title: "Release Workflow Interface"
status: "draft"
created: "2026-05-01 01:24 KST"
spec_id: "20260501-0124-release-workflow-interface"
related_plan: "20260501-0124-release-workflow-interface.plan.md"
---

# Spec: Release Workflow Interface

## Summary

This document records the public naming and CLI interface decision for release workflow selection after removing `mode`.

The product-facing workflows are `Direct Release` and `Split CI Release`. Bare `pubm` runs a Direct Release. `pubm --phase prepare` and `pubm --phase publish` run the two phases of a Split CI Release. `phase` stays public, but it must be documented as the Split CI Release phase selector, not as a generic mode selector.

## Goals

- Define the user-facing workflow names for local one-shot and CLI + CI release paths.
- Keep `--phase prepare|publish` as the public Split CI Release interface.
- Clarify the public meaning of `phase`, `prepare`, and `publish`.
- Correct the implementation rule so explicit `phase` selects Split CI Release regardless of whether the current process is running locally or in CI.
- Keep `isCI` and prompt availability as runtime/auth policy inputs, not workflow selection inputs.
- Keep `phase` out of project config.
- Keep release-pr out of this CLI interface; release-pr belongs to the future `pubm-actions` approval-gated workflow path.

## Non-Goals

- Reintroduce `mode`, `workflow`, `ci`, or another broad workflow-selection option.
- Rename `pubm` to `pubm release`.
- Add a public release-pr CLI mode.
- Implement the future `pubm-actions` release-pr workflow.
- Change version plan modes such as `single`, `fixed`, and `independent`.
- Change snapshot workflow semantics.

## Current State

- `mode` has been removed from the public CLI/options surface in the current branch.
- `phase?: "prepare" | "publish"` remains in core options and CLI handling.
- Bare `pubm` is intended to run the full release pipeline.
- Generated CI release workflows use `pubm --phase publish`.
- Current implementation still has a semantic bug: `DirectReleaseWorkflow` selects the split profile only when `ctx.options.phase !== undefined && isCI`.
- Because of that bug, local `pubm --phase prepare` can take the local direct preflight path instead of the Split CI prepare path that collects/syncs tokens for CI publish.
- The previous `mode=ci` did more than identify CI runtime; it selected the split release topology.
- Existing docs mention `--phase`, but the intended product labels need to be made consistent.
- A separate PR-based workflow direction document records that `createPr` should be removed and future PR-based release belongs to `pubm-actions`.

## Audience And Use Cases

- Users who want the simplest local one-shot release command.
- Maintainers who prepare a release locally and let CI publish it.
- CI workflows that publish a prepared release non-interactively.
- SDK and plugin maintainers who need clear semantics for `Options.phase`.
- Documentation maintainers describing release setup and troubleshooting.

## Requirements

- Public workflow names:
  - `Direct Release`: one command runs prepare, publish, and release.
  - `Split CI Release`: preparation and publishing are split across CLI and CI.
- Public command mapping:
  - `pubm` runs Direct Release.
  - `pubm --phase prepare` runs Split CI Release prepare.
  - `pubm --phase publish` runs Split CI Release publish.
- Public phase labels:
  - `prepare`: "Prepare for CI publish".
  - `publish`: "Publish prepared release".
- CLI help must describe `--phase` as: "Run one Split CI Release phase: prepare or publish. Omit for Direct Release."
- Long-form docs must state that `prepare` validates, collects/syncs tokens, writes versions, creates tags, pushes release refs, and does not publish packages.
- Long-form docs must state that `publish` reads manifest versions, publishes packages, creates GitHub Releases, and is intended for CI/non-interactive token execution.
- `phase` must remain a CLI/SDK runtime option and must not be added to `pubm.config.ts`.
- Internal workflow selection must use `phase === undefined ? "direct" : "split-ci"`.
- `isCI` must not decide Direct Release versus Split CI Release.
- `isCI` and `ctx.runtime.promptEnabled` may still decide prompt behavior, token-only behavior, CI renderer options, and provenance/auth policy.
- Local `pubm --phase prepare` must execute Split CI prepare preflight.
- CI `pubm --phase publish` must execute publish continuation behavior without prompts and without version/tag/push work.

## Interfaces And Contracts

- CLI:
  - `pubm [version]`
  - `pubm [version] --phase prepare`
  - `pubm --phase publish`
- SDK:
  - `Options.phase?: "prepare" | "publish"`
  - No `Options.mode`.
  - No config-level `phase`.
- Internal names:
  - `type ReleaseWorkflow = "direct" | "split-ci"` or equivalent.
  - `type ReleasePhase = "prepare" | "publish"`.
- Workflow selection rule:

```ts
const workflow = options.phase === undefined ? "direct" : "split-ci";
```

- Split phase resolution:
  - no phase: `["prepare", "publish"]`
  - `prepare`: `["prepare"]`
  - `publish`: `["publish"]`

## Constraints

- This work must preserve the recent `mode` removal.
- The public command remains `pubm`.
- No new broad workflow selector should be introduced for Direct versus Split CI Release.
- Existing translation sets should remain structurally aligned when current docs or locale strings are edited.
- The workflow fix must keep contract tests focused on externally visible semantic behavior.
- Historical planning docs do not need broad rewrites unless they are current acceptance or architecture decision documents.

## Acceptance Criteria

- `pubm --help` shows `--phase` with Split CI Release wording and does not show `--mode`.
- `pubm --phase prepare` is treated as Split CI Release prepare even in a local non-CI process.
- Local `pubm --phase prepare` runs the CI prepare preflight path that collects/syncs tokens for subsequent CI publish.
- `pubm` without `--phase` remains Direct Release and uses local preflight when run interactively outside CI.
- `pubm --phase publish` seeds version plans from manifest versions and does not run required missing-information prompts.
- Documentation consistently uses `Direct Release`, `Split CI Release`, `Prepare for CI publish`, and `Publish prepared release`.
- No `phase` project config option is introduced.
- Focused CLI, workflow, generated workflow, and docs tests pass.
- Full validation passes: `bun run typecheck`, `bun run check`, `bun run test`, and `bun run coverage`.

## Risks

- Keeping the option name `phase` can still sound generic if help text does not tie it to Split CI Release.
- Treating all explicit phases as split workflow phases changes the current buggy behavior of local `--phase prepare`; tests must capture the intended behavior.
- Docs can accidentally imply that `prepare` only checks credentials, even though it also writes versions, creates tags, and pushes release refs.
- `isCI` can accidentally creep back into workflow selection if helper names imply "CI mode" rather than "split workflow".
- Plugin auth behavior can regress if split workflow and non-interactive runtime are collapsed into one concept.

## Assumptions

- Users prefer one clear default command over an explicit workflow selector.
- `prepare` and `publish` are acceptable public values when paired with clearer labels and docs.
- `stage` is not a clear enough improvement over `phase` to justify churn.
- The future release-pr path will use `pubm-actions` and should not influence the current `phase` interface.

## Open Questions

- None for this implementation pass.
