# Changesets + np Integration Design — Unified E2E Deployment Tool

**Date:** 2026-03-04
**Status:** Approved
**Approach:** A+B Hybrid (Native integration with .changeset/ migration support)
**Relation:** Extends the [Multi-Ecosystem Registry Design](./2026-03-03-multi-ecosystem-registry-design.md)

---

## 1. Vision

Transform pubm from a multi-registry publish tool into a **complete end-to-end deployment tool** by integrating:

- **Changesets workflow** — intent-to-release files, CHANGELOG generation, CI automation
- **np-style validation** — clean install, entry point verification, extraneous file warnings
- **Monorepo support** — workspace detection, dependency cascading, fixed/linked groups
- **Pre-release system** — pre enter/exit mode, snapshot releases

### Core Philosophy: Zero-Config, Maximum Automation

- Everything works without `pubm.config.ts` (auto-detect everything)
- Smart defaults mean users rarely need to configure anything
- Interactive prompts auto-suggest based on git diff and commit messages
- All validations are enabled by default (users opt-out, not opt-in)

---

## 2. CLI Command Structure

Transition from single `pubm [version]` command to a subcommand system:

```
pubm add                    # Create changeset file (interactive)
pubm version                # Consume changesets → version bump → CHANGELOG
pubm publish [version]      # Multi-registry publish (existing core behavior)
pubm status                 # Pending changeset status / CI gate
pubm pre enter <tag>        # Enter pre-release mode
pubm pre exit               # Exit pre-release mode
pubm snapshot [tag]         # Snapshot release (ephemeral)
pubm init                   # Initialize .pubm/ + pubm.config.ts (optional)
pubm migrate                # Convert .changeset/ → .pubm/ (B: adapter)
```

### Backward Compatibility

- `pubm patch` / `pubm minor` / `pubm major` → mapped to `pubm publish patch` etc.
- Bare `pubm` → interactive mode:
  - If pending changesets exist → suggest `version` + `publish`
  - If no changesets → suggest `add`
- No config file → existing pubm behavior (single package, interactive version)

### Changeset File Location

- `.pubm/changesets/` directory (extends existing `.pubm/` for token storage)
- Files committed to git, reviewable in PRs

---

## 3. Changeset File Format

Uses the same YAML frontmatter + Markdown format as @changesets/cli, extended for multi-ecosystem:

```markdown
---
"@scope/package-a": minor
"@scope/package-b": patch
"my-rust-crate": major
---

Added new API endpoint for user management and fixed related bugs.
```

- File names are randomly generated (e.g., `brave-foxes-dance.md`)
- Empty changesets (no packages) supported via `pubm add --empty`
- Each changeset maps package names to bump types (`patch` | `minor` | `major`)

---

## 4. Workflow Details

### 4.1. `pubm add`

Interactive flow with maximum automation:

1. **Auto-detect changed packages** via `git diff` (monorepo: show only changed packages)
2. **Auto-suggest bump type** from commit messages (conventional commits pattern detection)
3. **Auto-suggest summary** from commit messages (for CHANGELOG)
4. User confirms/modifies with Enter (reasonable defaults always available)

```
$ pubm add

 📦 Detected changes in 2 packages:
   ◉ @myorg/core       (3 files changed)
   ◉ @myorg/utils      (1 file changed)

 ? Select packages to include:
   ◉ @myorg/core
   ◉ @myorg/utils

 ? @myorg/core — What kind of change?
   ○ patch (bug fix)
   ● minor (new feature)     ← suggested from commits
   ○ major (breaking change)

 ? Summary (for CHANGELOG):
   > Added new API endpoint for user management   ← suggested

 ✔ Created changeset: .pubm/changesets/brave-foxes-dance.md
```

**CI/Non-interactive flags:**
- `--empty` — create empty changeset (no release needed)
- `--packages <list>` — specify packages
- `--bump <type>` — specify bump type
- `--message <text>` — specify summary

### 4.2. `pubm version`

