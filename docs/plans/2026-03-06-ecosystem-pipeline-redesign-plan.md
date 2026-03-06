# Ecosystem-Driven Pipeline Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the publish pipeline so Runner delegates to Ecosystem, making crates.io (and future ecosystems) first-class citizens alongside JS.

**Architecture:** Runner becomes an orchestrator that calls Ecosystem methods for build/test/version and Registry methods for publish. Git operations stay in a shared common layer. `package.ts` is fully removed; all callers migrate to Ecosystem.

**Tech Stack:** TypeScript, Vitest, tinyexec, smol-toml, listr2

---

### Task 1: Extend Ecosystem abstract class with new methods

**Files:**
- Modify: `src/ecosystem/ecosystem.ts`
- Test: `tests/unit/ecosystem/ecosystem.test.ts`

**Step 1: Write the failing test**

Add tests for the three new abstract methods in `tests/unit/ecosystem/ecosystem.test.ts`. Update the `TestEcosystem` subclass to implement them and add assertions:

```ts
// Add to the TestEcosystem class:
async runTest(_script?: string): Promise<void> {}
async runBuild(_script?: string): Promise<void> {}
async hasScript(_name: string): Promise<boolean> {
  return true;
}

// Add to the "exposes all abstract methods through subclass" test:
await eco.runTest("test");
await eco.runBuild("build");
expect(await eco.hasScript("test")).toBe(true);
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/ecosystem/ecosystem.test.ts`
Expected: FAIL — `runTest`, `runBuild`, `hasScript` don't exist on Ecosystem

**Step 3: Add abstract methods to Ecosystem**

In `src/ecosystem/ecosystem.ts`, add after the existing abstract methods:

```ts
abstract runTest(script?: string): Promise<void>;
abstract runBuild(script?: string): Promise<void>;
abstract hasScript(name: string): Promise<boolean>;
```

Remove (replaced by `runTest`/`runBuild`):
```ts
// DELETE these two lines:
abstract defaultTestCommand(): Promise<string> | string;
abstract defaultBuildCommand(): Promise<string> | string;
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/ecosystem/ecosystem.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ecosystem/ecosystem.ts tests/unit/ecosystem/ecosystem.test.ts
git commit -m "feat(ecosystem): add runTest, runBuild, hasScript abstract methods"
```

---

### Task 2: Implement new methods in JsEcosystem

**Files:**
- Modify: `src/ecosystem/js.ts`
- Test: `tests/unit/ecosystem/js.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/ecosystem/js.test.ts`. First add the tinyexec mock at the top:

```ts
vi.mock("tinyexec", () => ({
  exec: vi.fn(),
}));

import { exec } from "tinyexec";
const mockedExec = vi.mocked(exec);
```

Then add test blocks:

```ts
describe("runTest", () => {
  it("runs test script via package manager", async () => {
    mockedGetPackageManager.mockResolvedValue("pnpm");
    const eco = new JsEcosystem(pkgPath);
    await eco.runTest("test");
    expect(mockedExec).toHaveBeenCalledWith("pnpm", ["run", "test"], { throwOnError: true });
  });

  it("defaults to 'test' when no script provided", async () => {
    mockedGetPackageManager.mockResolvedValue("pnpm");
    const eco = new JsEcosystem(pkgPath);
    await eco.runTest();
    expect(mockedExec).toHaveBeenCalledWith("pnpm", ["run", "test"], { throwOnError: true });
  });
});

describe("runBuild", () => {
  it("runs build script via package manager", async () => {
    mockedGetPackageManager.mockResolvedValue("pnpm");
    const eco = new JsEcosystem(pkgPath);
    await eco.runBuild("build");
    expect(mockedExec).toHaveBeenCalledWith("pnpm", ["run", "build"], { throwOnError: true });
  });
});

describe("hasScript", () => {
  it("returns true when script exists in package.json", async () => {
    mockedReadFile.mockResolvedValue(
      JSON.stringify({ name: "my-lib", version: "1.0.0", scripts: { test: "vitest" } }) as any,
    );
    const eco = new JsEcosystem(pkgPath);
    expect(await eco.hasScript("test")).toBe(true);
  });

  it("returns false when script does not exist", async () => {
    mockedReadFile.mockResolvedValue(
      JSON.stringify({ name: "my-lib", version: "1.0.0", scripts: {} }) as any,
    );
    const eco = new JsEcosystem(pkgPath);
    expect(await eco.hasScript("test")).toBe(false);
  });

  it("returns false when scripts field is missing", async () => {
    mockedReadFile.mockResolvedValue(
      JSON.stringify({ name: "my-lib", version: "1.0.0" }) as any,
    );
    const eco = new JsEcosystem(pkgPath);
    expect(await eco.hasScript("test")).toBe(false);
  });
});
```

