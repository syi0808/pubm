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

pubm publishes packages to multiple registries (npm, jsr, crates.io, private registries) simultaneously. It supports JavaScript/TypeScript and Rust ecosystems.

## Workflow

### 1. Detect Ecosystem

Use Glob to check for:
- `package.json` (JavaScript/TypeScript)
- `Cargo.toml` (Rust)
- Workspace config (`pnpm-workspace.yaml`, `workspaces` in `package.json`)

If both exist, note the multi-ecosystem setup. If multiple publishable packages exist across different directories (with or without a formal workspace), ask the user which packages they want to publish and configure them via `packages` in the config with explicit `path`, `registries`, and `ecosystem` fields.

### 2. Check if pubm is installed

Check `package.json` devDependencies for `pubm`. If not installed, ask whether to install:
- `npm install -D pubm` or `pnpm add -D pubm`
- pubm itself is an npm package, so even Rust projects need Node.js and npm to use it

### 3. Ask which registries

Ask the user which registries to publish to:
- `npm` (npmjs.com)
- `jsr` (jsr.io)
- `crates` (crates.io)
- Private registry (provide URL)

### 3.1. Install jsr CLI (if jsr selected)

If the user selected jsr, check `package.json` devDependencies for `jsr`. If not installed, install it as a devDependency using the project's package manager (detect from lock files: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm).

### 4. Generate missing registry config files

For each selected registry, check if its required config file exists. If missing, generate it from whichever source file is available.

**Generation rules:**

| Selected registry | Required file | Source file | Reference |
|---|---|---|---|
| `jsr` | `jsr.json` | `package.json` | `references/registry-jsr.md` |
| `npm` or custom URL | `package.json` | `jsr.json` | `references/registry-npm.md` |
| `crates` | `Cargo.toml` | `package.json` | `references/registry-crates.md` |

Read the corresponding registry reference file for the template and constraints specific to that registry.

**Behavior:**
- If the required file already exists, skip silently.
- If neither source file nor target file exists, inform the user and ask them to create one manually.
- Before writing any generated file, show the user the content and ask for confirmation.

### 5. Generate pubm config file

Create `pubm.config.ts` using `defineConfig()` for type safety. Read `references/config-examples.md` for templates.

Example for npm + jsr:
```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  registries: ['npm', 'jsr'],
})
```

### 6. Update .gitignore

Check if `.pubm/` is already in `.gitignore`. If not, append it. This directory contains encrypted JSR tokens and should not be committed.

### 7. Ask about CI setup

Ask if the user wants to set up CI/CD for automated publishing. If yes:

1. **Ask CI platform**: Default to GitHub Actions if not specified.
2. **Ask trigger method**:
   - **Tag-based** (recommended): push a `v*` tag to trigger publish
   - **Manual** (workflow_dispatch): trigger from the GitHub Actions UI
   - **Both**: supports both triggers
3. **Determine registries**: Use the registries selected in step 3.
4. **Generate workflow file**: Read `references/ci-templates.md` for the appropriate template. Create `.github/workflows/publish.yml`.
5. **List required secrets**: Based on the target registries:
   - `NODE_AUTH_TOKEN` for npm (create at npmjs.com > Access Tokens > Automation)
   - `JSR_TOKEN` for jsr (create at jsr.io/account/tokens/create)
   - `CARGO_REGISTRY_TOKEN` for crates.io (create at crates.io > Account Settings > API Tokens)

### 8. Add npm scripts (JS projects only)

Add to `package.json`. The `release` script depends on whether CI was set up in the previous step:

**If CI was configured** (publishing is handled by CI):
```json
{
  "scripts": {
    "release": "pubm --no-publish",
    "ci:release": "pubm --publish-only"
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

### 9. Present summary

List all files created/modified and remind about required authentication. Show only lines for registries the user selected:

- **npm**: Run `npm login` locally, or set `NODE_AUTH_TOKEN` secret in GitHub
- **jsr**: Run `pubm` locally (interactive token prompt), or set `JSR_TOKEN` secret in GitHub
- **crates.io**: Run `cargo login` locally, or set `CARGO_REGISTRY_TOKEN` secret in GitHub

### 10. External Version Sync (Optional)

Ask if the project has version references outside of package manifest files (e.g., plugin metadata, docs with install commands, CI configs).

If yes:
1. Run `pubm sync --discover` to scan for references
2. Show discovered references and ask which to include
3. Add `externalVersionSync()` plugin to `pubm.config.ts`:

```typescript
import { defineConfig, externalVersionSync } from "pubm";

export default defineConfig({
  registries: ["npm", "jsr"],
  plugins: [
    externalVersionSync({
      targets: [
        // discovered targets here
      ],
    }),
  ],
});
```

If no, skip this step.

## Constraints

- Always use `defineConfig()` from `pubm` for type safety in config files.
- Always add `.pubm/` to `.gitignore`.
- If unsure which registries the user wants, ask. Do not assume.
- When suggesting npm scripts: use `"release": "pubm --no-publish"` if CI is configured (local run only bumps version and pushes tags, CI publishes), or `"release": "pubm"` if no CI. Always use `"ci:release": "pubm --publish-only"` for CI.
- In CI, pubm ONLY supports `--publish-only` mode.

## References

- `references/registry-jsr.md` -- JSR-specific constraints and templates
- `references/registry-npm.md` -- npm-specific constraints and templates
- `references/registry-crates.md` -- crates.io-specific constraints and templates
- `references/config-examples.md` -- Config file templates
- `references/ci-templates.md` -- CI/CD pipeline templates