Consumes all pending changesets:

1. Read `.pubm/changesets/*.md`
2. Merge changesets per package (max bump type wins)
3. Apply dependency cascading (internal deps get auto-patched)
4. Apply fixed/linked group rules
5. Update version in manifests (`package.json`, `jsr.json`, `Cargo.toml`)
6. Generate/append `CHANGELOG.md` per package
7. Delete consumed changeset files
8. Create git commit (configurable message, default: `"Version Packages"`)

### 4.3. `pubm publish`

Existing pubm pipeline, enhanced for monorepo:

1. **Detect state:** if version was already bumped by `pubm version` → skip version prompt
2. **Prerequisites check** (global, once)
3. **Per-package pipeline** (in topological dependency order):
   - Validation (entry points, extraneous files, clean install)
   - Test & Build
   - Publish to all configured registries (concurrent per registry)
4. **Git push** with tags
5. **GitHub release draft** creation

If a package fails → that package rolls back. Already-published packages are retained (configurable: `rollbackStrategy: 'individual' | 'all'`).

### 4.4. `pubm status`

Reports pending changeset status:

```bash
$ pubm status
 Pending changesets:
   @myorg/core: minor (2 changesets)
   @myorg/utils: patch (1 changeset)

$ pubm status --verbose
 # Shows full changeset contents

$ pubm status --since=main
 # Exit code 1 if no changesets (CI gate)
```

### 4.5. `pubm migrate`

Converts existing `.changeset/` projects:

- `.changeset/config.json` → `pubm.config.ts` settings
- `.changeset/*.md` → `.pubm/changesets/*.md` (file move, format preserved)
- `.changeset/pre.json` → `.pubm/pre.json`
- Outputs migration summary and any manual steps needed

---

## 5. Configuration (`pubm.config.ts`)

Single unified config extending the multi-ecosystem design:

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  // === Multi-ecosystem (from existing design) ===
  versioning: 'independent',       // 'independent' | 'fixed'
  branch: 'main',
  packages: [
    { path: '.', registries: ['npm', 'jsr'] },
    { path: 'packages/core', registries: ['npm'] },
    { path: 'crates/my-lib', registries: ['crates'] },
  ],

  // === Changeset workflow ===
  changelog: true,                 // false | true | string (custom generator)
  changelogFormat: 'default',      // 'default' | 'github' | string
  commit: false,                   // auto-commit on add/version
  access: 'public',               // 'public' | 'restricted'

  // === Monorepo groups ===
  fixed: [['@myorg/core', '@myorg/utils']],
  linked: [['@myorg/react-*']],   // glob support
  updateInternalDependencies: 'patch',
  ignore: ['@myorg/internal-tool'],

  // === Validation (np-style) ===
  validate: {
    cleanInstall: true,            // default ON
    entryPoints: true,             // default ON
    extraneousFiles: true,         // default ON
  },

  // === Pre-release / Snapshot ===
  snapshot: {
    useCalculatedVersion: false,
    prereleaseTemplate: '{tag}-{timestamp}',
  },

  // === Publish options ===
  tag: 'latest',
  contents: '.',
  saveToken: true,
  releaseDraft: true,
  releaseNotes: true,
  rollbackStrategy: 'individual', // 'individual' | 'all'
})
```

### Config File Search Order

`pubm.config.ts` → `.mts` → `.cts` → `.js` → `.mjs` → `.cjs`

### Auto-Detection (No Config Required)

| Item | Detection Method |
|------|-----------------|
| Monorepo | `pnpm-workspace.yaml` / `workspaces` in package.json |
| Package list | Workspace config glob patterns |
| Registries | `publishConfig.registry` + jsr.json existence |
| Branch | Git default branch |
| Package manager | Lockfile-based (existing logic) |
| Ecosystem | Manifest files (package.json → JS, Cargo.toml → Rust) |
| GitHub repo | Git remote origin URL |

---

## 6. Monorepo Architecture

### Workspace Detection Priority

1. `pubm.config.ts` → `packages` field (explicit)
2. `pnpm-workspace.yaml` → `packages` globs
3. `package.json` → `workspaces` field (npm/yarn)
4. None → single package mode

### Fixed Groups

All packages in a fixed group always bump and publish together:

```typescript
fixed: [['@myorg/core', '@myorg/utils']]
```

- If `@myorg/core` gets minor, `@myorg/utils` also gets minor (max bump wins)
- Packages without changesets still get bumped and published
- Version numbers are always identical within the group

### Linked Groups

Packages share a version ceiling but only changed packages publish:

```typescript
linked: [['@myorg/react-*']]  // glob support
```

- Only packages with changesets get published
- Version = highest current in group + highest bump from changesets

### Internal Dependency Cascading

When `@myorg/utils@1.0.0` is bumped to `1.1.0`:
- `@myorg/core` (depends on `^1.0.0`) → updates dep range to `^1.1.0`
- `@myorg/core` gets auto patch bump (even without a changeset)
- CHANGELOG entry: "Updated dependency @myorg/utils to 1.1.0"

Configurable: `updateInternalDependencies: 'minor'` → cascade only on minor+ bumps.

### Per-Package Pipeline Execution

```
1. Global: Prerequisites check (once)
2. Per-package (topological order):
   a. Validate (entry points, extraneous files)
   b. Clean install (if enabled)
   c. Test
   d. Build
   e. Publish (concurrent across registries)
