---
title: "Release Workflow Interface"
status: "draft"
created: "2026-05-01 01:24 KST"
spec: "20260501-0124-release-workflow-interface.spec.md"
plan_id: "20260501-0124-release-workflow-interface"
---

# Plan: Release Workflow Interface

## Source Spec

- Spec file: `docs/plans/20260501-0124-release-workflow-interface.spec.md`
- Goals covered:
  - Name the public workflows as `Direct Release` and `Split CI Release`.
  - Keep `--phase prepare|publish` as the Split CI Release interface.
  - Fix workflow selection so explicit `phase` means split workflow regardless of `isCI`.
  - Keep `isCI` for runtime/auth policy only.
  - Keep `phase` out of config and release-pr out of the CLI workflow interface.
- Non-goals preserved:
  - Do not add `mode`, `workflow`, `ci`, or a public release-pr CLI mode.
  - Do not rename the command to `pubm release`.
  - Do not implement `pubm-actions` release-pr in this pass.

## Implementation Strategy

Implement this as a semantic correction and naming cleanup on top of the existing `mode` removal.

The critical code change is small: `DirectReleaseWorkflow` must select `split-ci` whenever `ctx.options.phase` is present, not only when the process is also running in CI. Tests must lock this before implementation because local `pubm --phase prepare` is the case that regressed.

The rest of the work is interface clarity: CLI help, i18n strings, current docs, plugin skill docs, and generated workflow references should describe `phase` as a Split CI Release phase selector. No project config option should be added.

## File And Module Map

- Create:
  - No source files.
  - Add tests only if existing test files cannot express the behavior cleanly.
- Modify:
  - `packages/core/src/workflow/direct-release-workflow.ts`
  - `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`
  - `packages/pubm/tests/contracts/cli/phase-option-contract.test.ts`
  - `packages/pubm/tests/e2e/help.test.ts`
  - `packages/pubm/tests/unit/cli.test.ts`
  - `packages/core/src/i18n/locales/en.json`
  - `packages/core/src/i18n/locales/ko.json`
  - `packages/core/src/i18n/locales/de.json`
  - `packages/core/src/i18n/locales/es.json`
  - `packages/core/src/i18n/locales/fr.json`
  - `packages/core/src/i18n/locales/zh-cn.json`
  - `README.md` and translated README files if they mention phase semantics.
  - `website/src/content/docs/**/guides/ci-cd.mdx`
  - `website/src/content/docs/**/reference/cli.mdx`
  - `website/src/content/docs/**/guides/troubleshooting.mdx` if it describes `--phase`.
  - `plugins/pubm-plugin/skills/publish-setup/SKILL.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/decision-guides.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/internals.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/troubleshooting.md`
  - `.pubm/changesets/phase-only-release-options.md` if the user-facing summary should mention the semantic correction.
- Delete:
  - None for this plan.
- Leave unchanged:
  - `packages/core/src/types/options.ts` except comment wording if needed.
  - `packages/core/src/utils/resolve-phases.ts` unless validation wording needs adjustment.
  - `packages/core/src/config/types.ts`; do not add `phase`.
  - PR-based workflow docs created in `20260501-0115-pr-based-workflow-direction.spec.md`.

## Task Breakdown

### Phase 1: Lock The Workflow Selection Contract

#### Task 1: Add direct workflow unit coverage for local split prepare

**Files**
- Modify: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`

- [ ] Step 1: Add or update a test named close to `runs split prepare preflight whenever phase prepare is explicit`.

```ts
const ctx = createMockContext(versionPlan, { phase: "prepare" });
await workflow.run(ctx, services);
expect(phaseMocks.runCiPreparePreflight).toHaveBeenCalledTimes(1);
expect(phaseMocks.runLocalPreflight).not.toHaveBeenCalled();
```

- [ ] Step 2: Ensure the test simulates the default local environment rather than CI.
  - The existing test file does not mock `std-env`, so it should run with normal local `isCI` behavior.
  - Expected current result before implementation: test fails because `runLocalPreflight` is called.

#### Task 2: Add coverage for Direct Release remaining direct

**Files**
- Modify: `packages/core/tests/unit/workflow/direct-release-workflow.test.ts`

- [ ] Step 1: Add or update a test named close to `runs local preflight for direct release without phase`.

```ts
const ctx = createMockContext(versionPlan);
await workflow.run(ctx, services);
expect(phaseMocks.runLocalPreflight).toHaveBeenCalledTimes(1);
expect(phaseMocks.runCiPreparePreflight).not.toHaveBeenCalled();
```

- [ ] Step 2: Assert release step creation still allows interactive token prompt in Direct Release.
  - Expected factory call:

```ts
expect(operationMocks.createGitHubReleaseOperation)
  .toHaveBeenCalledWith(true, false, true, false);
