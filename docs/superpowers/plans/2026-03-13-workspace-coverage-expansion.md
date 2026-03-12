# Workspace Coverage Expansion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real tests and coverage wiring across the workspace so plugin packages are covered and packages with existing thresholds continue to pass those thresholds.

**Architecture:** Stabilize coverage execution first, then add deterministic tests in the most under-covered package (`@pubm/plugin-brew`), then fill targeted gaps in `@pubm/plugin-external-version-sync` and `pubm` sync integration tests. Finish by validating package-level thresholds and the root workspace coverage command with the same package scripts used by CI.

**Tech Stack:** Bun workspaces, Vitest, Istanbul/Vitest coverage provider, Turborepo, TypeScript, mocked `node:child_process`/filesystem/fetch boundaries

---

## Chunk 1: Coverage Wiring Baseline

### Task 1: Make real coverage runnable for every covered package

**Files:**
- Modify: `package.json`
- Modify: `packages/plugins/plugin-external-version-sync/vitest.config.mts`
- Add: `packages/plugins/plugin-brew/vitest.config.mts`
- Add: `packages/plugins/plugin-brew/tests/setup.ts`
- Modify: `.github/workflows/ci.yaml`

- [ ] **Step 1: Add or normalize the workspace coverage provider dependency**

Ensure the root workspace install matches the provider used by package Vitest configs. Keep the provider choice consistent between local and CI coverage runs.

- [ ] **Step 2: Add a Vitest config for `@pubm/plugin-brew`**

Create `packages/plugins/plugin-brew/vitest.config.mts` with the same test file convention used elsewhere and a coverage block like:

```ts
export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["json-summary", "json", "text-summary"],
      reportOnFailure: true,
      include: ["src/**/*.ts"],
    },
    pool: "forks",
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
```

- [ ] **Step 3: Align plugin coverage behavior**

Update `packages/plugins/plugin-external-version-sync/vitest.config.mts` only if needed so its provider/reporters match the chosen workspace coverage model.

- [ ] **Step 4: Replace fake `plugin-brew` coverage in CI with a real coverage step**

Change `.github/workflows/ci.yaml` so the coverage job runs:

```yaml
- name: Coverage: @pubm/plugin-brew
  if: always()
  id: coverage_plugin_brew
  continue-on-error: true
  working-directory: packages/plugins/plugin-brew
  run: bun run coverage
```

and remove the synthetic `coverage-summary.json` / `coverage-final.json` generation for `plugin-brew`.

- [ ] **Step 5: Install dependencies and verify the baseline**

Run: `bun install --frozen-lockfile`

Expected: PASS with the selected coverage provider installed into the workspace.

- [ ] **Step 6: Verify plugin coverage wiring before adding tests**

Run: `cd packages/plugins/plugin-brew && bun run coverage`

Expected: the command starts cleanly and emits coverage output, even if thresholds are not yet enforced for that package.

- [ ] **Step 7: Commit the coverage wiring baseline**

```bash
git add package.json packages/plugins/plugin-external-version-sync/vitest.config.mts packages/plugins/plugin-brew/vitest.config.mts packages/plugins/plugin-brew/tests/setup.ts .github/workflows/ci.yaml
git commit -m "test: wire plugin coverage execution"
```

## Chunk 2: `@pubm/plugin-brew` Unit Coverage

### Task 2: Add failing tests for the pure formula helpers

**Files:**
- Add: `packages/plugins/plugin-brew/tests/unit/formula.test.ts`
- Test: `packages/plugins/plugin-brew/src/formula.ts`

- [ ] **Step 1: Write the failing helper tests**

Cover formula rendering and asset mapping with tests shaped like:

```ts
it("renders placeholders when a platform asset is missing", () => {
  const formula = generateFormula({
    name: "my-tool",
    desc: "CLI",
    homepage: "https://example.com",
    license: "MIT",
    version: "1.2.3",
    assets: [],
  });

  expect(formula).toContain('url "PLACEHOLDER"');
});
```

Also add tests for:
- class-name generation from dashed names
- `updateFormula` replacing only the targeted platform block
- `mapReleaseAssets` filtering unsupported asset names
- `computeSha256FromUrl` success and failed fetch responses

