# pubm Plugin API Reference

Source: `packages/core/src/plugin/types.ts`, `packages/core/src/context.ts`

## PubmPlugin Interface

```typescript
interface PubmPlugin {
  name: string;                    // Unique plugin identifier
  registries?: PackageRegistry[];  // Custom registry implementations
  ecosystems?: Ecosystem[];        // Custom ecosystem implementations
  hooks?: PluginHooks;             // Lifecycle hooks
  commands?: PluginCommand[];      // CLI subcommands
}
```

## Plugin Hooks

All hooks receive `PubmContext` (the publish pipeline context). Hooks are optional and run sequentially across plugins.

```typescript
type HookFn = (ctx: PubmContext) => Promise<void> | void;
type ErrorHookFn = (ctx: PubmContext, error: Error) => Promise<void> | void;
type AfterReleaseHookFn = (ctx: PubmContext, releaseCtx: ReleaseContext) => Promise<void> | void;
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

## PubmContext

```typescript
interface PubmContext {
  readonly config: ResolvedPubmConfig;  // Resolved pubm.config.ts
  readonly options: ResolvedOptions;    // Resolved CLI/programmatic options
  readonly cwd: string;                 // Working directory

  runtime: {
    version?: string;                   // Current version (single/fixed mode)
    versions?: Map<string, string>;     // Per-package versions
    changesetConsumed?: boolean;        // Whether changesets were consumed
    tag: string;                        // Release dist-tag (e.g., "latest")
    promptEnabled: boolean;             // Interactive prompts enabled
    cleanWorkingTree: boolean;          // Git working tree is clean
    pluginRunner: PluginRunner;         // Access to plugin runner
    versionPlan?: VersionPlan;          // Version plan for the release
    releaseContext?: ReleaseContext;     // Available in afterRelease
    npmOtp?: string;                    // npm OTP code
  };
}
```

### Accessing options (`ctx.options`)

| Property | Type | Description |
|---|---|---|
| `ctx.options.testScript` | `string` | npm test script name |
| `ctx.options.buildScript` | `string` | npm build script name |
| `ctx.options.branch` | `string` | Git branch |
| `ctx.options.tag` | `string` | Release dist-tag |
| `ctx.options.preview` | `boolean` | Dry-run mode |
| `ctx.options.ci` | `boolean` | CI mode |
| `ctx.options.skipTests` | `boolean` | Tests skipped |
| `ctx.options.skipBuild` | `boolean` | Build skipped |

### Accessing config (`ctx.config`)

| Property | Type | Description |
|---|---|---|
| `ctx.config.packages` | `ResolvedPackageConfig[]` | Per-package config (monorepo) |
| `ctx.config.versioning` | `"independent" \| "fixed"` | Versioning strategy |
| `ctx.config.plugins` | `PubmPlugin[]` | Registered plugins |

### Accessing runtime state (`ctx.runtime`)

| Property | Type | Description |
|---|---|---|
| `ctx.runtime.versionPlan` | `VersionPlan` | Version plan for the release |
| `ctx.runtime.tag` | `string` | Release dist-tag |
| `ctx.runtime.releaseContext` | `ReleaseContext` | GitHub release info (in `afterRelease`) |

### VersionPlan

```typescript
// Single package release
interface SingleVersionPlan {
  mode: "single";
  version: string;
  packagePath: string;
}

// All packages same version
interface FixedVersionPlan {
  mode: "fixed";
  version: string;
  packages: Map<string, string>;
}

// Each package has own version
interface IndependentVersionPlan {
  mode: "independent";
  packages: Map<string, string>;
}

type VersionPlan = SingleVersionPlan | FixedVersionPlan | IndependentVersionPlan;
```

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
- All plugins share the same `PubmContext` object
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
        const plan = ctx.runtime.versionPlan;
        const version = plan?.mode === "independent"
          ? [...plan.packages.values()][0]
          : plan?.version ?? "";

        await fetch(options.webhookUrl, {
          method: "POST",
          body: JSON.stringify({ version }),
        });
      },
    },
  };
}
```

Usage in `pubm.config.ts`:

```typescript
import { defineConfig } from "@pubm/core";
import { myPlugin } from "@pubm/plugin-my-plugin";

export default defineConfig({
  registries: ["npm", "jsr"],
  plugins: [
    myPlugin({ webhookUrl: "https://example.com/webhook" }),
  ],
});
```
