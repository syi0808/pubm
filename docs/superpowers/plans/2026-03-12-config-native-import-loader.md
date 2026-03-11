# Config Native Import Loader Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `loadConfig()` try native `import()` first, then fall back to bundled execution, with `vm` reserved for bundled CJS recovery.

**Architecture:** `packages/core/src/config/loader.ts` will expose smaller helpers for each execution stage so tests can verify native loading, bundled import fallback, and VM execution independently. The main loader will orchestrate the stages and preserve failure context across retries.

**Tech Stack:** Bun, TypeScript, Vitest, `node:vm`, `node:module`

---

## Chunk 1: Tests First

### Task 1: Add a native-import preference fixture

**Files:**
- Create: `packages/core/tests/fixtures/with-config-native-third-party/package.json`
- Create: `packages/core/tests/fixtures/with-config-native-third-party/pubm.config.ts`
- Modify: `packages/core/tests/unit/config/loader.test.ts`

- [ ] **Step 1: Write the failing test**

Add a fixture that imports a real export from `vitest/config` and stores it in the returned config. Assert that `loadConfig()` returns the real value rather than the shimmed fallback shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest --run packages/core/tests/unit/config/loader.test.ts`
Expected: the new test fails because the current loader still uses the bundled shim path first.

## Chunk 2: VM helper coverage

### Task 2: Add a focused VM execution test

**Files:**
- Modify: `packages/core/tests/unit/config/loader.test.ts`
- Modify: `packages/core/src/config/loader.ts`

- [ ] **Step 1: Write the failing test**

Add a test around a new helper that executes bundled CommonJS code inside `vm` and returns the exported config object.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest --run packages/core/tests/unit/config/loader.test.ts`
Expected: failure because the helper does not exist yet.

## Chunk 3: Implementation

### Task 3: Implement staged loading

**Files:**
- Modify: `packages/core/src/config/loader.ts`

- [ ] **Step 1: Add native import helper**

Import the config file directly with a cache-busting query and return `default ?? namespace`.

- [ ] **Step 2: Parameterize bundled builds**

Allow the existing build path to emit ESM or CJS while preserving optional dependency shims.

- [ ] **Step 3: Add bundled VM executor**

Execute bundled CJS in `node:vm` with an injected CommonJS runtime created from `createRequire(configPath)`.

- [ ] **Step 4: Wire orchestration**

Try native import first, then bundled ESM import, then bundled VM, and surface aggregated errors if all stages fail.

## Chunk 4: Verification

### Task 4: Run focused verification

**Files:**
- Modify: none

- [ ] **Step 1: Run unit tests**

Run: `bun vitest --run packages/core/tests/unit/config/loader.test.ts`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: PASS
