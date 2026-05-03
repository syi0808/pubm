# CI/CD Templates for pubm

## How pubm Works in Split CI Release

These templates are for the CI half of **Split CI Release**. The local command is `pubm --phase prepare`; the CI workflow runs `pubm --phase publish`.

| Phase | Command | What it does |
|---|---|---|
| **Prepare for CI publish** | `pubm --phase prepare` | Validate, collect/sync tokens, write versions, create tags, push the release commit and tags, do not publish packages |
| **Publish prepared release** | `pubm --phase publish` | Read manifest versions, publish packages, create GitHub Releases with assets |

Omitting `--phase` runs Direct Release and is not the command shape for these CI templates.

### What `--phase publish` does

- Skips prerequisites check (branch, remote, working tree).
- Skips conditions check (registry ping, login validation).
- Skips tests, build, version bump, git commit, tag creation, tag pushing.
- Reads each package's version from its manifest (`package.json`, `jsr.json`, `deno.json`, `deno.jsonc`, or `Cargo.toml`).
- Publishes to all configured registries concurrently. Already-published versions are skipped.
- Creates a GitHub Release with release notes and uploads release assets.
- Is intended for CI and non-interactive token execution.
- In monorepo independent mode, each package version is read independently. Fixed mode uses a shared version.

### What `--phase prepare` does

- Validates the project, registry access, and plugin credentials.
- Collects required tokens and can sync them to GitHub Secrets.
- Writes versions, creates release tags, and pushes the release commit and tags.
- Runs publish dry-runs for configured registries.
- Does not publish packages.

### Local workflow that triggers CI

Run `pubm --phase prepare` locally for Prepare for CI publish. It validates, collects/syncs tokens, writes versions, creates tags, pushes the release commit and tags, and does not publish packages. That push triggers the CI workflow, which runs Publish prepared release.

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

Pick the block that matches the user's package manager. These are **composable building blocks**; insert them into the templates below.

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

Publish step: `npx pubm --phase publish`

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

Publish step: `pnpm exec pubm --phase publish`

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

Publish step: `yarn pubm --phase publish`

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

Publish step: `bunx pubm --phase publish`

**Note:** `actions/setup-node` with `registry-url` is still required even with bun; `NODE_AUTH_TOKEN` is only picked up by npm when registry-url is configured.

### Rust (crates.io)

For Rust-only projects, install pubm via Homebrew instead of npm. This requires that pubm's Homebrew formula is already published; see `references/homebrew-setup.md` for details.

If the user also has `@pubm/plugin-brew` configured, installing pubm via Homebrew in CI keeps the setup symmetrical: pubm publishes their tool to Homebrew, and they install pubm itself from Homebrew.

```yaml
      - uses: dtolnay/rust-toolchain@stable

      - name: Install pubm
        run: |
          brew tap syi0808/tap
          brew install pubm
```

Publish step: `pubm --phase publish`

**Note:** No `actions/setup-node` needed for Rust-only projects. If publishing to both npm/jsr and crates.io, combine with a JS setup block above.

## Choosing a Trigger Strategy

| Project type | Trigger | Why |
|---|---|---|
| **Single-package** | Tag-based (`v*` push) | Simplest: one tag, one version, one publish |
| **Monorepo** | Commit-based ("Version Packages" on main) | Multiple package tags may be created, so the version commit is the reliable trigger |
| **Manual** | `workflow_dispatch` with a prepared ref input | For controlled re-runs of a release that was already prepared |

## Template: Single Package - Tag-Based

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
        run: <runner> pubm --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}  # npm
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}              # jsr
          # CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}  # crates.io
