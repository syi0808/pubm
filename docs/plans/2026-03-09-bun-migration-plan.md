# Bun Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate pubm from Node.js/pnpm/tsup to Bun for single binary distribution while keeping the npm SDK package.

**Architecture:** Incremental migration in 5 phases — package manager, build system, process spawning, keyring removal, binary distribution. Each phase is independently testable via the existing Vitest suite.

**Tech Stack:** Bun (runtime + bundler + package manager), TypeScript, Vitest, Biome

---

### Task 1: Package Manager — Remove pnpm, install with bun

**Files:**
- Delete: `pnpm-lock.yaml`
- Modify: `package.json`

**Step 1: Update package.json**

Remove the `pnpm` section and update `packageManager`:

```json
// Remove this:
"packageManager": "pnpm@9.11.0",
"pnpm": {
  "patchedDependencies": {
    "listr2": "patches/listr2.patch"
  }
}

// No packageManager field needed for bun
```

**Step 2: Delete pnpm-lock.yaml**

Run: `rm pnpm-lock.yaml`

**Step 3: Install with bun**

Run: `bun install`
Expected: `bun.lockb` generated, all deps installed.

**Step 4: Verify the patch**

Bun auto-applies patches from `patches/` directory. Verify:
Run: `grep -r "signalHandler" node_modules/listr2/dist/index.cjs | head -5`
Expected: patched code visible

**Step 5: Update scripts in package.json**

Replace `pnpm` references:
```json
"scripts": {
  "watch": "tsup --watch",
  "build": "tsup",
  "check": "biome check",
  "format": "bun check --write",
  "typecheck": "tsc --noEmit",
  "test": "vitest --run",
  "coverage": "vitest --run --coverage",
  "release": "bun run build && node bin/cli.js --preflight",
  "ci:release": "node bin/cli.js --publish-only"
}
```

Note: `tsup` stays in scripts for now (replaced in Task 2).

**Step 6: Run tests**

Run: `bun vitest --run`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: migrate package manager from pnpm to bun"
```

---

### Task 2: Build System — Replace tsup with bun build

**Files:**
- Delete: `tsup.config.ts`
- Modify: `package.json` (scripts)
- Create: `build.ts` (build script)

**Step 1: Create build script**

Create `build.ts` at project root:

```typescript
import { $ } from "bun";

// Clean output directories
await $`rm -rf dist bin`;

// Library build: ESM
await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  format: "esm",
  target: "node",
  packages: "external",
  naming: "[dir]/[name].js",
});

// Library build: CJS
await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  format: "cjs",
  target: "node",
  packages: "external",
  naming: "[dir]/[name].cjs",
});

// CLI build: ESM with shebang
const cliBuild = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "bin",
  format: "esm",
  target: "node",
  packages: "external",
  naming: "[dir]/cli.js",
});

// Prepend shebang to CLI output
const cliPath = "bin/cli.js";
const content = await Bun.file(cliPath).text();
await Bun.write(cliPath, `#!/usr/bin/env node\n${content}`);

// Generate type declarations
await $`tsc --declaration --emitDeclarationOnly --outDir dist`;

console.log("Build complete.");
```

Note: listr2 bundling — check if `packages: "external"` excludes it. If listr2 needs bundling, we can selectively include it. This may need adjustment after testing.

**Step 2: Update package.json scripts**

```json
"scripts": {
  "build": "bun run build.ts",
  "build:compile": "bun build --compile src/cli.ts --outfile pubm",
  ...
}
```

**Step 3: Remove tsup**

Run: `bun remove tsup`

**Step 4: Delete tsup.config.ts**

Run: `rm tsup.config.ts`

**Step 5: Run build and verify output**

Run: `bun run build`
Expected: `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, `bin/cli.js` generated.

**Step 6: Run tests**

