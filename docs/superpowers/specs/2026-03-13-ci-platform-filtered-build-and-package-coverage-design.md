# CI Platform-Filtered Build And Package Coverage Design

## Goal

Adjust the GitHub Actions CI workflow so the `test` matrix only builds the platform-specific pubm binary package relevant to each matrix entry, while coverage reporting is generated and published separately for each package in a single PR coverage comment/check.

## Current Problems

The current [`ci.yaml`](/Users/sung-yein/Workspace/open-source/pubm/.github/workflows/ci.yaml) runs `bun run build` from the workspace root inside every test matrix job. Because the root build script delegates to `turbo run build`, each OS job attempts to build every platform package, not just the platform package relevant to that matrix entry.

Coverage is also generated once from the workspace root via `bun run coverage`, so the PR report is aggregated across packages and does not show package-level coverage blocks.

## Constraints

- Keep the implementation small and focused on the existing CI workflow.
- Preserve the existing lint job behavior.
- Preserve multi-OS test coverage for the packages that actually need runtime verification.
- Publish coverage in one PR comment/check while keeping package reports visually separated.
- Include `@pubm/plugin-brew` in the coverage output even though it currently has no tests.

## Approved Approach

### Test Job

Replace the simple OS matrix with an `include` matrix that explicitly pairs each runner with the pubm platform package it should build:

- `ubuntu-latest` -> `@pubm/linux-x64`
- `macos-latest` -> `@pubm/darwin-arm64`
- `windows-latest` -> `@pubm/windows-x64`

The test job should stop calling the workspace-wide `bun run build`. Instead, it should run Turbo with explicit filters so each job builds:

- shared packages needed by tests (`@pubm/core`, `pubm`, plugin packages)
- the matrix-specific platform package only

This keeps the test job aligned with the matrix target and avoids building unrelated platform binaries on every runner.

### Coverage Job

Keep coverage on a single Ubuntu job, but generate coverage package-by-package instead of running the workspace-wide coverage script once.

For each package that should appear in the report:

- run the package coverage command from that package directory
- request reporters that generate the files expected by `davelosert/vitest-coverage-report-action`
- keep each package's coverage output in its own coverage directory

Then invoke `davelosert/vitest-coverage-report-action@v2` once per package with a unique `name`. The action supports consolidating multiple named reports into one PR comment/check, which matches the required output shape.

### No-Test Package Handling

`@pubm/plugin-brew` has no test suite today, but it still needs to appear in the PR coverage report.

The workflow should therefore create a synthetic empty coverage result for that package so the report action can publish a distinct package block without pretending coverage exists. This should be clearly labeled by package name and left without thresholds/config-based pass expectations.

## File Changes

- Modify [`ci.yaml`](/Users/sung-yein/Workspace/open-source/pubm/.github/workflows/ci.yaml) to:
  - change the test matrix shape
  - replace root build commands with filtered Turbo build commands
  - replace the single root coverage run with package-scoped coverage runs
  - add repeated named coverage reporting steps
  - generate a synthetic empty coverage payload for `@pubm/plugin-brew`

No production source packages need behavior changes for this CI fix.

## Validation

Before considering the work complete, verify:

1. The filtered build commands work locally for representative matrix targets.
2. Each covered package emits the expected coverage files.
3. The synthetic `plugin-brew` coverage payload is accepted by the report action inputs.
4. The updated workflow YAML remains valid.

## Notes

This design intentionally keeps package lists explicit inside the workflow. That is slightly more manual than introducing helper scripts, but it keeps the fix narrow and easy to reason about for the immediate CI repair.
