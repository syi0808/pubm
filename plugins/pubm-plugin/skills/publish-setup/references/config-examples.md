# pubm Config Reference

## When is a config file needed?

pubm auto-detects ecosystems, packages, and registries without any config file. A `pubm.config.ts` is only needed when:

- **Overriding auto-detected registries** (e.g., adding jsr to a package that wasn't auto-detected)
- **Using plugins** (externalVersionSync, brewTap, brewCore, etc.)
- **Setting non-default options** (versioning strategy, changelog format, etc.)

If auto-detection covers your setup, no config file is required.

## Config file search order

pubm looks for config files in the project root in this order:

1. `pubm.config.ts`
2. `pubm.config.mts`
3. `pubm.config.cts`
4. `pubm.config.js`
5. `pubm.config.mjs`
6. `pubm.config.cjs`

The file must export a config object as the default export. Use `defineConfig()` from `pubm` for type safety.

## Examples

### No config (auto-detection only)

When auto-detection is sufficient, no config file is needed. pubm will:
- Detect packages from workspace config or single-package root
- Detect JS ecosystem (package.json) or Rust ecosystem (Cargo.toml)
- Infer registries: npm (default for JS), jsr (when jsr.json exists), crates (for Rust), private (from .npmrc or publishConfig)

### Monorepo with explicit packages and registries

Use when auto-detection doesn't match your desired publish targets.

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  packages: [
    { path: 'packages/my-lib', registries: ['npm', 'jsr'] },
    { path: 'crates/my-crate', registries: ['crates'] },
  ],
})
```

### Monorepo with independent versioning

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  versioning: 'independent',
  packages: [
    { path: 'packages/core', registries: ['npm', 'jsr'] },
    { path: 'packages/cli', registries: ['npm'] },
  ],
})
```

### Private registry

Any URL string in `registries` is treated as a custom registry.

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
  packages: [
    {
      path: '.',
      registries: [
        'npm',
        { url: 'https://registry.mycorp.com', token: { envVar: 'CUSTOM_TOKEN' } },
      ],
    },
  ],
})
```

### Custom build and test commands per package

```typescript
import { defineConfig } from 'pubm'

export default defineConfig({
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

### With externalVersionSync plugin

```typescript
import { defineConfig } from 'pubm'
import { externalVersionSync } from '@pubm/plugin-external-version-sync'

export default defineConfig({
  plugins: [
    externalVersionSync({
      targets: [
        { file: 'plugins/.claude-plugin/plugin.json', jsonPath: 'version' },
        { file: 'README.md', pattern: /pubm@[\d.]+/g },
      ],
    }),
  ],
})
```

For independent versioning, provide a `version` callback to select which package's version to sync:

```typescript
externalVersionSync({
  targets: [
    { file: 'plugin.json', jsonPath: 'version' },
  ],
  version: (packages) => packages.get('@pubm/core') ?? '',
})
```

### With brewTap plugin

```typescript
import { defineConfig } from 'pubm'
import { brewTap } from '@pubm/plugin-brew'

export default defineConfig({
  plugins: [
    brewTap({
      formula: 'Formula/my-tool.rb',
      repo: 'user/homebrew-tap',
    }),
  ],
})
```

### With brewCore plugin

```typescript
import { defineConfig } from 'pubm'
import { brewCore } from '@pubm/plugin-brew'

export default defineConfig({
  plugins: [
    brewCore({
      formula: 'Formula/my-tool.rb',
    }),
  ],
})
```

## Type Reference

### `RegistryType`

```typescript
type RegistryType = 'npm' | 'jsr' | 'crates' | string
```

`'npm'`, `'jsr'`, and `'crates'` are built-in registries. For custom/private registries, use the `PrivateRegistryConfig` object format in the `registries` array (see example above) to specify the URL and token environment variable.

### `PrivateRegistryConfig`

```typescript
interface PrivateRegistryConfig {
  url: string
  token: { envVar: string }
}
```

### `PackageConfig`

```typescript
interface PackageConfig {
  path: string
  registries?: (RegistryType | PrivateRegistryConfig)[]
  ecosystem?: 'js' | 'rust'
  buildCommand?: string
  testCommand?: string
}
```

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Relative path to the package directory from the project root. |
| `registries` | `(RegistryType \| PrivateRegistryConfig)[]` | Target registries. If omitted, auto-detected from manifest files. |
| `ecosystem` | `'js' \| 'rust'` | Override auto-detected ecosystem. |
| `buildCommand` | `string` | Custom build command for this package. |
| `testCommand` | `string` | Custom test command for this package. |

### `PubmConfig`

```typescript
interface PubmConfig {
  versioning?: 'independent' | 'fixed'
  branch?: string
  packages?: PackageConfig[]
  changelog?: boolean | string
  changelogFormat?: 'default' | 'github' | string
  commit?: boolean
  access?: 'public' | 'restricted'
  fixed?: string[][]
  linked?: string[][]
  updateInternalDependencies?: 'patch' | 'minor'
  ignore?: string[]
  validate?: ValidateConfig
  snapshotTemplate?: string
  tag?: string
  contents?: string
  saveToken?: boolean
  releaseDraft?: boolean
  releaseNotes?: boolean
  rollbackStrategy?: 'individual' | 'all'
  plugins?: PubmPlugin[]
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `versioning` | `'independent' \| 'fixed'` | `'independent'` | Versioning strategy for monorepos. |
| `branch` | `string` | `'main'` | Target branch for release. |
| `packages` | `PackageConfig[]` | auto-detected | List of packages. Omit for auto-detection. |
| `changelog` | `boolean \| string` | `true` | Enable CHANGELOG generation, or path to custom template. |
| `changelogFormat` | `string` | `'default'` | Changelog format: `'default'`, `'github'`, or custom. |
| `commit` | `boolean` | `false` | Create a git commit on version bump. |
| `access` | `'public' \| 'restricted'` | `'public'` | npm access level. |
| `fixed` | `string[][]` | `[]` | Groups of packages that share the same version. |
| `linked` | `string[][]` | `[]` | Groups of packages with linked version bumps. |
| `updateInternalDependencies` | `'patch' \| 'minor'` | `'patch'` | How to bump internal dependency ranges. |
| `ignore` | `string[]` | `[]` | Package names to exclude from publishing. |
| `validate` | `ValidateConfig` | all enabled | Pre-publish validation settings. |
| `snapshotTemplate` | `string` | `'{tag}-{timestamp}'` | Template for snapshot versions. |
| `tag` | `string` | `'latest'` | Dist-tag to publish under. |
| `contents` | `string` | `'.'` | Subdirectory to publish. |
| `saveToken` | `boolean` | `true` | Save JSR tokens to encrypted local store. |
| `releaseDraft` | `boolean` | `true` | Create GitHub release draft. |
| `releaseNotes` | `boolean` | `true` | Include release notes in GitHub release. |
| `rollbackStrategy` | `'individual' \| 'all'` | `'individual'` | Rollback scope on publish failure. |
| `plugins` | `PubmPlugin[]` | `[]` | Plugins to extend the publish pipeline. |

### `ValidateConfig`

```typescript
interface ValidateConfig {
  cleanInstall?: boolean  // default: true
  entryPoints?: boolean   // default: true
  extraneousFiles?: boolean // default: true
}
```
