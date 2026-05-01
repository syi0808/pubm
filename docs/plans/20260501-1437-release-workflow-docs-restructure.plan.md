---
title: "Release Workflow Docs Restructure"
status: "draft"
created: "2026-05-01 14:37 KST"
spec: "20260501-1437-release-workflow-docs-restructure.spec.md"
plan_id: "20260501-1437-release-workflow-docs-restructure"
---

# Plan: Release Workflow Docs Restructure

## Source Spec

- Spec file: `docs/plans/20260501-1437-release-workflow-docs-restructure.spec.md`
- Goals covered:
  - Add a canonical Release Workflows guide.
  - Keep only Direct Release and Split CI Release as supported current workflows.
  - Move CI implementation details back into CI/CD docs.
  - Keep README and references short.
  - Align plugin skill docs with the same workflow decision.
- Non-goals preserved:
  - No behavior changes.
  - No new CLI or config options.
  - No Fully automated CI support.
  - No release-pr CLI workflow.
  - No code removal for `createPr`.

## Implementation Strategy

Make the website Release Workflows guide the canonical user-facing explanation. Then trim other docs so they either point to that guide or keep only the details that belong to their role.

Work in disjoint file groups so subagents can help without colliding:

- Website English and sidebar: canonical structure and links.
- README and plugin skill docs: setup/operator docs.
- Website locales: translated copies and matching links.
- Review agents: persona feedback for first-time maintainer, CI maintainer, and plugin/agent operator.

## File And Module Map

- Create:
  - `website/src/content/docs/guides/release-workflows.mdx`
  - `website/src/content/docs/ko/guides/release-workflows.mdx`
  - `website/src/content/docs/zh-cn/guides/release-workflows.mdx`
  - `website/src/content/docs/fr/guides/release-workflows.mdx`
  - `website/src/content/docs/de/guides/release-workflows.mdx`
  - `website/src/content/docs/es/guides/release-workflows.mdx`
- Modify:
  - `website/astro.config.mjs`
  - `website/src/content/docs/guides/quick-start.mdx`
  - `website/src/content/docs/guides/ci-cd.mdx`
  - `website/src/content/docs/guides/configuration.mdx`
  - `website/src/content/docs/guides/changesets.mdx`
  - `website/src/content/docs/guides/troubleshooting.mdx`
  - `website/src/content/docs/reference/cli.mdx`
  - `website/src/content/docs/reference/sdk.mdx`
  - `website/src/content/docs/reference/plugins.mdx`
  - Locale equivalents under `website/src/content/docs/{ko,zh-cn,fr,de,es}/`
  - `README.md`
  - `README.ko.md`
  - `README.zh-cn.md`
  - `README.fr.md`
  - `README.de.md`
  - `README.es.md`
  - `plugins/pubm-plugin/skills/publish-setup/SKILL.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/decision-guides.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/internals.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/troubleshooting.md`
  - `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md` only if it currently explains workflow choice rather than plugin API behavior
- Delete:
  - No files.
- Leave unchanged:
  - Source code and tests unless docs checks reveal generated references that must change.
  - Historical migration plans outside this new docs plan.
  - Config schema docs for `createPr` if they only record existing schema support and do not recommend it as the future workflow.

## Task Breakdown

### Phase 1: Canonical Website Docs

#### Task 1: Add Release Workflows guide

**Files**
- Create: `website/src/content/docs/guides/release-workflows.mdx`

- [ ] Write frontmatter with title `Release Workflows` and a description focused on choosing Direct Release or Split CI Release.
- [ ] Add a workflow decision table:
  - Direct Release: command `pubm`, use when one trusted local or controlled job should run the whole release.
  - Split CI Release: commands `pubm --phase prepare` and `pubm --phase publish`, use when local preparation should hand off publishing to CI.
- [ ] Explain Direct Release behavior:
  - validates project and git state
  - runs tests and build unless skipped
  - versions packages
  - publishes packages
  - creates GitHub Releases when enabled
  - rolls back on failure according to existing behavior
- [ ] Explain Prepare for CI publish:
  - collects registry tokens and plugin credentials
  - optionally syncs credentials to GitHub Secrets
  - runs prerequisite and required-condition checks
  - runs tests and build unless skipped
  - consumes changesets when present
  - writes versions, creates release commit and tags, and pushes release refs
  - dry-runs publish tasks
  - does not publish packages
- [ ] Explain Publish prepared release:
  - reads manifest versions
  - publishes packages
  - creates GitHub Releases and uploads release assets when configured
  - expects non-interactive tokens from the environment
  - does not redo versioning, tag creation, or release ref push
