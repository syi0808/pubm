# CI/CD Templates for pubm

## How pubm Works in CI

pubm detects CI environments using the `std-env` package (`isCI` flag). When running in CI:

- Interactive prompts are disabled (`promptEnabled` is set to `false`).
- **Only `--publish-only` mode is supported.** Running pubm without `--publish-only` in CI throws: `"Version must be set in the CI environment. Please define the version before proceeding."`
- `--publish-only` reads the latest git tag (via `git describe --tags --abbrev=0`), strips the `v` prefix, and uses it as the publish version. The tag must already exist and be a valid semver.
- Authentication is handled entirely through environment variables (no interactive login).

### What `--publish-only` Does

- Skips prerequisites check (branch validation, remote status, working tree).
- Skips required conditions check (registry ping, login validation).
- Skips tests, build, version bump, git commit, tag creation, tag pushing, and release draft.
- Runs **only** the publish step for all configured registries, concurrently.

This means your CI workflow must ensure the git tag already exists before `pubm --publish-only` runs.

## Required Secrets

| Secret | Registry | Description | How to Create |
|---|---|---|---|
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
        run: pubm --publish-only
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

### Workflow

1. Develop and merge to main.
2. Run `pubm --no-publish` locally (it bumps version, creates a git commit and tag, pushes tags — without publishing).
3. The pushed `v*` tag triggers this workflow.
4. `pubm --publish-only` reads the tag and publishes.

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
        run: pubm --publish-only
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}

      - name: Push tags
        run: git push --follow-tags
```

**Important:** Since `pubm --publish-only` requires an existing git tag, the workflow creates the tag before running pubm. The `--publish-only` flag then reads that tag as the version.

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
        run: pubm --publish-only --registry npm,jsr,crates
        env:
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
        run: pubm --publish-only
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

## Notes

- **`--publish-only` is mandatory in CI.** Without it, pubm throws an error. This flag skips version bump, tag creation, tests, and build -- it only runs the publish step.
- **`id-token: write` permission** is needed for npm provenance. pubm automatically uses `npm publish --provenance --access public` in CI.
- **`fetch-depth: 0`** is required on `actions/checkout` so that `git describe --tags --abbrev=0` can find the latest tag. Without full history, the tag lookup fails.
- **`registry-url` on `actions/setup-node`** configures the npm registry URL. This is required for `NODE_AUTH_TOKEN` to be picked up by npm.
- **The `--registry` flag** defaults to `npm,jsr`. Use `--registry npm` for npm-only, `--registry jsr` for jsr-only, or `--registry npm,jsr,crates` for all three.
- **crates.io publishing** uses `cargo publish` under the hood. The `CARGO_REGISTRY_TOKEN` environment variable is read by cargo automatically.
- **2FA limitation:** In CI, npm publish with 2FA (OTP) is not supported. If your package requires 2FA for token-based writes, disable it in the package access settings on npmjs.com.
