# Changeset Consumption Mode Design

**Date:** 2026-03-18
**Status:** Draft

## Problem

When a monorepo has pending changesets and the user selects "Accept all" in the changeset recommendation prompt, only packages with changesets are included in the `versionPlan`. However, the publish pipeline iterates over `ctx.config.packages` (all packages), so packages without changesets are also run through the pipeline — causing a "same version already published" error.

## Goals

1. Replace the two-choice changeset prompt with a three-choice prompt that clearly expresses user intent.
2. Ensure the publish pipeline only processes packages that are actually being published.
3. Skip the publish pipeline for any package whose selected version equals its current version (independent mode only).

## Non-Goals

- Changing single-package flow (no changesets, one package only).
- Changing CI/non-TTY changeset consumption behavior.
- Modifying fixed-mode versioning behavior (all packages share the same version; skipping individual packages is not applicable).

## Design

### 1. New Three-Choice Prompt

When changesets are detected in a multi-package workspace, `promptChangesetRecommendations` presents three choices:

| Choice | Label | Behavior |
|--------|-------|----------|
| `only_changesets` | "Only changesets (auto bump affected packages)" | Auto-bump changeset packages only; exclude all others from the pipeline |
| `add_packages` | "Also select versions for other packages" | Auto-bump changeset packages, then prompt version selection for remaining packages |
| `no` | "No, select versions manually" | Ignore changeset recommendations; prompt version selection for all packages |

### 2. `filterConfigPackages` Internal Utility

A new file `packages/core/src/utils/filter-config.ts` exports a single function:

```ts
export function filterConfigPackages(
  ctx: PubmContext,
  publishPaths: Set<string>,
): void
```

**Behavior:**
1. Constructs a new config: `{ ...ctx.config, packages: ctx.config.packages.filter(p => publishPaths.has(p.path)) }`.
2. `Object.freeze`s the new config (shallow, matching existing behavior in `createContext`).
3. Assigns the new config to `ctx.config` via direct assignment (possible because `config` property is made `writable: true` — see Section 3).

The freeze is shallow, consistent with the existing `Object.freeze(config)` in `createContext`. Nested arrays and objects (e.g., `packages` array contents) are not deeply frozen; this matches the current contract.

**Why a new file:** keeps mutation logic isolated and easy to test independently.

### 3. `context.ts` and `PubmContext` Changes

Two changes are required to allow `filterConfigPackages` to reassign `ctx.config` at runtime:

**3a. `createContext` — make `config` property writable:**
```ts
config: {
  value: Object.freeze(config),
  writable: true,   // was: false
  enumerable: true,
  configurable: false,
},
```
The original property is defined with `writable: false, configurable: false`. With this combination, direct assignment throws at runtime and `Object.defineProperty` also cannot change the descriptor (configurable: false blocks all re-definitions). Changing `writable` to `true` at definition time is the only way to allow subsequent direct assignment.

The config object value remains `Object.freeze`d, keeping its internal properties immutable. Only the top-level `ctx.config` reference becomes replaceable.

**3b. `PubmContext` interface — remove `readonly` from `config`:**
```ts
export interface PubmContext {
  config: ResolvedPubmConfig;  // was: readonly config
  readonly options: ResolvedOptions;
  readonly cwd: string;
  runtime: { ... };
}
```
Removing `readonly` is required so that `filterConfigPackages` can assign to `ctx.config` without a TypeScript error. Runtime immutability of config internals is preserved by `Object.freeze`.

### 4. Choice Behaviors in Detail

#### `only_changesets`
1. Calculate version bumps from changesets (`bumps: Map<string, VersionBump>`).
2. Build `versionPlan = { mode: "independent", packages: new Map([...bumps].map(([p, b]) => [p, b.newVersion])) }`.
3. Set `ctx.runtime.changesetConsumed = true`.
4. Call `filterConfigPackages(ctx, new Set(bumps.keys()))`.
5. Return — no further version prompts.

`versionPlan.packages` and `ctx.config.packages` are consistent: both contain only changeset-affected packages.

#### `add_packages`
1. Calculate version bumps from changesets (`bumps`).
2. Identify remaining packages: `ctx.config.packages` entries whose path is **not** in `bumps`.
3. Call `handleRemainingPackages(ctx, task, remainingPackages, currentVersions, graph, bumps)` which returns `{ versions, publishPaths }` (see Section 5).
   - `versions` = merged map: changeset-bumped packages + user-selected versions for remaining packages.
   - `publishPaths` = changeset package paths + remaining package paths where version changed.