Also update existing `defaultTestCommand` and `defaultBuildCommand` tests — **remove them** as those methods will no longer exist.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/ecosystem/js.test.ts`
Expected: FAIL — methods don't exist yet

**Step 3: Implement in JsEcosystem**

In `src/ecosystem/js.ts`, add import for tinyexec and implement:

```ts
import { exec } from "tinyexec";

// Replace defaultTestCommand and defaultBuildCommand with:
async runTest(script?: string): Promise<void> {
  const pm = await getPackageManager();
  await exec(pm, ["run", script ?? "test"], { throwOnError: true });
}

async runBuild(script?: string): Promise<void> {
  const pm = await getPackageManager();
  await exec(pm, ["run", script ?? "build"], { throwOnError: true });
}

async hasScript(name: string): Promise<boolean> {
  const pkg = await this.readPackageJson();
  const scripts = pkg.scripts as Record<string, string> | undefined;
  return !!scripts?.[name];
}
```

Delete `defaultTestCommand()` and `defaultBuildCommand()`.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/ecosystem/js.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ecosystem/js.ts tests/unit/ecosystem/js.test.ts
git commit -m "feat(ecosystem): implement runTest, runBuild, hasScript in JsEcosystem"
```

---

### Task 3: Implement new methods in RustEcosystem

**Files:**
- Modify: `src/ecosystem/rust.ts`
- Test: `tests/unit/ecosystem/rust.test.ts`

**Step 1: Write the failing tests**

Add to `tests/unit/ecosystem/rust.test.ts`. First add tinyexec mock:

```ts
vi.mock("tinyexec", () => ({
  exec: vi.fn(),
}));

import { exec } from "tinyexec";
const mockedExec = vi.mocked(exec);
```

Then add test blocks:

```ts
describe("runTest", () => {
  it("runs cargo test", async () => {
    const eco = new RustEcosystem(pkgPath);
    await eco.runTest();
    expect(mockedExec).toHaveBeenCalledWith("cargo", ["test"], { throwOnError: true });
  });

  it("ignores script parameter (cargo has built-in test)", async () => {
    const eco = new RustEcosystem(pkgPath);
    await eco.runTest("some-script");
    expect(mockedExec).toHaveBeenCalledWith("cargo", ["test"], { throwOnError: true });
  });
});

describe("runBuild", () => {
  it("runs cargo build --release", async () => {
    const eco = new RustEcosystem(pkgPath);
    await eco.runBuild();
    expect(mockedExec).toHaveBeenCalledWith("cargo", ["build", "--release"], { throwOnError: true });
  });
});

describe("hasScript", () => {
  it("always returns true (cargo has built-in test/build)", async () => {
    const eco = new RustEcosystem(pkgPath);
    expect(await eco.hasScript("test")).toBe(true);
    expect(await eco.hasScript("build")).toBe(true);
    expect(await eco.hasScript("anything")).toBe(true);
  });
});
```

Remove `defaultTestCommand` and `defaultBuildCommand` tests.

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/ecosystem/rust.test.ts`
Expected: FAIL

**Step 3: Implement in RustEcosystem**

In `src/ecosystem/rust.ts`, add:

```ts
import { exec } from "tinyexec";

