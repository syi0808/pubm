---
description: Set up pubm in a project (install, config, CI)
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

## Instructions

### 1. Detect Ecosystem

Use Glob to check for:
- `package.json` (JavaScript/TypeScript)
- `Cargo.toml` (Rust)

If both exist, note the multi-ecosystem setup.

### 2. Check if pubm is installed

Check `package.json` devDependencies for `pubm`. If not installed, ask whether to install:
- `npm install -D pubm` or `pnpm add -D pubm`

### 3. Ask which registries

Ask the user which registries to publish to:
- `npm` (npmjs.com)
- `jsr` (jsr.io)
- `crates` (crates.io)
- Private registry (provide URL)

### 4. Generate missing registry config files

For each selected registry, check if its required config file exists. If missing, generate it from whichever source file is available.

**Generation rules:**

| Selected registry | Required file | Source file |
|---|---|---|
| `jsr` | `jsr.json` | `package.json` |
| `npm` or custom URL | `package.json` | `jsr.json` |
| `crates` | `Cargo.toml` | `package.json` |

**jsr.json from package.json:**
```json
{
  "name": "<package name>",
  "version": "<version>",
  "exports": "<converted from package.json exports (flatten nested import/require to plain string)>",
  "publish": {
    "include": ["<from files array, non-negated entries>"],
    "exclude": ["<from files array, negated entries (strip !), plus .npmignore/.gitignore entries>"]
  }
}
```

**package.json from jsr.json:**
```json
{
  "name": "<package name>",
  "version": "<version>",
  "files": ["<from publish.include, plus negated publish.exclude>"],
  "exports": "<converted from jsr.json exports (wrap flat strings in { import: ... })>"
}
```

**Cargo.toml from package.json:**
```toml
[package]
name = "<name, with @scope/ stripped>"
version = "<version>"
edition = "2021"
description = "<from description>"
license = "<from license>"
repository = "<from repository.url>"
authors = ["<from author>"]
```

For Cargo.toml, also check if `src/lib.rs` or `src/main.rs` exists. If neither exists, ask the user whether this is a library or binary crate, then create a minimal `src/lib.rs` or `src/main.rs`.

**Behavior:**
- If the required file already exists, skip silently.
- If neither source file nor target file exists, inform the user and ask them to create one manually.
- Before writing any generated file, show the user the content and ask for confirmation.

### 5. Generate pubm config file

Create `pubm.config.ts` using `defineConfig()` for type safety. Read the skill's `references/config-examples.md` for templates.

Example for npm + jsr:
```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  registries: ['npm', 'jsr'],
})
```

### 6. Update .gitignore

Check if `.pubm/` is already in `.gitignore`. If not, append it.

### 7. Add npm scripts (JS projects only)

Add to `package.json`:
```json
{
  "scripts": {
    "release": "pubm",
    "ci:release": "pubm --publish-only"
  }
}
```

### 8. Ask about CI setup

Ask if the user wants to set up CI/CD for automated publishing. If yes, generate a GitHub Actions workflow using `references/ci-templates.md`.

### 9. Present summary

List all files created/modified and remind about required authentication. Show only lines for registries the user selected:

- **npm**: Run `npm login` locally, or set `NODE_AUTH_TOKEN` secret in GitHub
- **jsr**: Run `pubm` locally (interactive token prompt), or set `JSR_TOKEN` secret in GitHub
- **crates.io**: Run `cargo login` locally, or set `CARGO_REGISTRY_TOKEN` secret in GitHub
