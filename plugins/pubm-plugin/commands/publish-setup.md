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

### 4. Generate config file

Create `pubm.config.ts` using `defineConfig()` for type safety. Read the skill's `references/config-examples.md` for templates.

Example for npm + jsr:
```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  registries: ['npm', 'jsr'],
})
```

### 5. Update .gitignore

Check if `.pubm/` is already in `.gitignore`. If not, append it.

### 6. Add npm scripts (JS projects only)

Add to `package.json`:
```json
{
  "scripts": {
    "release": "pubm",
    "ci:release": "pubm --publish-only"
  }
}
```

### 7. Ask about CI setup

Ask if the user wants to set up CI/CD for automated publishing. If yes, generate a GitHub Actions workflow using `references/ci-templates.md`.

### 8. Present summary

List all files created/modified and remind about required authentication steps.