```

Replace `<runner>` with `npx`, `pnpm exec`, `yarn`, `bunx`, or remove it for Homebrew-installed pubm. Include only the env vars for registries the user targets.

### Workflow

1. Develop and merge to main.
2. Run `pubm --phase prepare` locally. It validates, collects/syncs tokens, writes versions, creates tags, pushes the release commit and tags, and does not publish packages.
3. The pushed `v*` tag triggers this workflow.
4. `--phase publish` reads the manifest version, publishes packages, and creates the GitHub Release.

## Template: Monorepo - Commit-Based

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
        run: <runner> pubm --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}  # npm
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}              # jsr
```

### Workflow

1. Develop and merge to main.
2. When ready to release, run `pubm --phase prepare` locally.
3. Prepare writes and pushes the "Version Packages" commit, which triggers this workflow. Package tags are pushed too, but the commit is the trigger.
4. `--phase publish` reads each package's manifest version, publishes unpublished packages, and creates GitHub Releases.

**Important:** This requires a **merge commit or fast-forward merge** strategy. Squash merges change the commit message and break the trigger.

**Note:** For advanced monorepo patterns (cross-platform builds, platform binary signing), see the [CI Patterns](#ci-patterns) section below.

## Template: Manual Trigger (workflow_dispatch)

```yaml
# .github/workflows/release.yml
name: Release

on:
  workflow_dispatch:
    inputs:
      ref:
        description: "Prepared release tag or commit SHA from pubm --phase prepare"
        required: true
        type: string

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
          ref: ${{ inputs.ref }}

      # --- INSERT SETUP BLOCK FOR YOUR PACKAGE MANAGER ---

      - name: Publish and release
        run: <runner> pubm --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

**Note:** The version must already be bumped and tagged before triggering. Use `pubm --phase prepare` locally first, then enter the prepared tag or commit SHA in the `ref` input. Do not run this template from the default branch unless that branch is already at the prepared release commit.

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
        run: bunx pubm --phase publish
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
        run: pubm --phase publish
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
        run: pnpm exec pubm --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
```

## Template: Changeset Check (PR Validation)

Generated by `pubm init --changesets`. Uses the [`syi0808/pubm-actions`](https://github.com/syi0808/pubm-actions) GitHub Action to check that every PR includes a properly formatted changeset file.

### How it works

- Triggers on pull_request events (opened, synchronize, reopened, labeled, unlabeled)
- Detects new `.pubm/changesets/*.md` files in the PR diff
- Validates changeset format (YAML frontmatter, bump types, package paths)
- Posts/updates a bot comment on the PR with the result
- Fails the check if no changeset is found or validation errors exist
- Skips when the `no-changeset` label is applied

### Generated File

`.github/workflows/pubm-changeset-check.yml` - default branch is auto-detected from the git remote.

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

      - uses: syi0808/pubm-actions/changeset-check@v1
        with:
          skip-label: no-changeset
```

### Comment behavior

Posts a single PR comment (identified by `<!-- pubm:changeset-check -->`). Updated on each push, not duplicated.

| State | Comment | Check Result |
|---|---|---|
| Changeset files found | ✅ Changeset detected (with file/package/bump table) | Pass |
| Changeset has format errors | ❌ Invalid changeset(s) (with error table) | Fail |
| No changeset files | ❌ No changeset found (with `pubm changesets add` instructions) | Fail |
| `no-changeset` label | ⚠️ Check skipped | Pass |

### Action inputs

| Input | Description | Default |
|-------|-------------|---------|
| `skip-label` | PR label name that bypasses the changeset requirement | `no-changeset` |
| `comment` | Whether to post/update a PR comment with the result | `true` |
| `token` | GitHub token for posting comments | `${{ github.token }}` |
| `working-directory` | Root of the project (if not repo root) | `.` |

### Required permissions

```yaml
permissions:
  contents: read
  pull-requests: write
```

No additional secrets required; `GITHUB_TOKEN` is automatically available.

## CI Patterns

Advanced CI patterns for complex publishing scenarios. For basic trigger templates (tag-based, commit-based, manual), see the templates above.

### Cross-Platform Matrix Build

Build platform-specific binaries on native runners, collect artifacts, then publish from a single job.

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
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Build binary
        run: |
          # Build for ${{ matrix.target }}...
          # Output to dist/${{ matrix.target }}/

      - name: Sign macOS binary
        if: runner.os == 'macOS'
        run: |
          codesign --remove-signature dist/${{ matrix.target }}/binary
          codesign -s - dist/${{ matrix.target }}/binary

      - uses: actions/upload-artifact@v4
        with:
          name: binary-${{ matrix.target }}
          path: dist/${{ matrix.target }}/

  publish:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/download-artifact@v4
        with:
          path: dist/
          merge-multiple: true

      # --- INSERT SETUP BLOCK FOR YOUR PACKAGE MANAGER ---

      - name: Publish and release
        run: <runner> pubm --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
```

**Key points:**
- macOS binaries **must** be signed on macOS runners using native `codesign`. `rcodesign` is no longer used.
- The publish job downloads all artifacts into `dist/` where pubm's asset pipeline can resolve them via glob patterns.
- Configure `releaseAssets` in `pubm.config.ts` to match the artifact directory structure.

### pubm as CI Trigger

Use local Prepare for CI publish to control when releases happen, while CI handles the actual build and Publish prepared release.

```
Developer                          CI
   │                                │
   ├─ pubm --phase prepare          │
   │  ├─ runs tests                 │
   │  ├─ runs build                 │
   │  ├─ bumps versions             │
   │  ├─ creates "Version Packages" │
   │    commit + tags               │
   │  ├─ pushes commit and tags     │
   │  └─ git push --follow-tags ────┤
   │                                ├─ triggered by tag/commit
   │                                ├─ checkout + setup
   │                                ├─ build (possibly cross-platform)
   │                                └─ pubm --phase publish
   │                                   ├─ publish to registries
   │                                   └─ create GitHub Release
```

**When to use this pattern:**
- You want manual control over release timing
- CI needs to do platform-specific builds that can't run locally
- You want local validation (tests, dry-run) before triggering CI

**Local command:**
```bash
pubm --phase prepare
```

This runs Prepare for CI publish: validates, collects/syncs tokens, writes versions, creates the commit and tags, pushes the release commit and tags, and does not publish packages. The push triggers CI.

### Platform Binary Signing in CI

macOS binaries require code signing. Here's how to handle it in CI:

**macOS runners (recommended):**
```yaml
      - name: Sign binary
        if: runner.os == 'macOS'
        run: |
          codesign --remove-signature $BINARY_PATH
          codesign -s - $BINARY_PATH
```

**Why `--remove-signature` first:** Some build tools embed a malformed signature. Removing it before re-signing ensures a clean ad-hoc signature.

**Linux cross-compilation for macOS:**
- Native `codesign` is not available on Linux
- Build darwin binaries on macOS runners instead
- If macOS runners are not available, the binaries will be unsigned and will be killed by Gatekeeper on macOS

**Windows:** No code signing needed for basic distribution. Windows SmartScreen warnings can be suppressed with a proper code signing certificate (out of scope for pubm).

## Notes

- **Phase is only for Split CI Release.** Omit `--phase` for Direct Release, or specify `--phase prepare` / `--phase publish` when preparation and publishing run in separate jobs.
- **`id-token: write`** is needed for npm provenance (`npm publish --provenance`). It is not needed for Rust-only projects.
- **`fetch-depth: 0`** is required for GitHub Release note generation and tag lookup.
- **`registry-url` on `actions/setup-node`** is required for `NODE_AUTH_TOKEN` to be picked up by npm.
- **jsr CLI dependency:** Make sure `jsr` is listed as a devDependency for jsr publishing.
- **`--registry` flag** defaults to `npm,jsr`. Use `--registry npm`, `--registry jsr`, or `--registry npm,jsr,crates`.
- **crates.io** uses `cargo publish`; `CARGO_REGISTRY_TOKEN` is read by cargo automatically.
