---
name: publish-setup
description: Set up pubm in a project (install, config, registries, CI)
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# Set Up pubm

Interactive setup wizard for pubm in the current project.

pubm publishes packages to multiple registries (npm, jsr, crates.io, private registries) simultaneously. It supports JavaScript/TypeScript and Rust ecosystems with automatic detection.

## Workflow

### 1. Check if pubm is installed

Check `package.json` devDependencies for `pubm`. If not installed, ask whether to install:
- `npm install -D pubm` or `pnpm add -D pubm` (detect package manager from lock files)
- pubm itself is an npm package, so even Rust projects need Node.js and npm to use it

### 2. Review auto-detected packages and registries

Run `pubm inspect packages` to show the auto-detected ecosystem, packages, and target registries.

pubm auto-detects:
- **Ecosystem**: JavaScript (package.json) or Rust (Cargo.toml)
- **Packages**: Workspace packages via pnpm-workspace.yaml, package.json workspaces, or Cargo.toml [workspace]. Falls back to single-package if no workspace found.
- **Registries per package**:
  - JS: npm (default when package.json exists), jsr (when jsr.json exists), private registry (from publishConfig.registry or .npmrc)
  - Rust: crates (always)

Show the output and ask the user:
1. **"이 감지 결과가 맞나요?"** — Confirm the detected packages and registries are correct
2. **"추가로 배포할 registry가 있나요?"** — e.g., adding jsr to a package that only has npm, adding a private registry URL

If the user wants changes (add/remove registries, add/remove packages), note them for config generation in Step 5.

### 3. Ask about official plugins

Present the available official plugins and ask which (if any) to use:

| Plugin | Package | Description |
|--------|---------|-------------|
| `externalVersionSync()` | `@pubm/plugin-external-version-sync` | Sync version to non-manifest files (plugin.json, README badges, etc.) |
| `brewCore()` | `@pubm/plugin-brew` | Open PR to homebrew-core on release |
| `brewTap()` | `@pubm/plugin-brew` | Update formula in a custom Homebrew tap repo on release |

**If `externalVersionSync` selected:**
1. Install the plugin: `npm install -D @pubm/plugin-external-version-sync` (or pnpm/bun equivalent)
2. Run `pubm sync --discover` to scan for version references outside manifest files
3. Show discovered references and ask which to include as sync targets
4. If the project uses independent versioning (monorepo), ask which package's version to sync, and note the `version` callback for config

**If `brewCore` selected:**
1. Install the plugin: `npm install -D @pubm/plugin-brew`
2. Ask for the formula file path (default: `Formula/<package-name>.rb`)
3. Optionally ask for `packageName` filter (for monorepo per-package releases)

**If `brewTap` selected:**
1. Install the plugin: `npm install -D @pubm/plugin-brew`
2. Ask for the formula file path (default: `Formula/<package-name>.rb`)
3. Ask for the tap repo (e.g., `user/homebrew-tap`)
4. Optionally ask for `packageName` filter

### 4. Ask about CI/CD and changesets

Ask the user:
1. **Set up CI/CD** for automated publishing?
2. **Use changesets workflow?** (Track changes per PR, automate versioning + CHANGELOG)

Store the answers for subsequent steps.

### 4.1. Install jsr CLI (if jsr is among registries)

If any package targets jsr, check `package.json` devDependencies for `jsr`. If not installed, install it using the project's package manager.

### 5. Generate pubm config file (conditional)

**Only create `pubm.config.ts` when needed.** A config file is needed when:
- User overrode auto-detected registries (explicit packages config required)
- User selected plugins
- User needs non-default config (versioning strategy, etc.)

**When config is NOT needed:** Inform the user that pubm's auto-detection covers their setup and no config file is required.

**When creating config:**

Use `defineConfig()` from `pubm` for type safety. Use `packages` array with per-package `path` and `registries`. Read `references/config-examples.md` for templates.

Example with plugins:
```typescript
import { defineConfig } from 'pubm'
import { externalVersionSync } from '@pubm/plugin-external-version-sync'

export default defineConfig({
  packages: [
    { path: 'packages/core', registries: ['npm', 'jsr'] },
    { path: 'packages/cli', registries: ['npm'] },
  ],
  plugins: [
    externalVersionSync({
      targets: [
        { file: 'plugins/.claude-plugin/plugin.json', jsonPath: 'version' },
      ],
    }),
  ],
})
```

### 6. Generate missing registry config files

For each registry that a package targets, check if its required config file exists. If missing, generate it from whichever source file is available.

**Generation rules:**

| Target registry | Required file | Source file | Reference |
|---|---|---|---|
| `jsr` | `jsr.json` | `package.json` | `references/registry-jsr.md` |
| `npm` or custom URL | `package.json` | `jsr.json` | `references/registry-npm.md` |
| `crates` | `Cargo.toml` | `package.json` | `references/registry-crates.md` |

Read the corresponding registry reference file for the template and constraints.

**Behavior:**
- If the required file already exists, skip silently.
- If neither source file nor target file exists, inform the user and ask them to create one manually.
- Before writing any generated file, show the user the content and ask for confirmation.

### 7. Update .gitignore

Check if `.pubm/` is already in `.gitignore`. If not, append it. This directory contains encrypted tokens and should not be committed.

**Note:** If the user selected changesets workflow in Step 4, the `.gitignore` update will be handled by `pubm init --changesets` instead (it uses `.pubm/*` with `!.pubm/changesets/` to track changeset files while ignoring tokens). Skip this step in that case.