// Replace defaultTestCommand and defaultBuildCommand with:
async runTest(_script?: string): Promise<void> {
  await exec("cargo", ["test"], { throwOnError: true });
}

async runBuild(_script?: string): Promise<void> {
  await exec("cargo", ["build", "--release"], { throwOnError: true });
}

async hasScript(_name: string): Promise<boolean> {
  return true;
}
```

Delete `defaultTestCommand()` and `defaultBuildCommand()`.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/ecosystem/rust.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ecosystem/rust.ts tests/unit/ecosystem/rust.test.ts
git commit -m "feat(ecosystem): implement runTest, runBuild, hasScript in RustEcosystem"
```

---

### Task 4: Absorb package.ts utilities into JsEcosystem

The key `package.ts` functions (`getPackageJson`, `getJsrJson`, `findOutFile`, `patchCachedJsrJson`, `packageJsonToJsrJson`, `jsrJsonToPackageJson`, `version`, `replaceVersion`) need to be moved into `JsEcosystem` as internal methods or exported from `ecosystem/js.ts`.

**Files:**
- Modify: `src/ecosystem/js.ts` — absorb `findOutFile`, `getPackageJson`, `getJsrJson`, `patchCachedJsrJson`, `packageJsonToJsrJson`, `jsrJsonToPackageJson`
- Modify: `src/utils/package.ts` — delete file after migration
- Modify: `src/utils/package-manager.ts` — replace `findOutFile` import with inline logic or import from JsEcosystem

**Step 1: Move `findOutFile` to a shared utility**

`findOutFile` is used by `package-manager.ts` (which is JS-specific anyway). Move it into `JsEcosystem` as a static method and export it:

In `src/ecosystem/js.ts`, add:

```ts
export async function findOutFile(
  file: string,
  { cwd = process.cwd() } = {},
): Promise<string | null> {
  let directory = cwd;
  let filePath = "";
  const { root } = path.parse(cwd);

  while (directory) {
    filePath = path.join(directory, file);
    try {
      if ((await stat(filePath)).isFile()) break;
    } catch {}
    directory = path.dirname(directory);
    if (directory === root) return null;
  }

  return filePath;
}
```

**Step 2: Add `getPackageJson`, `getJsrJson`, and conversion utilities as static/exported functions**

Move the caching logic and conversion functions (`packageJsonToJsrJson`, `jsrJsonToPackageJson`, `patchCachedJsrJson`) from `package.ts` into `src/ecosystem/js.ts`. Keep them as exported functions (not class methods) since they are used by jsr tasks, npm registry, etc.

**Step 3: Update all import paths**

Files that import from `../utils/package.js` need to import from `../ecosystem/js.js` instead:

| File | Import change |
|------|--------------|
| `src/tasks/runner.ts` | `getJsrJson`, `getPackageJson`, `replaceVersion` → remove (use ecosystem) |
| `src/tasks/required-conditions-check.ts` | `getPackageJson` → remove (use `ctx.ecosystem.hasScript`) |
| `src/tasks/required-missing-information.ts` | `version` → use `detectEcosystem` + `readVersion` |
| `src/tasks/jsr.ts` | `patchCachedJsrJson` → import from `../ecosystem/js.js` |
| `src/registry/jsr.ts` | `getJsrJson`, `version` → import from `../ecosystem/js.js` |
| `src/registry/npm.ts` | `getPackageJson` → import from `../ecosystem/js.js` |
| `src/registry/custom-registry.ts` | `getPackageJson` → import from `../ecosystem/js.js` |
| `src/cli.ts` | `version` → use `detectEcosystem` + `readVersion` |
| `src/utils/package-manager.ts` | `findOutFile` → import from `../ecosystem/js.js` |

**Step 4: Delete `src/utils/package.ts`**

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests pass. Fix any broken imports.