- [ ] Add a short unsupported-scope note:
  - Fully automated CI is not covered today.
  - PR approval based workflow belongs to future `pubm-actions` work.
- [ ] Link to CI/CD, CLI reference, troubleshooting, and release assets.

#### Task 2: Add the guide to sidebar

**Files**
- Modify: `website/astro.config.mjs`

- [ ] Add `guides/release-workflows` under Getting Started after Quick Start.
- [ ] Add translated sidebar labels:
  - Korean: `릴리스 워크플로`
  - Chinese: `发布工作流`
  - French: `Workflows de release`
  - German: `Release-Workflows`
  - Spanish: `Flujos de release`

#### Task 3: Narrow English CI/CD docs

**Files**
- Modify: `website/src/content/docs/guides/ci-cd.mdx`

- [ ] Replace the long workflow selection section with a short link to Release Workflows.
- [ ] Keep generated workflow guidance, required environment variables, secret sync, GitHub Actions examples, snapshot releases, common CI pitfalls, and release asset notes.
- [ ] Include `GITHUB_TOKEN` in the main CI token table or an adjacent required-token note.
- [ ] Ensure the release YAML uses `pubm --phase publish`.
- [ ] Avoid presenting Fully automated CI as supported.

#### Task 4: Update English entry and reference pages

**Files**
- Modify:
  - `website/src/content/docs/guides/quick-start.mdx`
  - `website/src/content/docs/guides/configuration.mdx`
  - `website/src/content/docs/guides/changesets.mdx`
  - `website/src/content/docs/guides/troubleshooting.mdx`
  - `website/src/content/docs/reference/cli.mdx`
  - `website/src/content/docs/reference/sdk.mdx`
  - `website/src/content/docs/reference/plugins.mdx`

- [ ] Quick Start: show `pubm` as the simplest path and link to Release Workflows for Split CI Release.
- [ ] Configuration: state that `phase` is runtime CLI/SDK state, not project config. Fix `releaseDraft` wording if it conflicts with current GitHub Release behavior.
- [ ] Changesets: clarify that `pubm --phase publish` assumes prepare already wrote versions.
- [ ] Troubleshooting: route workflow choice questions to Release Workflows and preserve failure recovery steps.
- [ ] CLI Reference: keep syntax and flag behavior. Link to Release Workflows instead of duplicating long semantics.
- [ ] SDK Reference: keep `Options.phase` as runtime workflow phase, not config.
- [ ] Plugins API: describe `ctx.options.phase` only as plugin context, and link to Release Workflows for operator behavior.

### Phase 2: README And Skill Docs

#### Task 5: Trim README workflow guidance

**Files**
- Modify:
  - `README.md`
  - `README.ko.md`
  - `README.zh-cn.md`
  - `README.fr.md`
  - `README.de.md`
  - `README.es.md`

- [ ] Replace duplicated workflow prose with a short `Choose your release path` section.
- [ ] Keep only two rows:
  - Direct Release: `pubm`
  - Split CI Release: `pubm --phase prepare`, then CI `pubm --phase publish`
- [ ] Do not include Fully automated CI as a supported current path.
- [ ] Keep preflight and rollback claims accurate without re-explaining all Split CI details.

#### Task 6: Align publish-setup skill docs

**Files**
- Modify:
  - `plugins/pubm-plugin/skills/publish-setup/SKILL.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/decision-guides.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/internals.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/troubleshooting.md`

- [ ] Make `decision-guides.md` the skill-side canonical choice between Direct Release and Split CI Release.
- [ ] Remove or rewrite any Option C/Fully automated CI guidance as unsupported current scope.
- [ ] Ensure `SKILL.md` asks for release path before generating scripts or workflows.
- [ ] Keep `ci-templates.md` focused on YAML for `pubm --phase publish`.
- [ ] Keep `internals.md` focused on phase semantics and setup mechanics.
- [ ] Keep `troubleshooting.md` focused on recovery and failure diagnosis.

### Phase 3: Locale Sync

#### Task 7: Add localized Release Workflows pages

**Files**
- Create:
  - `website/src/content/docs/ko/guides/release-workflows.mdx`
  - `website/src/content/docs/zh-cn/guides/release-workflows.mdx`
  - `website/src/content/docs/fr/guides/release-workflows.mdx`
  - `website/src/content/docs/de/guides/release-workflows.mdx`
  - `website/src/content/docs/es/guides/release-workflows.mdx`

- [ ] Mirror the English page structure and links.
- [ ] Preserve command names exactly.
- [ ] Translate workflow labels consistently, while keeping the English labels visible when useful.
- [ ] Include the unsupported Fully automated CI note as unsupported current scope, not as a path.