### 8. CI setup (if selected in Step 4)

1. **Ask CI platform**: Default to GitHub Actions if not specified.
2. **Ask trigger method**:
   - **Tag-based** (recommended for single-package): push a `v*` tag to trigger publish
   - **Commit-based** (recommended for monorepo): trigger on "Version Packages" commit to main
   - **Manual** (workflow_dispatch): trigger from the GitHub Actions UI
   - **Both**: supports multiple triggers
3. **Determine registries**: Use the registries confirmed in Step 2.
4. **Generate workflow file**: Read `references/ci-templates.md` for the appropriate template. Create `.github/workflows/publish.yml`.
5. **List required secrets**: Based on the target registries:
   - `GITHUB_TOKEN` for GitHub Releases (automatically available as `secrets.GITHUB_TOKEN` — no manual setup needed)
   - `NODE_AUTH_TOKEN` for npm (create at npmjs.com > Access Tokens > Automation)
   - `JSR_TOKEN` for jsr (create at jsr.io/account/tokens/create)
   - `CARGO_REGISTRY_TOKEN` for crates.io (create at crates.io > Account Settings > API Tokens)

### 8.1. Changesets Workflow (if selected in Step 4)

Run the CLI to set up the changesets workflow:

```bash
pubm init --changesets
```

This creates:
- `.github/workflows/changeset-check.yml` — PR changeset detection with bot comments
- Updates `.gitignore` to track `.pubm/changesets/` while ignoring other `.pubm/` contents

After running, inform the user about the workflow:
- Every PR with code changes needs a changeset (`pubm changesets add`)
- `no-changeset` label skips the check for docs/CI-only changes
- On release, pubm consumes changesets to determine version bumps and generate CHANGELOG

Then write the following section to the project's `CLAUDE.md` (append if file exists, create if not):

```markdown
## Changesets Workflow

This project uses pubm changesets to track changes and automate versioning.

### Rules
- Every PR that changes runtime code must include a changeset file
- Add a changeset: `pubm changesets add`
- Changeset identifiers use package path (e.g., `packages/core`), not registry name. Package names are also accepted and auto-resolved to paths.
- Changeset summaries should be written from the user's perspective
- PRs with `no-changeset` label skip the changeset check (use for docs, CI config, etc.)

### Workflow
1. Make changes on a feature branch
2. Run `pubm changesets add` — select packages, bump type, and summary
3. Commit the generated `.pubm/changesets/<id>.md` file with your PR
4. On merge, changesets accumulate on main
5. When releasing, `pubm` consumes pending changesets to determine versions and generate CHANGELOG

### Bump Type Guide
- **patch**: Bug fixes, internal refactors with no API changes
- **minor**: New features, backward-compatible additions
- **major**: Breaking changes, removed/renamed public APIs

### Review Checklist
- [ ] Changeset file included (or `no-changeset` label applied)
- [ ] Bump type matches the scope of changes
- [ ] Summary is clear and user-facing
```

### 9. Add npm scripts (JS projects only)

Add to `package.json`. The `release` script depends on whether CI was set up:

**If CI was configured** (publishing is handled by CI):
```json
{
  "scripts": {
    "release": "pubm --no-publish",
    "ci:release": "pubm --ci"
  }
}
```
`--no-publish` makes the local `release` command only bump the version, create a git commit and tag, and push — CI handles the actual publishing.

**If CI was NOT configured** (publishing is done locally):
```json
{
  "scripts": {
    "release": "pubm"
  }
}
```

### 10. Present summary

List all files created/modified and remind about required authentication. Show only lines for registries the user selected:

- **npm**: Run `npm login` locally, or set `NODE_AUTH_TOKEN` secret in GitHub
- **jsr**: Run `pubm` locally (interactive token prompt), or set `JSR_TOKEN` secret in GitHub
- **crates.io**: Run `cargo login` locally, or set `CARGO_REGISTRY_TOKEN` secret in GitHub

Remind the user they can run `pubm inspect packages` at any time to verify their detected setup.

## Constraints

- Always use `defineConfig()` from `pubm` for type safety in config files.
- Config uses `packages` array with per-package `registries` — there is no top-level `registries` field on `PubmConfig`.
- Config file is optional. Only create it when auto-detection needs to be overridden or plugins are used.
- Always add `.pubm/` to `.gitignore` (unless changesets workflow handles it via `pubm init --changesets`).
- If unsure which registries the user wants, ask. Do not assume.
- When suggesting npm scripts: use `"release": "pubm --no-publish"` if CI is configured (local run only bumps version and pushes tags, CI publishes), or `"release": "pubm"` if no CI. Always use `"ci:release": "pubm --ci"` for CI.
- In CI, use `--ci` mode (publish + GitHub Release) or `--publish-only` mode (publish only).
- When changesets workflow is selected, do NOT add `.pubm/` to `.gitignore` directly — `pubm init --changesets` handles the correct pattern (`.pubm/*` + `!.pubm/changesets/`).

## References

- `references/registry-jsr.md` -- JSR-specific constraints and templates
- `references/registry-npm.md` -- npm-specific constraints and templates
- `references/registry-crates.md` -- crates.io-specific constraints and templates
- `references/config-examples.md` -- Config file templates and type reference
- `references/ci-templates.md` -- CI/CD pipeline templates
