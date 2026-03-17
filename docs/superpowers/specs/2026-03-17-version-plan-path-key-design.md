# Version Plan Path-Based Key Design

**Date:** 2026-03-17
**Status:** Draft

## Problem

When a single package directory publishes to multiple registries with different names (e.g., `packages/core` → npm as `@pubm/core`, jsr as `@pubm/pubm`), version lookup fails.

`versionPlan.packages` uses `packageName` (from `package.json`) as keys. Each publish task looks up the version using its own registry-specific name (e.g., `jsr.json` name). When the names differ, the lookup returns an empty string. `isVersionPublished("")` then hits the package overview URL, gets 200, and incorrectly skips publishing.

## Root Cause

The version plan's key is `packageName`, but `packageName` is not a universal identifier — each registry reads its name from a different manifest file. `packagePath` is the only identifier that is consistent across all registries for the same source directory.

## Design

Change the key of `versionPlan.packages` from `packageName` to `packagePath`. Also remove the legacy fallback fields `ctx.runtime.version` and `ctx.runtime.versions`.

### Type Changes (`context.ts`)

**Before:**
```typescript
interface SingleVersionPlan {
  mode: "single";
  version: string;
  packageName: string;
}
interface FixedVersionPlan {
  mode: "fixed";
  version: string;
  packages: Map<string, string>; // Map<packageName, version>
}
interface IndependentVersionPlan {
  mode: "independent";
  packages: Map<string, string>; // Map<packageName, version>
}
```

**After:**
```typescript
interface SingleVersionPlan {
  mode: "single";
  version: string;
  packagePath: string;
}
interface FixedVersionPlan {
  mode: "fixed";
  version: string;
  packages: Map<string, string>; // Map<packagePath, version>
}
interface IndependentVersionPlan {
  mode: "independent";
  packages: Map<string, string>; // Map<packagePath, version>
}
```

### `PubmContext.runtime` Field Removal

Remove:
- `version?: string`
- `versions?: Map<string, string>`

These were legacy fallback fields; all code paths now use `versionPlan`.

### `getPackageVersion` Signature Change

**Before:** `getPackageVersion(ctx, packageName: string): string`
**After:** `getPackageVersion(ctx, packagePath: string): string`

Same logic, but lookup key is now `packagePath`. Remove fallback to `ctx.runtime.version`.

### `resolveVersion` Change

Picker signature changes from `(packages: Map<string, string>) => string` where keys are names, to keys being paths. Currently no production callers exist (only tests), so the impact is limited. Consider removing the export if no external consumers need it.

## Affected Code

### A. Type & Version Lookup — `context.ts`

| Change | Detail |
|--------|--------|
| `SingleVersionPlan.packageName` | Rename to `packagePath` |
| `getPackageVersion` param | `packageName` → `packagePath` |
| `PubmContext.runtime.version` | Delete |
| `PubmContext.runtime.versions` | Delete |
| Fallback code in `getPackageVersion` | Delete `ctx.runtime.version ?? ""` fallback |

### B. Version Plan Creation — `cli.ts`, `required-missing-information.ts`, `runner.ts`

All sites that create `versionPlan` objects must use `pkg.path` instead of `pkg.name` as Map keys.

**`cli.ts` (9 creation sites):**
- Single mode: `packageName: resolvedConfig.packages[0].name` → `packagePath: resolvedConfig.packages[0].path`
- Fixed/Independent mode: `Map(packages.map(p => [p.name, version]))` → `Map(packages.map(p => [p.path, version]))`
- All `ctx.runtime.version = ...` assignments: delete
- All `ctx.runtime.versions = ...` assignments: delete

**`required-missing-information.ts` (5 creation sites):**
- Same pattern: name → path in Map keys and SingleVersionPlan field
- Delete `ctx.runtime.version`/`ctx.runtime.versions` writes
- **Conversion boundary**: The changeset system (`calculateVersionBumps`, `getStatus`) is internally name-based and stays that way. Intermediate data structures (`currentVersions`, `bumps`, `graph`) remain name-keyed. Convert name → path only at the final `versionPlan` assignment, using `ctx.config.packages.find(p => p.name === name)?.path`

**`runner.ts` snapshot flow (1 creation site):**
- `packageName: ctx.config.packages[0].name` → `packagePath: ctx.config.packages[0].path`
- Delete `ctx.runtime.version` write

### C. Publish Tasks — `jsr.ts`, `npm.ts`, `crates.ts`, `dry-run-publish.ts`

Each task already receives `packagePath` as parameter. Change:
```typescript
// Before
const version = getPackageVersion(ctx, jsr.packageName);
// After
const version = getPackageVersion(ctx, packagePath);
```