3. Global: Git push + Release draft
```

Topological sort ensures dependencies are published before dependents.

---

## 7. Pre-release & Snapshot

### Pre-release Mode

```bash
pubm pre enter beta          # Creates .pubm/pre.json
pubm add                     # Normal changeset creation
pubm version                 # → 2.0.0-beta.0
pubm publish                 # dist-tag: beta (automatic)
# iterate: 2.0.0-beta.1, beta.2, ...
pubm pre exit                # Removes pre-release state
pubm version                 # → 2.0.0 (stable)
pubm publish                 # dist-tag: latest
```

**State file:** `.pubm/pre.json`
```json
{
  "mode": "pre",
  "tag": "beta",
  "packages": {
    "@myorg/core": { "baseVersion": "2.0.0", "iteration": 2 }
  }
}
```

### Snapshot Releases

Ephemeral versions without git commits or permanent changes:

```bash
pubm snapshot canary
# → 0.0.0-canary-20260304T120000
# Published with tag: canary
# No git commit/tag created
# No disk writes to version fields
```

Configurable template: `{tag}`, `{commit}`, `{timestamp}`, `{datetime}`

With `useCalculatedVersion: true`: `2.1.0-canary-20260304T120000` (real version as base).

---

## 8. np-Style Validation

All validations enabled by default. Users can disable via config.

### Clean Install Verification

Before test/build phase:
1. Delete `node_modules/`
2. Reinstall with lockfile enforcement (`pnpm install --frozen-lockfile`)
3. Verify working tree is still clean (catches lockfile drift)

Skippable: `validate.cleanInstall: false` or `--no-clean-install`

### Entry Point Verification

Validates all entry points in `package.json` resolve to actual files:
- `main`
- `module`
- `types` / `typings`
- `exports` (all conditions and subpath patterns)
- `bin`

Runs after build, before publish.

```
✗ Entry point validation failed:
  ✗ "exports"."./utils" → "./dist/utils.js" (file not found)

  Did you forget to run 'build' first?
```

### Extraneous File Warning

Checks `npm pack --dry-run` output for suspicious files:
- `.env`, `.env.*` files
- Test files (`*.test.*`, `*.spec.*`, `__tests__/`)
- Config files (`.eslintrc`, `tsconfig.json`, etc.)
- Source maps in production builds

```
⚠ Extraneous files detected in publish package:
  ! .env.local (potentially contains secrets)
  ! tests/unit.test.ts (test files)

  Add these to .npmignore or "files" in package.json to exclude them.
  Use --no-extraneous-check to skip this warning.
