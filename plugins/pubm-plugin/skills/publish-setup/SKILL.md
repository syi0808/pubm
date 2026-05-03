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

Set up pubm in the current project.

pubm can publish to npm, jsr, crates.io, and private registries in one run. It supports JavaScript/TypeScript and Rust projects with automatic detection.

## Workflow

### 1. Analyze project structure

Start by mapping out the project layout so the rest of the setup matches the repo.

**Scan the following:**
- **Manifest files**: `package.json`, `jsr.json`, `deno.json`, `deno.jsonc`, `Cargo.toml` to detect the ecosystem (JS, Rust, or both)
- **Workspace config**: `pnpm-workspace.yaml`, `package.json` workspaces, `Cargo.toml [workspace]` to detect monorepo structure
- **Package manager**: lock files (`bun.lockb`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`) to determine install commands
- **Existing config**: `pubm.config.ts` / `.js` / `.mjs` to check if pubm is already configured
- **CI/CD**: `.github/workflows/`, `.gitlab-ci.yml`, etc. for existing CI setup
- **Version references**: files outside manifests that contain version strings, such as README badges or `plugin.json`
- **Build artifacts**: `dist/`, `build/`, `bin/` to understand build outputs
- **Release workflow**: existing release scripts in `package.json`, `Makefile`, and similar files

**Present findings to the user:**
- Project type: single-package, monorepo, or multi-ecosystem
- Detected packages and their ecosystems
- Current release workflow, if there is one
- Likely needs such as version sync, Homebrew, or CI automation

Use this analysis to decide which registries to suggest, which supported release path to recommend, whether a config file is needed, and whether custom plugins are required.

### 2. Ask about release path, CI/CD, and changesets

Ask the user:
1. **Release path**: Direct Release (`pubm`) or Split CI Release (local `pubm --phase prepare`, CI `pubm --phase publish`). Use `references/decision-guides.md` to recommend one.
2. **Set up CI/CD** for Split CI Release publishing? Only generate publish workflows after the user chooses Split CI Release.
3. **Use changesets workflow?** (Track changes per PR, automate versioning + CHANGELOG)

Store the answers for subsequent steps. Do this before installing plugins, writing config, or generating workflows so later choices match the release path.

### 3. Check if pubm is installed

Check `package.json` devDependencies for `pubm`. If it is missing, ask whether to install:
- `npm install -D pubm` or `pnpm add -D pubm` (detect package manager from lock files)
- pubm itself is an npm package, so even Rust projects need Node.js and npm to use it

### 4. Review auto-detected packages and registries

Run `pubm inspect packages` to show the detected ecosystem, packages, and target registries.

pubm auto-detects:
- **Ecosystem**: JavaScript (package.json, deno.json, deno.jsonc) or Rust (Cargo.toml)
- **Packages**: Workspace packages via pnpm-workspace.yaml, package.json workspaces, or Cargo.toml [workspace]. Falls back to single-package if no workspace found.
- **Registries per package**:
  - JS: npm (default when package.json exists), jsr (when jsr.json or deno.json/deno.jsonc exists), private registry (from publishConfig.registry or .npmrc)
  - Rust: crates (always)

Show the output and ask:
1. Is this detection correct?
2. Is there any additional registry to publish to, such as adding jsr to a package that only has npm or adding a private registry URL?

If the user wants changes (add/remove registries, add/remove packages), note them for config generation in Step 6.

### 5. Ask about official plugins

Show the available official plugins and ask which, if any, to use:

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

### 5.1. Evaluate need for custom plugins

Based on the project analysis in Step 1, if the user needs something that pubm's built-in features or official plugins do not cover, guide them to create a custom plugin.

**Signals that a custom plugin is needed:**
- Post-release notifications (Slack, Discord, email, etc.)
- Custom artifact publishing (S3, CDN, etc.)
- Integration with external services (Sentry release tracking, deployment triggers, etc.)
- Custom validation or pre-publish checks beyond what pubm provides
- Automated documentation updates on release

**When a custom plugin is needed:**
1. Explain which hook(s) would be appropriate for the requirement
2. Ask the user: **"이 기능을 위해 커스텀 플러그인을 만들까요?"**
3. If yes, invoke the `/create-plugin` skill to scaffold the plugin
4. After the plugin is created, return to this setup flow and include it in config generation in Step 6

### 5.2. Install jsr CLI (if jsr is among registries)

If any package targets jsr, check `package.json` devDependencies for `jsr`. If not installed, install it using the project's package manager.

### 6. Generate pubm config file (conditional)

**Only create `pubm.config.ts` when needed.** Create one when:
- User overrode auto-detected registries (explicit packages config required)
- User selected plugins
- User needs non-default config (versioning strategy, etc.)

**When config is NOT needed:** Tell the user that pubm's auto-detection covers the setup and no config file is required.

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

### 7. Generate missing registry config files

For each registry a package targets, check whether its required config file exists. If not, generate it from whichever source file is available.

**Generation rules:**

| Target registry | Required file | Source file | Reference |
|---|---|---|---|
| `jsr` | `jsr.json` | `package.json` or `deno.json`/`deno.jsonc` | `references/registry-jsr.md` |
| `npm` or custom URL | `package.json` | `jsr.json` or `deno.json`/`deno.jsonc` | `references/registry-npm.md` |
| `crates` | `Cargo.toml` | `package.json` | `references/registry-crates.md` |

Read the corresponding registry reference file for the template and constraints.

**Behavior:**
- If the required file already exists, skip silently.
- If neither source file nor target file exists, inform the user and ask them to create one manually.
- Before writing any generated file, show the content and ask for confirmation.

### 8. CI setup (if Split CI Release was selected in Step 2)

1. **Ask CI platform**: Default to GitHub Actions if not specified.
2. **Ask trigger method**:
   - **Tag-based** (recommended for single-package): push a `v*` tag to trigger publish
   - **Commit-based** (recommended for monorepo): trigger on "Version Packages" commit to main
   - **Manual** (workflow_dispatch): trigger from the GitHub Actions UI
   - **Both**: supports multiple triggers
3. **Determine registries**: Use the registries confirmed in Step 3.
4. **Generate workflow file**: Read `references/ci-templates.md` for the appropriate template. Create `.github/workflows/publish.yml`.
5. **List required secrets**: Based on the target registries:
   - `GITHUB_TOKEN` for GitHub Releases (automatically available as `secrets.GITHUB_TOKEN`; no manual setup needed)
   - `NODE_AUTH_TOKEN` for npm (create at npmjs.com > Access Tokens > Automation)
   - `JSR_TOKEN` for jsr (create at jsr.io/account/tokens/create)
   - `CARGO_REGISTRY_TOKEN` for crates.io (create at crates.io > Account Settings > API Tokens)

### 9. Changesets Workflow (if selected in Step 2)

Run the CLI to set up the changesets workflow:

```bash
pubm init
```

This creates:
- `.github/workflows/changeset-check.yml` - PR changeset detection with bot comments
After running, tell the user:
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
2. Run `pubm changesets add` to select packages, bump type, and summary
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

### 10. Add npm scripts (JS projects only)

Add to `package.json`. The `release` script depends on whether CI was set up:

**If Split CI Release was selected** (publishing is handled by CI):
```json
{
  "scripts": {
    "release": "pubm --phase prepare",
    "release:ci": "pubm --phase publish"
  }
}
```
For Split CI Release, `--phase prepare` runs Prepare for CI publish: it validates the project, collects/syncs tokens, writes versions, creates tags, pushes the release commit and tags, and does not publish packages. `--phase publish` runs Publish prepared release in CI: it reads manifest versions, publishes packages, and creates GitHub Releases.

**If Direct Release was selected** (publishing is done locally or by one controlled job):
```json
{
  "scripts": {
    "release": "pubm"
  }
}
```

### 11. Present summary

List all files created or modified and remind them about required authentication. Show only the lines for registries the user selected:

- **npm**: Run `npm login` locally, or set `NODE_AUTH_TOKEN` secret in GitHub
- **jsr**: Run `pubm` locally (interactive token prompt), or set `JSR_TOKEN` secret in GitHub
- **crates.io**: Run `cargo login` locally, or set `CARGO_REGISTRY_TOKEN` secret in GitHub

Remind the user they can run `pubm inspect packages` at any time to check the detected setup.

## Constraints

- Always use `defineConfig()` from `pubm` for type safety in config files.
- Config uses a `packages` array with per-package `registries`; there is no top-level `registries` field on `PubmConfig`.
- The config file is optional. Only create it when auto-detection needs to be overridden or plugins are used.
- If you are not sure which registries the user wants, ask.
- When suggesting npm scripts, use `"release": "pubm"` for Direct Release. Use `"release": "pubm --phase prepare"` and `"release:ci": "pubm --phase publish"` for Split CI Release.
- In CI, use `--phase publish` for Publish prepared release: publish packages plus GitHub Release creation.
- When Step 1 reveals requirements beyond built-in features and official plugins, use the `/create-plugin` skill to scaffold a custom plugin before generating the config file.

## References

- `references/registry-jsr.md` -- JSR-specific constraints and templates
- `references/registry-npm.md` -- npm-specific constraints and templates
- `references/registry-crates.md` -- crates.io-specific constraints and templates
- `references/config-examples.md` -- Config file templates and type reference
- `references/ci-templates.md` -- CI/CD pipeline templates (package manager-specific setup blocks)
- `references/official-plugins.md` -- Official plugin API reference (externalVersionSync, brewTap, brewCore)
- `references/homebrew-setup.md` -- Homebrew distribution setup and CI installation guide