**Step 6: Update `tests/unit/utils/package.test.ts`**

Move relevant tests into `tests/unit/ecosystem/js.test.ts` or delete if already covered by existing ecosystem tests. Tests for `findOutFile`, `getPackageJson`, `getJsrJson`, `replaceVersion`, `version`, conversion functions should be preserved but updated to import from the new location.

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: absorb package.ts utilities into JsEcosystem module"
```

---

### Task 5: Update Runner context — add Ecosystem, remove JS flags

**Files:**
- Modify: `src/tasks/runner.ts`
- Modify: `src/index.ts` (programmatic entry)

**Step 1: Update Ctx interface**

In `src/tasks/runner.ts`, change:

```ts
import { detectEcosystem, type Ecosystem } from "../ecosystem/index.js";

export interface Ctx extends ResolvedOptions {
  promptEnabled: boolean;
  ecosystem: Ecosystem;
  cleanWorkingTree: boolean;
}
```

Remove `npmOnly` and `jsrOnly`.

**Step 2: Update `run()` initialization**

```ts
export async function run(options: ResolvedOptions): Promise<void> {
  if (options.contents) process.chdir(options.contents);

  const ecosystem = await detectEcosystem(process.cwd(), options.registries);

  if (!ecosystem) {
    throw new AbstractError(
      "No supported ecosystem detected. Ensure the project has a package.json or Cargo.toml.",
    );
  }

  const ctx = <Ctx>{
    ...options,
    promptEnabled: !isCI && process.stdin.isTTY,
    ecosystem,
    cleanWorkingTree: false,
  };

  // ... rest of pipeline
}
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: Errors in places that reference `ctx.npmOnly` / `ctx.jsrOnly` — we'll fix these in subsequent tasks.

**Step 4: Commit**

```bash
git add src/tasks/runner.ts
git commit -m "refactor(runner): add Ecosystem to Ctx, remove npmOnly/jsrOnly"
```

---

### Task 6: Refactor Runner — test & build via Ecosystem

**Files:**
- Modify: `src/tasks/runner.ts`

**Step 1: Replace test execution**

Replace the "Running tests" task body:

```ts
{
  skip: options.skipTests,
  title: "Running tests",
  task: async (ctx): Promise<void> => {
    await ctx.ecosystem.runTest(ctx.testScript);
  },
},
```

**Step 2: Replace build execution**

Replace the "Building the project" task body:

```ts
{
  skip: options.skipBuild,
  title: "Building the project",
  task: async (ctx): Promise<void> => {
    try {
      await ctx.ecosystem.runBuild(ctx.buildScript);
    } catch (error) {
      throw new AbstractError(
        "Failed to build the project",
        { cause: error },
      );
    }
  },
},
```

**Step 3: Remove unused imports**

Remove `getPackageManager` import and `exec` import from runner.ts (no longer directly used).

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (or only errors from future tasks)

**Step 5: Commit**

```bash
git add src/tasks/runner.ts
git commit -m "refactor(runner): delegate test/build to Ecosystem"
```

---

### Task 7: Refactor Runner — version bump via Ecosystem

**Files:**
- Modify: `src/tasks/runner.ts`

**Step 1: Replace version bump logic**

In the "Bumping version" task, replace `replaceVersion` with ecosystem:

```ts
{
  title: "Bumping version",
  skip: (ctx) => !!ctx.preview,
  task: async (ctx, task): Promise<void> => {
    const git = new Git();
    let tagCreated = false;
    let commited = false;

    addRollback(async () => {
      if (tagCreated) {
        console.log("Deleting tag...");
        await git.deleteTag(`${await git.latestTag()}`);
      }

      if (commited) {
        console.log("Reset commits...");
        await git.reset();
        await git.stash();
        await git.reset("HEAD^", "--hard");
        await git.popStash();
      }
    }, ctx);

    await git.reset();
    await ctx.ecosystem.writeVersion(ctx.version);

    for (const file of ctx.ecosystem.manifestFiles()) {
      await git.stage(file);
    }

    const nextVersion = `v${ctx.version}`;
    const commit = await git.commit(nextVersion);

    commited = true;

    task.output = "Creating tag...";
    await git.createTag(nextVersion, commit);

    tagCreated = true;
  },
},
```

