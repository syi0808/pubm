# Setup Decision Guides

Decision trees for common setup choices. Use these when recommending configuration during the publish-setup workflow.

## CI Trigger Strategy

Choose how CI publishes get triggered:

| Project type | Recommended trigger | Why |
|---|---|---|
| Single package | Tag-based (`v*` push) | One tag = one version = one publish. Simple and reliable |
| Monorepo (fixed versioning) | Tag-based (`v*` push) | All packages share one version, so one tag works |
| Monorepo (independent versioning) | Commit-based ("Version Packages") | Multiple packages have different versions; no single tag represents the release |
| Any | Manual (`workflow_dispatch`) | Useful as a supplementary trigger for re-runs or controlled releases |

**Key constraint:** Commit-based triggers require **merge commit** or **fast-forward merge** strategy. Squash merges rewrite the commit message and break the `startsWith(github.event.head_commit.message, 'Version Packages')` condition.

## Config File Necessity

`pubm.config.ts` is optional. pubm auto-detects packages, ecosystems, and registries.

### When you do NOT need a config file

- Single-ecosystem project (JS-only or Rust-only)
- Default registries are correct (npm+jsr for JS, crates for Rust)
- No plugins needed
- Default build/test commands from package manifest are sufficient

### When you DO need a config file

| Scenario | Config needed |
|---|---|
| Override detected registries (e.g., npm only, skip jsr) | `packages[].registries` |
| Use any plugin (brew, externalVersionSync, custom) | `plugins` |
| Custom build or test commands | `packages[].build` or `packages[].test` |
| Private registry | `packages[].registries` with URL |
| Multi-ecosystem directory (Cargo.toml + package.json) | `packages[].ecosystem` |
| Monorepo with non-standard package paths | `packages[].path` |
| Release assets / platform binaries | `releaseAssets` |

**Rule of thumb:** If `pubm inspect packages` shows the correct packages with correct registries, you don't need a config file.

## Phase Strategy

How to split work between local and CI:

### Option A: Local standalone (no CI)

```bash
pubm  # runs both prepare and publish locally
```

**Best for:** Simple projects, single developer, no cross-platform builds needed.

### Option B: Prepare local + Publish in CI

```bash
# Local: runs tests, builds, bumps versions, creates tags, pushes
pubm --phase prepare

# CI: triggered by tag/commit, publishes to registries
pubm --mode ci --phase publish
```

**Best for:** Most projects. Version control stays local, publishing is automated and reproducible.

### Option C: Full CI automation

```bash
# CI prepare job: triggered by changeset merge
pubm --mode ci --phase prepare

# CI publish job: triggered by version commit/tag
pubm --mode ci --phase publish
```

**Best for:** Teams with strict release processes, projects using changesets with automated version PRs.

### Decision flow

1. Do you need cross-platform builds? → **Option B or C** (CI handles the build matrix)
2. Do you use changesets with a team? → **Option C** (fully automated)
3. Solo developer, simple project? → **Option A** (local is fine)
4. Default recommendation → **Option B** (balance of control and automation)

## Multi-Ecosystem Projects

When a directory contains manifests for multiple ecosystems (e.g., `Cargo.toml` + `package.json`):

### The problem

pubm checks Rust first, then JavaScript. Only one ecosystem is detected per directory. If both `Cargo.toml` and `package.json` exist, Rust wins and JavaScript is ignored.

### Solution 1: Explicit ecosystem in config

```typescript
import { defineConfig } from 'pubm';

export default defineConfig({
  packages: [
    {
      path: '.',
      ecosystem: 'js',
      registries: ['npm'],
    },
    {
      path: '.',
      ecosystem: 'rust',
      registries: ['crates'],
    },
  ],
});
```

### Solution 2: Separate directories

Organize Rust and JS code in separate directories so each is detected independently:

```
packages/
  my-lib/          # package.json → JS detected
  my-lib-native/   # Cargo.toml → Rust detected
```

**Recommendation:** Solution 1 if the project is already structured with both manifests at the root. Solution 2 for new projects or when restructuring is feasible.
