# CI Platform-Filtered Build And Package Coverage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update GitHub Actions CI so each test matrix job only builds its matching pubm platform package and the PR coverage output shows separate blocks for each package.

**Architecture:** Keep the change inside `.github/workflows/ci.yaml` plus the package Vitest configs. Replace workspace-wide build and coverage commands with explicit Turbo filters and package-scoped coverage/reporting steps, move the coverage provider and reporters into each package's Vitest config so `bun run coverage` is the canonical path, and synthesize an empty coverage payload for `@pubm/plugin-brew` so it appears in the same PR report stream.

**Tech Stack:** GitHub Actions, Bun, Turborepo, Vitest coverage with Istanbul, `davelosert/vitest-coverage-report-action@v2`

---

## Chunk 1: Matrix-Scoped Builds

### Task 1: Replace the test matrix with explicit platform metadata

**Files:**
- Modify: `package.json`
- Modify: `packages/core/vitest.config.mts`
- Modify: `packages/pubm/vitest.config.mts`
- Modify: `packages/plugins/plugin-external-version-sync/vitest.config.mts`
- Modify: `.github/workflows/ci.yaml`

- [ ] **Step 1: Update the test matrix to use `include` entries**

Replace the existing `os` array with explicit entries that pair the runner with the platform package:

```yaml
strategy:
  matrix:
    include:
      - os: ubuntu-latest
        platform_package: "@pubm/linux-x64"
      - os: macos-latest
        platform_package: "@pubm/darwin-arm64"
      - os: windows-latest
        platform_package: "@pubm/windows-x64"
  fail-fast: false
```

- [ ] **Step 2: Replace the root build command with a filtered Turbo build**

Change the test job build step to a filtered Turbo invocation that only builds the shared buildable packages plus the matrix-specific platform package:

```yaml
- run: >
    bunx turbo run build
    --filter=@pubm/core
    --filter=@pubm/plugin-brew
    --filter=@pubm/plugin-external-version-sync
    --filter=${{ matrix.platform_package }}
```

- [ ] **Step 3: Verify the Linux-target filtered build succeeds**

Run: `bunx turbo run build --filter=@pubm/core --filter=@pubm/plugin-brew --filter=@pubm/plugin-external-version-sync --filter=@pubm/linux-x64`

Expected: PASS with build output for the shared packages and `@pubm/linux-x64`, without attempting every other platform package.

- [ ] **Step 4: Verify the Windows-target filtered build succeeds**

Run: `bunx turbo run build --filter=@pubm/core --filter=@pubm/plugin-brew --filter=@pubm/plugin-external-version-sync --filter=@pubm/windows-x64`

Expected: PASS with build output for `@pubm/windows-x64` and no unrelated darwin/linux-arm64 package builds.

- [ ] **Step 5: Commit the matrix/build filtering change**

```bash
git add .github/workflows/ci.yaml
git commit -m "ci: scope test builds to matrix platform"
```

## Chunk 2: Package-Scoped Coverage Reporting

### Task 2: Replace the root coverage run with package-specific coverage generation

**Files:**
- Modify: `.github/workflows/ci.yaml`

- [ ] **Step 1: Replace the V8 coverage dependency with the Istanbul package**

Update the root dev dependency list so Vitest loads Istanbul support through the workspace install:

```json
"@vitest/coverage-istanbul": "^4.0.18"
```

and remove:

```json
"@vitest/coverage-v8": "^4.0.18"
```

- [ ] **Step 2: Move the coverage provider and reporters into package Vitest configs**

Update the package Vitest configs that own coverage so they define:

- `provider: "istanbul"`
- reporters for `json-summary`, `json`, and `text-summary`
- `reportOnFailure: true`
- existing include/exclude/threshold settings preserved

Add the same coverage reporter setup to `packages/plugins/plugin-external-version-sync/vitest.config.mts`, which currently has no explicit coverage block.

The result should make plain `bun run coverage` produce the report files expected by CI.

- [ ] **Step 3: Simplify the coverage job to use Bun package commands**

Remove the Node 24 setup and direct `node "$VITEST_BIN"` invocations.

Add separate steps that execute coverage from each package directory:

```yaml
- name: Coverage: @pubm/core
  working-directory: packages/core
  run: bun run coverage

- name: Coverage: pubm
  working-directory: packages/pubm
  run: bun run coverage

- name: Coverage: @pubm/plugin-external-version-sync
  working-directory: packages/plugins/plugin-external-version-sync
  run: bun run coverage
```

- [ ] **Step 4: Add a synthetic empty coverage payload for `@pubm/plugin-brew`**

Create the expected files inside `packages/plugins/plugin-brew/coverage/` so the reporting action can publish an explicit no-tests section for that package.

Use a shell step that creates:

- `coverage-summary.json`
- `coverage-final.json`

The JSON payload should represent zero totals rather than fabricated covered lines.

- [ ] **Step 5: Report each package coverage block with a unique name**

Invoke `davelosert/vitest-coverage-report-action@v2` once per package, setting:

- a distinct `name`
- the package-specific `json-summary-path`
- the package-specific `file-coverage-mode` / `json-summary-compare-path` inputs only if required by the chosen action contract

Keep all report steps in the same job so GitHub produces one PR comment/check with separate named sections.

- [ ] **Step 6: Reinstall dependencies and verify real coverage outputs exist**

Run:

```bash
bun install --frozen-lockfile
cd packages/core && bun run coverage
cd packages/pubm && bun run coverage
cd packages/plugins/plugin-external-version-sync && bun run coverage
```

Expected: Each package writes `coverage/coverage-summary.json` and `coverage/coverage-final.json`.

- [ ] **Step 7: Verify the synthetic `plugin-brew` payload exists**

Run: `ls packages/plugins/plugin-brew/coverage`

Expected: `coverage-summary.json` and `coverage-final.json` are present.

- [ ] **Step 8: Commit the coverage job update**

```bash
git add .github/workflows/ci.yaml
git commit -m "ci: split coverage reporting by package"
```

## Chunk 3: Final Validation

### Task 3: Validate the updated workflow behavior locally

**Files:**
- Modify: `.github/workflows/ci.yaml` (if validation reveals a workflow issue)

- [ ] **Step 1: Run the full local test command once after the workflow changes**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 2: Parse the workflow YAML**

Run: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yaml")'`

Expected: PASS with no syntax error output.

- [ ] **Step 3: Check the diff for whitespace or merge issues**

Run: `git diff --check`

Expected: PASS with no output.

- [ ] **Step 4: Commit any validation-driven fixes**

```bash
git add .github/workflows/ci.yaml
git commit -m "ci: finalize workflow validation fixes"
```
