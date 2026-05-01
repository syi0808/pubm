# Setup Decision Guides

Decision trees for common setup choices. Use these when recommending configuration during the publish-setup workflow.

## CI Trigger Strategy

Choose how CI publishes get triggered:

| Project type | Recommended trigger | Why |
|---|---|---|
| Single package | Tag-based (`v*` push) | One tag = one version = one publish. Simple and reliable |
| Monorepo (fixed versioning) | Tag-based (`v*` push) | All packages share one version, so one tag works |
| Monorepo (independent versioning) | Commit-based ("Version Packages") | Multiple package tags may be created, so the version commit is the reliable trigger |
| Any | Manual (`workflow_dispatch` with prepared ref input) | Useful as a supplementary trigger for re-runs of a prepared release |

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

## Release Path Strategy

Choose one of the two supported current release paths before generating scripts or CI workflows:

### Direct Release

```bash
pubm  # runs the full Direct Release
```

**Best for:** Simple projects, single-maintainer projects, and teams that want one trusted local environment or controlled job to run the full release.

### Split CI Release

```bash
# Local: Prepare for CI publish validates, collects/syncs tokens, writes versions, creates tags, pushes the release commit and tags, and does not publish packages
pubm --phase prepare

# CI: Publish prepared release reads manifest versions, publishes packages, and creates GitHub Releases
pubm --phase publish
```

**Best for:** Most projects. Version control stays local, publishing is automated and reproducible.

### Unsupported current scope

Fully automated CI, release approval PRs, and release-pr flows are future `pubm-actions` scope. Do not recommend them as a current CLI or setup-skill path.

### Decision flow

1. Need CI for platform-specific builds, protected publishing secrets, or reproducible publish jobs? → **Split CI Release**
2. Want one local or controlled job to run versioning, publishing, and GitHub Releases together? → **Direct Release**
3. Default recommendation for teams → **Split CI Release**
4. Default recommendation for simple solo projects → **Direct Release**

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