- [ ] **Step 2: Run the formula tests to verify they fail first**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/formula.test.ts`

Expected: FAIL until the test harness or missing mocks are completed.

- [ ] **Step 3: Add the minimum setup or mocks needed for the current code to pass**

Keep production changes minimal. Prefer test-side `fetch` stubs and fixture strings over changing source behavior.

- [ ] **Step 4: Re-run the formula tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/formula.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the helper coverage**

```bash
git add packages/plugins/plugin-brew/tests/unit/formula.test.ts
git commit -m "test: cover brew formula helpers"
```

### Task 3: Add failing tests for git identity handling

**Files:**
- Add: `packages/plugins/plugin-brew/tests/unit/git-identity.test.ts`
- Test: `packages/plugins/plugin-brew/src/git-identity.ts`

- [ ] **Step 1: Write the failing identity tests**

Mock `execSync` and cover:
- existing `user.name` and `user.email`
- missing `user.name`
- missing `user.email`
- cwd-aware invocation

- [ ] **Step 2: Run the identity tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/git-identity.test.ts`

Expected: FAIL until the mocks match the module import shape.

- [ ] **Step 3: Adjust only the tests or tiny seams needed to observe behavior**

If import timing makes mocking difficult, use `vi.mock` before importing the module under test. Avoid refactoring production code unless direct observation is impossible.

- [ ] **Step 4: Re-run the identity tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/git-identity.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the identity coverage**

```bash
git add packages/plugins/plugin-brew/tests/unit/git-identity.test.ts
git commit -m "test: cover brew git identity setup"
```

### Task 4: Add failing tests for `brewTap` command and hook flows

**Files:**
- Add: `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts`
- Test: `packages/plugins/plugin-brew/src/brew-tap.ts`

- [ ] **Step 1: Write the failing `brewTap` tests**

Cover these scenarios by constructing the plugin and invoking the generated command/hook functions directly:
- `brew init` writes a formula from `package.json`
- `afterRelease` updates an existing formula file
- same-repo flow commits and pushes successfully
- same-repo flow falls back to branch creation and PR when `git push` fails
- external tap repo flow clones the repo and writes to `Formula/<file>`

Use module mocks for `node:child_process`, `node:fs`, `node:path`, and `./git-identity.js` as needed.

- [ ] **Step 2: Run the `brewTap` tests to verify they fail first**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-tap.test.ts`

Expected: FAIL before the mocks and assertions are complete.

- [ ] **Step 3: Add the smallest production seam only if direct mocking is blocked**

Allowed examples:
- extracting a tiny internal helper for locating the brew command handler
- separating command creation from side-effect execution

Do not rewrite the plugin architecture.

- [ ] **Step 4: Re-run the `brewTap` tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-tap.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the `brewTap` coverage**

```bash
git add packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts packages/plugins/plugin-brew/src/brew-tap.ts
git commit -m "test: cover brew tap plugin flows"
```

### Task 5: Add failing tests for `brewCore` command and hook flows

**Files:**
- Add: `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts`
- Test: `packages/plugins/plugin-brew/src/brew-core.ts`

- [ ] **Step 1: Write the failing `brewCore` tests**

Cover:
- `init-core` formula generation from local `package.json`
- ignored fork failure
- username discovery via `gh api user --jq .login`
- formula update when a file exists in the cloned fork
- formula generation when no existing formula is present
- branch creation, push, and PR creation commands

- [ ] **Step 2: Run the `brewCore` tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-core.test.ts`

Expected: FAIL before mocks and assertions fully match the command sequence.

- [ ] **Step 3: Add only the minimal seams needed for deterministic tests**

Prefer checking issued command strings and file writes over deep behavioral rewrites.

- [ ] **Step 4: Re-run the `brewCore` tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run tests/unit/brew-core.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the `brewCore` coverage**

```bash
git add packages/plugins/plugin-brew/tests/unit/brew-core.test.ts packages/plugins/plugin-brew/src/brew-core.ts
git commit -m "test: cover brew core release flows"
```

## Chunk 3: `external-version-sync` And `pubm` Sync Coverage

### Task 6: Fill remaining `external-version-sync` branches

**Files:**
- Modify: `packages/plugins/plugin-external-version-sync/tests/unit/types.test.ts`
- Modify: `packages/plugins/plugin-external-version-sync/tests/unit/sync.test.ts`
- Modify: `packages/plugins/plugin-external-version-sync/tests/unit/plugin.test.ts`

- [ ] **Step 1: Add failing type-guard and branch tests**

Add tests for:
- `isJsonTarget` returning true/false
- `isRegexTarget` returning true/false
- regex targets that do not change content
- relative file paths resolved from `process.cwd()`
- aggregated error messages that include each failing target path

- [ ] **Step 2: Run the package unit tests**