4. Set `ctx.runtime.versionPlan = { mode: "independent", packages: new Map([...versions].filter(([p]) => publishPaths.has(p))) }`.
   - **Only packages in `publishPaths` are included in `versionPlan.packages`** — "keep current" packages are excluded from both `versionPlan` and the pipeline.
5. Set `ctx.runtime.changesetConsumed = true`.
6. Call `filterConfigPackages(ctx, publishPaths)`.

`versionPlan.packages` and `ctx.config.packages` are consistent: both contain only packages being published.

#### `no`
1. Fall through to the existing `handleManualMultiPackage` flow with no changeset consumption (`changesetConsumed` remains unset).
2. `handleManualMultiPackage` determines versioning mode:
   - If `ctx.config.versioning` is pre-set in config, that value is used (no prompt shown).
   - Otherwise, the user is prompted to choose fixed or independent.
3. If mode is **fixed**: `filterConfigPackages` is **not** called. Fixed mode applies to all packages by design.
4. If mode is **independent**:
   - `handleIndependentMode` runs as-is and sets `ctx.runtime.versionPlan`. Note: `handleIndependentMode` unconditionally adds every package to `versionPlan.packages`, including "keep current" ones (stores current version as selected). Cascade-declined packages are simply absent from `versionPlan.packages` — they were never iterated in the main loop.
   - After it returns, `currentVersions` (available as a parameter of `handleManualMultiPackage`) is used to compute `publishPaths`: paths in `versionPlan.packages` where stored version ≠ `currentVersions.get(path)`. Cascade-declined packages are absent from `versionPlan.packages` and require no explicit exclusion.
   - Filter `versionPlan.packages` (plain unfrozen `Map` property — direct assignment is safe): `versionPlan.packages = new Map([...versionPlan.packages].filter(([p]) => publishPaths.has(p)))`.
   - Call `filterConfigPackages(ctx, publishPaths)`.
   - This applies whether mode was pre-set via `ctx.config.versioning` or chosen interactively.

`versionPlan.packages` and `ctx.config.packages` are consistent: both contain only packages being published.

### 5. `handleRemainingPackages` (new helper)

For the `add_packages` choice, a new private function handles the version prompt loop for non-changeset packages:

```ts
async function handleRemainingPackages(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  remainingPackages: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  graph: Map<string, string[]>,
  bumps: Map<string, VersionBump>,
): Promise<{ versions: Map<string, string>; publishPaths: Set<string> }>
```

**Behavior:**

1. Initialize `bumpedPackages` with all paths from `bumps` (changeset-bumped packages are considered already bumped for cascade purposes).
2. Initialize `versions` with changeset-bumped entries: `new Map([...bumps].map(([p, b]) => [p, b.newVersion]))`.
3. Initialize `publishPaths` with all keys of `bumps` (changeset packages always publish).
4. Iterate over `remainingPackages`:
   - Check if any of this package's dependencies are in `bumpedPackages` (including changeset-bumped ones) → show cascade hint in the prompt.
   - Call `promptVersion` for the package.
   - If selected version ≠ current version: add to `bumpedPackages` and `publishPaths`.
   - Add selected version to `versions`.
5. After the loop, apply the cascade prompt for unbumped dependents of bumped packages (same logic as `handleIndependentMode`). Cascade targets are packages whose path is NOT already in `bumpedPackages` (i.e., not already a changeset-bumped or user-bumped package). Cascade-accepted packages are added to `publishPaths` and `versions`. Cascade-declined packages are NOT added to `publishPaths`.
6. Return `{ versions, publishPaths }`.

Note: the returned `versions` map is a **superset** of `publishPaths` — it includes all packages that were prompted (including "keep current" ones), because the caller uses `versions` as the source of truth for version strings but filters by `publishPaths` when building `versionPlan.packages` (see Section 4 `add_packages` step 4).

### 6. Consistency Between `versionPlan.packages` and `ctx.config.packages`

A key invariant maintained throughout all code paths: **`versionPlan.packages` and `ctx.config.packages` must contain exactly the same set of package paths after the version prompt step completes.**

This ensures that downstream code in `runner.ts` that iterates `plan.packages` (tag creation at line ~1006, changelog at line ~981) and code that iterates `ctx.config.packages` (publish tasks, ecosystem grouping) operate on the same set.

Summary of how each path achieves this:

