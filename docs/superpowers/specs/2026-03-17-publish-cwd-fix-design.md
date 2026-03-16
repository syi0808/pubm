# Publish CWD Fix Design

## Problem

All registry publish commands (`npm publish`, `jsr publish`, `cargo publish`) run without setting `cwd` to the target package directory. In a monorepo, this causes every publish to execute in the repository root, attempting to publish the root `package.json` (`pubm-monorepo`, `private: true`) instead of individual packages.

**CI failure**: https://github.com/syi0808/pubm/actions/runs/23146104590/job/67234562346

- `npm publish` from root produces `pubm-monorepo@0.3.6` (475.5 MB, 514 files)
- Fails with `EPRIVATE` and `403 Forbidden`
- JSR was skipped (already published) so the same latent bug didn't surface

## Root Cause

`PackageRegistry` subclasses store `packageName` and `registry` but not `packagePath`. Factory functions (`npmPackageRegistry`, `jsrPackageRegistry`, etc.) receive `packagePath`, read the manifest to extract the name, then **discard the path**. Publish methods call `exec()` without `cwd`, defaulting to `process.cwd()` (repo root).

## Solution

Add `packagePath` as a required constructor parameter to `PackageRegistry`. Each publish method uses `this.packagePath` as `cwd` (npm/jsr) or `--manifest-path` source (crates).

## Changes

### 1. Base Class

**`packages/core/src/registry/package-registry.ts`**

```ts
// Before
constructor(public packageName: string, public registry?: string)

// After
constructor(public packageName: string, public packagePath: string, public registry?: string)
```

Remove `_manifestDir?: string` parameter from `dryRunPublish()` — replaced by `this.packagePath`.

### 2. NpmPackageRegistry

**`packages/core/src/registry/npm.ts`**

- Constructor: `(packageName, packagePath, registry?)`
- `npm()` method: add `cwd?: string` parameter, pass to `runNpm()`
- `runNpm()`: accept `cwd?: string`, pass as `nodeOptions.cwd` to `exec()`
- `publish()`: call `this.npm(args, this.packagePath)`
- `publishProvenance()`: call `this.npm([...], this.packagePath)`
- `dryRunPublish()`: set `nodeOptions.cwd` to `this.packagePath`
- Factory: `new NpmPackageRegistry(manifest.name, packagePath)`

### 3. CustomPackageRegistry

**`packages/core/src/registry/custom-registry.ts`**

- No separate constructor (inherits from NpmPackageRegistry)
- `npm()` override: add `cwd?: string` parameter, pass as `nodeOptions.cwd`
- Factory: `new CustomPackageRegistry(manifest.name, packagePath, registryUrl)`
- Inline factory in `catalog.ts` `registerPrivateRegistry()`: same pattern

### 4. JsrPackageRegistry

**`packages/core/src/registry/jsr.ts`**

- Constructor: `(packageName, packagePath, registry?)`
- `publish()`: add `nodeOptions: { cwd: this.packagePath }` to `exec()`
- `dryRunPublish()`: same
- Factory: `new JsrPackageRegistry(manifest.name, packagePath)`

### 5. CratesPackageRegistry

**`packages/core/src/registry/crates.ts`**

- Constructor: `(packageName, packagePath, registry?)`
- `publish()`: remove `manifestDir` parameter, use `this.packagePath` for `--manifest-path`
- `dryRunPublish()`: remove `manifestDir` parameter, same
- Factory: refactor `cratesPackageRegistry(packagePath)` to read `Cargo.toml` manifest (like npm/jsr factories), return `new CratesPackageRegistry(manifest.name, packagePath)`

### 6. Registry Catalog

**`packages/core/src/registry/catalog.ts`**

- Crates descriptor: `factory: (packagePath) => cratesPackageRegistry(packagePath)` (was passing name)
- Private registry inline factory: pass `packagePath` to `CustomPackageRegistry` constructor

### 7. Task Layer — Crates

**`packages/core/src/tasks/crates.ts`**

- `createCratesPublishTask(packagePath)`: construct with `new CratesPackageRegistry(packageName, packagePath)` or use factory
- `registry.publish(packagePath)` → `registry.publish()` (cwd managed by instance)
- `createCratesAvailableCheckTask(packagePath)`: same pattern
- Remove backward-compat static exports (`cratesAvailableCheckTasks`, `cratesPublishTasks`) — unused in source code, only in tests

### 8. Task Layer — Dry-Run

**`packages/core/src/tasks/dry-run-publish.ts`**

- `siblingCrateNames: string[]` → `siblingPaths: string[]`
- `findUnpublishedSiblingDeps`: receive sibling paths, read crate name from manifest via factory
- All `new CratesPackageRegistry(name)` → use factory with path
- `registry.dryRunPublish(packagePath)` → `registry.dryRunPublish()`
- Remove backward-compat static export (`cratesDryRunPublishTask`)

### 9. Task Layer — Runner

**`packages/core/src/tasks/runner.ts`**

- `siblingNames` collection: pass `packagePaths` directly instead of resolving to names (simplifies code)
- `dryRunTaskMap` signature update: `siblingNames?: string[]` → `siblingPaths?: string[]`

### 10. Tests

- All direct constructor calls: add `packagePath` parameter (empty string `""` or fixture path)
- Crates mock constructors: update signature
- Backward-compat export tests: migrate to `create*()` function calls or remove
- `crates.test.ts`: `registry.publish(packagePath)` → `registry.publish()`
- `dry-run-publish.test.ts`: `registry.dryRunPublish(packagePath)` → `registry.dryRunPublish()`, update sibling param assertions

## Files Affected

### Source (10 files)
1. `packages/core/src/registry/package-registry.ts` — base constructor
2. `packages/core/src/registry/npm.ts` — constructor, publish methods, factory
3. `packages/core/src/registry/jsr.ts` — constructor, publish methods, factory
4. `packages/core/src/registry/crates.ts` — constructor, publish methods, factory refactor
5. `packages/core/src/registry/custom-registry.ts` — npm override, factory
6. `packages/core/src/registry/catalog.ts` — crates descriptor, private registry factory
7. `packages/core/src/registry/index.ts` — no change needed (uses descriptor.factory)
8. `packages/core/src/tasks/crates.ts` — remove manifestDir passing, remove backward-compat exports
9. `packages/core/src/tasks/dry-run-publish.ts` — siblingPaths refactor, remove backward-compat export
10. `packages/core/src/tasks/runner.ts` — siblingNames → siblingPaths simplification

### Tests (~6 files)
1. `packages/core/tests/unit/registry/npm.test.ts`
2. `packages/core/tests/unit/registry/jsr.test.ts`
3. `packages/core/tests/unit/registry/crates.test.ts`
4. `packages/core/tests/unit/registry/custom-registry.test.ts`
5. `packages/core/tests/unit/registry/version-published.test.ts`
6. `packages/core/tests/unit/tasks/crates.test.ts`
7. `packages/core/tests/unit/tasks/dry-run-publish.test.ts`
8. `packages/core/tests/unit/tasks/runner.test.ts`
9. `packages/core/tests/unit/tasks/runner-coverage.test.ts`