**Step 2: Remove `replaceVersion` import**

Remove `replaceVersion` from the imports.

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tasks/runner.ts
git commit -m "refactor(runner): version bump via Ecosystem.writeVersion"
```

---

### Task 8: Refactor Runner — success message

**Files:**
- Modify: `src/tasks/runner.ts`

**Step 1: Replace hardcoded success message**

Replace lines 232-237:

```ts
const packageName = await ctx.ecosystem.packageName();
const registryNames = ctx.registries.join(", ");

console.log(
  `\n\n🚀 Successfully published ${color.bold(packageName)} on ${color.green(registryNames)} ${color.blueBright(`v${ctx.version}`)} 🚀\n`,
);
```

**Step 2: Remove `getPackageJson`, `getJsrJson` imports**

Remove the `getJsrJson` and `getPackageJson` imports from runner.ts.

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tasks/runner.ts
git commit -m "refactor(runner): ecosystem-based success message"
```

---

### Task 9: Refactor required-conditions-check — dynamic install verification

**Files:**
- Modify: `src/tasks/required-conditions-check.ts`

**Step 1: Replace hardcoded npm/jsr install check**

Replace the "Verifying if npm and jsr are installed" block (lines 54-107) with a dynamic per-registry check:

```ts
{
  title: "Verifying registry tools are installed",
  task: (ctx, parentTask) =>
    parentTask.newListr(
      ctx.registries.map((registryKey) => ({
        title: `Verifying ${registryKey} is available`,
        task: async (): Promise<void> => {
          const registry = await getRegistry(registryKey);

          if (!(await registry.isInstalled())) {
            throw new RequiredConditionCheckError(
              `${registryKey} tooling is not installed. Please install the required tools to proceed.`,
            );
          }
        },
      })),
      { concurrent: true },
    ),
},
```

This removes the special-case JSR auto-install prompt. If JSR auto-install behavior is important to preserve, keep a special case for `jsr` that prompts, but make the default generic.

**Step 2: Replace script existence check**

Replace the "Checking if test and build scripts exist" block (lines 109-133):

```ts
{
  title: "Checking if test and build scripts exist",
  task: async (ctx): Promise<void> => {
    const errors: string[] = [];

    if (!ctx.skipTests && !(await ctx.ecosystem.hasScript(ctx.testScript))) {
      errors.push(`Test script '${ctx.testScript}' does not exist.`);
    }

    if (!ctx.skipBuild && !(await ctx.ecosystem.hasScript(ctx.buildScript))) {
      errors.push(
        `Build script '${ctx.buildScript}' does not exist.`,
      );
    }

    if (errors.length) {
      throw new RequiredConditionCheckError(
        `${errors.join(" and ")} Please check your configuration.`,
      );
    }
  },
},
```

Remove `skip: (ctx) => ctx.jsrOnly` — `hasScript` handles this (Rust always returns true).

**Step 3: Remove unused imports**

