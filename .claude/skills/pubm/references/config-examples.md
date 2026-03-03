# pubm Config Reference

## Config file search order

pubm looks for config files in the project root in this order:

1. `pubm.config.ts`
2. `pubm.config.mts`
3. `pubm.config.cts`
4. `pubm.config.js`
5. `pubm.config.mjs`
6. `pubm.config.cjs`

Config files are loaded via `jiti` (with `interopDefault: true`), so TypeScript works without a build step. The file must export a config object as the default export. Use `defineConfig()` from `pubm` for type safety.

## Examples

### Single JS package publishing to npm and jsr

Use when a single-package repo targets both npm and jsr registries.

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  registries: ['npm', 'jsr'],
})
```

### Single JS package publishing to npm only

Use when only npm is needed (no jsr).

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  registries: ['npm'],
})
```

### Single Rust crate

Use for a Rust project publishing to crates.io.

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  registries: ['crates'],
})
```

### Monorepo with JS + Rust and independent versioning

Use when a monorepo contains multiple packages across ecosystems, each versioned independently.

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  versioning: 'independent',
  packages: [
    { path: 'packages/my-lib', registries: ['npm', 'jsr'] },
    { path: 'crates/my-crate', registries: ['crates'] },
  ],
})
```

### Private registry

Use when publishing to a corporate/private registry alongside npm. Any URL string is treated as a custom registry.

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  registries: ['npm', 'https://registry.mycorp.com'],
})
```

### Custom build and test commands per package

Use in a monorepo when individual packages need their own build/test scripts.

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  versioning: 'independent',
  packages: [
    {
      path: 'packages/ui',
      registries: ['npm'],
      buildCommand: 'pnpm run build:ui',
      testCommand: 'pnpm run test:ui',
    },
  ],
})
```

## Type Reference

### `RegistryType`

```typescript
type RegistryType = 'npm' | 'jsr' | 'crates' | string
```

`'npm'`, `'jsr'`, and `'crates'` are built-in registries. Any other string is treated as a custom registry URL.

### `PubmConfig`

```typescript
interface PubmConfig {
  versioning?: 'independent' | 'fixed'
  packages?: PackageConfig[]
  registries?: RegistryType[]
  branch?: string
  tag?: string
  skipTests?: boolean
  skipBuild?: boolean
  skipPublish?: boolean
  skipReleaseDraft?: boolean
}
```

| Field | Type | Description |
|---|---|---|
| `versioning` | `'independent' \| 'fixed'` | Versioning strategy for monorepos. `'independent'` = each package versioned separately, `'fixed'` = all share one version. |
| `packages` | `PackageConfig[]` | List of packages in a monorepo. Omit for single-package repos. |
| `registries` | `RegistryType[]` | Target registries for single-package repos. Ignored when `packages` is set. |
| `branch` | `string` | Target branch for release (default: `'main'`). |
| `tag` | `string` | Dist-tag to publish under (default: `'latest'`). |
| `skipTests` | `boolean` | Skip running tests before publish. |
| `skipBuild` | `boolean` | Skip running build before publish. |
| `skipPublish` | `boolean` | Skip the actual publish step. |
| `skipReleaseDraft` | `boolean` | Skip creating a GitHub release draft. |

### `PackageConfig`

```typescript
interface PackageConfig {
  path: string
  registries: RegistryType[]
  buildCommand?: string
  testCommand?: string
}
```

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Relative path to the package directory from the project root. Required. |
| `registries` | `RegistryType[]` | Target registries for this package. Required. |
| `buildCommand` | `string` | Custom build command for this package. Overrides the default build script. |
| `testCommand` | `string` | Custom test command for this package. Overrides the default test script. |
