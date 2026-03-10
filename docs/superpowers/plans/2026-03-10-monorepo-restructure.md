# pubm Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert pubm from a single-package project into a monorepo with `@pubm/core`, `pubm` (CLI), `@pubm/plugin-external-version-sync`, and `@pubm/plugin-brew` packages.

**Architecture:** Move core logic (ecosystem, registry, changeset, monorepo, plugin, config, tasks, validate, prerelease, git, utils) into `packages/core/`. Move CLI-specific code (cli.ts, commands/, bin/, build.ts) into `packages/cli/`. Extract `plugin-external-version-sync` into `plugins/`. Use bun workspaces + Turborepo for build orchestration. Use pubm's own monorepo features for independent versioning and publish automation.

**Tech Stack:** TypeScript, bun workspaces, Turborepo, Vitest, Biome, Commander

**Spec:** `docs/superpowers/specs/2026-03-10-monorepo-restructure-design.md`

---

## File Structure

After migration, the repository will have this structure:

```
pubm/
├── package.json                  # Root: workspaces, devDeps (biome, vitest, typescript), scripts
├── turbo.json                    # Turborepo task config
├── tsconfig.json                 # Root tsconfig (references)
├── biome.json                    # Shared biome config
├── vitest.config.mts             # Root test config (workspace mode)
├── pubm.config.ts                # pubm self-publish config
├── .changeset/                   # Changeset files
├── patches/
│   └── listr2.patch
├── packages/
│   ├── core/                     # @pubm/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   ├── vitest.config.mts
│   │   ├── src/                  # All current src/ except cli.ts, commands/
│   │   │   ├── index.ts
│   │   │   ├── error.ts
│   │   │   ├── git.ts
│   │   │   ├── options.ts
│   │   │   ├── changeset/
│   │   │   ├── config/
│   │   │   ├── ecosystem/
│   │   │   ├── monorepo/
│   │   │   ├── plugin/
│   │   │   ├── prerelease/
│   │   │   ├── registry/
│   │   │   ├── tasks/
│   │   │   ├── types/
│   │   │   ├── utils/
│   │   │   └── validate/
│   │   └── tests/                # Core unit tests
│   │       ├── setup.ts
│   │       └── unit/
│   └── cli/                      # pubm (CLI)
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.build.json
│       ├── build.ts
│       ├── postinstall.cjs
│       ├── bin/cli.js
│       ├── vitest.config.mts
│       ├── src/
│       │   ├── cli.ts
│       │   └── commands/
│       └── tests/                # CLI tests (unit + e2e)
│           ├── unit/
│           │   ├── cli.test.ts
│           │   └── commands/
│           ├── e2e/
│           ├── integration/
│           ├── fixtures/
│           └── utils/
├── plugins/
│   ├── plugin-external-version-sync/   # @pubm/plugin-external-version-sync
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.mts
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── sync.ts
│   │   │   └── types.ts
│   │   └── tests/
│   │       └── unit/
│   └── plugin-brew/                    # @pubm/plugin-brew (existing)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
├── website/
└── docs/
```

---

## Chunk 1: Root Workspace & Tooling Setup

### Task 1: Create root workspace package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update root package.json to workspace root**

Transform the current `package.json` into a workspace root. Remove package-specific fields (bin, exports, main, module, types, files, optionalDependencies, publishConfig, postinstall). Keep shared devDependencies and add workspace config.

```json
{
  "name": "pubm-monorepo",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=18",
    "git": ">=2.11.0"
  },
  "workspaces": [
    "packages/*",
    "plugins/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "check": "turbo run check",
    "format": "biome check --write",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "coverage": "turbo run coverage",
    "dev:site": "cd website && pnpm dev",
    "build:site": "cd website && pnpm build",
    "preview:site": "cd website && pnpm preview"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.4",
    "@types/bun": "^1.3.10",
    "@types/node": "^22.7.4",
    "@vitest/coverage-v8": "^2.1.1",
    "jsr": "^0.13.2",
    "turbo": "^2.4.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  },
  "patchedDependencies": {
    "listr2@8.2.5": "patches/listr2.patch"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: convert root package.json to workspace root"
```