```

---

## 9. CHANGELOG Generation

### Default Format

```markdown
# @myorg/core

## 1.2.0

### Minor Changes

- Added new API endpoint for user management (brave-foxes-dance)

### Patch Changes

- Updated dependency @myorg/utils to 2.3.1
```

### GitHub-Enhanced Format (Auto-Detected)

When a GitHub remote is detected, automatically enriches entries:

```markdown
## 1.2.0

### Minor Changes

- Added new API endpoint ([#42](https://github.com/owner/repo/pull/42))
  by @contributor
```

### Custom Generators

```typescript
changelog: './my-changelog.ts'
```

Custom module exports:
```typescript
export function getReleaseLine(changeset, type, options): string
export function getDependencyReleaseLine(changesets, deps, options): string
```

Disable with `changelog: false`.

---

## 10. CI/CD Automation

### GitHub Action: `pubm/action`

Two-mode operation (same pattern as changesets/action):

**Mode 1 — Pending changesets exist:**
- Creates/updates "Release Packages" PR
- PR contains version bumps + CHANGELOG updates
- When PR is merged → triggers Mode 2

**Mode 2 — No pending changesets:**
- Runs `pubm publish`
- Multi-registry concurrent deployment
- Creates GitHub Releases

```yaml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: pnpm install
      - uses: pubm/action@v1
        with:
          publish: pnpm pubm publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

**Action Outputs:**
```
published: boolean
publishedPackages: '[{"name": "@myorg/core", "version": "1.2.0", "registries": ["npm", "jsr"]}]'
hasChangesets: boolean
```

### GitHub Bot: `pubm-bot`

Comments on PRs about changeset status:

**With changeset:**
```
🦋 This PR includes changesets:
  - @myorg/core: minor
  - @myorg/utils: patch
When merged, these packages will be included in the next release.
```

**Without changeset:**
```
⚠️ No changeset found.
If this PR should trigger a release, run: npx pubm add
[I don't need a changeset] ← auto-creates empty changeset
```

### `pubm status` as CI Gate

```yaml
- name: Check changesets
  run: npx pubm status --since=${{ github.event.pull_request.base.sha }}
  # Exit code 1 = no changesets → CI check fails
```

---

## 11. Internal Architecture

### Module Structure

```
src/
├── cli.ts                          # CAC → subcommand system
├── index.ts                        # Programmatic API
├── config/
│   ├── loader.ts                   # pubm.config.ts loading (jiti)
│   ├── defaults.ts                 # Default values + auto-detect
│   └── types.ts                    # PubmConfig, defineConfig
├── changeset/
│   ├── add.ts                      # pubm add logic
│   ├── version.ts                  # Consume + bump + CHANGELOG
│   ├── status.ts                   # pubm status
│   ├── parser.ts                   # Changeset md file parsing
│   ├── writer.ts                   # Changeset md file creation
│   ├── changelog.ts                # CHANGELOG.md generator
│   └── migrate.ts                  # .changeset/ → .pubm/ migration
├── monorepo/
│   ├── workspace.ts                # Workspace detection + package list
│   ├── dependency-graph.ts         # Dependency graph + topological sort
│   ├── cascade.ts                  # Dependency cascading logic
│   └── groups.ts                   # Fixed/linked group resolution
├── prerelease/
│   ├── pre.ts                      # Pre enter/exit state management
│   └── snapshot.ts                 # Snapshot version generation
├── validate/
│   ├── clean-install.ts            # node_modules delete + reinstall
│   ├── entry-points.ts             # main/exports/types validation
│   └── extraneous-files.ts         # Extraneous file detection
├── registry/                       # Existing + extensions
│   ├── registry.ts
│   ├── npm.ts
│   ├── jsr.ts
│   ├── custom-registry.ts
│   └── index.ts
├── tasks/                          # Existing + per-package extension
│   ├── runner.ts                   # Refactored: per-package pipeline
│   ├── prerequisites-check.ts
│   ├── required-conditions-check.ts
│   └── ...
├── git.ts                          # Existing
├── error.ts                        # Existing
├── options.ts                      # Extended: config merge
└── utils/                          # Existing
    ├── package.ts                  # Extended: monorepo support
    ├── db.ts
    ├── rollback.ts
    └── ...
```

### Core Data Flow

```
pubm add:
  git diff → detect changed packages → interactive prompt → .pubm/changesets/xxx.md

pubm version:
  .pubm/changesets/*.md → parse → max bump calc → dependency cascade
  → fixed/linked group rules → version bump (package.json etc.)
  → CHANGELOG.md generation → delete changeset files → git commit

pubm publish:
  load config → resolve packages → topological sort
  → per-package: validate → test → build → publish (concurrent per registry)
  → git push → release draft
```

### Extended Context Object

```typescript
interface Ctx extends ResolvedOptions {
  // Existing
  promptEnabled: boolean
  npmOnly: boolean
  jsrOnly: boolean
  cleanWorkingTree: boolean

  // New
  config: ResolvedPubmConfig
  packages: PackageInfo[]
  dependencyGraph: DependencyGraph
  changesets: Changeset[]
  preState: PreState | null
}
```

---

## 12. Testing Strategy

### Unit Tests (maintain 95%+ coverage)

- `changeset/parser.ts` — YAML frontmatter parsing, various formats
- `changeset/version.ts` — max bump calculation, cascading, fixed/linked
- `monorepo/workspace.ts` — pnpm/yarn/npm workspace detection
- `monorepo/dependency-graph.ts` — topological sort, circular dependency detection
- `validate/*.ts` — entry point verification, extraneous file detection
- `config/loader.ts` — config file loading, default merging

### E2E Tests

- Single package full flow: add → version → publish (preview)
- Monorepo full flow: multi-package changeset → version → publish
- Migration: `.changeset/` → `.pubm/` conversion
- Pre-release: enter → add → version → publish → exit
- CI mode: non-interactive changeset creation + publish

### Test Fixtures

- `monorepo-basic/` — pnpm workspace + 2 packages
- `monorepo-fixed/` — fixed group testing
- `monorepo-linked/` — linked group testing
- `with-changesets/` — existing .changeset/ migration testing

---

## 13. Error Handling — Friendly Messages

All error messages follow a pattern: **What went wrong → Why → How to fix it**.

```
✗ Cannot publish @myorg/core

  The package @myorg/core@1.2.0 is already published on npm.

  This usually means `pubm version` was run but `pubm publish`
  was interrupted. Try:
    1. pubm publish --skip-already-published
    2. Or bump the version: pubm add → pubm version → pubm publish
```

```
✗ Circular dependency detected

  @myorg/core → @myorg/utils → @myorg/core

  pubm cannot resolve the publish order. Please break the
  circular dependency or use `fixed` groups.
```

```
⚠ Pre-release mode is active (beta)

  Publishing will use tag 'beta' instead of 'latest'.
  To exit pre-release mode: pubm pre exit
```

---

## 14. Relation to Multi-Ecosystem Design

This design **extends** the [Multi-Ecosystem Registry Design](./2026-03-03-multi-ecosystem-registry-design.md):

| Multi-Ecosystem Design | This Design |
|------------------------|-------------|
| `Ecosystem` abstraction | Reused: changeset version/publish is ecosystem-aware |
| `pubm.config.ts` structure | Extended: adds changeset, monorepo, validation fields |
| `CratesRegistry` | Unchanged: works with changeset workflow |
| Per-package pipeline | Extended: adds topological sort + cascading |
| Config file loading | Shared: same jiti-based loader |

The two designs share the same config file and are implemented incrementally. The multi-ecosystem design provides the foundation (Ecosystem abstraction, config system), and this design adds the workflow layer on top (changesets, CHANGELOG, monorepo groups, validation, CI/CD).