Remove `getPackageJson` import, `npmRegistry` and `jsrRegistry` imports (if no longer used here).

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tasks/required-conditions-check.ts
git commit -m "refactor(conditions): dynamic registry install check, ecosystem-based script check"
```

---

### Task 10: Refactor required-missing-information — dynamic dist-tag query

**Files:**
- Modify: `src/tasks/required-missing-information.ts`

**Step 1: Replace version reading**

Replace `import { version } from "../utils/package.js"` with ecosystem-based version reading. Since this file has its own `Ctx` interface (not the runner Ctx), we need to pass registries to detect the ecosystem:

```ts
import { detectEcosystem } from "../ecosystem/index.js";
import { getRegistry } from "../registry/index.js";
```

Replace `const currentVersion = await version();` with:

```ts
const ecosystem = await detectEcosystem(process.cwd());
if (!ecosystem) throw new Error("No supported ecosystem detected");
const currentVersion = await ecosystem.readVersion();
```

**Step 2: Replace dist-tag query**

Replace the hardcoded npm/jsr dist-tag query (lines 70-76):

```ts
const registryInstances = await Promise.all(
  (ctx as any).registries?.map((key: string) => getRegistry(key)) ?? [],
);
const distTags = [
  ...new Set(
    (await Promise.all(registryInstances.map((r) => r.distTags()))).flat(),
  ),
].filter((tag) => tag !== defaultOptions.tag);
```

Note: This task's `Ctx` doesn't have `registries`. We need to either:
- Accept registries as a parameter to `requiredMissingInformationTasks`, or
- Import `defaultOptions` to get default registries

The cleanest approach: add `registries` to this task's local `Ctx`:

```ts
interface Ctx {
  version?: string;
  tag: string;
  registries?: RegistryType[];
}
```

**Step 3: Remove unused imports**

Remove `npmRegistry`, `jsrRegistry` imports.

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tasks/required-missing-information.ts
git commit -m "refactor(prompts): ecosystem-based version reading, dynamic dist-tag query"
```

---

### Task 11: Update cli.ts — ecosystem-based version reading

**Files:**
- Modify: `src/cli.ts`

**Step 1: Replace version import**

Replace `import { version } from "./utils/package.js"` with:

```ts
import { detectEcosystem } from "./ecosystem/index.js";
```

**Step 2: Update version usage**

The `version()` call at the bottom of cli.ts reads pubm's own version for `cli.version()`. Since pubm itself is a JS project, we can either:
- Use `detectEcosystem` (generic), or
- Use `JsEcosystem` directly (since pubm is always JS)

Use `JsEcosystem` directly since this reads pubm's own version:

```ts
import { JsEcosystem } from "./ecosystem/js.js";

// At the bottom:
(async () => {
  const eco = new JsEcosystem(import.meta.dirname);
  cli.version(await eco.readVersion());
  cli.parse();
})();
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "refactor(cli): use JsEcosystem for own version reading"
```

---

### Task 12: Update registry files — migrate package.ts imports

**Files:**
- Modify: `src/registry/npm.ts`
- Modify: `src/registry/jsr.ts`
- Modify: `src/registry/custom-registry.ts`
- Modify: `src/tasks/jsr.ts`

**Step 1: Update imports in each file**

For each file, replace `../utils/package.js` imports with `../ecosystem/js.js`:

- `src/registry/npm.ts`: `getPackageJson` → from `../ecosystem/js.js`
- `src/registry/jsr.ts`: `getJsrJson`, `version` → from `../ecosystem/js.js`
- `src/registry/custom-registry.ts`: `getPackageJson` → from `../ecosystem/js.js`
- `src/tasks/jsr.ts`: `patchCachedJsrJson` → from `../ecosystem/js.js`

**Step 2: Update package-manager.ts**

In `src/utils/package-manager.ts`, replace:

```ts
import { findOutFile } from "./package";
```

with:

```ts
import { findOutFile } from "../ecosystem/js.js";
```

**Step 3: Run typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/registry/ src/tasks/jsr.ts src/utils/package-manager.ts
git commit -m "refactor: migrate package.ts imports to ecosystem/js"
```

---

### Task 13: Delete package.ts and migrate its tests

**Files:**
- Delete: `src/utils/package.ts`
- Modify: `tests/unit/utils/package.test.ts` — move tests or re-point imports

**Step 1: Delete package.ts**

```bash
rm src/utils/package.ts
```

**Step 2: Update or move tests**

In `tests/unit/utils/package.test.ts`, update all imports to point to `../../../src/ecosystem/js.js`. If the test file tests `replaceVersion` and `version()`, these are now `JsEcosystem.writeVersion` and `JsEcosystem.readVersion` — update accordingly or remove tests that are duplicated in `tests/unit/ecosystem/js.test.ts`.

Move the file to `tests/unit/ecosystem/js-utils.test.ts` if keeping separate, or merge into `tests/unit/ecosystem/js.test.ts`.

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: PASS

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete package.ts, migrate remaining tests"
```