#### Task 8: Sync locale pages touched in English

**Files**
- Modify locale equivalents for quick start, CI/CD, configuration, changesets, troubleshooting, CLI, SDK, and plugin reference pages as needed.

- [ ] Preserve locale file parity.
- [ ] Update links to locale-specific Release Workflows routes.
- [ ] Keep examples and environment variable names identical across locales.
- [ ] Do not introduce locale-only workflow options.

### Phase 4: Reviews And Corrections

#### Task 9: Persona review

**Files**
- No direct ownership. Reviewers report findings against modified docs.

- [ ] First-time maintainer reviewer checks whether the default command and Split CI handoff are easy to choose.
- [ ] CI maintainer reviewer checks token, `GITHUB_TOKEN`, checkout, and `pubm --phase publish` instructions.
- [ ] Plugin/agent operator reviewer checks publish-setup skill docs and plugin API mentions.
- [ ] Apply accepted feedback without changing code behavior.

#### Task 10: Consistency search

**Files**
- No direct ownership.

- [ ] Run:

```bash
rg -n "Fully automated|full CI automation|Option C|--create-pr|createPr|phase.*config|config.*phase" README*.md website/src/content/docs plugins/pubm-plugin/skills
```

- [ ] Expected:
  - Fully automated CI appears only as unsupported current scope, if at all.
  - Option C does not appear as a supported setup option.
  - `createPr` does not appear as a recommended release workflow.
  - `phase` is not documented as project config.

#### Task 11: Locale parity check

**Files**
- No direct ownership.

- [ ] Run:

```bash
find website/src/content/docs -path '*/guides/release-workflows.mdx' -print | sort
```

- [ ] Expected: exactly six files, one for the root English docs and one for each locale directory.

#### Task 12: Documentation build/check

**Files**
- No direct ownership.

- [ ] Run:

```bash
bun run check
```

- [ ] Expected: pass.
- [ ] If check does not include site content validation, also run:

```bash
bun run build:site
```

- [ ] Expected: pass. Any pre-existing or unrelated failure must be recorded with the failing command and error summary.

## Interfaces, Data Flow, And State

- The public docs point users from Quick Start and README to Release Workflows.
- Release Workflows points users to CI/CD for runner setup and to CLI Reference for option syntax.
- CI/CD docs keep the concrete `pubm --phase publish` GitHub Actions commands.
- Plugin skill docs keep operational setup commands and use the same two workflow choices.

## Edge Cases And Failure Modes

- Users may read CLI Reference first. It must be enough to learn that `--phase` is Split CI only and where to read the full model.
- Users may assume CI can run the full release from scratch. The unsupported note must be direct, but it should not advertise future behavior as available.
- Existing `createPr` schema references can remain if they document current config, but must not become the recommended migration direction.
- Localized docs can accidentally link to root English routes. Check links while editing.

## Test And Verification Matrix

- Requirement: Release Workflows exists in all locales.
  - Test or command: `find website/src/content/docs -path '*/guides/release-workflows.mdx' -print | sort`
  - Expected result: six paths.
- Requirement: Fully automated CI is not supported in docs.
  - Test or command: `rg -n "Fully automated|full CI automation|Option C" README*.md website/src/content/docs plugins/pubm-plugin/skills`
  - Expected result: no supported workflow option; only unsupported-scope notes if present.
- Requirement: `phase` is runtime-only.
  - Test or command: `rg -n "phase.*config|config.*phase" website/src/content/docs README*.md plugins/pubm-plugin/skills`
  - Expected result: no claim that `phase` belongs in project config.
- Requirement: `createPr` is not a recommended release workflow.
  - Test or command: `rg -n "--create-pr|createPr" website/src/content/docs README*.md plugins/pubm-plugin/skills`
  - Expected result: schema/reference-only hits are acceptable; recommendation hits are not.
- Requirement: docs compile and format checks pass.
  - Test or command: `bun run check` and `bun run build:site` if needed.
  - Expected result: pass.

## Rollout And Review

- Keep this as a documentation-only change unless verification exposes generated docs tied to code strings.
- Review focus:
  - workflow naming consistency
  - unsupported Fully automated CI handling
  - `GITHUB_TOKEN` visibility
  - no project-config `phase`
  - no new PR-based CLI promise
- Rollback note: reverting docs and sidebar files restores previous navigation without changing release behavior.

## Assumptions

- English docs define structure and command examples.
- Translated docs may keep some English product labels to avoid ambiguity.
- The site uses root docs as English locale and five explicit translated locale directories.
