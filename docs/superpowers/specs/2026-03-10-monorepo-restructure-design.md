# pubm Monorepo Restructure Design

## Overview

Convert the pubm single-package project into a monorepo with separate packages for core SDK, CLI, and plugins. Use pubm's own monorepo features for publish automation.

## Package Structure

```
pubm/
├── turbo.json
├── package.json              # bun workspace root
├── pubm.config.ts            # pubm self-publish config
├── .changeset/
├── packages/
│   ├── core/                 # @pubm/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts      # programmatic API exports
│   │       ├── options.ts
│   │       ├── git.ts
│   │       ├── ecosystem/
│   │       ├── registry/
│   │       ├── changeset/
│   │       ├── monorepo/
│   │       ├── plugin/
│   │       ├── config/
│   │       ├── tasks/
│   │       ├── validate/
│   │       ├── prerelease/
│   │       ├── types/
│   │       └── utils/
│   └── cli/                  # pubm (CLI binary)
│       ├── package.json
│       ├── tsconfig.json
│       ├── build.ts          # SDK build + cross-compile
│       ├── bin/cli.js
│       └── src/
│           ├── cli.ts
│           └── commands/
├── plugins/
│   ├── plugin-external-version-sync/  # @pubm/plugin-external-version-sync
│   │   ├── package.json
│   │   └── src/
│   └── plugin-brew/                   # @pubm/plugin-brew (already exists)
│       ├── package.json
│       └── src/
├── tests/
├── website/
└── docs/
```

## Package Responsibilities

### @pubm/core

Contains all core logic:
- `ecosystem/` — Ecosystem abstraction (JS, Rust)
- `registry/` — Registry abstraction (npm, jsr, crates, custom)
- `changeset/` — Changeset parsing, versioning, changelog generation
- `monorepo/` — Workspace detection, dependency graph, groups
- `plugin/` — Plugin system (PluginRunner, hooks, types)
- `config/` — Config loading, defineConfig
- `tasks/` — Publish pipeline (runner)
- `validate/` — Entry point/extraneous validation
- `prerelease/` — Pre-release/snapshot handling
- `git.ts` — Git operations
- `utils/` — exec, db, rollback, etc.
- `options.ts` — Option normalization
- `types/` — Shared TypeScript types
- `index.ts` — Programmatic API export

Dependencies: semver, listr2, enquirer, @listr2/prompt-adapter-enquirer, yaml, smol-toml, micromatch, jiti, std-env, and other current production dependencies (except commander, update-kit).

### pubm (CLI)

Contains CLI-specific code:
- `cli.ts` — Commander program definition
- `commands/` — add, init, migrate, secrets, sync, status, update, version-cmd, changesets
- `bin/cli.js` — Static binary wrapper
- `build.ts` — Cross-compile build for platform binaries

Dependencies: commander, update-kit, @pubm/core

Platform binaries (`@pubm/{os}-{arch}`) are build artifacts generated inside the CLI package, not separate monorepo packages.

### Plugins

- `@pubm/plugin-external-version-sync` — Moved from `src/plugins/external-version-sync/`, separate package.json
- `@pubm/plugin-brew` — Already exists at `plugins/plugin-brew/`

Both plugins use `@pubm/core` as peerDependency.

## Dependency Graph

```
@pubm/plugin-brew ──────────┐
@pubm/plugin-external-ver ──┤
pubm (cli) ─────────────────┼──→ @pubm/core
```

## Build & Tooling

### bun workspace

Root `package.json`:
```json
{
  "workspaces": ["packages/*", "plugins/*"]
}
```

### Turborepo

```json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "check": {}
  }
}
```

`^build` ensures core builds before cli/plugins.

## Publish Automation

### pubm.config.ts

```ts
import { defineConfig } from "@pubm/core";

export default defineConfig({
  versioning: "independent",
  packages: [
    { path: "packages/core", registries: ["npm", "jsr"] },
    { path: "packages/cli", registries: ["npm"] },
    { path: "plugins/plugin-external-version-sync", registries: ["npm", "jsr"] },
    { path: "plugins/plugin-brew", registries: ["npm", "jsr"] },
  ],
});
```

- Independent versioning per package
- Changeset-based version management
- CI publish via `pubm --ci`

## Migration Notes

- **Import paths**: CLI commands change from relative imports (`../../ecosystem/`) to `@pubm/core`
- **plugin-external-version-sync**: Move from `src/plugins/` to `plugins/plugin-external-version-sync/`, add package.json
- **Tests**: Core logic tests move to `packages/core/`, CLI integration tests stay in `packages/cli/` or root `tests/`
- **Exports**: core handles `exports` field (ESM + CJS + types), cli handles `bin` field
- **No breaking change concern**: No external SDK users currently exist
