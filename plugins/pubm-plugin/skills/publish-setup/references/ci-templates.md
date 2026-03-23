# CI/CD Templates for pubm

## How pubm Works in CI

pubm uses a **two-phase model** in CI: **prepare** and **publish**.

| Phase | Command | What it does |
|---|---|---|
| **prepare** | `pubm --mode ci --phase prepare` | Collect tokens, validate registry access, prepare for publish |
| **publish** | `pubm --mode ci --phase publish` | Publish to all registries + create GitHub Release with assets |

CI mode (`--mode ci`) **requires** exactly one of `--phase prepare` or `--phase publish`. Omitting the phase is an error.

### What `--mode ci --phase publish` Does

- Skips prerequisites check (branch, remote, working tree).
- Skips conditions check (registry ping, login validation).
- Skips tests, build, version bump, git commit, tag creation, tag pushing.
- Reads each package's version from its manifest (`package.json`, `jsr.json`, `Cargo.toml`).
- Publishes to all configured registries concurrently. Already-published versions are skipped.
- Creates a GitHub Release with release notes and uploads release assets.
- In monorepo independent mode, each package version is read independently. Fixed mode uses a shared version.

### What `--mode ci --phase prepare` Does

- Collects required tokens and validates registry access.
- Useful as a pre-publish validation step or for interactive CI setups where tokens are gathered first.

### Local workflow (triggers CI)

Run `pubm --no-publish` locally to bump version, create a git commit + tag, and push — without publishing. This push triggers the CI workflow.

## Required Secrets

| Secret | Registry | Description | How to Create |
|---|---|---|---|
| `GITHUB_TOKEN` | GitHub Releases | Token for releases and asset uploads | Automatically available as `secrets.GITHUB_TOKEN` |
| `NODE_AUTH_TOKEN` | npm | npm automation token | npmjs.com > Access Tokens > Automation |
| `JSR_TOKEN` | jsr | JSR API token | jsr.io/account/tokens/create |
| `CARGO_REGISTRY_TOKEN` | crates.io | crates.io API token | crates.io > Account Settings > API Tokens |

**npm notes:**
- pubm checks `NODE_AUTH_TOKEN` specifically (not `NPM_TOKEN`).
- In CI, pubm publishes with `--provenance --access public` automatically.
- 2FA for token-based access must be disabled on npmjs.com for CI publishing.

## Setup Blocks by Package Manager / Ecosystem

Pick the block matching the user's package manager. These are **composable building blocks** — insert them into the templates below.

### npm

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
```

Publish step: `npx pubm --mode ci --phase publish`

### pnpm

```yaml
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm run build
```

Publish step: `pnpm exec pubm --mode ci --phase publish`

### yarn

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          cache: yarn

      - name: Install dependencies
        run: yarn install --immutable

      - name: Build
        run: yarn build
```

Publish step: `yarn pubm --mode ci --phase publish`

### bun

```yaml
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Cache bun dependencies
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
          restore-keys: |
            bun-${{ runner.os }}-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build
```

Publish step: `bunx pubm --mode ci --phase publish`

**Note:** `actions/setup-node` with `registry-url` is still required even with bun — `NODE_AUTH_TOKEN` is only picked up by npm when registry-url is configured.

### Rust (crates.io)

For Rust-only projects, install pubm via Homebrew tap instead of npm. This requires that pubm's Homebrew formula is already published — see `references/homebrew-setup.md` for details.

If the user also has `@pubm/plugin-brew` configured, installing pubm via Homebrew in CI creates a nice symmetry: pubm publishes their tool to Homebrew, and they install pubm itself from Homebrew.

```yaml
      - uses: dtolnay/rust-toolchain@stable

      - name: Install pubm
        run: |
          brew tap syi0808/tap
          brew install pubm
```

Publish step: `pubm --mode ci --phase publish`

**Note:** No `actions/setup-node` needed for Rust-only projects. If publishing to both npm/jsr and crates.io, combine with a JS setup block above.

## Choosing a Trigger Strategy

| Project type | Trigger | Why |
|---|---|---|
| **Single-package** | Tag-based (`v*` push) | Simplest — one tag, one version, one publish |
| **Monorepo** | Commit-based ("Version Packages" on main) | Each package may have a different version; no single tag |
| **Manual** | `workflow_dispatch` | For controlled, on-demand releases |

## Template: Single Package — Tag-Based

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # --- INSERT SETUP BLOCK FOR YOUR PACKAGE MANAGER ---

      - name: Publish and release
        run: <runner> pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}  # npm
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}              # jsr
          # CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}  # crates.io