| Choice | How invariant is maintained |
|--------|-----------------------------|
| `only_changesets` | `versionPlan.packages` built from `bumps` only; `filterConfigPackages` uses same `bumps.keys()` |
| `add_packages` | `versionPlan.packages` built from `publishPaths` only (step 4); `filterConfigPackages` uses same `publishPaths` |
| `no` → independent | `versionPlan.packages` filtered to `publishPaths` before `filterConfigPackages` call |
| `no` → fixed | No filtering; all packages included in both |

### 7. Timing: `filterConfigPackages` vs. `originalVersions` Capture

In `runner.ts`, the version bump task captures `originalVersions` for dry-run rollback:

```ts
const originalVersions = new Map(
  ctx.config.packages.map((pkg) => [pkg.path, pkg.version ?? "0.0.0"]),
);
```

`filterConfigPackages` is called during the version prompt step, which runs **before** the version bump task. By the time `originalVersions` is captured, `ctx.config.packages` already contains only the filtered subset. The dry-run rollback (`writeVersions(ctx, originalVersions)`) therefore only restores the packages that were included in the pipeline — which is correct, as excluded packages were never written to.

### 8. Changeset Consumption and `deleteChangesetFiles`

| Choice | `changesetConsumed` | Which changesets deleted |
|--------|--------------------|-----------------------|
| `only_changesets` | `true` | All changeset files |
| `add_packages` | `true` | All changeset files |
| `no` | `false` (not set) | None |

`deleteChangesetFiles` deletes changeset files by file identity (not by package path). In `only_changesets` and `add_packages`, all pending changesets belong to packages that are auto-bumped and included in the pipeline — so deleting all changeset files is correct. In `no` mode, `changesetConsumed` is never set, so `deleteChangesetFiles` is never called and all changeset files remain intact.

### 9. Side Effects Analysis

| Usage site | Impact of filtering | Safe? |
|---|---|---|
| `createKeyResolver(ctx.config.packages)` in version bump | Resolver only knows about filtered packages; `deleteChangesetFiles` deletes by file identity (not by package), so deletion scope is unaffected by resolver | ✅ In `only_changesets`/`add_packages`, excluded packages have no pending changesets by design. In `no`, `changesetConsumed` is never set so deletion never runs. |
| `ctx.config.packages[0]` (single-mode refs in runner.ts) | Only triggered in single-package path | ✅ Filtering only applies in multi-package path |
| `ctx.config.packages[0]` in "Checking tag information" task (dist-tags lookup) | Uses first filtered package path for registry queries | ✅ Any included package path is sufficient for dist-tag discovery; the first filtered package is a valid choice |
| `collectEcosystemRegistryGroups(ctx.config)` | Uses `ctx.config.packages` internally | ✅ Automatically filtered |
| `countPublishTargets` / `formatRegistryGroupSummary` | Use config.packages indirectly | ✅ Automatically filtered |
| `originalVersions` capture in version bump task | Captures filtered packages only | ✅ Dry-run rollback only restores packages that entered the pipeline |
| `plan.packages` iteration in tag/changelog loop | Must match filtered packages | ✅ Ensured by Section 6 invariant |

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/context.ts` | `config` property: `writable: false` → `writable: true`; `PubmContext.config`: remove `readonly` |
| `packages/core/src/utils/filter-config.ts` | New file: `filterConfigPackages` utility |
| `packages/core/src/tasks/required-missing-information.ts` | Three-choice prompt; `only_changesets` / `add_packages` / `no` logic; `handleRemainingPackages` helper; `filterConfigPackages` calls; `versionPlan.packages` filtering for `no` → independent path |

## Tests

| Test file | What is tested |
|-----------|----------------|
| `packages/core/tests/unit/utils/filter-config.test.ts` | Filters correctly; result is frozen; handles empty set; original config unchanged; shallow freeze (consistent with existing behavior) |
| `packages/core/tests/unit/tasks/required-missing-information.test.ts` | Three choices render correctly; `only_changesets`: versionPlan + filter consistent; `add_packages`: changeset pkgs auto-bumped + remaining prompted + filter consistent; `no` → independent: manual selection + same-version excluded + cascade-declined excluded; `no` → fixed: `filterConfigPackages` NOT called; `ctx.config.versioning: "independent"` pre-set: mode prompt skipped, filter still applied; `ctx.config.versioning: "fixed"` pre-set: mode prompt skipped, filter NOT applied |
