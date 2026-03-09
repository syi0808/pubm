# Build Script Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the build to produce SDK + cross-compiled platform binaries + thin CLI wrapper in a single `bun run build` command, following agron's distribution pattern.

**Architecture:** `build.ts` produces three outputs: SDK library (dist/), platform binaries (npm/@pubm-{platform}/bin/pubm), and type declarations. The npm package ships a thin Node.js wrapper (`bin/cli.js`) that resolves and spawns the correct platform binary from `optionalDependencies`. SDK remains importable via `dist/`.

**Tech Stack:** Bun build API, Bun compile (`--compile --target`), Node.js (wrapper/postinstall scripts)

**Reference:** `/Users/sung-yein/Workspace/agron/scripts/build.ts`, `/Users/sung-yein/Workspace/agron/bin/agron`, `/Users/sung-yein/Workspace/agron/postinstall.js`

---

### Task 1: Create thin CLI wrapper (`bin/cli.js`)

**Files:**
- Create: `bin/cli.js`

This is a static file checked into git (not build output). It resolves the platform binary and spawns it.

**Step 1: Write `bin/cli.js`**

```js
#!/usr/bin/env node

const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

function run(target) {
  const result = childProcess.spawnSync(target, process.argv.slice(2), {
    stdio: "inherit",
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  const code = typeof result.status === "number" ? result.status : 0
  process.exit(code)
}

const envPath = process.env.PUBM_BIN_PATH
if (envPath) {
  run(envPath)
}

const scriptPath = fs.realpathSync(__filename)
const scriptDir = path.dirname(scriptPath)

const platformMap = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
}
const archMap = {
  x64: "x64",
  arm64: "arm64",
}

let platform = platformMap[os.platform()]
if (!platform) {
  platform = os.platform()
}
let arch = archMap[os.arch()]
if (!arch) {
  arch = os.arch()
}

const base = "@pubm/" + platform + "-" + arch
const binary = platform === "windows" ? "pubm.exe" : "pubm"

function findBinary(startDir) {
  let current = startDir
  for (;;) {
    const modules = path.join(current, "node_modules")
    if (fs.existsSync(modules)) {
      // Check scoped package: node_modules/@pubm/{platform}-{arch}/bin/pubm
      const candidate = path.join(modules, base, "bin", binary)
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return
    }
    current = parent
  }
}

const resolved = findBinary(scriptDir)
if (!resolved) {
  console.error(
    'Failed to find the pubm binary for your platform. You can try manually installing the "' +
      base +
      '" package, or set the PUBM_BIN_PATH environment variable.',
  )
  process.exit(1)
}

run(resolved)
```

**Step 2: Make it executable and verify**

Run: `chmod +x bin/cli.js && head -1 bin/cli.js`
Expected: `#!/usr/bin/env node`

**Step 3: Commit**

```bash
git add bin/cli.js
git commit -m "feat: add thin CLI wrapper for platform binary resolution"
```

---

### Task 2: Create postinstall script

**Files:**
- Create: `postinstall.js`

**Step 1: Write `postinstall.js`**

```js
#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const os = require("os")

function detectPlatform() {
  const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" }
  const archMap = { x64: "x64", arm64: "arm64" }

  const platform = platformMap[os.platform()] || os.platform()
  const arch = archMap[os.arch()] || os.arch()

  return { platform, arch }
}

function main() {
  try {
    const { platform, arch } = detectPlatform()
    const packageName = `@pubm/${platform}-${arch}`
    const binaryName = platform === "windows" ? "pubm.exe" : "pubm"

    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)

    if (!fs.existsSync(binaryPath)) {
      console.error(`pubm: binary not found at ${binaryPath}`)
      process.exit(1)
    }

    console.log(`pubm: platform binary verified (${packageName})`)
  } catch (error) {
    console.error(
      `pubm: could not find platform binary package. You may need to install it manually for your platform (${os.platform()}-${os.arch()}).`
    )
    process.exit(0)
  }
}

main()
```

**Step 2: Commit**

```bash
git add postinstall.js
git commit -m "feat: add postinstall script for platform binary verification"
```

---

### Task 3: Rewrite `build.ts`

**Files:**
- Modify: `build.ts`

The new build.ts does everything in one run:
1. Clean `dist/`, `npm/` directories
2. Build SDK (ESM + CJS)
3. Generate type declarations
4. Cross-compile binaries into `npm/@pubm-{platform}/`

**Step 1: Replace `build.ts` with unified build**

