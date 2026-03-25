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
  credentials?: (ctx: PubmContext) => PluginCredential[];  // Token descriptors
  checks?: (ctx: PubmContext) => PluginCheck[];            // Preflight checks
}
```

- `credentials` — declare tokens or secrets this plugin requires. pubm resolves them via env → `resolve()` → keyring → interactive prompt, injects them into `ctx.runtime.pluginTokens`, and syncs them to GitHub Secrets during `--ci-prepare`.
- `checks` — declare preflight checks that run alongside the core prerequisite and condition phases.

## PluginCredential

Declare tokens or secrets required by a plugin. pubm resolves each credential via the following chain: env var → `resolve()` → keyring (SecureStore) → interactive prompt.

```typescript
interface PluginCredential {
  key: string;           // Internal identifier; resolved value available at ctx.runtime.pluginTokens[key]
  env: string;           // Environment variable name for CI
  label: string;         // Human-readable prompt label
  tokenUrl?: string;     // URL where users can create the token
  tokenUrlLabel?: string; // Display label for tokenUrl
  ghSecretName?: string; // GitHub Secret name for --ci-prepare sync
  required?: boolean;    // Error if unresolved (default: true)
  resolve?: () => Promise<string | null>;  // Custom resolver (no args)
  validate?: (token: string, task: PluginTaskContext) => Promise<boolean>;  // Token validator
}
```

Example:

```typescript
credentials: () => [
  {
    key: "my-plugin-token",
    env: "MY_PLUGIN_TOKEN",
    label: "My Plugin API Token",
    tokenUrl: "https://example.com/tokens",
    tokenUrlLabel: "Create token",
    ghSecretName: "MY_PLUGIN_TOKEN",
    required: true,
  },
],
```

Access the resolved value in hooks via `ctx.runtime.pluginTokens?.["my-plugin-token"]`.

## PluginCheck

Declare preflight checks that run alongside the core prerequisite and condition phases.

```typescript
interface PluginCheck {
  title: string;
  phase: "prerequisites" | "conditions";
  task: (ctx: PubmContext, task: PluginTaskContext) => Promise<void> | void;
}
```

- `phase: "prerequisites"` — runs before network calls, suitable for local environment validation.
- `phase: "conditions"` — runs after registry connectivity is confirmed, suitable for permission checks.

Throw from `task` to fail the check and halt the pipeline.

## PluginTaskContext

A listr2-agnostic wrapper passed as the second argument to `PluginCheck.task`.

```typescript
interface PluginTaskContext {
  output: string;
  title: string;
  prompt<T = unknown>(options: {
    type: string;
    message: string;
    [key: string]: unknown;
  }): Promise<T>;
}
```

- `output` — display a status line beneath the check title in the terminal UI.
- `title` — modify the task title dynamically.
- `prompt()` — run an enquirer prompt (available in interactive mode).

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
    onError
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
| `onError` | `ErrorHookFn` | Error reporting, cleanup. Use `ctx.runtime.rollback.add()` to register rollback actions. |
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
    pluginTokens?: Record<string, string>; // Resolved plugin credentials keyed by PluginCredential.key
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
| `ctx.options.dryRun` | `boolean` | Dry-run mode |
| `ctx.options.mode` | `string` | Mode (`"interactive"` or `"ci"`) |
| `ctx.options.phase` | `string \| undefined` | Phase (`"prepare"`, `"publish"`, or undefined for full) |
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
