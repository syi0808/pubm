# README Sync & Missing Features Design

Date: 2026-03-09

## Goal

Sync README with implementation, implement missing features, and add new capabilities.

## Scope

### 1. Plugin System

**Plugin interface** with three extension points:
- **Hooks** (13 lifecycle hooks): `beforeTest`, `afterTest`, `beforeBuild`, `afterBuild`, `beforeVersion`, `afterVersion`, `beforePublish`, `afterPublish`, `beforePush`, `afterPush`, `onError`, `onRollback`, `onSuccess`
- **Custom registries**: plugins can register `Registry` implementations (e.g., Cargo, Maven)
- **Custom ecosystems**: plugins can register `Ecosystem` implementations (e.g., Rust, Java)

**Config format** (unified structure — plugins contain hooks):

```ts
export default defineConfig({
  plugins: [
    cargoPlugin({ token: process.env.CARGO_TOKEN }),
    {
      name: 'my-notifications',
      hooks: {
        afterPublish: async (ctx) => { await notify(ctx) },
        onError: async (ctx, error) => { await alertSlack(error) },
      },
    },
  ],
})
```

Multiple plugins' same hooks execute in registration order.

### 2. `pubm version` Command

- Read changesets → calculate version bumps → generate changelog → delete changeset files → git commit
- Monorepo: per-package independent/fixed version bumps + internal dependency updates
- Pre-release: when `pubm pre enter` is active, generate `1.2.0-beta.1` style versions

### 3. `pubm snapshot` Command

- Default: `0.0.0-snapshot-20260309123456` (timestamp-based)
- `--snapshot-id <id>`: custom identifier (e.g., git SHA)
- No git tags or changelog generation — registry publish only

### 4. Windows/Bun Compatibility

- Introduce `cross-spawn` for cross-platform process execution
- Unify file paths with `path.join`/`path.sep`
- Bun runtime detection and `crypto` module compatibility
- Add Windows + Bun to CI test matrix

### 5. README Update

- Fix monorepo "(Soon)" → supported
- Add subcommand docs: `init`, `add`, `status`, `pre`, `migrate`, `update`, `secrets`
- Add plugin system documentation
- Add changeset workflow documentation
- Document Crates.io/Rust support
- Update Windows/Bun from "Planned" to "Supported"