```

### Phase 2: Correct Workflow Selection

#### Task 3: Change the workflow profile resolver

**Files**
- Modify: `packages/core/src/workflow/direct-release-workflow.ts`

- [ ] Step 1: Change `resolveWorkflowProfile` to use explicit phase as the split selector.

```ts
function resolveWorkflowProfile(ctx: PubmContext): WorkflowReleaseProfile {
  return ctx.options.phase === undefined ? "full" : "split-ci";
}
```

- [ ] Step 2: Review call sites in `describe` and `run`.
  - `profile === "split-ci" && hasPrepare` must now be true for local `--phase prepare`.
  - `profile === "full" && hasPrepare` must remain true for bare `pubm`.
  - `profile === "split-ci" && hasPublish && !hasPrepare` must remain true for `--phase publish`.

- [ ] Step 3: Run focused workflow tests.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/direct-release-workflow.test.ts`
  - Expected: all tests pass.

### Phase 3: Strengthen CLI Contract Coverage

#### Task 4: Capture the public workflow naming in CLI contracts

**Files**
- Modify: `packages/pubm/tests/contracts/cli/phase-option-contract.test.ts`

- [ ] Step 1: Add contract facts or scenario descriptions that distinguish:
  - bare `pubm` as Direct Release
  - `--phase prepare` as Split CI Release prepare
  - `--phase publish` as Split CI Release publish

- [ ] Step 2: Add a local `--phase prepare` scenario if missing.
  - `argv`: `["--phase", "prepare"]` or `["1.2.3", "--phase", "prepare"]`
  - `env.isCI`: `false`
  - Expected:
    - `options.phase` is `"prepare"`
    - required information runs only if version selection still needs it
    - `pubm` receives the context with explicit `phase`

- [ ] Step 3: Keep publish-only contract unchanged.
  - `--phase publish` must seed version plan from manifests.
  - Required missing-information tasks must not run.

#### Task 5: Update help tests for precise wording

**Files**
- Modify: `packages/pubm/tests/e2e/help.test.ts`
- Modify: `packages/pubm/tests/unit/cli.test.ts`

- [ ] Step 1: Assert `--phase` help includes Split CI Release wording.
  - Expected text fragment:

```text
Run one Split CI Release phase
```

- [ ] Step 2: Keep the guard that `--mode` is absent.

### Phase 4: Update CLI Help And Locales

#### Task 6: Update the phase option i18n string

**Files**
- Modify:
  - `packages/core/src/i18n/locales/en.json`
  - `packages/core/src/i18n/locales/ko.json`
  - `packages/core/src/i18n/locales/de.json`
  - `packages/core/src/i18n/locales/es.json`
  - `packages/core/src/i18n/locales/fr.json`
  - `packages/core/src/i18n/locales/zh-cn.json`

- [ ] Step 1: Set English `cli.option.phase` to:

```text
Run one Split CI Release phase: prepare or publish. Omit for Direct Release.
```

- [ ] Step 2: Update translations with the same meaning.
  - Korean should read close to:

```text
분리형 CI 릴리스의 한 단계를 실행합니다: prepare 또는 publish. 생략하면 직접 릴리스를 실행합니다.
```

- [ ] Step 3: Do not change unrelated `mode` strings for versioning, renderer, migration adapters, or package manager commands.

### Phase 5: Update User-Facing Documentation

#### Task 7: Update CLI reference pages

