---
title: "Release Workflow Docs Restructure"
status: "draft"
created: "2026-05-01 14:37 KST"
spec_id: "20260501-1437-release-workflow-docs-restructure"
related_plan: "20260501-1437-release-workflow-docs-restructure.plan.md"
---

# Spec: Release Workflow Docs Restructure

## Summary

This document defines the documentation cleanup for the public release workflow model after the CLI interface was narrowed to `pubm` plus `--phase prepare|publish`.

The docs should present two supported user workflows: Direct Release and Split CI Release. Fully automated CI is not a supported current workflow and must not appear as a recommended path. PR-based release work is future `pubm-actions` scope, not a CLI path.

## Goals

- Establish one canonical user-facing guide for release workflow selection.
- Document only the currently supported workflow choices:
  - Direct Release: `pubm`
  - Split CI Release: local `pubm --phase prepare`, CI `pubm --phase publish`
- Keep `--phase` documented as the Split CI Release phase selector.
- Remove supported-workflow guidance for Fully automated CI.
- Reduce duplicated workflow explanations across README, website docs, and plugin skill docs.
- Keep translated website docs structurally aligned with the English source.
- Keep agent skill docs aligned with the same workflow model, while preserving their role as setup operator manuals.

## Non-Goals

- Do not implement new release behavior.
- Do not add a new CLI option, config option, command, or workflow selector.
- Do not add Fully automated CI support.
- Do not document release-pr as a CLI workflow.
- Do not remove `createPr` from code in this documentation pass.
- Do not rewrite historical architecture plans that record past migration context.
- Do not translate every sentence with publication-quality localization if a faithful technical translation is enough for parity.

## Current State

- `docs/plans/20260501-0124-release-workflow-interface.spec.md` defines the public interface:
  - bare `pubm` means Direct Release
  - `pubm --phase prepare` and `pubm --phase publish` mean Split CI Release phases
  - `phase` is runtime-only and should not be project config
  - `isCI` affects auth and prompt policy, not workflow selection
- `website/src/content/docs/guides/ci-cd.mdx` currently contains both workflow selection and CI runner guidance.
- `website/src/content/docs/reference/cli.mdx` repeats workflow semantics that should be guide-level content.
- `README.md` includes Direct and Split workflow details, but it should be a quick decision surface.
- `plugins/pubm-plugin/skills/publish-setup/references/decision-guides.md` still needs to be the canonical skill-side choice guide and must not include a supported Fully automated CI option.
- `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` should keep YAML templates and CI commands, not redefine product strategy.
- `plugins/pubm-plugin/skills/publish-setup/references/internals.md` may describe phase semantics for agents, but should not compete with user docs.
- Website locale directories currently have matching guide and reference file sets. Adding a new page requires adding it for all locales.
- The Starlight sidebar in `website/astro.config.mjs` does not yet expose a Release Workflows page.

## Audience And Use Cases

- A maintainer deciding how to run their first release.
- A maintainer who wants local preparation with CI publishing.
- A CI owner wiring secrets and GitHub Actions around `pubm --phase publish`.
- A plugin or SDK reader checking what `ctx.options.phase` means.
- A coding agent using the `publish-setup` skill to install the correct workflow.

## Requirements

- Add a first-class Release Workflows guide to the website.
- The Release Workflows guide must explain:
  - when to use Direct Release
  - when to use Split CI Release
  - exact command mapping
  - what Prepare for CI publish does
  - what Publish prepared release does
  - that Fully automated CI is not covered today
  - that PR-based approval belongs to future `pubm-actions` work
- Update the sidebar so Release Workflows is discoverable near Quick Start and Configuration.
- Narrow CI/CD docs to CI setup: generated workflow, secrets, GitHub Actions examples, snapshot releases, release assets, and CI pitfalls.
- Narrow CLI reference docs to syntax, options, and command behavior summaries, linking to Release Workflows for conceptual guidance.
- Keep README workflow content short: a decision table or short section that points to the detailed docs.
- Update plugin skill docs so setup asks for Direct Release or Split CI Release, with no supported Fully automated CI option.
- Keep `GITHUB_TOKEN` visible in CI examples when GitHub Releases or release assets are created.
- Fix or avoid wording that implies `pubm --phase prepare` is only a credential check.
- Fix or avoid wording that implies `pubm --phase publish` performs versioning or tag creation.
- Preserve existing code behavior and existing CLI option names.

## Interfaces And Contracts

- Website route:
  - `guides/release-workflows`
  - locale copies under `ko`, `zh-cn`, `fr`, `de`, and `es`
- Public commands in docs:
  - `pubm`
  - `pubm --phase prepare`
  - `pubm --phase publish`
- Public workflow labels:
  - Direct Release
  - Split CI Release
  - Prepare for CI publish
  - Publish prepared release
- Skill-side workflow options:
  - Direct Release
  - Split CI Release
- Unsupported current workflow label:
  - Fully automated CI, only as a short non-supported note when needed

## Constraints

- Documentation must not contradict the current code interface.
- `--phase` remains the public option name in docs.
- `phase` must not appear as a `pubm.config.ts` setting.
- No docs should recommend `--create-pr` or `createPr` as the current release workflow direction.
- All six website locales must keep the same new page path.
- User-facing prose should stay direct and avoid filler.
- Existing uncommitted implementation and doc edits in the worktree must not be reverted.

## Acceptance Criteria

- A Release Workflows website page exists for English, Korean, Chinese, French, German, and Spanish docs.
- The sidebar includes Release Workflows.
- README files point users to the two supported workflows without presenting Fully automated CI as supported.
- CI/CD guides focus on CI execution and link to Release Workflows for workflow choice.
- CLI references describe `--phase` as a Split CI Release phase selector and link to Release Workflows.
- Plugin setup docs ask the user to choose between Direct Release and Split CI Release only.
- Searches do not find Fully automated CI presented as a supported workflow in current user docs.
- Searches do not find Option C as a supported skill workflow choice.
- Searches do not find `phase` documented as a project config field.
- Documentation checks pass, or any failure is unrelated and reported with evidence.

## Risks

- Duplicated wording can drift between the website and plugin skill docs.
- Localized pages can fall out of structural parity if only English is edited.
- CI/CD docs can become too thin if workflow selection content is removed without leaving practical YAML and secrets guidance.
- References to `createPr` may still exist in configuration schema docs because code support has not been removed yet; those must not be framed as the new release workflow.
- Docs can overstate future `pubm-actions` behavior before it exists.

## Assumptions

- The English website docs are the source of truth for translated website docs.
- The README is an entry point, not the canonical workflow guide.
- Plugin skill docs can repeat short command mappings because agents need operational instructions.
- It is acceptable to mention Fully automated CI only as unsupported current scope.

## Open Questions

- None for this documentation pass.