```ts
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const ROOT = import.meta.dir;
const NPM_DIR = join(ROOT, "npm");
const ENTRY_SDK = join(ROOT, "src", "index.ts");
const ENTRY_CLI = join(ROOT, "src", "cli.ts");

const pkg = await Bun.file(join(ROOT, "package.json")).json();
const VERSION = pkg.version as string;

// External packages: Node.js builtins
const external = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

// ── SDK Build ──────────────────────────────────────────────

// Clean output directories
rmSync("dist", { recursive: true, force: true });

// Build library ESM: src/index.ts → dist/index.js
const esmResult = await Bun.build({
  entrypoints: [ENTRY_SDK],
  outdir: "dist",
  target: "node",
  format: "esm",
  splitting: false,
  external,
  packages: "bundle",
  naming: "index.js",
});

if (!esmResult.success) {
  console.error("ESM build failed:", esmResult.logs);
  process.exit(1);
}

// Build library CJS: src/index.ts → dist/index.cjs
const cjsResult = await Bun.build({
  entrypoints: [ENTRY_SDK],
  outdir: "dist",
  target: "node",
  format: "cjs",
  splitting: false,
  external,
  packages: "bundle",
  naming: "index.cjs",
});

if (!cjsResult.success) {
  console.error("CJS build failed:", cjsResult.logs);
  process.exit(1);
}

// Generate type declarations
console.log("Generating type declarations...");
const tsc = Bun.spawn(["tsc", "--project", "tsconfig.build.json"], {
  stdout: "inherit",
  stderr: "inherit",
});
const tscExitCode = await tsc.exited;
if (tscExitCode !== 0) {
  console.error("Type declaration generation failed");
  process.exit(1);
}

console.log("SDK build complete.");
console.log("  dist/index.js  (ESM)");
console.log("  dist/index.cjs (CJS)");
console.log("  dist/index.d.ts (types)");

// ── Cross-compiled Binaries ────────────────────────────────

interface Target {
  os: string;
  arch: "arm64" | "x64";
}

const targets: Target[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "win32", arch: "x64" },
];

function platformName(t: Target): string {
  const os = t.os === "win32" ? "windows" : t.os;
  return `@pubm/${os}-${t.arch}`;
}

function bunTarget(t: Target): string {
  return `bun-${t.os === "win32" ? "windows" : t.os}-${t.arch}`;
}

// Clean previous platform builds
if (existsSync(NPM_DIR)) {
  rmSync(NPM_DIR, { recursive: true });
}

console.log(
  `\nBuilding pubm v${VERSION} binaries for ${targets.length} target(s)...\n`,
);

let succeeded = 0;
let failed = 0;

for (const target of targets) {
  const name = platformName(target);
  const pkgDir = join(NPM_DIR, name);
  const binDir = join(pkgDir, "bin");
  const isWindows = target.os === "win32";
  const binaryName = isWindows ? "pubm.exe" : "pubm";
  const outFile = join(binDir, binaryName);

  mkdirSync(binDir, { recursive: true });

  console.log(`[${name}] Compiling...`);

  const result = Bun.spawnSync(
    [
      "bun",
      "build",
      "--compile",
      `--target=${bunTarget(target)}`,
      ENTRY_CLI,
      "--outfile",
      outFile,
    ],
    {
      cwd: ROOT,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  if (result.exitCode !== 0) {
    console.error(`[${name}] Build failed with exit code ${result.exitCode}`);
    failed++;
    continue;
  }

  // Write platform package.json
  const platformPkg = {
    name: name,
    version: VERSION,
    description: `pubm binary for ${name.replace("@pubm/", "")}`,
    license: "Apache-2.0",
    author: "Yein Sung <syi778800@gmail.com>",
    repository: {
      type: "git",
      url: "git+https://github.com/syi0808/pubm.git",
    },
    homepage: "https://github.com/syi0808/pubm#readme",
    os: [target.os],
    cpu: [target.arch],
  };

  await Bun.write(
    join(pkgDir, "package.json"),
    JSON.stringify(platformPkg, null, 2) + "\n",
  );

  console.log(`[${name}] Done → ${outFile}\n`);
  succeeded++;
}

console.log(
  `\nBuild complete: ${succeeded} succeeded, ${failed} failed.`,
);
if (succeeded > 0) console.log(`Platform packages: ${NPM_DIR}`);
```

**Step 2: Verify the build runs**