**Files**
- Modify:
  - `website/src/content/docs/reference/cli.mdx`
  - `website/src/content/docs/ko/reference/cli.mdx`
  - `website/src/content/docs/de/reference/cli.mdx`
  - `website/src/content/docs/es/reference/cli.mdx`
  - `website/src/content/docs/fr/reference/cli.mdx`
  - `website/src/content/docs/zh-cn/reference/cli.mdx`

- [ ] Step 1: Rename the conceptual sections or text to use:
  - `Direct Release`
  - `Split CI Release`
  - `Prepare for CI publish`
  - `Publish prepared release`

- [ ] Step 2: Ensure `prepare` says it writes versions, creates tags, pushes release refs, and does not publish packages.

- [ ] Step 3: Ensure `publish` says it reads manifest versions, publishes packages, creates GitHub Releases, and is intended for CI/non-interactive token execution.

#### Task 8: Update CI/CD guide pages

**Files**
- Modify:
  - `website/src/content/docs/guides/ci-cd.mdx`
  - `website/src/content/docs/ko/guides/ci-cd.mdx`
  - `website/src/content/docs/de/guides/ci-cd.mdx`
  - `website/src/content/docs/es/guides/ci-cd.mdx`
  - `website/src/content/docs/fr/guides/ci-cd.mdx`
  - `website/src/content/docs/zh-cn/guides/ci-cd.mdx`

- [ ] Step 1: Present two primary release workflows:
  - Direct Release: `pubm`
  - Split CI Release: `pubm --phase prepare` then CI `pubm --phase publish`

- [ ] Step 2: Do not mention release-pr as a CLI workflow in this section.

- [ ] Step 3: If `createPr` content remains in these pages, coordinate with the separate `createPr` removal plan. For this plan, do not expand PR-based workflow guidance.

#### Task 9: Update README and plugin skill references

**Files**
- Modify:
  - `README.md`
  - `README.ko.md`
  - `README.de.md`
  - `README.es.md`
  - `README.fr.md`
  - `README.zh-cn.md`
  - `plugins/pubm-plugin/skills/publish-setup/SKILL.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/decision-guides.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/internals.md`
  - `plugins/pubm-plugin/skills/publish-setup/references/troubleshooting.md`

- [ ] Step 1: Replace vague `phase` wording with Split CI Release wording.

- [ ] Step 2: Keep generated workflow commands as `pubm --phase publish`.

- [ ] Step 3: Ensure setup guidance says `pubm` for Direct Release and `pubm --phase prepare` / `pubm --phase publish` for Split CI Release.

### Phase 6: Verification And Guardrails

#### Task 10: Run focused tests

**Files**
- No source edits.

- [ ] Step 1: Run workflow unit tests.
  - Command: `cd packages/core && bun vitest --run tests/unit/workflow/direct-release-workflow.test.ts`
  - Expected: pass.

- [ ] Step 2: Run CLI phase contract.
  - Command: `cd packages/pubm && bun vitest --run tests/contracts/cli/phase-option-contract.test.ts`
  - Expected: pass.

- [ ] Step 3: Run CLI help tests.
  - Command: `cd packages/pubm && bun vitest --run tests/e2e/help.test.ts tests/unit/cli.test.ts`
  - Expected: pass.

#### Task 11: Run acceptance searches

**Files**
- No source edits.

- [ ] Step 1: Confirm no old workflow selector is back.
  - Command: `rg -n "pubm --mode|--mode <mode>|Options\\.mode|ReleaseMode|ctx\\.options\\.mode" packages docs website plugins README*.md`
  - Expected: no current user-facing or source matches.

- [ ] Step 2: Confirm no config phase has been introduced.
  - Command: `rg -n "phase\\??:|phase:" packages/core/src/config packages/core/src/options.ts packages/core/src/types/options.ts`
  - Expected: `phase` only appears in runtime `Options`, not config types/defaults.

- [ ] Step 3: Confirm current docs use the chosen names.
  - Command: `rg -n "Direct Release|Split CI Release|Prepare for CI publish|Publish prepared release" README*.md website/src/content/docs plugins/pubm-plugin`
  - Expected: matches in current release docs and plugin skill references.

#### Task 12: Run full verification

