# JS Lockfile Sync on Version Bump

**Date:** 2026-03-23
**Status:** Draft

## Problem

When pubm bumps versions in a JS monorepo, the root lock file (and any workspace-level lock files) become stale. `RustEcosystem` already implements `syncLockfile()` via `cargo update --package <name>`, but `JsEcosystem` has no implementation — it inherits the base class's `undefined` return.

The infrastructure is already in place: `writeVersionsForEcosystem()` Phase 3 calls `eco.syncLockfile()` and stages returned paths. Only the JS implementation is missing.

## Design

### 1. `JsEcosystem.syncLockfile()`

Implement `syncLockfile()` following the same pattern as `RustEcosystem`:

1. **Find lock file** — walk from `this.packagePath` upward toward filesystem root, checking for known JS lock files (`bun.lock`, `bun.lockb`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`).
   - Return the first match. In JS monorepos, the first lock file found going upward is the workspace root's lock file. Nested lock files below a workspace root indicate a separate project boundary, not a workspace member — so ascending to the first hit is correct.
2. **Determine package manager** — derive from which lock file was found.
3. **Run lock-only install** — execute the appropriate install command in the lock file's directory.
4. **Return lock file path** — for git staging by the existing Phase 3 flow.

### 2. Package Manager Install Commands

| Package Manager | Lock File(s) | Command | Notes |
|---|---|---|---|
| bun | `bun.lock`, `bun.lockb` | `bun install` | No lock-only option; also updates `node_modules` (not committed) |
| npm | `npm-shrinkwrap.json`, `package-lock.json` | `npm install --package-lock-only` | Lock only, no node_modules. `npm-shrinkwrap.json` takes precedence per npm docs |
| pnpm | `pnpm-lock.yaml` | `pnpm install --lockfile-only` | Lock only, no node_modules |
| yarn v2+ | `yarn.lock` | `yarn install --mode update-lockfile` | Berry lock-only mode |
| yarn v1 | `yarn.lock` | `yarn install` | No lock-only option; full install required |

**Yarn version detection:** check for `.yarnrc.yml` in the lock file's directory (present = v2+, absent = v1). Note: Yarn Berry can resolve `.yarnrc.yml` from parent directories, but in practice it colocates with `yarn.lock` at the workspace root. If this heuristic proves insufficient, fall back to `yarn --version`.

### 3. Configuration

Add `lockfileSync` option to `PubmConfig`:

```ts
lockfileSync?: "required" | "optional" | "skip"
```

- **`"optional"`** (default): sync failure emits a warning, publish continues.
- **`"required"`**: sync failure throws, triggering pipeline abort and rollback.
- **`"skip"`**: `syncLockfile()` returns `undefined` immediately without attempting sync.

### 4. Error Handling

```
syncLockfile(lockfileSync) called
  ├─ lockfileSync === "skip" → return undefined
  ├─ No lock file found → return undefined
  └─ Lock file found → run install command
       ├─ Success → return lock file path
       └─ Failure
            ├─ lockfileSync === "optional" → warn + return undefined
            └─ lockfileSync === "required" → throw Error
```

### 5. Signature Changes

`Ecosystem.syncLockfile()` gains a parameter for the sync mode:

```ts
async syncLockfile(mode?: "required" | "optional" | "skip"): Promise<string | undefined>
```

`writeVersionsForEcosystem()` gains a `lockfileSync` parameter and passes it to each `syncLockfile()` call:

```ts
export async function writeVersionsForEcosystem(
  ecosystems: { eco: Ecosystem; pkg: ResolvedPackageConfig }[],
  versions: Map<string, string>,
  lockfileSync?: "required" | "optional" | "skip",
): Promise<string[]>
```

**Call sites to update:**
- `packages/core/src/tasks/runner.ts` — pass `ctx.config.lockfileSync` to `writeVersionsForEcosystem()`
- `packages/pubm/src/commands/version-cmd.ts` — pass config's `lockfileSync` (or default `"optional"`)

`RustEcosystem.syncLockfile()` is updated to accept the parameter and respect `"skip"` / error handling behavior.

### 6. Phase 3 Deduplication

In a monorepo, multiple `JsEcosystem` instances share the same root lock file. Phase 3 must deduplicate to avoid running install N times:

```ts
// Phase 3: Sync lockfiles (deduplicated)
const syncedLockfiles = new Set<string>();
for (const { eco } of ecosystems) {
  const lockfilePath = await eco.syncLockfile(lockfileSync);
  if (lockfilePath && !syncedLockfiles.has(lockfilePath)) {
    syncedLockfiles.add(lockfilePath);
    modifiedFiles.push(lockfilePath);
  }
}
```

This also benefits `RustEcosystem` if multiple Rust crates share a `Cargo.lock`.

## Files to Change

| File | Change |
|---|---|
| `packages/core/src/ecosystem/ecosystem.ts` | Update `syncLockfile()` signature to accept `mode` parameter |
| `packages/core/src/ecosystem/js.ts` | Implement `syncLockfile()` and `findLockfile()` |
| `packages/core/src/ecosystem/rust.ts` | Update `syncLockfile()` to accept `mode` parameter, add skip/error handling |
| `packages/core/src/utils/package-manager.ts` | Export `lockFile` map, add `installCommand()` function with yarn version detection |
| `packages/core/src/config/types.ts` | Add `lockfileSync` to `PubmConfig` |
| `packages/core/src/manifest/write-versions.ts` | Add `lockfileSync` parameter, deduplicate Phase 3 |
| `packages/core/src/tasks/runner.ts` | Pass `ctx.config.lockfileSync` to `writeVersionsForEcosystem()` |
| `packages/pubm/src/commands/version-cmd.ts` | Pass `lockfileSync` to `writeVersionsForEcosystem()` |
| Tests | Unit tests for each changed module |

## Out of Scope

- Handling multiple lock files from different package managers in the same project
- Nested workspace lock file aggregation (see design note in Section 1)
