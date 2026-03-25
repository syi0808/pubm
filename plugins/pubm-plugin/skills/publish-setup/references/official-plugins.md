# Official Plugins Reference

## Overview

Official plugins are maintained alongside pubm and follow the same release cycle. Use them for well-supported integrations without building custom plugins.

| Plugin | Package | Hook | Description |
|---|---|---|---|
| `externalVersionSync()` | `@pubm/plugin-external-version-sync` | `afterVersion` | Sync version to non-manifest files. Rolls back file contents on failure. |
| `brewTap()` | `@pubm/plugin-brew` | `afterRelease` | Update formula in a custom Homebrew tap. Rolls back by closing created PRs on failure. |
| `brewCore()` | `@pubm/plugin-brew` | `afterRelease` | Open PR to homebrew-core. Rolls back by closing created PRs on failure. |

## `@pubm/plugin-external-version-sync`

Keeps non-manifest files aligned with your package version after a version bump.

### Install

```bash
npm install -D @pubm/plugin-external-version-sync
# or: pnpm add -D / bun add -D
```

### Use cases

- README install snippets (`pubm@1.2.3`)
- App manifests (`plugin.json`, `manifest.json`)
- Source constants (`export const VERSION = "1.2.3"`)
- Documentation examples with pinned versions

### Discovery

Run `pubm sync --discover` to scan the repository for likely version references:

```bash
pubm sync --discover
```

Show discovered files and ask the user which to include as sync targets.

### Config

**JSON target** — updates a value at a JSON path:

```typescript
{ file: 'manifest.json', jsonPath: 'version' }
{ file: 'plugin.json', jsonPath: 'metadata.version' }
```

**Regex target** — replaces the first capture group:

```typescript
{ file: 'README.md', pattern: /pubm@([\w.-]+)/g }
{ file: 'src/version.ts', pattern: /export const VERSION = "([^"]+)"/ }
```

The regex pattern must have exactly one capture group containing the version string.

### Independent versioning (monorepo)

In independent mode, provide a `version` callback to select which package's version to sync:

```typescript
externalVersionSync({
  targets: [
    { file: 'plugin.json', jsonPath: 'version' },
  ],
  version: (packages) => packages.get('packages/core') ?? '',
})
```

The callback receives a `Map<string, string>` where keys are package paths and values are versions.

### Full example

```typescript
import { defineConfig } from 'pubm'
import { externalVersionSync } from '@pubm/plugin-external-version-sync'

export default defineConfig({
  plugins: [
    externalVersionSync({
      targets: [
        { file: 'plugins/.claude-plugin/plugin.json', jsonPath: 'version' },
        { file: 'README.md', pattern: /pubm@([\w.-]+)/g },
      ],
    }),
  ],
})
```

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `targets` | `SyncTarget[]` | Yes | Files and patterns to update |
| `version` | `(packages: Map<string, string>) => string` | Only in independent mode | Selects which package's version to sync |

### Types

```typescript
interface JsonTarget {
  file: string
  jsonPath: string
}

interface RegexTarget {
  file: string
  pattern: RegExp
}

type SyncTarget = JsonTarget | RegexTarget

interface ExternalVersionSyncOptions {
  targets: SyncTarget[]
  version?: (packages: Map<string, string>) => string
}
```

## `@pubm/plugin-brew`

Automates Homebrew formula updates on release. Provides two functions: `brewTap` (custom tap) and `brewCore` (homebrew-core PR).

See `references/homebrew-setup.md` for detailed Homebrew setup instructions, formula structure, and platform matching.

### Install

```bash
npm install -D @pubm/plugin-brew
# or: pnpm add -D / bun add -D
```

### `brewTap` — Custom tap

Maintains a formula in a dedicated tap repository.

```typescript
import { defineConfig } from 'pubm'
import { brewTap } from '@pubm/plugin-brew'

export default defineConfig({
  plugins: [
    brewTap({
      formula: 'Formula/my-tool.rb',
      repo: 'https://github.com/user/homebrew-tap',
    }),
  ],
})
```

| Option | Type | Required | Description |
|---|---|---|---|
| `formula` | `string` | Yes | Formula path relative to repo root |
| `repo` | `string` | No | Remote tap repo URL. If omitted, updates formula in the current repo. |
| `packageName` | `string` | No | Only run for releases matching this package name (monorepo filter) |
| `assetPlatforms` | `Record<string, (asset) => boolean>` | No | Custom platform matchers |

**Behavior:**
- If `repo` is set: clones the tap repo, updates formula, commits and pushes
- If `repo` is omitted: updates formula in the current repo, commits and pushes (falls back to PR if push fails)

### `brewCore` — homebrew-core PR

Opens a PR to `homebrew/homebrew-core` for each release.

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

| Option | Type | Required | Description |
|---|---|---|---|
| `formula` | `string` | Yes | Formula path relative to repo root |
| `packageName` | `string` | No | Monorepo package name filter |
| `assetPlatforms` | `Record<string, (asset) => boolean>` | No | Custom platform matchers |

**Requires:** `gh` CLI authenticated with GitHub.

### CLI commands (registered by both plugins)

```bash
pubm brew init        # Generate formula from package metadata (brewTap)
pubm brew init-core   # Generate homebrew-core formula (brewCore)
```

### Prerequisites

Both plugins require:
1. **Release assets**: Platform binaries must be uploaded to GitHub Releases (via `releaseAssets` or `compress` config)
2. **Formula file**: Run `pubm brew init` to scaffold, or provide an existing formula
3. **`GITHUB_TOKEN`**: For pushing changes and creating PRs

## When to use official vs custom plugins

**Use official plugins when:**
- Your need matches an existing integration
- You want lower maintenance — official plugins are tested and updated with pubm

**Build a custom plugin when:**
- Post-release notifications (Slack, Discord, email)
- Custom artifact publishing (S3, CDN)
- Organization-specific deployment triggers
- External service integrations (Sentry, Datadog)

To scaffold a custom plugin, use the `/create-plugin` skill.
