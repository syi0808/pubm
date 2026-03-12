# Path Portability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove slash-format assumptions from the path-sensitive core tests and keep runtime path handling based on `node:path`.

**Architecture:** Keep runtime path construction native by continuing to use `node:path` for filesystem paths, and move the failing checks to structural path assertions instead of raw string suffixes. The implementation should not need Windows-specific branches; the tests should follow the same path contract as production code.

**Tech Stack:** TypeScript, Vitest, Bun, Node built-in `path`

---

## Chunk 1: Reproduce And Lock In The Failure

### Task 1: Add OS-neutral failing expectations for the Windows-sensitive tests

**Files:**
- Modify: `packages/core/tests/unit/tasks/required-missing-information.test.ts`
- Modify: `packages/core/tests/unit/utils/gh-secrets-sync-state.test.ts`

- [ ] **Step 1: Rewrite the test fixtures to use `node:path`**

Update the test helpers so mocked file-path matching and expected persisted paths are derived with `path.join`, `path.dirname`, `path.basename`, or equivalent path APIs instead of hard-coded POSIX suffixes.

- [ ] **Step 2: Run the targeted tests to verify RED or capture the current failure mode**

Run: `./node_modules/.bin/vitest run packages/core/tests/unit/tasks/required-missing-information.test.ts packages/core/tests/unit/utils/gh-secrets-sync-state.test.ts`

Expected: Either the old Windows-sensitive assertions fail, or the tests expose the remaining implementation mismatch after the fixture rewrite.

## Chunk 2: Minimal Runtime Adjustment

### Task 2: Keep runtime path handling native and minimal

**Files:**
- Modify if needed: `packages/core/src/utils/gh-secrets-sync-state.ts`
- Modify if needed: `packages/core/src/tasks/required-missing-information.ts`
- Test: `packages/core/tests/unit/tasks/required-missing-information.test.ts`
- Test: `packages/core/tests/unit/utils/gh-secrets-sync-state.test.ts`

- [ ] **Step 1: Change runtime code only if the rewritten tests reveal a real contract gap**

If the tests still fail after becoming OS-neutral, make the smallest possible runtime change using `node:path` APIs only. Do not add separator-specific branches.

- [ ] **Step 2: Re-run the targeted tests to verify GREEN**

Run: `./node_modules/.bin/vitest run packages/core/tests/unit/tasks/required-missing-information.test.ts packages/core/tests/unit/utils/gh-secrets-sync-state.test.ts`

Expected: PASS.

## Chunk 3: Verification

### Task 3: Confirm the change is isolated and stable

**Files:**
- Modify if needed: `packages/core/tests/unit/tasks/required-missing-information.test.ts`
- Modify if needed: `packages/core/tests/unit/utils/gh-secrets-sync-state.test.ts`
- Modify if needed: `packages/core/src/utils/gh-secrets-sync-state.ts`
- Modify if needed: `packages/core/src/tasks/required-missing-information.ts`

- [ ] **Step 1: Run `git diff --check`**

Run: `git diff --check`

Expected: PASS with no whitespace errors.

- [ ] **Step 2: Re-run the targeted tests one more time**

Run: `./node_modules/.bin/vitest run packages/core/tests/unit/tasks/required-missing-information.test.ts packages/core/tests/unit/utils/gh-secrets-sync-state.test.ts`

Expected: PASS.