---

### Task 14: Fix all remaining references to removed fields

**Step 1: Search for any remaining references**

Grep for `npmOnly`, `jsrOnly`, `defaultTestCommand`, `defaultBuildCommand`, `getPackageJson`, `getJsrJson`, `replaceVersion` across `src/`:

```bash
grep -rn "npmOnly\|jsrOnly\|defaultTestCommand\|defaultBuildCommand\|replaceVersion\|utils/package" src/
```

Fix any remaining references.

**Step 2: Run full test suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

**Step 3: Run lint**

Run: `pnpm check`
Expected: PASS (or fix issues)

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: clean up remaining references to removed APIs"
```

---

### Task 15: Changelog pipeline integration — utility functions

**Files:**
- Create: `src/utils/changelog.ts`
- Test: `tests/unit/utils/changelog.test.ts`

**Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedExistsSync = vi.mocked(existsSync);

import { updateChangelogFile, consumeChangesets } from "../../../src/utils/changelog.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateChangelogFile", () => {
  it("prepends new changelog entry to existing file", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFile.mockResolvedValue("## 1.0.0\n\n- Initial release\n" as any);

    await updateChangelogFile("## 2.0.0\n\n- New feature\n", true);

    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("CHANGELOG.md"),
      expect.stringContaining("## 2.0.0"),
    );
    const written = mockedWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("## 1.0.0");
  });

  it("creates new file when CHANGELOG.md does not exist", async () => {
    mockedExistsSync.mockReturnValue(false);

    await updateChangelogFile("## 1.0.0\n\n- Initial\n", true);

    expect(mockedWriteFile).toHaveBeenCalled();
  });

  it("uses custom path when provided as string", async () => {
    mockedExistsSync.mockReturnValue(false);

    await updateChangelogFile("## 1.0.0\n", "docs/CHANGES.md");

    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("docs/CHANGES.md"),
      expect.any(String),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/utils/changelog.test.ts`
Expected: FAIL — module not found

**Step 3: Implement**

Create `src/utils/changelog.ts`:

```ts
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export async function updateChangelogFile(
  newEntry: string,
  changelog: boolean | string,
  cwd: string = process.cwd(),
): Promise<void> {
  const filePath =
    typeof changelog === "string"
      ? path.resolve(cwd, changelog)
      : path.join(cwd, "CHANGELOG.md");

  let existing = "";
  if (existsSync(filePath)) {
    existing = await readFile(filePath, "utf-8");
  }

  const header = "# Changelog\n\n";
  const content = existing.startsWith("# Changelog")
    ? existing.replace("# Changelog\n\n", `# Changelog\n\n${newEntry}\n`)
    : `${header}${newEntry}\n${existing}`;

  await writeFile(filePath, content);
}

