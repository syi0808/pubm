# Auto-Discovery: Make `packages` Optional

**Date:** 2026-03-13
**Status:** Draft

## Problem

Currently, when `packages` is not specified in `pubm.config.ts`, it falls back to `[{ path: "." }]` — treating only the current directory as a publish target. This means monorepo users **must** explicitly list every package in config, even though workspace definitions already declare them.

Additionally, documentation examples show `ecosystem: "js"` / `ecosystem: "rust"` fields, which are rarely needed since ecosystem auto-detection works reliably from manifest files.

## Goals

1. Make `packages` truly optional — auto-discover publishable packages from workspace config when not specified
2. Extend workspace detection to cover Cargo, Deno, and Bun (in addition to existing pnpm/npm/yarn)
3. Filter out `private: true` packages from auto-discovery
4. Remove `ecosystem` field from documentation examples (keep in config types for edge-case override)

## Non-Goals

- Adding new ecosystems (Go, Python, etc.) — deferred to when those ecosystems are implemented
- Removing the `ecosystem` field from config types — it stays as an escape hatch
- Changing behavior when `packages` IS explicitly specified

## Design

### 1. `resolveConfig` becomes async

**File:** `packages/core/src/config/defaults.ts`

`resolveConfig` changes signature:

```typescript
// Before
export function resolveConfig(config: PubmConfig): ResolvedPubmConfig

// After
export async function resolveConfig(config: PubmConfig, cwd?: string): Promise<ResolvedPubmConfig>
```

When `config.packages` is undefined:
1. Call `discoverPackages({ cwd })` to auto-discover
2. Convert `DiscoveredPackage[]` to `PackageConfig[]`
3. If discovery returns empty and cwd is a single package:
   - `private: true` → prompt user for confirmation (interactive) / error (CI)
   - `private: false` → use `[{ path: "." }]` with inferred registries

When `config.packages` is defined: existing logic unchanged.

### 2. Workspace Detection Extension

**File:** `packages/core/src/monorepo/workspace.ts`

Extend `WorkspaceInfo.type`:

```typescript
type WorkspaceType = "pnpm" | "npm" | "yarn" | "bun" | "cargo" | "deno";
```

Detection order (first match wins):

| Priority | File | Condition | Type |
|----------|------|-----------|------|
| 1 | `pnpm-workspace.yaml` | exists | pnpm |
| 2 | `Cargo.toml` | has `[workspace]` section with `members` | cargo |
| 3 | `deno.json` / `deno.jsonc` | has `workspace` array | deno |
| 4 | `bunfig.toml` + `package.json` | bunfig exists + package.json has workspaces | bun |
| 5 | `package.json` | `workspaces` is array | npm |
| 6 | `package.json` | `workspaces.packages` is array | yarn |

**Cargo parsing:**
```toml
[workspace]
members = ["crates/*", "tools/cli"]
exclude = ["crates/archived"]
```
- Parse TOML, extract `workspace.members` glob patterns
- Apply `workspace.exclude` as filter after resolution

**Deno parsing:**
```json
{ "workspace": ["./packages/add", "./packages/*"] }
```
- Parse JSON/JSONC, extract `workspace` array as glob patterns

**Bun detection:**
- If `bunfig.toml` exists alongside `package.json` with workspaces, classify as `"bun"`
- Patterns come from `package.json` workspaces (same format as npm)

### 3. `discoverPackages` Modifications

**File:** `packages/core/src/monorepo/discover.ts`

Changes:
- **`private: true` filtering:** After resolving each package directory, read manifest and skip if `private: true`
- **Single package fallback:** When no workspace is detected, treat cwd itself as a candidate:
  - Detect ecosystem from manifest files
  - Infer registries
  - Return as single-element array (or empty if no ecosystem detected)

```
discoverPackages({ cwd })
  ├─ detectWorkspace(cwd)
  │
  ├─ workspace found (monorepo)
  │    ├─ resolve glob patterns → directory list
  │    ├─ for each directory:
  │    │    ├─ detect ecosystem
  │    │    ├─ infer registries
  │    │    └─ check private → skip if true
  │    └─ return PackageConfig[]
  │
  └─ no workspace (single package)
       ├─ detect ecosystem at cwd
       ├─ infer registries
       └─ return [{ path: ".", ... }] or []
```

### 4. Documentation Changes

**Primary file:** `website/src/content/docs/reference/config.mdx`
- Remove `ecosystem` field from `PackageConfig` interface example (lines ~254)
- Remove `ecosystem` field documentation section (lines ~299-304)
- Add note that packages are auto-discovered from workspace config when not specified

**Secondary files (type reference only):**
- Korean config reference
- Chinese config reference

## Affected Files

| File | Change |
|------|--------|
| `packages/core/src/config/defaults.ts` | `resolveConfig` → async, add discovery integration |
| `packages/core/src/monorepo/workspace.ts` | Add Cargo, Deno, Bun detection; extend WorkspaceType |
| `packages/core/src/monorepo/discover.ts` | Add private filtering, single-package fallback |
| `packages/core/src/index.ts` | Await async `resolveConfig` |
| `website/src/content/docs/reference/config.mdx` | Remove ecosystem examples, add auto-discovery docs |
| `website/src/content/docs/ko/reference/config.mdx` | Update if ecosystem referenced |
| `website/src/content/docs/zh-cn/reference/config.mdx` | Update if ecosystem referenced |
| `packages/core/tests/unit/monorepo/workspace.test.ts` | Add Cargo/Deno/Bun detection tests |
| `packages/core/tests/unit/monorepo/discover.test.ts` | Add private filtering, single-package tests |
| `packages/core/tests/unit/config/defaults.test.ts` | Update for async resolveConfig |

## Edge Cases

- **Mixed workspace types:** A repo with both `Cargo.toml` [workspace] and `package.json` workspaces — detection order handles this (both get discovered since `discoverPackages` checks ecosystem per directory)
- **Nested workspaces:** Not supported — only root-level workspace detection
- **Empty workspace:** If workspace config exists but all packages are private → prompt/error same as single private package
- **Cargo `exclude`:** Must be applied after glob resolution to filter out excluded paths
