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

## Breaking Changes

`resolveConfig` becomes async (`Promise<ResolvedPubmConfig>`). This is a **public API breaking change** — any external consumer calling `resolveConfig` synchronously will need to update. This warrants a semver major bump or, at minimum, a clear migration note in the changelog.

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
3. If discovery returns empty, return a `discoveryEmpty: true` flag in the resolved config (no prompt/error here — keep `resolveConfig` side-effect-free)

The caller (`pubm()` in `index.ts` or CLI layer) handles the `discoveryEmpty` case:
- `private: true` → prompt user for confirmation (interactive) / error (CI)
- No publishable package found → error with helpful message

When `config.packages` is defined: existing logic unchanged.

### 2. Workspace Detection Extension

**File:** `packages/core/src/monorepo/workspace.ts`

Extend `WorkspaceInfo.type`:

```typescript
type WorkspaceType = "pnpm" | "npm" | "yarn" | "bun" | "cargo" | "deno";
```

`detectWorkspace` returns `WorkspaceInfo[]` (array of all detected workspaces) instead of a single result. This supports polyglot monorepos (e.g., JS + Rust in the same repo). `discoverPackages` merges results from all detected workspaces.

Detection order:

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
- Parse TOML using `smol-toml` (lightweight, zero-dependency TOML parser)
- Extract `workspace.members` glob patterns
- Apply `workspace.exclude` as filter after resolution

**Deno parsing:**
```json
{ "workspace": ["./packages/add", "./packages/*"] }
```
- Parse using `jsonc-parser` (handles comments and trailing commas in `.jsonc` files)
- Extract `workspace` array as glob patterns

**Bun detection:**
- If `bunfig.toml` exists alongside `package.json` with workspaces, classify as `"bun"`
- Patterns come from `package.json` workspaces (same format as npm)
- Note: If `pnpm-workspace.yaml` also exists, pnpm takes priority (already handled by detection order)

### New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `smol-toml` | Parse `Cargo.toml` workspace config | ~15KB, zero deps |
| `jsonc-parser` | Parse `deno.jsonc` with comments/trailing commas | ~30KB, zero deps |

### 3. `discoverPackages` Modifications

**File:** `packages/core/src/monorepo/discover.ts`

Changes:
- **Private/unpublishable filtering:** After resolving each package directory, check:
  - JS: `package.json` → `"private": true` → skip
  - Rust: `Cargo.toml` → `publish = false` or `publish = []` → skip
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
| `packages/core/src/index.ts` | Await async `resolveConfig`, handle `discoveryEmpty` |
| `packages/core/src/changeset/packages.ts` | Update `discoverPackages` usage (single-package fallback now built-in) |
| `packages/pubm/src/commands/add.ts` | Update `discoverPackages` usage |
| `website/src/content/docs/reference/config.mdx` | Remove ecosystem examples, add auto-discovery docs |
| `website/src/content/docs/ko/reference/config.mdx` | Update if ecosystem referenced |
| `website/src/content/docs/zh-cn/reference/config.mdx` | Update if ecosystem referenced |
| `packages/core/tests/unit/monorepo/workspace.test.ts` | Add Cargo/Deno/Bun detection tests |
| `packages/core/tests/unit/monorepo/discover.test.ts` | Add private filtering, single-package tests |
| `packages/core/tests/unit/config/defaults.test.ts` | Update for async resolveConfig |

## Edge Cases

- **Mixed workspace types:** A repo with both `Cargo.toml` [workspace] and `package.json` workspaces — `detectWorkspace` returns all detected workspaces, `discoverPackages` merges results with deduplication by path
- **Nested workspaces:** Not supported — only root-level workspace detection
- **Empty workspace:** If workspace config exists but all packages are private → prompt/error same as single private package
- **Cargo `exclude`:** Must be applied after glob resolution to filter out excluded paths