Run: `bun vitest --run`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: replace tsup with bun build"
```

---

### Task 3: Process Spawning — Replace tinyexec with Bun.spawn wrapper

**Files:**
- Create: `src/utils/exec.ts`
- Modify: `src/error.ts` (remove tinyexec import)
- Modify: `src/git.ts`
- Modify: `src/registry/jsr.ts`
- Modify: `src/registry/npm.ts`
- Modify: `src/registry/crates.ts`
- Modify: `src/registry/custom-registry.ts`
- Modify: `src/ecosystem/rust.ts`
- Modify: `src/tasks/runner.ts`
- Modify: `src/tasks/preflight.ts`
- Modify: `src/commands/snapshot.ts`
- Modify: `tests/utils/cli.ts`
- Modify: All test files that mock tinyexec

**Step 1: Create exec wrapper**

Create `src/utils/exec.ts`:

```typescript
export class NonZeroExitError extends Error {
  output: { stdout: string; stderr: string };

  constructor(
    command: string,
    exitCode: number,
    output: { stdout: string; stderr: string },
  ) {
    super(
      `Command "${command}" exited with code ${exitCode}\n${output.stderr}`,
    );
    this.name = "NonZeroExitError";
    this.output = output;
  }
}

interface ExecOptions {
  throwOnError?: boolean;
  nodeOptions?: {
    env?: Record<string, string | undefined>;
    cwd?: string;
  };
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: options.nodeOptions?.env
      ? { ...process.env, ...options.nodeOptions.env }
      : undefined,
    cwd: options.nodeOptions?.cwd,
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (options.throwOnError && exitCode !== 0) {
    throw new NonZeroExitError(command, exitCode, { stdout, stderr });
  }

  return { stdout, stderr, exitCode };
}
```

**Step 2: Update src/error.ts**

Replace:
```typescript
import { NonZeroExitError } from "tinyexec";
```
With:
```typescript
import { NonZeroExitError } from "./utils/exec.js";
```

**Step 3: Update all source files importing tinyexec**

In every file that has `import { exec } from "tinyexec"`, replace with:
```typescript
import { exec } from "../utils/exec.js";  // adjust relative path per file
```

Files and their import paths:
- `src/git.ts` → `import { exec } from "./utils/exec.js"`
- `src/registry/jsr.ts` → `import { exec } from "../utils/exec.js"`
- `src/registry/npm.ts` → `import { exec } from "../utils/exec.js"`
- `src/registry/crates.ts` → `import { exec } from "../utils/exec.js"`
- `src/registry/custom-registry.ts` → `import { exec } from "../utils/exec.js"`
- `src/ecosystem/rust.ts` → `import { exec } from "../utils/exec.js"`
- `src/tasks/runner.ts` → `import { exec } from "../utils/exec.js"`
- `src/tasks/preflight.ts` → `import { exec } from "../utils/exec.js"`
- `src/commands/snapshot.ts` → `import { exec } from "../utils/exec.js"`

**Step 4: Update tests/utils/cli.ts**

Replace:
```typescript
import { exec, type Options } from "tinyexec";
```
With:
```typescript
import { exec } from "../../src/utils/exec.js";
```

Verify the `Options` type is no longer needed or adapt usage.

**Step 5: Update test mocks**

All test files that mock `tinyexec` need to mock `../utils/exec.js` (or the appropriate relative path) instead. Search for `vi.mock("tinyexec")` and replace with `vi.mock` pointing to the new module path.

**Step 6: Remove tinyexec dependency**

Run: `bun remove tinyexec`

**Step 7: Run tests**

Run: `bun vitest --run`
Expected: All tests pass.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor: replace tinyexec with Bun.spawn wrapper"
```

---

### Task 4: Process Spawning — Replace cross-spawn and @npmcli/promise-spawn

**Files:**
- Modify: `src/tasks/npm.ts`
- Modify: `src/tasks/jsr.ts`
- Modify: `src/tasks/runner.ts`
- Create: `src/utils/open-url.ts`

**Step 1: Create open-url utility**

Create `src/utils/open-url.ts`:

```typescript
import process from "node:process";

export async function openUrl(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";

  const args =
    process.platform === "win32" ? ["/c", "start", url] : [url];

  Bun.spawn([command, ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });
}
```