This is the change that fixes the original bug.

### D. Version Plan Consumption — `runner.ts`

Sites that iterate `plan.packages` and need a package **name** (for tags, commit messages, release titles) must resolve path → name via config lookup.

Add a helper:
```typescript
function getPackageName(ctx: PubmContext, packagePath: string): string {
  return ctx.config.packages.find(p => p.path === packagePath)?.name ?? packagePath;
}
```

Affected sites (with specific line references in `runner.ts`):
- **Tag creation** (lines 849, 1075, 1112): `${pkgName}@${pkgVersion}` — resolve name from path
- **Commit messages** (line 1103): `${name}: ${ver}` — resolve name from path
- **GitHub release** (lines 627-629, 676-677, 1211): tag and title — resolve name from path
- **GitHub release changelog lookup** (lines 632, 677, 1052): `ctx.config.packages.find(p => p.name === pkgName)` must change to `.find(p => p.path === pkgPath)` since iteration variable is now a path
- **`formatVersionSummary`** (line 260): display `name@version` — resolve name from path
- **`formatVersionPlan`** (line 280): display `name: version` — resolve name from path
- **Changelog** (line 982): `buildChangelogEntries(changesets, pkgName)` — resolve name from path. The changeset system is name-based; the caller must convert path → name before calling

### E. Manifest Writing — `write-versions.ts`

`writeVersionsForEcosystem` currently does:
```typescript
const name = await eco.packageName();
const version = versions.get(name);
```

Change to use `eco.packagePath` as key:
```typescript
const version = versions.get(eco.packagePath);
```

`updateSiblingDependencyVersions` in `rust.ts` uses `siblingVersions.has(depName)` where `depName` is a crate name. The conversion must happen inside `writeVersionsForEcosystem` between Phase 1 and Phase 2:

```typescript
// Phase 1: Write versions to manifests (path-keyed)
for (const { eco } of ecosystems) {
  const version = versions.get(eco.packagePath);
  if (version) await eco.writeVersion(version);
}

// Phase 2: Build name-keyed map for sibling dependency updates
const nameKeyedVersions = new Map<string, string>();
for (const { eco } of ecosystems) {
  const name = await eco.packageName();
  const version = versions.get(eco.packagePath);
  if (version) nameKeyedVersions.set(name, version);
}
await Promise.all(
  ecosystems.map(({ eco }) =>
    eco.updateSiblingDependencyVersions(nameKeyedVersions),
  ),
);
```

### F. Defense-in-Depth — `isVersionPublished`

Add empty version guard to all implementations (`npm.ts`, `jsr.ts`, `crates.ts`):
```typescript
async isVersionPublished(version: string): Promise<boolean> {
  if (!version) return false;
  // ... existing logic
}
```

### G. Plugin — `plugin-external-version-sync`

Reads `ctx.runtime.versionPlan`. If it accesses `plan.packages` keys expecting names, change to path-based lookup. If the plugin exposes a `version` callback that receives `plan.packages`, this is a **breaking change for end users** who configured the callback with name-based keys (e.g., `version: (pkgs) => pkgs.get('@pubm/core')`).

### H. Tests

All test files that create `versionPlan` objects or assert on their structure must update:
- `context.test.ts` — `getPackageVersion` tests
- `version-plan.test.ts` — `resolveVersion` tests
- `cli.test.ts` — versionPlan structure assertions
- `jsr-already-published.test.ts`, `npm-already-published.test.ts`, `crates-already-published.test.ts`, `dry-run-already-published.test.ts`
- `plugin-external-version-sync` integration tests
- `registry/version-published.test.ts`

## Design Boundaries

- **Changeset system** (`changeset/version.ts`, `changeset/status.ts`, `changeset/writer.ts`): remains entirely name-based. No changes needed. The conversion boundary is at versionPlan creation/consumption points.
- **Ecosystem/Registry internals**: `packageName()`, `ManifestReader`, registry classes — all remain name-based. Only the versionPlan key changes.

## Migration Notes

- No config file changes needed — `pubm.config.ts` is unaffected
- No CLI interface changes — user-facing behavior identical
- `versionPlan` is runtime-only (not serialized), so no data migration
- Exported types `SingleVersionPlan`, `FixedVersionPlan`, `IndependentVersionPlan` change — breaking for programmatic API consumers
- Exported functions `getPackageVersion`, `resolveVersion` — parameter semantics change (name → path)
- `plugin-external-version-sync` — if users have `version` callbacks that reference `plan.packages` by name, they must update to use paths
