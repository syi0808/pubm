# CI/CD Templates for pubm

## How pubm Works in CI

pubm detects CI environments using the `std-env` package (`isCI` flag). When running in CI:

- Interactive prompts are disabled (`promptEnabled` is set to `false`).
- **Use `--mode ci --phase publish`** for the full CI pipeline: publish + GitHub Release with assets. Alternatively, use `--phase publish` if you only need the publish step.
- Both modes read each package's version from its local manifest (`package.json`, `jsr.json`, `Cargo.toml`). Packages whose version is already published on the registry are automatically skipped.
- In monorepo independent versioning mode, each package's version is read independently. Fixed mode uses a single shared version.
- Authentication is handled entirely through environment variables (no interactive login).

### What `--mode ci --phase publish` Does

- Skips prerequisites check (branch validation, remote status, working tree).
- Skips required conditions check (registry ping, login validation).
- Skips tests, build, version bump, git commit, tag creation, and tag pushing.
- Publishes to all configured registries concurrently.
- Creates a GitHub Release with release notes and uploads platform binary assets.
- Requires `GITHUB_TOKEN` environment variable.

### What `--phase publish` Does

- Same as `--mode ci --phase publish` but **without** GitHub Release creation.
- Runs **only** the publish step for all configured registries, concurrently.

For tag-based workflows, the git tag must already exist before running. For commit-based monorepo workflows, tags are created locally and pushed alongside the commit.

## Required Secrets

| Secret | Registry | Description | How to Create |
|---|---|---|---|
| `GITHUB_TOKEN` | GitHub Releases | GitHub token for creating releases and uploading assets | Automatically available as `secrets.GITHUB_TOKEN` in GitHub Actions |
| `NODE_AUTH_TOKEN` | npm | npm automation token | npmjs.com > Access Tokens > Generate New Token > Automation |
| `JSR_TOKEN` | jsr | JSR API token | jsr.io/account/tokens/create (select "Interact with the JSR API") |
| `CARGO_REGISTRY_TOKEN` | crates.io | crates.io API token | crates.io > Account Settings > API Tokens |

**npm note:** pubm checks for `NODE_AUTH_TOKEN` specifically (not `NPM_TOKEN`). In CI, it publishes with `--provenance --access public` automatically. If your package has 2FA enabled for token-based access, publishing will fail -- disable "Require two-factor authentication for write actions" in the package access settings on npmjs.com.

## Template: GitHub Actions -- Tag-Based Auto Publish

