# Workspace Coverage Expansion Design

## Goal

Raise automated test coverage across the workspace, including plugin packages, while preserving the existing strict thresholds for packages that already enforce them and making the root coverage workflow runnable end-to-end.

## Current Problems

The workspace has uneven test coverage by package.

- [`packages/core`](/Users/sung-yein/Workspace/open-source/pubm/packages/core) and [`packages/pubm`](/Users/sung-yein/Workspace/open-source/pubm/packages/pubm) already enforce strict Vitest thresholds, so any new or newly-included code paths must keep those packages above threshold.
- [`packages/plugins/plugin-external-version-sync`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-external-version-sync) has tests and coverage wiring, but some behavior branches remain lightly exercised.
- [`packages/plugins/plugin-brew`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew) has production code and coverage scripts but no test harness or real coverage generation yet.
- The root [`package.json`](/Users/sung-yein/Workspace/open-source/pubm/package.json) exposes `bun run coverage`, but the current workspace install state does not resolve the configured Istanbul provider consistently, so the root coverage command can fail before any package-level threshold is checked.
- The current CI workflow still treats `plugin-brew` as a synthetic empty-coverage package, which no longer matches the desired state once real tests are added.

## Constraints

- Do not lower existing thresholds in [`packages/core/vitest.config.mts`](/Users/sung-yein/Workspace/open-source/pubm/packages/core/vitest.config.mts) or [`packages/pubm/vitest.config.mts`](/Users/sung-yein/Workspace/open-source/pubm/packages/pubm/vitest.config.mts).
- Keep the implementation focused on coverage infrastructure and tests; avoid unrelated production refactors.
- Prefer deterministic unit and integration tests over networked or shell-dependent end-to-end flows.
- Keep root and CI coverage behavior aligned so local verification and CI use the same package coverage commands.
- Add real coverage for plugin packages rather than hiding them behind synthetic reports.

## Approved Approach

### Coverage Execution Model

First stabilize coverage execution so the workspace can produce package coverage outputs reliably before adding more tests.

- Standardize package coverage configuration around the provider that is actually available to the workspace install and ensure each covered package emits `json-summary`, `json`, and `text-summary`.
- Make `plugin-brew` a first-class covered package with its own Vitest config instead of treating it as an empty placeholder.
- Update CI so `plugin-brew` runs a real `bun run coverage` step and publishes its real report alongside `@pubm/core`, `pubm`, and `@pubm/plugin-external-version-sync`.

This keeps `bun run coverage` as the canonical workspace entry point and prevents a situation where tests improve locally but the root or CI coverage command still fails on configuration or package wiring.

### Package Coverage Strategy

Expand coverage in layers, starting with the largest uncovered production package and then filling integration gaps.

#### `@pubm/plugin-brew`

Add a full Vitest test harness and exercise the package through direct unit and hook invocation tests.

- Cover pure helper logic in [`formula.ts`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew/src/formula.ts), including placeholder rendering, asset mapping, formula updates, and `fetch` failure/success paths.
- Cover [`git-identity.ts`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew/src/git-identity.ts) with `execSync` mocks for both configured and fallback identity flows.
- Cover [`brew-tap.ts`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew/src/brew-tap.ts) by invoking generated command handlers and `afterRelease` hooks with mocked filesystem and child-process behavior for:
  - formula generation
  - formula update
  - same-repo push success
  - push fallback to branch + PR creation
  - separate tap repository clone/update flow
- Cover [`brew-core.ts`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew/src/brew-core.ts) with mocked `gh`/`git` flows for fork, clone, formula update, branch creation, push, and PR creation behavior.

These tests should mock external processes and avoid live GitHub or git interactions.

#### `@pubm/plugin-external-version-sync`

Keep the existing coverage model and fill the remaining branches with targeted tests.

- Add direct tests for both type guards in [`types.ts`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-external-version-sync/src/types.ts).
- Extend plugin and sync tests to cover relative path resolution, mixed target batches, unchanged regex paths, and aggregated multi-error output details.
- Keep testing at the file and hook layer rather than routing through the full CLI for every case.

#### `pubm` Integration Coverage

Use `sync` command tests to cover realistic integration between CLI discovery behavior and the external version sync workflow.

- Add unit tests for discovery edge cases in [`packages/pubm/tests/unit/commands/sync.test.ts`](/Users/sung-yein/Workspace/open-source/pubm/packages/pubm/tests/unit/commands/sync.test.ts).
- Add focused e2e cases in [`packages/pubm/tests/e2e/sync-discover.test.ts`](/Users/sung-yein/Workspace/open-source/pubm/packages/pubm/tests/e2e/sync-discover.test.ts) that validate discoverable version references map cleanly to configuration suggestions.
- Only add more `core` or `pubm` tests if package coverage reports show threshold shortfalls after the plugin and integration work lands.

### CI And Root Verification

Once package coverage is real across the plugin packages:

- remove the synthetic `plugin-brew` coverage artifact generation from [`ci.yaml`](/Users/sung-yein/Workspace/open-source/pubm/.github/workflows/ci.yaml)
- run package-scoped real coverage for `plugin-brew`
- keep coverage report publishing package-by-package
- verify the root `bun run coverage` command succeeds from the workspace root

This preserves package-level coverage visibility while aligning the reported state with actual tests.

## File Changes

- Modify [`package.json`](/Users/sung-yein/Workspace/open-source/pubm/package.json) only if workspace coverage dependency wiring must be corrected.
- Modify [`packages/plugins/plugin-brew/package.json`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew/package.json) only if test script/config references need adjustment.
- Add [`packages/plugins/plugin-brew/vitest.config.mts`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew/vitest.config.mts).
- Add [`packages/plugins/plugin-brew/tests/setup.ts`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew/tests/setup.ts).
- Add focused `plugin-brew` unit tests under [`packages/plugins/plugin-brew/tests/unit`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-brew/tests/unit).
- Modify `plugin-external-version-sync` tests under [`packages/plugins/plugin-external-version-sync/tests`](/Users/sung-yein/Workspace/open-source/pubm/packages/plugins/plugin-external-version-sync/tests).
- Modify `pubm` sync tests under [`packages/pubm/tests/unit/commands`](/Users/sung-yein/Workspace/open-source/pubm/packages/pubm/tests/unit/commands) and [`packages/pubm/tests/e2e`](/Users/sung-yein/Workspace/open-source/pubm/packages/pubm/tests/e2e).
- Modify [`ci.yaml`](/Users/sung-yein/Workspace/open-source/pubm/.github/workflows/ci.yaml) so plugin coverage is real instead of synthetic.

No production refactor is required beyond the smallest changes needed to make code testable where direct mocking is otherwise impossible.

## Validation

Before implementation is considered complete, verify:

1. `bun run test` passes in `packages/plugins/plugin-brew`.
2. `bun run coverage` passes in `packages/plugins/plugin-brew`.
3. `bun run coverage` still passes in `packages/plugins/plugin-external-version-sync`.
4. `bun run coverage` still passes in `packages/core` and `packages/pubm` with existing thresholds intact.
5. Root `bun run coverage` succeeds from the workspace root.
6. The CI workflow YAML remains valid and no longer relies on fake `plugin-brew` coverage output.

## Notes

This design intentionally prefers mocked process boundaries over fully-real git or GitHub flows. The goal is trustworthy and repeatable coverage gains, not brittle coverage inflation through shell-heavy end-to-end tests.