Run: `bun run build`
Expected: SDK builds in dist/, binaries compile into npm/@pubm-{platform}/bin/pubm

**Step 3: Commit**

```bash
git add build.ts
git commit -m "feat: unify build to produce SDK + platform binaries"
```

---

### Task 4: Update `package.json`

**Files:**
- Modify: `package.json`

**Step 1: Update package.json fields**

Changes needed:
- Add `bin` field pointing to `bin/cli.js`
- Update `files` to `["bin/", "dist/", "postinstall.js"]`
- Add `postinstall` script
- Remove `build:compile` script
- Remove `release` script (uses old `bin/cli.js` that was a bundled CLI)

```diff
+ "bin": {
+   "pubm": "./bin/cli.js"
+ },
  "files": [
-   "dist"
+   "bin/",
+   "dist/",
+   "postinstall.js"
  ],
  "scripts": {
    "build": "bun run build.ts",
-   "build:compile": "bun run build.ts --compile",
    "check": "biome check",
    "format": "bun check --write",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "coverage": "vitest --run --coverage",
-   "release": "bun run build && node bin/cli.js --preflight",
-   "ci:release": "node bin/cli.js --publish-only"
+   "release": "bun run build && bun src/cli.ts --preflight",
+   "ci:release": "bun src/cli.ts --publish-only",
+   "postinstall": "node ./postinstall.js"
  },
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "feat: update package.json for platform binary distribution"
```

---

### Task 5: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

Since `bin/cli.js` is now a static checked-in file (not build output), we need to stop ignoring `bin/`. Instead, ignore `npm/` (build output) and remove `releases` (no longer used).

**Step 1: Update `.gitignore`**

```diff
- bin
- releases
+ npm
```

**Step 2: Commit**

```bash
git add .gitignore bin/cli.js
git commit -m "chore: update gitignore for new build output structure"
```

---

### Task 6: Update CI release workflow

**Files:**
- Modify: `.github/workflows/release.yml`

The release workflow needs to:
1. Build everything with `bun run build` (includes binaries now)
2. Publish platform packages from `npm/` directory
3. Upload binaries to GitHub Release from `npm/@pubm-*/bin/`

**Step 1: Update `.github/workflows/release.yml`**

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
      contents: write
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

      # Publish platform packages
      - name: Publish platform packages
        run: |
          for dir in npm/@pubm/*/; do
            if [ -f "$dir/package.json" ]; then
              echo "Publishing $(basename $dir)..."
              npm publish "$dir" --access public || true
            fi
          done
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}

      # Publish main package to npm and jsr
      - name: Publish to npm and jsr
        run: bun run ci:release
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}

      # Upload binaries to GitHub Release
      - name: Collect binaries for release
        run: |
          mkdir -p releases
          for dir in npm/@pubm/*/bin; do
            for f in "$dir"/*; do
              if [ -f "$f" ]; then
                platform_dir=$(dirname $(dirname "$f"))
                name=$(basename "$platform_dir")
                ext=""
                if [[ "$f" == *.exe ]]; then ext=".exe"; fi
                cp "$f" "releases/pubm-${name}${ext}"
              fi
            done
          done
      - name: Upload to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: releases/*
```

**Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: update release workflow for unified build"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update build commands section**

Remove `build:compile` reference, update description:

```diff
- bun run build          # Build with Bun (outputs ESM/CJS to dist/, CLI to bin/)
- bun run build:compile  # Build + compile single binaries for all platforms
+ bun run build          # Build SDK (dist/) + cross-compiled platform binaries (npm/)
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for unified build"
```

---

### Task 8: Verify end-to-end

**Step 1: Clean and rebuild**

Run: `rm -rf dist npm && bun run build`
Expected: dist/ has SDK files, npm/@pubm-{platform}/ has binaries and package.json

**Step 2: Verify SDK output**

Run: `ls dist/`
Expected: `index.js`, `index.cjs`, `index.d.ts` (and other .d.ts files)

**Step 3: Verify platform packages**

Run: `ls npm/@pubm/*/bin/`
Expected: Binary files for each platform

**Step 4: Verify wrapper script works locally**

Run: `PUBM_BIN_PATH=npm/@pubm/darwin-arm64/bin/pubm node bin/cli.js --version`
Expected: Prints version number

**Step 5: Run existing tests**

Run: `bun run test`
Expected: All tests pass

**Step 6: Run format + typecheck**

Run: `bun run format && bun run typecheck`
Expected: No errors