**Files**
- No source edits.

- [ ] Step 1: Format.
  - Command: `bun run format`
  - Expected: pass, with any formatting changes reviewed.

- [ ] Step 2: Typecheck.
  - Command: `bun run typecheck`
  - Expected: pass.

- [ ] Step 3: Check.
  - Command: `bun run check`
  - Expected: pass.

- [ ] Step 4: Test.
  - Command: `bun run test`
  - Expected: pass.

- [ ] Step 5: Coverage.
  - Command: `bun run coverage`
  - Expected: pass without lowering thresholds.

## Interfaces, Data Flow, And State

- CLI input `--phase prepare|publish` flows through `packages/pubm/src/cli.ts` into `Options.phase`.
- `resolvePhases` continues to map omitted phase to both phases and explicit phase to a single phase.
- `DirectReleaseWorkflow` maps `Options.phase` to release workflow topology:

```ts
phase omitted -> Direct Release
phase present -> Split CI Release
```

- Runtime environment controls prompt/auth/rendering:

```ts
isCI -> non-interactive assumptions and CI renderer defaults
promptEnabled -> prompt versus token-only auth behavior
phase -> direct versus split workflow topology
```

- No new config state is introduced.

## Edge Cases And Failure Modes

- Local `pubm --phase prepare` must not take the Direct Release local preflight path.
- `pubm --phase publish` outside CI may still be accepted, but because it is a Split CI publish phase it should behave as a prepared publish continuation rather than a direct release.
- Bare `pubm` inside CI remains full release; it should not become Split CI Release unless `phase` is explicit.
- Plugin auth checks must distinguish split workflow or non-interactive runtime as needed, not infer everything from `isCI`.
- Documentation must not imply `prepare` is a read-only credential check.

## Test And Verification Matrix

- Requirement: Explicit `phase` selects Split CI Release.
  - Test or command: `cd packages/core && bun vitest --run tests/unit/workflow/direct-release-workflow.test.ts`
  - Expected result: local `phase: "prepare"` calls `runCiPreparePreflight`, not `runLocalPreflight`.

- Requirement: Bare `pubm` remains Direct Release.
  - Test or command: `cd packages/core && bun vitest --run tests/unit/workflow/direct-release-workflow.test.ts`
  - Expected result: no phase calls `runLocalPreflight` in local interactive environment.

- Requirement: Publish phase reads manifest versions and skips prompts.
  - Test or command: `cd packages/pubm && bun vitest --run tests/contracts/cli/phase-option-contract.test.ts`
  - Expected result: `--phase publish` scenario uses manifest-derived version plan and does not run required missing-information tasks.

- Requirement: CLI help uses public names.
  - Test or command: `cd packages/pubm && bun vitest --run tests/e2e/help.test.ts tests/unit/cli.test.ts`
  - Expected result: help includes Split CI Release wording and omits `--mode`.

- Requirement: No config `phase`.
  - Test or command: `rg -n "phase\\??:|phase:" packages/core/src/config packages/core/src/options.ts packages/core/src/types/options.ts`
  - Expected result: runtime Options only; config files do not expose project-level phase.

- Requirement: Full repo remains healthy.
  - Test or command: `bun run typecheck && bun run check && bun run test && bun run coverage`
  - Expected result: all pass.

## Rollout And Review

- Treat the workflow selection fix as a bug fix within the recent `mode` removal breaking change.
- Review focus:
  - No `isCI` usage in workflow topology selection.
  - `phase` help text is not generic.
  - Local `--phase prepare` is locked by tests.
  - Docs do not present release-pr as a CLI workflow.
  - No config-level `phase` is introduced.
- Changeset:
  - Reuse or amend `.pubm/changesets/phase-only-release-options.md` so it says `--phase` selects Split CI Release phases and bare `pubm` runs Direct Release.
- Commit scope:
  - Keep this separate from `createPr` removal unless the user explicitly asks to combine them.

## Assumptions

- The user has accepted `phase`, `prepare`, and `publish` as public names when paired with clearer labels.
- The implementation branch already removed `mode`.
- `createPr` removal will be handled in a separate implementation plan or follow-up pass.