---

### Task 2: Add Turborepo configuration

**Files:**
- Create: `turbo.json`

- [ ] **Step 1: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "check": {},
    "coverage": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add turbo.json
git commit -m "chore: add Turborepo configuration"
```

---

### Task 3: Update root tsconfig.json to use project references

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Update root tsconfig.json**

Replace the current root tsconfig with a base config that child packages extend, plus project references:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "references": [
    { "path": "packages/core" },
    { "path": "packages/cli" },
    { "path": "plugins/plugin-external-version-sync" },
    { "path": "plugins/plugin-brew" }
  ],
  "exclude": ["node_modules", "dist", "website"]
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "chore: update root tsconfig with project references"
```

---

## Chunk 2: @pubm/core Package

### Task 4: Create @pubm/core package structure

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsconfig.build.json`

- [ ] **Step 1: Create packages/core/ directory**

```bash
mkdir -p packages/core
```

- [ ] **Step 2: Create packages/core/package.json**

```json
{
  "name": "@pubm/core",
  "version": "0.3.6",
  "type": "module",
  "description": "Core SDK for pubm - publish manager for multiple registries",
  "types": "./dist/index.d.ts",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist/"
  ],
  "scripts": {
    "build": "bun run ../../build-core.ts",
    "check": "biome check",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "coverage": "vitest --run --coverage"
  },
  "dependencies": {
    "@listr2/prompt-adapter-enquirer": "^2.0.12",
    "enquirer": "^2.4.1",
    "jiti": "^2.6.1",
    "listr2": "^8.2.5",
    "micromatch": "^4.0.8",
    "semver": "^7.6.3",
    "smol-toml": "^1.6.0",
    "std-env": "^3.7.0",
    "yaml": "^2.8.2"
  },
  "devDependencies": {
    "@types/micromatch": "^4.0.10",
    "@types/semver": "^7.5.8"
  },
  "license": "Apache-2.0",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/syi0808/pubm.git",
    "directory": "packages/core"
  }
}
```

- [ ] **Step 3: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

- [ ] **Step 4: Create packages/core/tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "emitDeclarationOnly": true,
    "declaration": true,
    "declarationDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/
git commit -m "chore: create @pubm/core package skeleton"
```

---

### Task 5: Move core source files

**Files:**
- Move: `src/` → `packages/core/src/` (except cli.ts, commands/)