```

Replace `<runner>` with `npx`, `pnpm exec`, `yarn`, `bunx`, or remove it for Homebrew-installed pubm. Include only the env vars for registries the user targets.

### Workflow

1. Develop and merge to main.
2. Run `pubm --no-publish` locally — bumps version, creates git commit + tag, pushes.
3. The pushed `v*` tag triggers this workflow.
4. `--mode ci --phase publish` reads the tag version, publishes, creates GitHub Release.

## Template: Monorepo — Commit-Based

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write
  id-token: write

jobs:
  release:
    if: startsWith(github.event.head_commit.message, 'Version Packages')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # --- INSERT SETUP BLOCK FOR YOUR PACKAGE MANAGER ---

      - name: Publish and release
        run: <runner> pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}  # npm
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}              # jsr
```

### Workflow

1. Develop and merge to main.
2. When ready to release, merge the "Version Packages" PR (created by pubm's changeset workflow).
3. The commit message starts with "Version Packages", triggering this workflow.
4. `--mode ci --phase publish` reads each package's manifest version, publishes unpublished packages, creates GitHub Releases.

**Important:** Requires **merge commit or fast-forward merge** strategy. Squash merges alter the commit message and break the trigger.

## Template: Manual Trigger (workflow_dispatch)

```yaml
# .github/workflows/release.yml
name: Release

on:
  workflow_dispatch:

permissions:
  contents: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # --- INSERT SETUP BLOCK FOR YOUR PACKAGE MANAGER ---

      - name: Publish and release
        run: <runner> pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

**Note:** Version must already be bumped and tagged before triggering. Use `pubm --no-publish` locally first.

## Full Examples

### bun + npm + jsr (monorepo)

This is the pattern used by the pubm project itself.

```yaml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write
  id-token: write

jobs:
  release:
    if: startsWith(github.event.head_commit.message, 'Version Packages')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Cache bun dependencies
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
          restore-keys: |
            bun-${{ runner.os }}-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build

      - name: Publish and release
        run: bunx pubm --mode ci --phase publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Rust + crates.io (single-package, tag-based)

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: dtolnay/rust-toolchain@stable

      - name: Install pubm
        run: |
          brew tap syi0808/tap
          brew install pubm

      - name: Publish and release
        run: pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

### pnpm + npm (single-package, tag-based)

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm run build

      - name: Publish and release
        run: pnpm exec pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
```

## Template: Changeset Check (PR Validation)

Generated by `pubm init --changesets`. Uses the [`syi0808/pubm-actions`](https://github.com/syi0808/pubm-actions) GitHub Action to validate that every PR includes a properly formatted changeset file.

### How It Works

- Triggers on pull_request events (opened, synchronize, reopened, labeled, unlabeled)
- Detects new `.pubm/changesets/*.md` files in the PR diff
- Validates changeset format (YAML frontmatter, bump types, package paths)
- Posts/updates a bot comment on the PR with the result
- Fails the check if no changeset is found or validation errors exist
- Skips when the `no-changeset` label is applied

### Generated File

`.github/workflows/changeset-check.yml` — default branch is auto-detected from the git remote.

```yaml
name: Changeset Check

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, labeled, unlabeled]

permissions:
  contents: read
  pull-requests: write

jobs:
  changeset-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: syi0808/pubm-actions@v1
        with:
          skip-label: no-changeset
```

### Comment Behavior

Posts a single PR comment (identified by `<!-- pubm:changeset-check -->`). Updated on each push, not duplicated.

| State | Comment | Check Result |
|---|---|---|
| Changeset files found | ✅ Changeset detected (with file/package/bump table) | Pass |
| Changeset has format errors | ❌ Invalid changeset(s) (with error table) | Fail |
| No changeset files | ❌ No changeset found (with `pubm changesets add` instructions) | Fail |
| `no-changeset` label | ⚠️ Check skipped | Pass |

### Action Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `skip-label` | PR label name that bypasses the changeset requirement | `no-changeset` |
| `comment` | Whether to post/update a PR comment with the result | `true` |
| `token` | GitHub token for posting comments | `${{ github.token }}` |
| `working-directory` | Root of the project (if not repo root) | `.` |

### Required Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
```

No additional secrets required — `GITHUB_TOKEN` is automatically available.

## Notes

- **CI mode requires a phase flag.** `pubm --mode ci` alone is an error — always specify `--phase prepare` or `--phase publish`.
- **`id-token: write`** is needed for npm provenance (`npm publish --provenance`). Not needed for Rust-only projects.
- **`fetch-depth: 0`** is required for GitHub Release note generation and tag lookup.
- **`registry-url` on `actions/setup-node`** is required for `NODE_AUTH_TOKEN` to be picked up by npm.
- **jsr CLI dependency:** Ensure `jsr` is listed as a devDependency for jsr publishing.
- **`--registry` flag** defaults to `npm,jsr`. Use `--registry npm`, `--registry jsr`, or `--registry npm,jsr,crates`.
- **crates.io** uses `cargo publish` — `CARGO_REGISTRY_TOKEN` is read by cargo automatically.
