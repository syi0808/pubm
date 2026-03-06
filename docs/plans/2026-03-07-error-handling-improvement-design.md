# Error Handling Improvement Design

## Overview

Comprehensive error handling sweep across the pubm publish pipeline. Addresses 43 identified gaps including logic bugs, silent failures, infinite loops, rollback instability, and generic error messages.

## Strategy

- **Recovery model**: Semi-automatic — attempt auto-recovery where possible (e.g., `npm login`), fall back to actionable guidance
- **Retry policy**: Fixed 3 attempts for user-input loops (OTP, JSR token)
- **Error language**: English (matching existing codebase)
- **Approach**: Category-by-category in 6 phases

---

## Phase 1: Logic Bug Fixes

### 1-1. `prerequisites-check.ts` — `cleanWorkingTree` flag

`ctx.cleanWorkingTree = true` is set unconditionally outside the dirty-tree conditional block. When the working tree is dirty and the user skips, the flag is still set to `true`.

**Fix**: Move assignment into the correct branch so it only sets `true` when the tree is actually clean.

### 1-2. `package-name.ts` — `getScopeAndName` returns undefined

When regex match fails, returns `["undefined", "undefined"]` as strings, causing downstream API calls with invalid values.

**Fix**: Throw an error when the match fails.

### 1-3. `git.ts` — Wrong error message in `tags()`

Copy-paste error: `tags()` failure message says "Failed to run `git config --get user.name`".

**Fix**: Correct to "Failed to run `git tag -l`".

### 1-4. `crates.ts` — `isPackageNameAvailable` returns true on network error

Network errors are treated as "name available", leading to publish-time collisions.

**Fix**: Throw the error instead of returning `true`.

### 1-5. `cli.ts` — Missing exit code

Error in the main action handler doesn't set `process.exitCode`, so CI treats failures as success.

**Fix**: Add `process.exitCode = 1` in the catch block.

---

## Phase 2: Rollback Stability

### 2-1. `rollback.ts` — `Promise.all` → `Promise.allSettled`

One failing rollback aborts all remaining rollbacks, risking partial state corruption.

**Fix**: Use `Promise.allSettled` and report which rollbacks succeeded/failed.

### 2-2. `runner.ts` — Rollback callback error handling

Version bump task rollback calls `git.deleteTag()`, `git.reset()`, etc. without try-catch. A throw in any one aborts the rest.

**Fix**: Wrap each rollback callback in try-catch, continue on failure.

### 2-3. Rollback result reporting

After rollback execution, report success/failure per operation. On partial failure, list items requiring manual recovery.

---

## Phase 3: Infinite Loop Prevention

### 3-1. `jsr.ts` — JSR token input loop

`while (true)` with no exit condition. If JSR API is down, loops forever showing "invalid token".

**Fix**: Max 3 attempts. Show remaining attempts count. Throw after exhaustion.

### 3-2. `npm.ts` — OTP input loop

Same infinite loop pattern for 2FA code entry.

**Fix**: Max 3 attempts. Throw "OTP verification failed after 3 attempts".

---

## Phase 4: Auto-Recovery Logic

### 4-1. `required-conditions-check.ts` — Auto npm login

On `npm whoami` failure:
- **TTY**: Spawn `npm login` interactively, then re-verify
- **CI**: Show actionable message: "Set NODE_AUTH_TOKEN in your CI environment"

### 4-2. `jsr.ts` — Distinguish API errors from token errors

Replace empty `catch {}` with error type analysis:
- Network/API error → "JSR API is unreachable. Check your network connection."
- 401/auth error → "Invalid token. Please try again." with re-prompt

### 4-3. `crates.ts` — Cargo login guidance

Verify actual permissions with `cargo owner --list`. On failure, guide user to run `cargo login`.

### 4-4. `npm.ts` — CI token error improvement

On missing `NODE_AUTH_TOKEN`, provide registry-specific setup instructions (e.g., GitHub Actions secrets).

---

## Phase 5: Error Message Improvement

### 5-1. `registry/npm.ts` — Publish error classification

Classify errors beyond just `EOTP`: rate-limit, network timeout, 403 forbidden.

### 5-2. `registry/jsr.ts` — API response error messages

Parse response body on non-2xx and include API-provided error details.

### 5-3. `registry/crates.ts` — 404 vs server error

Distinguish: 404 → "Crate not found", 5xx → "crates.io API error", network → "Cannot reach crates.io".

### 5-4. `required-conditions-check.ts` — Registry ping classification

Distinguish timeout vs server error vs DNS failure.

### 5-5. `runner.ts` — Test/build script failure context

Wrap exec errors: "Script '{name}' failed with exit code {code}".

### 5-6. `utils/package.ts` — File write error context

Wrap writeFile errors: "Failed to write {filename}: {error}".

---

## Phase 6: Silent Failure Removal

### 6-1. `db.ts` — Token read failure distinction

- File not found → return `null`
- Decryption failure → warn log + return `null` (triggers re-prompt)
- Other errors → throw

### 6-2. `db.ts` — Directory/file write failures

Throw on `mkdirSync`/`writeFileSync` failure with context message.

### 6-3. `jsr.ts:67` — Remove empty catch block

Replace with error type analysis from Phase 4-2.

### 6-4. `registry/npm.ts` — JSON parse failures

Wrap `JSON.parse()` in try-catch: "Unexpected response from npm registry".

### 6-5. `registry/jsr.ts` — Disambiguate null returns

- Not found → return `null`
- API error → throw

### 6-6. `utils/package-manager.ts` — Silent npm fallback

Log warning: "No lock file found, defaulting to npm".
