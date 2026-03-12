# pubm Plugin API Reference

Source: `packages/core/src/plugin/types.ts`

## PubmPlugin Interface

```typescript
interface PubmPlugin {
  name: string;              // Unique plugin identifier
  registries?: Registry[];   // Custom registry implementations
  ecosystems?: Ecosystem[];  // Custom ecosystem implementations
  hooks?: PluginHooks;       // Lifecycle hooks
  commands?: PluginCommand[];// CLI subcommands
}
```

## Plugin Hooks

All hooks receive `Ctx` (the publish pipeline context). Hooks are optional and run sequentially across plugins.

```typescript
type HookFn = (ctx: Ctx) => Promise<void> | void;
type ErrorHookFn = (ctx: Ctx, error: Error) => Promise<void> | void;
type AfterReleaseHookFn = (ctx: Ctx, releaseCtx: ReleaseContext) => Promise<void> | void;
```

### Hook Execution Order

```
1. Prerequisites check
2. Required conditions check
3. Version/tag prompts
4. beforeTest → Test → afterTest
5. beforeBuild → Build → afterBuild
6. beforeVersion → Version bump → afterVersion
7. beforePublish → Publish → afterPublish
8. beforePush → Push → afterPush
9. afterRelease (GitHub release)
10. onSuccess
    ── or on failure ──
    onError → onRollback
```

### Hook Details

| Hook | Signature | Use case |
|---|---|---|
| `beforeTest` | `HookFn` | Pre-test setup (env vars, fixtures) |
| `afterTest` | `HookFn` | Test cleanup |
| `beforeBuild` | `HookFn` | Pre-build transformations |
| `afterBuild` | `HookFn` | Post-build validation, asset generation |
| `beforeVersion` | `HookFn` | Pre-version checks |
| `afterVersion` | `HookFn` | Sync version to external files, update manifests |
| `beforePublish` | `HookFn` | Final checks before publish |
| `afterPublish` | `HookFn` | Post-publish notifications, cache invalidation |
| `beforePush` | `HookFn` | Pre-push validation |
| `afterPush` | `HookFn` | Post-push actions (deploy triggers) |
| `afterRelease` | `AfterReleaseHookFn` | Post-release actions (Homebrew, notifications) |
| `onError` | `ErrorHookFn` | Error reporting, cleanup |
| `onRollback` | `HookFn` | Custom rollback logic |
| `onSuccess` | `HookFn` | Success notifications, metrics |

## Ctx (Context Object)

```typescript
interface Ctx extends ResolvedOptions {
  promptEnabled: boolean;        // Interactive prompts enabled
  cleanWorkingTree: boolean;     // Git working tree is clean
  pluginRunner: PluginRunner;    // Access to plugin runner
  releaseContext?: ReleaseContext;// Available in afterRelease
}
```

Key properties from `ResolvedOptions`:

| Property | Type | Description |
|---|---|---|
| `version` | `string` | Version being published |
| `testScript` | `string` | npm test script name |
| `buildScript` | `string` | npm build script name |
| `branch` | `string` | Git branch |
| `tag` | `string` | Release dist-tag |
| `registries` | `RegistryType[]` | Target registries (`"npm"`, `"jsr"`, `"crates"`, or URL) |
| `packages` | `PackageConfig[]` | Per-package config (monorepo) |
| `preview` | `boolean` | Dry-run mode |
| `ci` | `boolean` | CI mode |
| `skipTests` | `boolean` | Tests skipped |
| `skipBuild` | `boolean` | Build skipped |

## ReleaseContext

Available in `afterRelease` hook:

```typescript
interface ReleaseContext {
  releaseUrl: string;   // GitHub release URL
  tagName: string;      // Git tag (e.g., "v1.2.3")
  releaseName: string;  // Release title
}
```

## Plugin Commands

Register CLI subcommands accessible via `pubm <command> <subcommand>`.

```typescript
interface PluginCommand {
  name: string;
  description: string;
  subcommands?: PluginSubcommand[];
}

interface PluginSubcommand {
  name: string;
  description: string;
  options?: PluginCommandOption[];
  action: (args: Record<string, unknown>) => Promise<void>;
}

interface PluginCommandOption {
  name: string;
  description: string;
  required?: boolean;
}
```

## Plugin Runner

Plugins are executed by `PluginRunner`. Key behaviors:
- Hooks run **sequentially** across all plugins (in registration order)
- All plugins share the same `Ctx` object
- Errors in one plugin's hook do not prevent other plugins' hooks from running
- `registries` and `ecosystems` from plugins are collected and merged with core registries

## Factory Function Pattern

Every plugin exports a factory function that accepts options and returns `PubmPlugin`:

```typescript
import type { PubmPlugin } from "@pubm/core";

export interface MyPluginOptions {
  webhookUrl: string;
}

export function myPlugin(options: MyPluginOptions): PubmPlugin {
  return {
    name: "my-plugin",
    hooks: {
      onSuccess: async (ctx) => {
        await fetch(options.webhookUrl, {
          method: "POST",
          body: JSON.stringify({ version: ctx.version }),
        });
      },
    },
  };
}
```

Usage in `pubm.config.ts`:

```typescript
import { defineConfig } from "pubm";
import { myPlugin } from "@pubm/plugin-my-plugin";

export default defineConfig({
  registries: ["npm", "jsr"],
  plugins: [
    myPlugin({ webhookUrl: "https://example.com/webhook" }),
  ],
});
```