**Step 2: Replace cross-spawn in src/tasks/npm.ts**

Replace the `spawn("npm", ["login"], ...)` block with `Bun.spawn`:

```typescript
// Replace:
import spawn from "cross-spawn";
// With: (remove import entirely)

// Replace spawn usage (lines 33-62):
const child = Bun.spawn(["npm", "login"], {
  stdout: "pipe",
  stderr: "pipe",
  stdin: "pipe",
});

let opened = false;

const readStream = async (
  stream: ReadableStream<Uint8Array>,
  onData: (text: string) => void,
) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onData(decoder.decode(value));
  }
};

await new Promise<void>((resolve, reject) => {
  const onData = (text: string) => {
    const urlMatch = text.match(
      /https:\/\/www\.npmjs\.com\/login[^\s]*/,
    );

    if (urlMatch && !opened) {
      opened = true;
      task.output = `Login at: ${color.cyan(urlMatch[0])}`;
      openUrl(urlMatch[0]);
      child.stdin.write("\n");
    }
  };

  Promise.all([
    readStream(child.stdout, onData),
    readStream(child.stderr, onData),
  ]).catch(reject);

  child.exited.then((code) =>
    code === 0
      ? resolve()
      : reject(new Error(`npm login exited with code ${code}`)),
  ).catch(reject);
});
```

**Step 3: Replace @npmcli/promise-spawn with openUrl**

In `src/tasks/npm.ts`, `src/tasks/jsr.ts`, `src/tasks/runner.ts`:

Replace:
```typescript
import npmCli from "@npmcli/promise-spawn";
const { open } = npmCli;
// ... open(url)
```
With:
```typescript
import { openUrl } from "../utils/open-url.js";
// ... openUrl(url)
```

**Step 4: Update test mocks**

Update `tests/unit/tasks/npm.test.ts` to mock the new modules instead of `cross-spawn` and `@npmcli/promise-spawn`.

**Step 5: Remove dependencies**

Run: `bun remove cross-spawn @npmcli/promise-spawn @types/cross-spawn @types/npmcli__promise-spawn`

**Step 6: Run tests**

Run: `bun vitest --run`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: replace cross-spawn and @npmcli/promise-spawn with Bun natives"
```

---

### Task 5: Remove @napi-rs/keyring — Use Db class exclusively

**Files:**
- Modify: `src/utils/secure-store.ts`

**Step 1: Simplify SecureStore to use Db only**

Replace `src/utils/secure-store.ts` entirely:

```typescript
import { Db } from "./db.js";

export class SecureStore {
  private db: Db | null = null;

  private getDb(): Db {
    if (!this.db) this.db = new Db();
    return this.db;
  }

  get(field: string): string | null {
    try {
      return this.getDb().get(field);
    } catch {
      return null;
    }
  }

  set(field: string, value: unknown): void {
    this.getDb().set(field, value);
  }
}
```

**Step 2: Remove dependency**

Run: `bun remove @napi-rs/keyring`

**Step 3: Run tests**

Run: `bun vitest --run`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove @napi-rs/keyring, use encrypted file storage exclusively"
```

---

### Task 6: Single Binary Build — bun build --compile

**Files:**
- Modify: `build.ts` (add compile target)
- Modify: `package.json` (scripts, bin field, files)

**Step 1: Add compile script to build.ts**

Append to `build.ts`:

```typescript
// Single binary (only when --compile flag passed)
if (process.argv.includes("--compile")) {
  const targets = [
    "bun-linux-x64",
    "bun-linux-arm64",
    "bun-darwin-x64",
    "bun-darwin-arm64",
    "bun-windows-x64",
  ];

  await $`mkdir -p releases`;

  for (const target of targets) {
    const ext = target.includes("windows") ? ".exe" : "";
    const outfile = `releases/pubm-${target}${ext}`;
    await $`bun build --compile --target=${target} src/cli.ts --outfile ${outfile}`;
    console.log(`Built: ${outfile}`);
  }
}
```

**Step 2: Update package.json scripts**

