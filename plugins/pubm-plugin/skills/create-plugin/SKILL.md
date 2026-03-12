---
name: create-plugin
description: Scaffold and guide creation of a new pubm plugin package
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# Create pubm Plugin

Scaffold a new pubm plugin package with all boilerplate files and guide implementation.

## Workflow

### 1. Gather Plugin Info

Use AskUserQuestion to collect:

1. **Plugin name** (kebab-case, without `plugin-` prefix). Example: `slack-notify`, `sentry-release`
2. **One-line description** of what the plugin does
3. **Which hooks to use** (multi-select from the list below)
4. **Whether it needs CLI commands** (pubm subcommands)

Available hooks (see `references/plugin-api.md` for details):

| Hook | When it runs |
|---|---|
| `beforeTest` | Before test script |
| `afterTest` | After test script |
| `beforeBuild` | Before build script |
| `afterBuild` | After build script |
| `beforeVersion` | Before version bump |
| `afterVersion` | After version bump commit |
| `beforePublish` | Before registry publish |
| `afterPublish` | After registry publish |
| `beforePush` | Before git push |
| `afterPush` | After git push |
| `afterRelease` | After GitHub release creation (receives `ReleaseContext`) |
| `onError` | On pipeline error (receives `Error`) |
| `onRollback` | During rollback |
| `onSuccess` | On successful publish |

### 2. Scaffold Files

Create `packages/plugins/plugin-{name}/` with these files:

#### `package.json`

```json
{
  "name": "@pubm/plugin-{name}",
  "version": "0.0.1",
  "type": "module",
  "description": "{description}",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist/"],
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target node --format esm && bunx tsc --project tsconfig.build.json",
    "check": "biome check",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "coverage": "vitest --run --coverage"
  },
  "peerDependencies": {
    "@pubm/core": ">=0.3.6"
  },
  "license": "Apache-2.0",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/syi0808/pubm.git",
    "directory": "packages/plugins/plugin-{name}"
  }
}
```

#### `tsconfig.json`

```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
    "paths": {
      "@pubm/core": ["../../core/src/index.ts"]
    }
  },
  "references": [{ "path": "../../core" }],
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

#### `tsconfig.build.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "emitDeclarationOnly": true,
    "declaration": true,
    "declarationDir": "dist",
    "paths": {}
  }
}
```

#### `vitest.config.mts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["tests/setup.ts"],
    pool: "forks",
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
```

#### `src/types.ts`

```typescript
export interface {PascalName}Options {
  // TODO: Define your plugin options here
}
```

#### `src/index.ts`

Generate based on selected hooks. Pattern:

```typescript
import type { PubmPlugin } from "@pubm/core";
import type { {PascalName}Options } from "./types.js";

export type { {PascalName}Options } from "./types.js";

export function {camelName}(options: {PascalName}Options): PubmPlugin {
  return {
    name: "{name}",
    hooks: {
      {selectedHook}: async (ctx) => {
        // TODO: Implement {selectedHook} logic
      },
    },
  };
}
```

If `afterRelease` is selected, use the special signature:
```typescript
afterRelease: async (ctx, releaseCtx) => {
  // releaseCtx has: { releaseUrl, tagName, releaseName }
},
```

If `onError` is selected, use the error signature:
```typescript
onError: async (ctx, error) => {
  // error is the Error that caused the failure
},
```

If CLI commands are needed, add a `commands` property:
```typescript
commands: [
  {
    name: "{name}",
    description: "{description}",
    subcommands: [
      {
        name: "init",
        description: "Initialize {name} configuration",
        options: [],
        action: async (args) => {
          // TODO: Implement command
        },
      },
    ],
  },
],
```

#### `tests/setup.ts`

```typescript
import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
```

#### `tests/unit/plugin.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { {camelName} } from "../../src/index.js";

describe("{name} plugin", () => {
  it("should return a valid PubmPlugin", () => {
    const plugin = {camelName}({});
    expect(plugin.name).toBe("{name}");
    expect(plugin.hooks).toBeDefined();
  });

  // Add hook-specific tests:
  // it("should have {selectedHook} hook", () => {
  //   const plugin = {camelName}({});
  //   expect(plugin.hooks?.{selectedHook}).toBeTypeOf("function");
  // });
});
```

### 3. Register in Workspace

Check root `package.json` for the `workspaces` field. If it uses a glob pattern like `packages/plugins/*`, it's already covered. Otherwise, add the new plugin path.

### 4. Install Dependencies

Run `bun install` from the repo root to link the new package.

### 5. Verify Scaffold

Run in sequence:
```bash
cd packages/plugins/plugin-{name} && bun run build && bun run test
```

### 6. Present Next Steps

After scaffolding, tell the user:

1. Implement hook logic in `src/index.ts`
2. Define options in `src/types.ts`
3. Add tests in `tests/unit/` and `tests/integration/`
4. Register the plugin in `pubm.config.ts`:
   ```typescript
   import { defineConfig } from "pubm";
   import { {camelName} } from "@pubm/plugin-{name}";

   export default defineConfig({
     plugins: [
       {camelName}({ /* options */ }),
     ],
   });
   ```
5. Refer to `references/plugin-api.md` for the full plugin API

## Naming Conventions

Convert the user-provided `{name}` (kebab-case) to:
- **PascalName**: `slack-notify` → `SlackNotify`
- **camelName**: `slack-notify` → `slackNotify`
- **Package name**: `@pubm/plugin-{name}`
- **Directory**: `packages/plugins/plugin-{name}`

## Constraints

- Always use the factory function pattern (function returning `PubmPlugin`)
- Always use `@pubm/core` as a peer dependency, never a regular dependency
- Always use ESM (`"type": "module"`)
- Follow the existing plugin structure exactly (same scripts, tsconfig, vitest config)
- Do not add dependencies beyond `@pubm/core` unless the user explicitly requests them

## References

- `references/plugin-api.md` -- Complete PubmPlugin interface and hook reference