export async function consumeChangesets(
  cwd: string = process.cwd(),
): Promise<void> {
  const changesetsDir = path.join(cwd, ".pubm", "changesets");

  if (!existsSync(changesetsDir)) return;

  const { readdirSync } = await import("node:fs");
  const files = readdirSync(changesetsDir);

  for (const file of files) {
    if (file.endsWith(".md") && file !== "README.md") {
      await rm(path.join(changesetsDir, file));
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/unit/utils/changelog.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/changelog.ts tests/unit/utils/changelog.test.ts
git commit -m "feat(changelog): add updateChangelogFile and consumeChangesets utilities"
```

---

### Task 16: Integrate changelog consumption into Runner version bump

**Files:**
- Modify: `src/tasks/runner.ts`

**Step 1: Add changelog integration to version bump task**

Import the new utilities and changeset module:

```ts
import { getStatus } from "../changeset/status.js";
import { generateChangelog } from "../changeset/changelog.js";
import { updateChangelogFile, consumeChangesets } from "../utils/changelog.js";
import { loadConfig } from "../config/index.js";
```

In the "Bumping version" task, add changelog consumption before `writeVersion`:

```ts
// After git.reset(), before writeVersion:
const filesToStage = [...ctx.ecosystem.manifestFiles()];

const config = await loadConfig();
const status = getStatus();

if (status.hasChangesets && config?.changelog !== false) {
  const entries = status.changesets.flatMap((cs) =>
    cs.releases.map((r) => ({
      summary: cs.summary,
      type: r.type,
      id: cs.id ?? "",
    })),
  );
  const changelogContent = generateChangelog(`v${ctx.version}`, entries);
  await updateChangelogFile(changelogContent, config?.changelog ?? true);
  await consumeChangesets();
  filesToStage.push("CHANGELOG.md");
}

await ctx.ecosystem.writeVersion(ctx.version);

for (const file of filesToStage) {
  await git.stage(file);
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/tasks/runner.ts
git commit -m "feat(runner): integrate changelog consumption into version bump"
```

---

### Task 17: Implement `pubm version` command

**Files:**
- Modify: `src/commands/version-cmd.ts`

**Step 1: Implement the command**

Replace the stub:

```ts
import type { CAC } from "cac";
import { detectEcosystem } from "../ecosystem/index.js";
import { getStatus } from "../changeset/status.js";
import { calculateVersionBumps } from "../changeset/version.js";
import { generateChangelog } from "../changeset/changelog.js";
import { updateChangelogFile, consumeChangesets } from "../utils/changelog.js";
import { loadConfig } from "../config/index.js";
import { Git } from "../git.js";

export function registerVersionCommand(cli: CAC): void {
  cli
    .command("version", "Consume changesets and bump versions")
    .action(async () => {
      const ecosystem = await detectEcosystem(process.cwd());
      if (!ecosystem) {
        console.error("No supported ecosystem detected.");
        process.exit(1);
      }

      const status = getStatus();
      if (!status.hasChangesets) {
        console.log("No pending changesets.");
        return;
      }

      const packageName = await ecosystem.packageName();
      const currentVersion = await ecosystem.readVersion();
      const currentVersions = new Map([[packageName, currentVersion]]);

      const bumps = calculateVersionBumps(currentVersions);
      const bump = bumps.get(packageName);

      if (!bump) {
        console.log("No version bumps needed.");
        return;
      }

      console.log(`Bumping ${packageName}: ${bump.currentVersion} → ${bump.newVersion}`);

      // Write new version
      await ecosystem.writeVersion(bump.newVersion);

      // Generate changelog
      const config = await loadConfig();
      if (config?.changelog !== false) {
        const entries = status.changesets.flatMap((cs) =>
          cs.releases.map((r) => ({
            summary: cs.summary,
            type: r.type,
            id: cs.id ?? "",
          })),
        );
        const changelogContent = generateChangelog(bump.newVersion, entries);
        await updateChangelogFile(changelogContent, config?.changelog ?? true);
      }

      // Consume changesets
      await consumeChangesets();

      // Git commit
      const git = new Git();
      for (const file of ecosystem.manifestFiles()) {
        await git.stage(file);
      }
      await git.stage("CHANGELOG.md");
      await git.stage(".pubm/changesets/");
      await git.commit(`v${bump.newVersion}`);

      console.log(`Version bumped to ${bump.newVersion}`);
    });
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/commands/version-cmd.ts
git commit -m "feat(cli): implement pubm version command to consume changesets"
```

---

### Task 18: Final verification

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Run linter**

Run: `pnpm check`
Expected: No errors (or fix formatting issues with `pnpm format`)

**Step 4: Run build**

Run: `pnpm build`
Expected: Build succeeds

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: final cleanup for ecosystem pipeline redesign"
```