```json
"scripts": {
  "build": "bun run build.ts",
  "build:compile": "bun run build.ts --compile",
  ...
}
```

**Step 3: Build and verify binary locally**

Run: `bun run build:compile`
Expected: `releases/pubm-bun-darwin-arm64` (or your platform) generated.

Run: `./releases/pubm-bun-darwin-arm64 --version`
Expected: Prints version number.

**Step 4: Add releases/ to .gitignore**

Add `releases/` to `.gitignore`.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add single binary compilation via bun build --compile"
```

---

### Task 7: CI — Update workflows for bun

**Files:**
- Modify: `.github/workflows/ci.yaml`
- Modify: `.github/workflows/release.yml`

**Step 1: Update ci.yaml**

Replace the CI workflow to use bun as package manager. Keep test matrix but remove pnpm/node setup, use bun instead:

```yaml
name: 'CI'
on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main
  workflow_dispatch:

jobs:
  lint:
    runs-on: ubuntu-latest
    name: 'Lint'
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run typecheck

  test:
    name: 'Test: ${{ matrix.os }}'
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
      fail-fast: false
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: bun run test

  coverage:
    name: 'Coverage'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: bun run coverage
      - name: 'Report Coverage'
        if: always()
        uses: davelosert/vitest-coverage-report-action@v2
```

**Step 2: Update release.yml**

Add binary build + GitHub Release upload alongside npm/jsr publish:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    environment: Publish
    permissions:
      contents: read
      id-token: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org/
      - run: bun install --frozen-lockfile
      - run: bun run build
      - name: Publish to npm and jsr
        run: bun run ci:release
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}

  build-binaries:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run build:compile
      - name: Upload to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: releases/*
```

**Step 3: Run CI locally to smoke test**

Run: `bun run check && bun run typecheck && bun vitest --run`
Expected: All pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "ci: update workflows for bun"
```

---

### Task 8: npm Platform Packages — Optional binary dependencies

**Files:**
- Create: `packages/` directory with platform package scaffolding
- Modify: `package.json` (optionalDependencies, bin)

**Step 1: Design package structure**

```
packages/
  darwin-arm64/
    package.json   # { "name": "@pubm/darwin-arm64", "os": ["darwin"], "cpu": ["arm64"] }
  darwin-x64/
    package.json
  linux-arm64/
    package.json
  linux-x64/
    package.json
  windows-x64/
    package.json
```

Each platform package.json:
```json
{
  "name": "@pubm/darwin-arm64",
  "version": "0.2.12",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "bin": {
    "pubm": "pubm"
  }
}
```

**Step 2: Update main package.json**

```json
"optionalDependencies": {
  "@pubm/darwin-arm64": "0.2.12",
  "@pubm/darwin-x64": "0.2.12",
  "@pubm/linux-arm64": "0.2.12",
  "@pubm/linux-x64": "0.2.12",
  "@pubm/windows-x64": "0.2.12"
}
```

Remove `"bin"` field from main package.json (CLI is now from platform packages).

**Step 3: Update release CI to publish platform packages**

Add steps to copy compiled binary into each platform package and publish them before the main package.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add platform-specific binary packages for npm distribution"
```

---

### Task 9: Cleanup and CLAUDE.md Update

**Files:**
- Modify: `CLAUDE.md`
- Modify: `package.json` (remove engines.node, clean unused @types)

**Step 1: Update CLAUDE.md**

Update commands section to use `bun` instead of `pnpm`. Update architecture notes about Bun.spawn wrapper, build.ts, and binary distribution.

**Step 2: Remove unused devDependencies**

Run: `bun remove @types/cross-spawn @types/npmcli__promise-spawn @types/npm`

(Some may already be removed in earlier tasks. Skip if so.)

**Step 3: Update engines field**

```json
"engines": {
  "git": ">=2.11.0"
}
```

Remove `"node": ">=18"` since the CLI is now a Bun binary.

**Step 4: Final verification**

Run: `bun run check && bun run typecheck && bun vitest --run && bun run build`
Expected: All pass, build outputs correct.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: cleanup after bun migration"
```