Run: `cd packages/plugins/plugin-external-version-sync && bun vitest --run tests/unit`

Expected: FAIL before the new expectations are satisfied.

- [ ] **Step 3: Make minimal source changes only if a branch is truly unreachable**

Prefer test additions. Change production code only if the current structure makes a legitimate branch impossible to verify.

- [ ] **Step 4: Re-run the package unit tests**

Run: `cd packages/plugins/plugin-external-version-sync && bun vitest --run tests/unit`

Expected: PASS.

- [ ] **Step 5: Commit the branch coverage additions**

```bash
git add packages/plugins/plugin-external-version-sync/tests/unit/types.test.ts packages/plugins/plugin-external-version-sync/tests/unit/sync.test.ts packages/plugins/plugin-external-version-sync/tests/unit/plugin.test.ts
git commit -m "test: expand external version sync coverage"
```

### Task 7: Expand `pubm sync` discovery integration coverage

**Files:**
- Modify: `packages/pubm/tests/unit/commands/sync.test.ts`
- Modify: `packages/pubm/tests/e2e/sync-discover.test.ts`

- [ ] **Step 1: Add failing unit and e2e sync tests**

Target cases that improve realistic integration coverage:
- multiple discoverable references in one workspace
- nested JSON and text references reported together
- skipped directories stay excluded when other valid references exist
- config suggestion output includes the discovered file/path pairings users need for `versionSync`

- [ ] **Step 2: Run the focused sync tests**

Run:

```bash
cd packages/pubm && bun vitest --run tests/unit/commands/sync.test.ts tests/e2e/sync-discover.test.ts
```

Expected: FAIL before the new expectations or fixtures are complete.

- [ ] **Step 3: Make the minimum implementation change only if the tests reveal a genuine gap**

Stay inside `sync` discovery/printing behavior. Do not broaden this into unrelated CLI refactors.

- [ ] **Step 4: Re-run the focused sync tests**

Run:

```bash
cd packages/pubm && bun vitest --run tests/unit/commands/sync.test.ts tests/e2e/sync-discover.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the sync coverage additions**

```bash
git add packages/pubm/tests/unit/commands/sync.test.ts packages/pubm/tests/e2e/sync-discover.test.ts packages/pubm/src/commands/sync.ts
git commit -m "test: improve sync discovery coverage"
```

## Chunk 4: Threshold Validation And Workspace Coverage

### Task 8: Close any remaining threshold gaps in threshold-enforced packages

**Files:**
- Modify only the specific files identified by coverage reports in:
  - `packages/core/tests/**`
  - `packages/pubm/tests/**`

- [ ] **Step 1: Run package coverage reports**

Run:

```bash
cd packages/plugins/plugin-brew && bun run coverage
cd packages/plugins/plugin-external-version-sync && bun run coverage
cd packages/core && bun run coverage
cd packages/pubm && bun run coverage
```

Expected: identify any remaining files or branches below threshold, especially in `packages/core` and `packages/pubm`.

- [ ] **Step 2: Add one failing test for the worst uncovered branch**

Use the coverage report to pick the highest-impact missing branch first. Add a focused test in the owning package before changing production code.

- [ ] **Step 3: Re-run only the affected package coverage**

Run the specific package `bun run coverage` command again.

Expected: the targeted threshold deficit improves or disappears.

- [ ] **Step 4: Repeat until `core` and `pubm` exceed thresholds**

Keep each iteration small and report-driven.

- [ ] **Step 5: Commit the threshold-closing tests**

```bash
git add packages/core/tests packages/pubm/tests
git commit -m "test: close remaining coverage gaps"
```

### Task 9: Validate root coverage and final repo health

**Files:**
- Modify only if verification exposes a real issue:
  - `package.json`
  - `.github/workflows/ci.yaml`
  - any directly implicated test/config file

- [ ] **Step 1: Run the root workspace coverage command**

Run: `bun run coverage`

Expected: PASS from the workspace root with package coverage jobs completing successfully.

- [ ] **Step 2: Run the root workspace test command**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 3: Check for formatting or whitespace issues**

Run: `git diff --check`

Expected: PASS with no output.

- [ ] **Step 4: Verify the workflow YAML still parses**

Run: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yaml")'`

Expected: PASS.

- [ ] **Step 5: Commit any verification-driven fixes**

```bash
git add package.json .github/workflows/ci.yaml packages/plugins/plugin-brew packages/plugins/plugin-external-version-sync packages/pubm packages/core
git commit -m "test: finalize workspace coverage expansion"
```