- [ ] **Step 1: Move all core source files to packages/core/src/**

Note: Do NOT move `src/cli.ts`, `src/commands/`, or `src/plugins/` (these are handled in later tasks).

```bash
mkdir -p packages/core/src

# Move top-level core files
mv src/index.ts packages/core/src/
mv src/error.ts packages/core/src/
mv src/git.ts packages/core/src/
mv src/options.ts packages/core/src/

# Move core directories (NOT plugins/ — that's handled in Task 14)
mv src/changeset packages/core/src/
mv src/config packages/core/src/
mv src/ecosystem packages/core/src/
mv src/monorepo packages/core/src/
mv src/plugin packages/core/src/
mv src/prerelease packages/core/src/
mv src/registry packages/core/src/
mv src/tasks packages/core/src/
mv src/types packages/core/src/
mv src/utils packages/core/src/
mv src/validate packages/core/src/
```

- [ ] **Step 2: Verify core source files are in place and src/ only has cli.ts, commands/, plugins/ remaining**

```bash
ls packages/core/src/
ls src/
```

Expected core: `changeset/ config/ ecosystem/ error.ts git.ts index.ts monorepo/ options.ts plugin/ prerelease/ registry/ tasks/ types/ utils/ validate/`
Expected remaining src/: `cli.ts commands/ plugins/`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: move core source files to packages/core/src/"
```

---

### Task 6: Update @pubm/core index.ts exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Remove `externalVersionSync` export from core index.ts**

The `externalVersionSync` plugin is being extracted to its own package. Remove the import and re-export of `externalVersionSync` and its types from `packages/core/src/index.ts`. Keep all other exports as-is since internal relative imports within core remain unchanged.

Find and remove lines like:
```typescript
export { externalVersionSync } from "./plugins/external-version-sync/index.js";
export type { ExternalVersionSyncOptions, JsonTarget, RegexTarget, SyncTarget } from "./plugins/external-version-sync/types.js";
```

- [ ] **Step 2: Verify no broken internal imports within core**

```bash
cd packages/core && bun tsc --noEmit 2>&1 | head -20
```

Fix any import issues found. Internal imports (e.g., `./changeset/index.js`) should still work since the relative structure is preserved.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "refactor: remove external-version-sync export from core index"
```

---

### Task 7: Create core build script

**Files:**
- Create: `build-core.ts` (at repo root, referenced by core's build script)

- [ ] **Step 1: Create build-core.ts**

Extract the SDK build portion from the current `build.ts`. This builds only the library (ESM + CJS + types), not the CLI binaries.

```typescript
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const coreDir = path.join(import.meta.dir, "packages/core");
const distDir = path.join(coreDir, "dist");

// Clean
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}

const entrypoint = path.join(coreDir, "src/index.ts");
const nodeBuiltins = (await import("node:module")).builtinModules.flatMap((m) => [m, `node:${m}`]);

// ESM build
await Bun.build({
  entrypoints: [entrypoint],
  outdir: distDir,
  format: "esm",
  target: "node",
  splitting: false,
  external: nodeBuiltins,
  naming: "index.js",
});

// CJS build
await Bun.build({
  entrypoints: [entrypoint],
  outdir: distDir,
  format: "cjs",
  target: "node",
  splitting: false,
  external: nodeBuiltins,
  naming: "index.cjs",
});

// Types
const tscResult = Bun.spawnSync(["bunx", "tsc", "--project", path.join(coreDir, "tsconfig.build.json")], {
  cwd: coreDir,
  stdio: ["inherit", "inherit", "inherit"],
});

if (tscResult.exitCode !== 0) {
  process.exit(1);
}

console.log("@pubm/core build complete");
```

- [ ] **Step 2: Commit**

```bash
git add build-core.ts
git commit -m "chore: add core build script"
```

---

### Task 8: Create core vitest config and move core tests

**Files:**
- Create: `packages/core/vitest.config.mts`
- Move: core-related test files from `tests/` → `packages/core/tests/`

- [ ] **Step 1: Create packages/core/vitest.config.mts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/types/**", "src/config/**"],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 90,
      },
    },
    pool: "forks",
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
```

- [ ] **Step 2: Move core test files**

```bash
mkdir -p packages/core/tests/unit

# Copy setup file
cp tests/setup.ts packages/core/tests/setup.ts

# Move core unit tests
mv tests/unit/error.test.ts packages/core/tests/unit/
mv tests/unit/git.test.ts packages/core/tests/unit/
mv tests/unit/index.test.ts packages/core/tests/unit/
mv tests/unit/options.test.ts packages/core/tests/unit/
mv tests/unit/changeset packages/core/tests/unit/
mv tests/unit/config packages/core/tests/unit/
mv tests/unit/ecosystem packages/core/tests/unit/
mv tests/unit/monorepo packages/core/tests/unit/
mv tests/unit/plugin packages/core/tests/unit/
mv tests/unit/prerelease packages/core/tests/unit/
mv tests/unit/registry packages/core/tests/unit/
mv tests/unit/tasks packages/core/tests/unit/
mv tests/unit/types packages/core/tests/unit/
mv tests/unit/utils packages/core/tests/unit/
mv tests/unit/validate packages/core/tests/unit/

# Note: tests/unit/plugins/ will also be moved here temporarily.
# Task 14 will move them to the plugin package later.
mv tests/unit/plugins packages/core/tests/unit/
```

- [ ] **Step 3: Update test import paths**

All test files use relative imports like `import { X } from "../../../src/module.js"`. After moving tests to `packages/core/tests/unit/`, the relative path to `packages/core/src/` changes.

For tests that were at `tests/unit/<name>.test.ts` (3 levels up to src/):
- Old: `"../../../src/git.js"` → New: `"../../src/git.js"`

For tests that were at `tests/unit/<dir>/<name>.test.ts` (4 levels up to src/):
- Old: `"../../../../src/ecosystem/js.js"` → New: `"../../../src/ecosystem/js.js"`

Use find-and-replace across all test files in `packages/core/tests/`:
- Replace `"../../../../src/` with `"../../../src/`
- Replace `"../../../src/` with `"../../src/` (only in files directly under `tests/unit/`, NOT in subdirectories)

Be careful with the order — process deeper paths first.

- [ ] **Step 4: Verify core tests pass**

```bash
cd packages/core && bun vitest --run 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: move core tests to packages/core/tests/"
```

---

## Chunk 3: pubm CLI Package

### Task 9: Create pubm CLI package structure

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/tsconfig.build.json`

- [ ] **Step 1: Create packages/cli/ directory**

```bash
mkdir -p packages/cli
```

- [ ] **Step 2: Create packages/cli/package.json**

```json
{
  "name": "pubm",
  "version": "0.3.6",
  "type": "module",
  "description": "publish manager for multiple registry (jsr, npm and private registries)",
  "bin": {
    "pubm": "./bin/cli.js"
  },
  "files": [
    "bin/",
    "dist/",
    "postinstall.cjs"
  ],
  "scripts": {
    "build": "bun run build.ts",
    "postinstall": "node ./postinstall.cjs",
    "check": "biome check",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "coverage": "vitest --run --coverage"
  },
  "dependencies": {
    "@pubm/core": "workspace:*",
    "commander": "^14.0.3",
    "update-kit": "^0.1.1"
  },
  "optionalDependencies": {
    "@pubm/darwin-arm64": "0.2.12",
    "@pubm/darwin-x64": "0.2.12",
    "@pubm/linux-arm64": "0.2.12",
    "@pubm/linux-x64": "0.2.12",
    "@pubm/windows-x64": "0.2.12"
  },
  "engines": {
    "node": ">=18",
    "git": ">=2.11.0"
  },
  "license": "Apache-2.0",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/syi0808/pubm.git",
    "directory": "packages/cli"
  },
  "keywords": [
    "npm", "jsr", "registry", "publish", "np",
    "publish manager", "private registry", "multiple publish"
  ]
}
```

- [ ] **Step 3: Create packages/cli/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [
    { "path": "../core" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

- [ ] **Step 4: Create packages/cli/tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "emitDeclarationOnly": true,
    "declaration": true,
    "declarationDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/
git commit -m "chore: create pubm CLI package skeleton"
```

---

### Task 10: Move CLI source files

**Files:**
- Move: `src/cli.ts` → `packages/cli/src/cli.ts`
- Move: `src/commands/` → `packages/cli/src/commands/`
- Move: `bin/cli.js` → `packages/cli/bin/cli.js`
- Move: `build.ts` → `packages/cli/build.ts`
- Move: `postinstall.cjs` → `packages/cli/postinstall.cjs`

- [ ] **Step 1: Move CLI source files**

```bash
mkdir -p packages/cli/src packages/cli/bin

mv src/cli.ts packages/cli/src/
mv src/commands packages/cli/src/
mv bin/cli.js packages/cli/bin/
mv build.ts packages/cli/build.ts
mv postinstall.cjs packages/cli/postinstall.cjs
```

- [ ] **Step 2: Verify files are in place**

```bash
ls packages/cli/src/
ls packages/cli/src/commands/
ls packages/cli/bin/
```

Expected: `cli.ts`, `commands/` directory with all command files, `bin/cli.js`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: move CLI source files to packages/cli/"
```

---

### Task 11: Update CLI import paths to use @pubm/core

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Modify: All files in `packages/cli/src/commands/`

- [ ] **Step 1: Update packages/cli/src/cli.ts imports**

Replace all relative imports that point to core modules with `@pubm/core` imports:

```typescript
// Before (relative imports to core)
import { discoverCurrentVersions } from "./changeset/packages.js";
import { getStatus } from "./changeset/status.js";
import { calculateVersionBumps } from "./changeset/version.js";
import { loadConfig } from "./config/loader.js";
import { consoleError } from "./error.js";
import { Git } from "./git.js";
import { pubm } from "./index.js";
import { requiredMissingInformationTasks } from "./tasks/required-missing-information.js";
import type { Options } from "./types/options.js";
import { notifyNewVersion } from "./utils/notify-new-version.js";
import { version } from "./utils/package.js";

// After (@pubm/core imports — all from barrel export)
import {
  calculateVersionBumps,
  consoleError,
  discoverCurrentVersions,
  getStatus,
  Git,
  loadConfig,
  notifyNewVersion,
  pubm,
  requiredMissingInformationTasks,
  version,
} from "@pubm/core";
import type { Options } from "@pubm/core";
```

**Important:** Many functions used by CLI commands are NOT currently exported from `@pubm/core`'s `index.ts`. The approach is to **add all missing exports to `packages/core/src/index.ts`** so all CLI imports use `@pubm/core` barrel import (no deep imports).

To catalog all missing exports, run this in all CLI source files:
```bash
grep -rh "from \"\.\." packages/cli/src/ | sort -u
```

Known missing exports that must be added to `packages/core/src/index.ts`:
- `consoleError` from `./error.js`
- `notifyNewVersion` from `./utils/notify-new-version.js`
- `version`, `getPackageJson`, `replaceVersion`, `replaceVersionAtPath` from `./utils/package.js`
- `requiredMissingInformationTasks` from `./tasks/required-missing-information.js`
- `discoverPackages` from `./monorepo/discover.js` (+ `DiscoveredPackage` type)
- `discoverCurrentVersions`, `discoverPackageInfos` from `./changeset/packages.js`
- `exec` from `./utils/exec.js`
- `getPackageManager` from `./utils/package-manager.js`
- `loadTokensFromDb` from `./utils/token.js`
- `syncGhSecrets` from tasks if used by commands
- Any other functions/types found by the grep audit above

- [ ] **Step 2: Update each command file's imports**

For each file in `packages/cli/src/commands/`, replace relative imports to core modules with `@pubm/core`:

Example for `add.ts`:
```typescript
// Before
import type { BumpType, Release } from "../changeset/parser.js";
import { writeChangeset } from "../changeset/writer.js";
import { discoverPackages } from "../monorepo/discover.js";
import { getPackageJson } from "../utils/package.js";

// After
import type { BumpType, Release } from "@pubm/core";
import { writeChangeset, discoverPackages, getPackageJson } from "@pubm/core";
```

Keep `commander` imports as-is (they come from the CLI's own dependency).
Keep relative imports between command files (e.g., `./init-changesets.js` from `init.ts`).

**Special case — `init.ts` template string:** The `init.ts` command generates a `pubm.config.ts` template containing `import { defineConfig } from 'pubm'`. Update this string literal to `from '@pubm/core'`.

- [ ] **Step 3: Add missing exports to packages/core/src/index.ts**

After cataloging all imports needed by CLI, add any missing exports. Read the current `packages/core/src/index.ts` and add exports for:
- `consoleError` from `./error.js`
- `notifyNewVersion` from `./utils/notify-new-version.js`
- `version` from `./utils/package.js`
- `requiredMissingInformationTasks` from `./tasks/required-missing-information.js`
- Any other functions/types imported by command files

- [ ] **Step 4: Verify CLI typechecks**

```bash
cd packages/cli && bun tsc --noEmit 2>&1 | head -30
```

Fix any remaining import issues.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/ packages/core/src/index.ts
git commit -m "refactor: update CLI imports to use @pubm/core"
```

---

### Task 12: Update CLI build.ts for monorepo context

**Files:**
- Modify: `packages/cli/build.ts`

- [ ] **Step 1: Move npm/ directory into packages/cli/**

The `npm/` directory at the repo root contains platform binary output directories. Move it into the CLI package:

```bash
mv npm packages/cli/npm
```

- [ ] **Step 2: Update build.ts paths**

The build script needs path updates since it moved from repo root to `packages/cli/`. Key changes:
- `import.meta.dir` now resolves to `packages/cli/`
- SDK build (ESM/CJS/types) is handled by core's build — remove that from CLI build
- Keep only the cross-compile binary build
- Update the binary entry point to resolve correctly (it's now at `packages/cli/src/cli.ts`)
- `npm/` output directory is now at `packages/cli/npm/` (already moved)
- Update `package.json` reading for version to read from `packages/cli/package.json`

- [ ] **Step 3: Review and update bin/cli.js**

The `bin/cli.js` wrapper finds platform-specific binaries by walking up `node_modules`. Verify that path resolution still works from `packages/cli/bin/cli.js`. The `require.resolve()` and `node_modules` traversal logic should work unchanged since npm installs `optionalDependencies` in the same `node_modules` tree, but verify by reading the file and tracing the paths.

- [ ] **Step 4: Verify build works**

```bash
cd packages/cli && bun run build.ts --current 2>&1 | tail -10
```

Expected: Binary built for current platform.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/build.ts packages/cli/bin/cli.js packages/cli/npm/
git commit -m "refactor: update CLI build script and binary wrapper for monorepo structure"
```

---

### Task 13: Move CLI tests

**Files:**
- Move: `tests/unit/cli.test.ts` → `packages/cli/tests/unit/cli.test.ts`
- Move: `tests/unit/commands/` → `packages/cli/tests/unit/commands/`
- Move: `tests/e2e/` → `packages/cli/tests/e2e/`
- Move: `tests/fixtures/` → `packages/cli/tests/fixtures/`
- Move: `tests/utils/` → `packages/cli/tests/utils/`
- Create: `packages/cli/vitest.config.mts`

- [ ] **Step 1: Create CLI vitest config**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/commands/**"],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 90,
      },
    },
    pool: "forks",
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
```

- [ ] **Step 2: Move CLI test files**

```bash
mkdir -p packages/cli/tests/unit

# Copy setup file
cp tests/setup.ts packages/cli/tests/setup.ts

# Move CLI-specific tests
mv tests/unit/cli.test.ts packages/cli/tests/unit/
mv tests/unit/commands packages/cli/tests/unit/

# Move e2e, integration, fixtures, utils
mv tests/e2e packages/cli/tests/
mv tests/integration packages/cli/tests/
mv tests/fixtures packages/cli/tests/
mv tests/utils packages/cli/tests/
```

- [ ] **Step 3: Update CLI test import paths**

CLI tests previously imported from `../../../src/cli.js` etc. Update to use `@pubm/core` for core imports and relative paths for CLI-local files:

For `cli.test.ts`:
```typescript
// Before
import { createProgram } from "../../../src/cli.js";

// After
import { createProgram } from "../../src/cli.js";
```

For command tests, update similarly — core module imports become `@pubm/core`, CLI-local imports use updated relative paths.

- [ ] **Step 4: Verify CLI tests pass**

```bash
cd packages/cli && bun vitest --run 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: move CLI tests to packages/cli/tests/"
```

---

## Chunk 3: Plugin Packages

### Task 14: Extract plugin-external-version-sync to its own package

**Files:**
- Move: `src/plugins/external-version-sync/` → `plugins/plugin-external-version-sync/src/`
- Create: `plugins/plugin-external-version-sync/package.json`
- Create: `plugins/plugin-external-version-sync/tsconfig.json`
- Move: `tests/unit/plugins/external-version-sync/` → `plugins/plugin-external-version-sync/tests/`
- Move: `tests/integration/external-version-sync.test.ts` → `plugins/plugin-external-version-sync/tests/integration/`

- [ ] **Step 1: Create plugin package structure**

```bash
mkdir -p plugins/plugin-external-version-sync/src
mkdir -p plugins/plugin-external-version-sync/tests/unit
mkdir -p plugins/plugin-external-version-sync/tests/integration
```

- [ ] **Step 2: Create plugins/plugin-external-version-sync/package.json**

```json
{
  "name": "@pubm/plugin-external-version-sync",
  "version": "0.3.6",
  "type": "module",
  "description": "pubm plugin to sync versions to external files",
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
    "directory": "plugins/plugin-external-version-sync"
  }
}
```

- [ ] **Step 3: Create plugins/plugin-external-version-sync/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
    "paths": {
      "@pubm/core": ["../../packages/core/src/index.ts"]
    }
  },
  "references": [
    { "path": "../../packages/core" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

- [ ] **Step 4: Create tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "emitDeclarationOnly": true,
    "declaration": true,
    "declarationDir": "dist"
  }
}
```

- [ ] **Step 5: Move source files**

```bash
mv src/plugins/external-version-sync/index.ts plugins/plugin-external-version-sync/src/
mv src/plugins/external-version-sync/sync.ts plugins/plugin-external-version-sync/src/
mv src/plugins/external-version-sync/types.ts plugins/plugin-external-version-sync/src/
```

- [ ] **Step 6: Update imports in plugin source**

In `plugins/plugin-external-version-sync/src/index.ts`, update the import of `PubmPlugin` type:

```typescript
// Before
import type { PubmPlugin } from "../../plugin/types.js";

// After
import type { PubmPlugin } from "@pubm/core";
```

Update any other imports referencing `../../` paths to use `@pubm/core`.

- [ ] **Step 7: Move and update tests**

Note: By this point, plugin tests were moved to `packages/core/tests/` in Task 8. Move them to the plugin package instead. The integration test was moved to `packages/cli/tests/` in Task 13.

```bash
# Move unit tests from core (where Task 8 placed them)
mv packages/core/tests/unit/plugins/external-version-sync/* plugins/plugin-external-version-sync/tests/unit/
rmdir packages/core/tests/unit/plugins/external-version-sync packages/core/tests/unit/plugins 2>/dev/null

# Move integration test from CLI (where Task 13 placed it)
mv packages/cli/tests/integration/external-version-sync.test.ts plugins/plugin-external-version-sync/tests/integration/

# Copy setup file
cp packages/core/tests/setup.ts plugins/plugin-external-version-sync/tests/setup.ts
```

Create `plugins/plugin-external-version-sync/vitest.config.mts`:
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

Update test import paths to use relative paths to `src/` or `@pubm/core`.

- [ ] **Step 8: Verify plugin builds and tests pass**

```bash
cd plugins/plugin-external-version-sync && bun tsc --noEmit && bun vitest --run
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: extract plugin-external-version-sync to its own package"
```

---

### Task 15: Update plugin-brew to use @pubm/core

**Files:**
- Modify: `plugins/plugin-brew/package.json`
- Modify: `plugins/plugin-brew/tsconfig.json`
- Modify: `plugins/plugin-brew/src/*.ts`

- [ ] **Step 1: Update plugins/plugin-brew/package.json**

Change peerDependency from `pubm` to `@pubm/core`:

```json
{
  "peerDependencies": {
    "@pubm/core": ">=0.3.6"
  }
}
```

- [ ] **Step 2: Update plugins/plugin-brew/tsconfig.json**

Update the path alias to point to `@pubm/core`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
    "paths": {
      "@pubm/core": ["../../packages/core/src/index.ts"]
    }
  },
  "references": [
    { "path": "../../packages/core" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Update source imports**

In all `plugins/plugin-brew/src/*.ts` files, replace:
```typescript
import type { PubmPlugin } from "pubm";
// →
import type { PubmPlugin } from "@pubm/core";
```

- [ ] **Step 4: Verify plugin typechecks**

```bash
cd plugins/plugin-brew && bun tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-brew/
git commit -m "refactor: update plugin-brew to depend on @pubm/core"
```

---

## Chunk 4: Cleanup & Integration

### Task 16: Clean up old source directories

**Files:**
- Remove: `src/` (should be empty or only have `plugins/` shell)
- Remove: `bin/` (moved to packages/cli/)
- Remove: old `tests/` files (moved to packages)
- Modify: root `vitest.config.mts` (remove or update)
- Modify: root `tsconfig.build.json` (remove, now in packages)

- [ ] **Step 1: Remove empty old directories**

```bash
# Remove remaining src/ directory (should be empty except maybe plugins/ shell)
rm -rf src/
rm -rf bin/

# Remove old tests directory if empty
rm -rf tests/

# Remove old build configs that moved to packages
rm -f tsconfig.build.json
rm -f vitest.config.mts
```

- [ ] **Step 2: Update .gitignore**

Add entries for monorepo build outputs:
```
# Package build outputs
packages/*/dist/
plugins/*/dist/

# Turbo
.turbo/
```

- [ ] **Step 3: Update biome.json if needed**

Verify `biome.json` still works at the repo root. It should — biome naturally discovers files. No changes expected unless paths are hardcoded.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: clean up old single-package files and directories"
```

---

### Task 17: Install dependencies and verify workspace

- [ ] **Step 1: Install all dependencies**

```bash
bun install
```

Expected: bun resolves workspace dependencies (`@pubm/core: workspace:*`), creates/updates lockfile.

- [ ] **Step 2: Verify workspace packages are linked**

```bash
bun pm ls --all 2>&1 | grep @pubm
```

Expected: `@pubm/core` appears as a workspace link in the CLI package.

- [ ] **Step 3: Commit lockfile changes**

```bash
git add bun.lock package.json
git commit -m "chore: update lockfile for monorepo workspace"
```

---

### Task 18: Verify full build pipeline

- [ ] **Step 1: Build all packages**

```bash
turbo run build
```

Expected: Core builds first (ESM + CJS + types), then CLI and plugins build successfully.

- [ ] **Step 2: Run all tests**

```bash
turbo run test
```

Expected: All tests pass across all packages.

- [ ] **Step 3: Run typecheck**

```bash
turbo run typecheck
```

Expected: No type errors in any package.

- [ ] **Step 4: Run lint**

```bash
turbo run check
```

Expected: No lint errors.

- [ ] **Step 5: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix: resolve monorepo build/test issues"
```

---

## Chunk 5: Publish Automation

### Task 19: Add pubm.config.ts for self-publishing

**Files:**
- Create: `pubm.config.ts`

- [ ] **Step 1: Create pubm.config.ts**

```typescript
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

- [ ] **Step 2: Initialize changeset directory**

```bash
mkdir -p .changeset
```

- [ ] **Step 3: Commit**

```bash
git add pubm.config.ts .changeset/
git commit -m "chore: add pubm.config.ts for monorepo self-publishing"
```

---

### Task 20: Update CI workflows

**Files:**
- Modify: `.github/workflows/` (any existing CI/CD workflows)

- [ ] **Step 1: Review existing workflows**

```bash
ls .github/workflows/
```

Check each workflow and update:
- Build commands: `bun run build` → `turbo run build`
- Test commands: `bun run test` → `turbo run test`
- Add `turbo` to CI dependencies if not using bun's workspace resolution
- Update release workflow to use `pubm --ci` from the monorepo root

- [ ] **Step 2: Update workflows accordingly**

Update each workflow file with the new commands.

- [ ] **Step 3: Commit**

```bash
git add .github/
git commit -m "ci: update workflows for monorepo structure"
```

---

### Task 21: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md to reflect monorepo structure**

Update the project overview, commands, and architecture sections to describe the new monorepo layout. Key changes:
- Commands now use `turbo run` for build/test/typecheck
- Architecture section describes the package split
- File paths reflect new locations

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for monorepo structure"
```

---

### Task 22: Final integration verification

- [ ] **Step 1: Clean install from scratch**

```bash
rm -rf node_modules packages/*/node_modules plugins/*/node_modules
bun install
```

- [ ] **Step 2: Full build**

```bash
turbo run build
```

- [ ] **Step 3: Full test suite**

```bash
turbo run test
```

- [ ] **Step 4: Full typecheck**

```bash
turbo run typecheck
```

- [ ] **Step 5: Lint check**

```bash
turbo run check
```

- [ ] **Step 6: Verify CLI binary works**

```bash
cd packages/cli && bun src/cli.ts --help
```

Expected: CLI help output displays correctly.

- [ ] **Step 7: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final monorepo integration fixes"
```
