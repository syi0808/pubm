# Multi-Ecosystem Registry Support Design

Date: 2026-03-03

## Goal

Extend pubm to support non-JS registries (starting with crates.io) in polyglot monorepos, while maintaining backward compatibility with existing JS-only workflows.

## Requirements

- **1st target**: crates.io (Rust/cargo publish) support
- **Monorepo**: JS + Rust mixed monorepos with independent package publishing
- **Extensibility**: Built-in extensions with future plugin system in mind
- **Versioning**: Both independent and fixed (unified) versioning strategies
- **Auth**: cargo native auth + pubm Db fallback
- **Config file**: `pubm.config.{ts,mts,cts,js,mjs,cjs}` with `defineConfig()` helper
- **Build/test**: Auto-detect from manifest (Cargo.toml → cargo commands), overridable in config

## Architecture

### Approach: Ecosystem Abstraction + Declarative Config

Two new layers are introduced:

1. **Ecosystem** — abstracts build/test/version per language ecosystem
2. **Config file** — declarative project/monorepo configuration

The existing `Registry` abstraction remains unchanged (publish-only responsibility).

### Config File System

```ts
// pubm.config.ts
import { defineConfig } from 'pubm'

export default defineConfig({
  versioning: 'independent', // 'independent' | 'fixed'

  packages: [
    {
      path: 'packages/my-lib',
      registries: ['npm', 'jsr'],
    },
    {
      path: 'crates/my-crate',
      registries: ['crates'],
      buildCommand: 'cargo build --release --features production',
      testCommand: 'cargo test --all-features',
    },
  ],

  branch: 'main',
  skipReleaseDraft: false,
})
```

**Config file search order:**
`pubm.config.ts` → `.mts` → `.cts` → `.js` → `.mjs` → `.cjs`

**Backward compatibility:** No config file = existing behavior unchanged (root package.json, `--registry` CLI flag).

**Single-package shorthand:**
```ts
export default defineConfig({
  registries: ['npm', 'jsr'],
  branch: 'main',
})
```

### Ecosystem Abstraction

```ts
// src/ecosystem/ecosystem.ts
export abstract class Ecosystem {
  constructor(public packagePath: string) {}

  abstract packageName(): Promise<string>
  abstract readVersion(): Promise<string>
  abstract writeVersion(newVersion: string): Promise<void>
  abstract manifestFiles(): string[]
  abstract defaultTestCommand(): string
  abstract defaultBuildCommand(): string
  abstract supportedRegistries(): RegistryType[]
  static detect(packagePath: string): Promise<boolean>
}
```

**Implementations:**

- `JsEcosystem` — reads package.json/jsr.json, uses detected package manager
- `RustEcosystem` — reads Cargo.toml, uses cargo commands

**Detection priority:**
1. Config file specifies registries → derive ecosystem
2. Cargo.toml exists → RustEcosystem
3. package.json exists → JsEcosystem
4. Both exist → must be specified in config, or derive from registries

### CratesRegistry

```ts
// src/registry/crates.ts
export class CratesRegistry extends Registry {
  ping()                    // GET https://crates.io/api/v1
  isInstalled()             // which cargo
  distTags()                // [] (not applicable)
  version()                 // crates.io API latest version
  publish()                 // cargo publish (from package path)
  isPublished()             // crates.io API version check
  hasPermission()           // crates.io API owners check
  isPackageNameAvailable()  // crates.io API 404 = available
}
```

**Auth flow:**
1. `CARGO_REGISTRY_TOKEN` env var (CI)
2. `~/.cargo/credentials.toml` (cargo native)
3. pubm Db encrypted store
4. Interactive prompt (TTY)

**crates.io API endpoints:**
- `GET /api/v1/crates/{name}` — existence, versions
- `GET /api/v1/crates/{name}/owners` — permissions
- User-Agent header required (crates.io policy)

### Runner Changes

```
Current:  run(options) → hardcoded npm/jsr task chain
New:      run(options) → resolvePackages(config) → per-package pipeline
```

**Per-package pipeline:**

| Step | Source |
|------|--------|
| Prerequisites check | Git state (once per run) |
| Conditions check | Each registry: ping/permission |
| Version/tag prompts | ecosystem.readVersion() |
| Test | ecosystem.defaultTestCommand() or config override |
| Build | ecosystem.defaultBuildCommand() or config override |
| Version bump | ecosystem.writeVersion() + git commit + tag |
| Publish | Each registry.publish() concurrently |
| Post-publish | git push --follow-tags + GitHub release draft |

**Monorepo execution:**
- `versioning: 'fixed'` → all packages share version, sequential execution
- `versioning: 'independent'` → per-package version prompt, sequential execution
- Prerequisites check runs once globally

### Rollback

- Per-package rollback scope
- On partial failure: only failed package's git changes are rolled back
- crates.io published versions cannot be deleted (only yanked) — warning message shown

**Final report format:**
```
✓ packages/my-lib → npm@1.2.0, jsr@1.2.0
✗ crates/my-crate → crates.io failed: "authentication error"
  ↳ Rollback: deleted git tag v0.3.1-my-crate, restored Cargo.toml
```

## Error Handling

- **Partial failure**: Failed package rolls back independently, successful packages remain
- **cargo publish errors**: version exists (skip/error), verification failure, network errors
- **Config errors**: Invalid path (immediate error), registry/ecosystem mismatch (warning)

## Testing Strategy

**Unit tests:**
- CratesRegistry — all methods with tinyexec/fetch mocks
- RustEcosystem — Cargo.toml read/write, version replacement
- loadConfig() — parsing, defaults, validation
- resolvePackages() — ecosystem detection, config merging

**E2E tests:**
- Config file project with `pubm --help`
- `--preview` dry-run through full pipeline
- Fixture with Cargo.toml + package.json mixed project

**Backward compatibility:**
- All existing tests pass with no config file present
- Minimal changes to existing test imports

## File Structure (New/Modified)

```
src/
├── config/
│   ├── config.ts           # loadConfig(), defineConfig()
│   ├── types.ts            # PubmConfig, PackageConfig types
│   └── resolve.ts          # resolvePackages() — config → Package[]
├── ecosystem/
│   ├── ecosystem.ts        # Abstract base class
│   ├── js.ts               # JsEcosystem (existing logic extracted)
│   ├── rust.ts             # RustEcosystem (new)
│   └── index.ts            # detectEcosystem() dispatcher
├── registry/
│   ├── crates.ts           # CratesRegistry (new)
│   └── index.ts            # Updated getRegistry() with 'crates' entry
├── tasks/
│   ├── runner.ts           # Refactored to use Ecosystem + Config
│   └── crates.ts           # cratesAvailableCheckTasks, cratesPublishTasks
└── types/
    └── options.ts          # Extended RegistryType: 'npm' | 'jsr' | 'crates'
```