The simplest approach. Create and push a tag locally (or via pubm's local workflow), and CI publishes automatically.

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm install

      - name: Install pubm
        run: npm install -g pubm

      - name: Publish to registries
        run: pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

### Workflow

1. Develop and merge to main.
2. Run `pubm --no-publish` locally (it bumps version, creates a git commit and tag, pushes tags — without publishing).
3. The pushed `v*` tag triggers this workflow.
4. `pubm --mode ci --phase publish` reads the tag, publishes, and creates a GitHub Release.

## Template: GitHub Actions -- Monorepo Auto Publish (Commit-Based)

For monorepos using pubm's changeset workflow with independent or fixed versioning. The workflow triggers when a "Version Packages" commit is pushed to main.

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    branches:
      - main

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    if: startsWith(github.event.head_commit.message, 'Version Packages')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm install

      - name: Install pubm
        run: npm install -g pubm

      - name: Publish to registries
        run: pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

### Workflow

1. Develop and merge to main.
2. When ready to release, merge the "Version Packages" PR (created by pubm's changeset workflow).
3. The merged commit message starts with "Version Packages", triggering this workflow.
4. `pubm --mode ci --phase publish` reads each package's manifest version, publishes unpublished packages, and creates GitHub Releases.

**Important:** This template requires merge commit or fast-forward merge strategy. Squash merges may alter the commit message and break the trigger condition.

## Template: GitHub Actions -- Manual Trigger (workflow_dispatch)

Use this when you want to trigger a publish manually from the GitHub Actions UI.

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to publish (e.g., 1.2.3)'
        required: true
        type: string

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm install

      - name: Install pubm
        run: npm install -g pubm

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Create version tag
        run: |
          npm version ${{ inputs.version }} --no-git-tag-version
          git add -A
          git commit -m "v${{ inputs.version }}"
          git tag "v${{ inputs.version }}"

      - name: Publish to registries
        run: pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}

      - name: Push tags
        run: git push --follow-tags
```

**Important:** Since `pubm --mode ci --phase publish` requires an existing git tag, the workflow creates the tag before running pubm. The `--mode ci --phase publish` flags then read that tag as the version.

## Template: Multi-Registry (npm + jsr + crates.io)

For projects that publish to all three ecosystems.

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies
        run: npm install

      - name: Install pubm
        run: npm install -g pubm

      - name: Publish to all registries
        run: pubm --mode ci --phase publish --registry npm,jsr,crates
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

## Template: Publish with Build and Test (Pre-Tag Workflow)

If you want CI to run tests and build before the tag-triggered publish job, use a two-job approach.

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm install

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

  publish:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm install

      - name: Install pubm
        run: npm install -g pubm

      - name: Publish to registries
        run: pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

## Notes

- **`--mode ci --phase publish` is the recommended CI mode.** It publishes to all configured registries and creates a GitHub Release with assets. Use `--phase publish` if you only want the publish step without GitHub Release creation.
- **`id-token: write` permission** is needed for npm provenance. pubm automatically uses `npm publish --provenance --access public` in CI.
- **`fetch-depth: 0`** is recommended on `actions/checkout` for GitHub Release note generation, which uses git history to build commit-based release notes. For single-package tag-based workflows, it's also needed for tag lookup.
- **`registry-url` on `actions/setup-node`** configures the npm registry URL. This is required for `NODE_AUTH_TOKEN` to be picked up by npm.
- **jsr CLI dependency:** If publishing to jsr, ensure `jsr` is listed as a devDependency in `package.json`. The `npm install` step in CI will make it available. pubm invokes `jsr` directly for jsr publishing.
- **The `--registry` flag** defaults to `npm,jsr`. Use `--registry npm` for npm-only, `--registry jsr` for jsr-only, or `--registry npm,jsr,crates` for all three.
- **crates.io publishing** uses `cargo publish` under the hood. The `CARGO_REGISTRY_TOKEN` environment variable is read by cargo automatically.
- **2FA limitation:** In CI, npm publish with 2FA (OTP) is not supported. If your package requires 2FA for token-based writes, disable it in the package access settings on npmjs.com.

## Template: Changeset Check (PR Validation)

This workflow is generated by `pubm init --changesets`. It validates that every PR includes a changeset file.

### How It Works

- Triggers on pull_request events (opened, synchronize, reopened, labeled, unlabeled)
- Checks for new `.pubm/changesets/*.md` files in the PR diff
- Posts/updates a bot comment on the PR with the result
- Fails the check if no changeset is found
- Skips when the `no-changeset` label is applied

### Generated File

`.github/workflows/changeset-check.yml` — generated by `pubm init --changesets`. The default branch is auto-detected from the git remote.

### Comment Behavior

The workflow uses `actions/github-script@v7` to post a single PR comment (identified by an HTML marker `<!-- changeset-check -->`). The comment is updated on each push, not duplicated.

| State | Comment | Check Result |
|---|---|---|
| Changeset files found | ✅ Changeset detected (with file list) | Pass |
| No changeset files | ❌ No changeset found (with instructions) | Fail |
| `no-changeset` label | ⚠️ Check skipped | Pass |

### Required Permissions

```yaml
permissions:
  contents: read       # Read repository to diff files
  pull-requests: write # Post/update PR comments
```

No additional secrets are required — `GITHUB_TOKEN` is automatically available.
