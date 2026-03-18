# Changeset Consumption Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-choice changeset prompt with a three-choice prompt (only_changesets / add_packages / no) and ensure packages with unchanged versions are excluded from the publish pipeline.

**Architecture:** A new `filterConfigPackages` utility replaces `ctx.config.packages` with a frozen filtered copy; `ctx.config` is made writable in `createContext`. The version prompt in `required-missing-information.ts` is restructured into three branches; each branch ensures `versionPlan.packages` and `ctx.config.packages` are consistent before the pipeline proceeds.

**Tech Stack:** TypeScript (strict), Bun, Vitest, listr2 / enquirer prompts

**Spec:** `docs/superpowers/specs/2026-03-18-changeset-consumption-mode-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/context.ts` | Modify | Make `config` writable; remove `readonly` from `PubmContext.config` |
| `packages/core/src/utils/filter-config.ts` | Create | `filterConfigPackages(ctx, publishPaths)` utility |
| `packages/core/src/tasks/required-missing-information.ts` | Modify | Three-choice prompt; `only_changesets` / `add_packages` / `no` branches; `handleRemainingPackages` helper |
| `packages/core/tests/unit/context.test.ts` | Modify | Add test: `ctx.config` is reassignable after change |
| `packages/core/tests/unit/utils/filter-config.test.ts` | Create | Unit tests for `filterConfigPackages` |
| `packages/core/tests/unit/tasks/required-missing-information.test.ts` | Modify | Update existing multi-package tests; add new three-choice tests |

---

## Task 1: Make `ctx.config` Writable

**Files:**
- Modify: `packages/core/src/context.ts`
- Modify: `packages/core/tests/unit/context.test.ts`

- [ ] **Step 1: Update the existing conflicting test and add new reassignability test**

In `packages/core/tests/unit/context.test.ts`, find the test at line ~97:

```ts
// BEFORE — delete or replace this test (it will permanently fail after the change):
it("config is immutable (top-level reassignment throws)", () => {
  const ctx = createContext(makeConfig(), makeOptions());
  expect(() => {
    (ctx as any).config = makeConfig();
  }).toThrow();
});
```

Replace it with these two tests:

```ts
it("ctx.config is replaceable (writable reference)", () => {
  const ctx = createContext(makeConfig(), makeOptions());
  const newConfig = makeConfig({ packages: [] });
  expect(() => {
    (ctx as { config: typeof ctx.config }).config = Object.freeze(newConfig);
  }).not.toThrow();
  expect(ctx.config).toBe(newConfig);
});

it("replaced ctx.config is frozen (internal properties immutable)", () => {
  const ctx = createContext(makeConfig(), makeOptions());
  const newConfig = makeConfig({ packages: [] });
  (ctx as { config: typeof ctx.config }).config = Object.freeze(newConfig);
  expect(Object.isFrozen(ctx.config)).toBe(true);
  expect(() => {
    (ctx.config as any).branch = "other";
  }).toThrow();
});
```

- [ ] **Step 2: Run test to confirm the new tests fail**

```bash
cd packages/core && bun vitest --run tests/unit/context.test.ts
```
Expected: FAIL — new tests expect no throw, but assignment still throws because `writable: false`.

- [ ] **Step 3: Make `config` writable and remove `readonly` from interface**

In `packages/core/src/context.ts`:

**Change 1** — property descriptor in `createContext`:
```ts
// Before:
config: {
  value: Object.freeze(config),
  writable: false,
  enumerable: true,
  configurable: false,
},

// After:
config: {
  value: Object.freeze(config),
  writable: true,
  enumerable: true,
  configurable: false,
},
```

**Change 2** — `PubmContext` interface:
```ts
// Before:
export interface PubmContext {
  readonly config: ResolvedPubmConfig;

// After:
export interface PubmContext {
  config: ResolvedPubmConfig;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/core && bun vitest --run tests/unit/context.test.ts
```
Expected: all PASS. The existing frozen-config test still passes because `Object.freeze` on the config value itself is unchanged — only the reference on `ctx` is now replaceable.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context.ts packages/core/tests/unit/context.test.ts
git commit -m "feat: make ctx.config writable to allow filterConfigPackages"
```

---

## Task 2: Create `filterConfigPackages` Utility

**Files:**
- Create: `packages/core/src/utils/filter-config.ts`
- Create: `packages/core/tests/unit/utils/filter-config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/unit/utils/filter-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createContext } from "../../../src/context.js";
import type { ResolvedPackageConfig, ResolvedPubmConfig } from "../../../src/config/types.js";
import type { ResolvedOptions } from "../../../src/types/options.js";
import { filterConfigPackages } from "../../../src/utils/filter-config.js";

function makePkg(path: string, name: string): ResolvedPackageConfig {
  return { path, name, version: "1.0.0", dependencies: [], registries: ["npm"] };
}

function makeConfig(packages: ResolvedPackageConfig[]): ResolvedPubmConfig {
  return {
    versioning: "independent",
    branch: "main",
    changelog: true,
    changelogFormat: "default",
    commit: false,
    access: "public",
    fixed: [],
    linked: [],
    updateInternalDependencies: "patch",
    ignore: [],
    snapshotTemplate: "{tag}-{timestamp}",
    tag: "latest",
    contents: ".",
    saveToken: true,
    releaseDraft: true,
    releaseNotes: true,
    rollbackStrategy: "individual",
    packages,
    validate: { cleanInstall: true, entryPoints: true, extraneousFiles: true },
    plugins: [],
  };
}

function makeOptions(): ResolvedOptions {
  return {
    testScript: "test",
    buildScript: "build",
    mode: "local",
    branch: "main",
    tag: "latest",
    saveToken: true,
  };
}

describe("filterConfigPackages", () => {
  const pkgA = makePkg("packages/a", "@scope/a");
  const pkgB = makePkg("packages/b", "@scope/b");
  const pkgC = makePkg("packages/c", "@scope/c");

  it("replaces ctx.config.packages with only the packages in publishPaths", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB, pkgC]), makeOptions());
    filterConfigPackages(ctx, new Set(["packages/a", "packages/c"]));
    expect(ctx.config.packages).toHaveLength(2);
    expect(ctx.config.packages.map((p) => p.path)).toEqual(["packages/a", "packages/c"]);
  });

  it("freezes the new config object", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB]), makeOptions());
    filterConfigPackages(ctx, new Set(["packages/a"]));
    expect(Object.isFrozen(ctx.config)).toBe(true);
  });

  it("handles an empty publishPaths set (no packages)", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB]), makeOptions());
    filterConfigPackages(ctx, new Set());
    expect(ctx.config.packages).toHaveLength(0);
  });

  it("preserves all packages when all paths are in publishPaths", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB]), makeOptions());
    filterConfigPackages(ctx, new Set(["packages/a", "packages/b"]));
    expect(ctx.config.packages).toHaveLength(2);
  });

  it("preserves other config fields unchanged", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB]), makeOptions());
    const originalBranch = ctx.config.branch;
    filterConfigPackages(ctx, new Set(["packages/a"]));
    expect(ctx.config.branch).toBe(originalBranch);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/core && bun vitest --run tests/unit/utils/filter-config.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `filterConfigPackages`**

Create `packages/core/src/utils/filter-config.ts`:

```ts
import type { ResolvedPubmConfig } from "../config/types.js";
import type { PubmContext } from "../context.js";

export function filterConfigPackages(
  ctx: PubmContext,
  publishPaths: Set<string>,
): void {
  const filtered: ResolvedPubmConfig = {
    ...ctx.config,
    packages: ctx.config.packages.filter((p) => publishPaths.has(p.path)),
  };
  ctx.config = Object.freeze(filtered);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/core && bun vitest --run tests/unit/utils/filter-config.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd packages/core && bun vitest --run
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/utils/filter-config.ts packages/core/tests/unit/utils/filter-config.test.ts
git commit -m "feat: add filterConfigPackages utility"
```

---

## Task 3: Three-Choice Prompt + `only_changesets` Branch

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`
- Modify: `packages/core/tests/unit/tasks/required-missing-information.test.ts`

This task replaces the two-choice multi-package changeset prompt with three choices and implements the `only_changesets` branch. The `add_packages` choice temporarily falls through to the existing manual flow (fully implemented in Task 4).

- [ ] **Step 1: Update existing multi-package tests that mock `"accept"` / `"customize"`**

The existing `promptChangesetRecommendations` has choices `name: "accept"` and `name: "customize"`. The multi-package tests below use these values and will break when the choices change. Single-package tests (which use a different `handleSinglePackage` prompt) are NOT affected.

In `packages/core/tests/unit/tasks/required-missing-information.test.ts`, change these lines:

| Line | From | To | Context |
|------|------|----|---------|
| ~541 | `mockResolvedValueOnce("accept")` | `mockResolvedValueOnce("only_changesets")` | "accepts multi-package changeset recommendations..." |
| ~607 | `mockResolvedValueOnce("accept")` | `mockResolvedValueOnce("only_changesets")` | "shows zero changesets for workspace packages..." |
| ~1108 | `mockResolvedValueOnce("customize")` | `mockResolvedValueOnce("no")` | "customize → fixed mode" |
| ~1178 | `mockResolvedValueOnce("customize")` | `mockResolvedValueOnce("no")` | "customize → independent mode" |
| ~1238 | `mockResolvedValueOnce("customize")` | `mockResolvedValueOnce("no")` | "marks recommended bump type in version choices" |
| ~1315 | `mockResolvedValueOnce("accept")` | `mockResolvedValueOnce("only_changesets")` | "dependency sort order is reflected..." |
| ~1385 | `mockResolvedValueOnce("customize")` | `mockResolvedValueOnce("no")` | "marks highest changeset bump type in fixed mode..." |

Also confirm that tests at lines ~296, ~339, ~383 are **single-package** tests (`config: { packages: defaultPackages }` with a single entry) — these use the `handleSinglePackage` prompt which still uses `"accept"`/`"customize"`. Do NOT change those.

- [ ] **Step 2: Add mock for `filter-config` and new test assertions**

At the top of the test file, add:
```ts
vi.mock("../../../src/utils/filter-config.js", () => ({
  filterConfigPackages: vi.fn(),
}));
```

Add the import after existing imports:
```ts
import { filterConfigPackages } from "../../../src/utils/filter-config.js";
const mockedFilterConfigPackages = vi.mocked(filterConfigPackages);
```

In `beforeEach`, add:
```ts
mockedFilterConfigPackages.mockClear();
```

Then add new tests for the three-choice prompt. Add a new describe block in the multi-package + changesets section:

```ts
describe("three-choice prompt — only_changesets", () => {
  const pkgA = makePkg({ name: "@scope/a", version: "1.0.0", path: "packages/a" });
  const pkgB = makePkg({ name: "@scope/b", version: "2.0.0", path: "packages/b" });
  const twoPackages = [pkgA, pkgB];

  function makeTwoPkgCtx() {
    return {
      config: { packages: twoPackages, versioning: undefined },
      runtime: { versionPlan: undefined, changesetConsumed: undefined },
      cwd: "/cwd",
      options: {},
    } as any;
  }

  beforeEach(() => {
    mockedGetStatus.mockReturnValue({
      hasChangesets: true,
      packages: new Map([["packages/a", { changesetCount: 1 }]]),
      changesets: [],
    } as any);
    mockedCalculateVersionBumps.mockReturnValue(
      new Map([["packages/a", { currentVersion: "1.0.0", newVersion: "1.1.0", bumpType: "minor" }]])
    );
  });

  it("shows three choices: only_changesets, add_packages, no", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx();
    const mockTask = createMockTask();
    mockTask._promptAdapter.run.mockResolvedValueOnce("only_changesets");

    await versionTask.task(ctx, mockTask);

    const promptCall = mockTask._promptAdapter.run.mock.calls[0];
    const choiceNames = promptCall[0].choices.map((c: any) => c.name);
    expect(choiceNames).toEqual(["only_changesets", "add_packages", "no"]);
  });

  it("only_changesets: sets versionPlan with changeset packages only", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx();
    const mockTask = createMockTask();
    mockTask._promptAdapter.run.mockResolvedValueOnce("only_changesets");

    await versionTask.task(ctx, mockTask);

    expect(ctx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([["packages/a", "1.1.0"]]),
    });
    expect(ctx.runtime.changesetConsumed).toBe(true);
  });

  it("only_changesets: calls filterConfigPackages with changeset package paths", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx();
    const mockTask = createMockTask();
    mockTask._promptAdapter.run.mockResolvedValueOnce("only_changesets");

    await versionTask.task(ctx, mockTask);

    expect(mockedFilterConfigPackages).toHaveBeenCalledWith(
      ctx,
      new Set(["packages/a"]),
    );
  });
});
```

- [ ] **Step 3: Run tests to confirm new tests fail and existing ones still pass after mock update**

```bash
cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts 2>&1 | tail -20
```
Expected: new `only_changesets` tests FAIL (choices not yet changed); existing tests that you updated in Step 1 should now FAIL too (still returning `"accept"`/`"customize"` from production code).

- [ ] **Step 4: Implement the three-choice prompt**

In `packages/core/src/tasks/required-missing-information.ts`:

**1. Add import:**
```ts
import { filterConfigPackages } from "../utils/filter-config.js";
```

**2. Replace `promptChangesetRecommendations` with this implementation** (change return type from `boolean` to `"accepted" | "add_packages" | "no"`):

```ts
async function promptChangesetRecommendations(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  status: ReturnType<typeof getStatus>,
  bumps: Map<string, VersionBump>,
  sortedPackageInfos: ResolvedPackageConfig[],
): Promise<"accepted" | "add_packages" | "no"> {
  const lines: string[] = ["Changesets suggest:"];

  for (const pkg of sortedPackageInfos) {
    const bump = bumps.get(pkg.path);
    if (!bump) continue;
    const pkgStatus = status.packages.get(pkg.path);
    const changesetCount = pkgStatus?.changesetCount ?? 0;
    const changesetLabel = pluralize(changesetCount, "changeset");
    lines.push(
      `  ${pkg.name}  ${bump.currentVersion} → ${bump.newVersion} (${bump.bumpType}: ${changesetLabel})`,
    );
  }

  task.output = lines.join("\n");

  const choice = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
    type: "select",
    message: "Accept changeset recommendations?",
    choices: [
      { message: "Only changesets (auto bump affected packages)", name: "only_changesets" },
      { message: "Also select versions for other packages", name: "add_packages" },
      { message: "No, select versions manually", name: "no" },
    ],
    name: "version",
  });

  if (choice === "only_changesets") {
    const versions = new Map<string, string>();
    for (const [path, bump] of bumps) {
      versions.set(path, bump.newVersion);
    }
    ctx.runtime.versionPlan = {
      mode: "independent",
      packages: versions,
    };
    ctx.runtime.changesetConsumed = true;
    filterConfigPackages(ctx, new Set(bumps.keys()));
    return "accepted";
  }

  if (choice === "add_packages") {
    return "add_packages";
  }

  return "no";
}
```

**3. Update `handleMultiPackage` to use the new return type** — for now, `"add_packages"` falls through to the same manual flow as `"no"` (will be replaced in Task 4):

```ts
// In handleMultiPackage, change:
// Before:
const accepted = await promptChangesetRecommendations(...);
if (accepted) return;

// After:
const result = await promptChangesetRecommendations(...);
if (result === "accepted") return;
// "add_packages" and "no" both fall through to manual flow for now
```

- [ ] **Step 5: Run tests to confirm all pass**

```bash
cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts
```
Expected: all PASS — new three-choice tests pass, updated existing tests pass.

- [ ] **Step 6: Run full test suite**

```bash
cd packages/core && bun vitest --run
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tasks/required-missing-information.ts packages/core/tests/unit/tasks/required-missing-information.test.ts
git commit -m "feat: add three-choice changeset prompt and only_changesets branch"
```

---

## Task 4: `handleRemainingPackages` + `add_packages` Branch

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`
- Modify: `packages/core/tests/unit/tasks/required-missing-information.test.ts`

- [ ] **Step 1: Write failing tests for `add_packages`**

Add inside the three-choice describe block from Task 3:

```ts
describe("three-choice prompt — add_packages", () => {
  // reuse makeTwoPkgCtx() and beforeEach from the outer describe

  it("add_packages: auto-bumps changeset packages and prompts for remaining", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx();
    const mockTask = createMockTask();

    // Three-choice → add_packages; pkgB (remaining) → "2.1.0" (bumped)
    mockTask._promptAdapter.run
      .mockResolvedValueOnce("add_packages")
      .mockResolvedValueOnce("2.1.0");

    await versionTask.task(ctx, mockTask);

    expect(ctx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a", "1.1.0"], // auto-bumped from changeset
        ["packages/b", "2.1.0"], // user-selected
      ]),
    });
    expect(ctx.runtime.changesetConsumed).toBe(true);
  });

  it("add_packages: excludes remaining package when 'keep current' selected", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx();
    const mockTask = createMockTask();

    // pkgB → keep current version "2.0.0"
    mockTask._promptAdapter.run
      .mockResolvedValueOnce("add_packages")
      .mockResolvedValueOnce("2.0.0");

    await versionTask.task(ctx, mockTask);

    expect(ctx.runtime.versionPlan?.packages.has("packages/b")).toBe(false);
    expect(mockedFilterConfigPackages).toHaveBeenCalledWith(
      ctx,
      new Set(["packages/a"]),
    );
  });

  it("add_packages: sets changesetConsumed to true", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx();
    const mockTask = createMockTask();
    mockTask._promptAdapter.run
      .mockResolvedValueOnce("add_packages")
      .mockResolvedValueOnce("2.0.0");

    await versionTask.task(ctx, mockTask);

    expect(ctx.runtime.changesetConsumed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts 2>&1 | tail -15
```
Expected: new `add_packages` tests FAIL — currently falls through to manual flow.

- [ ] **Step 3: Implement `handleRemainingPackages` and `handleAddPackages`**

Add these two functions to `packages/core/src/tasks/required-missing-information.ts`:

```ts
/**
 * add_packages branch: auto-bump changeset packages, then prompt for remaining.
 */
async function handleAddPackages(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  graph: Map<string, string[]>,
  bumps: Map<string, VersionBump>,
): Promise<void> {
  const remainingPackages = packageInfos.filter((p) => !bumps.has(p.path));
  const { versions, publishPaths } = await handleRemainingPackages(
    ctx,
    task,
    remainingPackages,
    currentVersions,
    graph,
    bumps,
  );

  ctx.runtime.versionPlan = {
    mode: "independent",
    packages: new Map([...versions].filter(([p]) => publishPaths.has(p))),
  };
  ctx.runtime.changesetConsumed = true;
  filterConfigPackages(ctx, publishPaths);
}

/**
 * Prompts version selection for non-changeset packages.
 * Returns merged versions map (superset of publishPaths) and publishPaths set.
 */
async function handleRemainingPackages(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  remainingPackages: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  graph: Map<string, string[]>,
  bumps: Map<string, VersionBump>,
): Promise<{ versions: Map<string, string>; publishPaths: Set<string> }> {
  const pathToName = new Map(
    ctx.config.packages.map((p) => [p.path, p.name || p.path]),
  );

  // Initialize with changeset-bumped packages (considered already bumped for cascade)
  const bumpedPackages = new Set<string>(bumps.keys());
  const versions = new Map<string, string>(
    [...bumps].map(([p, b]) => [p, b.newVersion]),
  );
  const publishPaths = new Set<string>(bumps.keys());
  const reverseDeps = buildReverseDeps(graph);

  for (const pkg of remainingPackages) {
    const currentVersion = currentVersions.get(pkg.path) ?? pkg.version;
    const deps = graph.get(pkg.path) ?? [];
    const bumpedDeps = deps.filter((dep) => bumpedPackages.has(dep));
    const pkgNotes: string[] = [];

    if (bumpedDeps.length > 0) {
      const bumpedDepNames = bumpedDeps.map((dep) => pathToName.get(dep) ?? dep);
      pkgNotes.push(buildDependencyBumpNote(currentVersion, bumpedDepNames));
    }

    if (pkgNotes.length > 0) {
      task.output = renderPackageVersionSummary(
        remainingPackages,
        currentVersions,
        versions,
        { activePackage: pkg.path, notes: new Map([[pkg.path, pkgNotes]]) },
      );
    }

    const result = await promptVersion(task, currentVersion, pkg.name);
    versions.set(pkg.path, result.version);

    if (result.version !== currentVersion) {
      bumpedPackages.add(pkg.path);
      publishPaths.add(pkg.path);
    }
  }

  // Cascade prompt for unbumped dependents (not already bumped)
  const unbumpedDependents: string[] = [];
  for (const bumped of bumpedPackages) {
    for (const dep of reverseDeps.get(bumped) ?? []) {
      if (!bumpedPackages.has(dep)) {
        unbumpedDependents.push(dep);
      }
    }
  }

  if (unbumpedDependents.length > 0) {
    const uniqueDependents = [...new Set(unbumpedDependents)];
    const notes: PackageNotes = new Map();
    for (const pkgPath of uniqueDependents) {
      const currentVersion = currentVersions.get(pkgPath) ?? "0.0.0";
      const deps = (graph.get(pkgPath) ?? []).filter((d) => bumpedPackages.has(d));
      const depNames = deps.map((d) => pathToName.get(d) ?? d);
      notes.set(pkgPath, [buildDependencyBumpNote(currentVersion, depNames)]);
    }

    task.output = renderPackageVersionSummary(
      remainingPackages,
      currentVersions,
      versions,
      { notes },
    );

    const cascadeChoice = await task
      .prompt(ListrEnquirerPromptAdapter)
      .run<string>({
        type: "select",
        message: "Bump these dependent packages too?",
        choices: [
          { message: "Yes, apply patch bump", name: "patch" },
          { message: "No, keep current versions", name: "skip" },
        ],
        name: "cascade",
      });

    if (cascadeChoice === "patch") {
      for (const pkgPath of uniqueDependents) {
        const currentVersion = currentVersions.get(pkgPath) ?? "0.0.0";
        const patchVersion = new SemVer(currentVersion).inc("patch").toString();
        versions.set(pkgPath, patchVersion);
        publishPaths.add(pkgPath);
      }
    }
  }

  return { versions, publishPaths };
}
```

**4. Update `handleMultiPackage` to use `handleAddPackages`** for the `"add_packages"` result:

```ts
const result = await promptChangesetRecommendations(...);
if (result === "accepted") return;
if (result === "add_packages") {
  await handleAddPackages(ctx, task, sortedPackageInfos, currentVersions, graph, bumps!);
  return;
}
// "no" — fall through to manual
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/required-missing-information.ts packages/core/tests/unit/tasks/required-missing-information.test.ts
git commit -m "feat: implement add_packages branch with handleRemainingPackages"
```

---

## Task 5: `no` Branch — Filter Same-Version Packages

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`
- Modify: `packages/core/tests/unit/tasks/required-missing-information.test.ts`

The `no` choice falls through to `handleManualMultiPackage`. After independent mode completes, filter out "keep current" packages from both `versionPlan.packages` and `ctx.config.packages`.

Note: `handleIndependentMode` always adds ALL packages to `versionPlan.packages` including "keep current" ones. Cascade-declined packages are never added to `versionPlan.packages` at all (they're only in `unbumpedDependents`, not in the main loop). The post-call filter (`selectedVersion !== currentVersion`) handles the "keep current" packages; cascade-declined ones are simply absent.

- [ ] **Step 1: Write failing tests for the `no` branch**

Add a new describe block in the multi-package + changesets section:

```ts
describe("three-choice prompt — no choice", () => {
  const pkgA = makePkg({ name: "@scope/a", version: "1.0.0", path: "packages/a" });
  const pkgB = makePkg({ name: "@scope/b", version: "2.0.0", path: "packages/b" });

  function makeTwoPkgCtx(versioning?: "fixed" | "independent") {
    return {
      config: { packages: [pkgA, pkgB], versioning },
      runtime: { versionPlan: undefined, changesetConsumed: undefined },
      cwd: "/cwd",
      options: {},
    } as any;
  }

  beforeEach(() => {
    mockedGetStatus.mockReturnValue({
      hasChangesets: true,
      packages: new Map([["packages/a", { changesetCount: 1 }]]),
      changesets: [],
    } as any);
    mockedCalculateVersionBumps.mockReturnValue(
      new Map([["packages/a", { currentVersion: "1.0.0", newVersion: "1.1.0", bumpType: "minor" }]])
    );
  });

  it("no → independent: excludes packages with unchanged versions from versionPlan and config", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx("independent"); // pre-set to skip mode prompt
    const mockTask = createMockTask();

    // "no" → pkgA: "1.1.0" (bump), pkgB: "2.0.0" (keep current)
    mockTask._promptAdapter.run
      .mockResolvedValueOnce("no")
      .mockResolvedValueOnce("1.1.0")
      .mockResolvedValueOnce("2.0.0");

    await versionTask.task(ctx, mockTask);

    expect(ctx.runtime.versionPlan?.packages.has("packages/a")).toBe(true);
    expect(ctx.runtime.versionPlan?.packages.has("packages/b")).toBe(false);

    const filterArg = mockedFilterConfigPackages.mock.calls[0][1] as Set<string>;
    expect(filterArg.has("packages/a")).toBe(true);
    expect(filterArg.has("packages/b")).toBe(false);
  });

  it("no → fixed: does NOT call filterConfigPackages", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx("fixed"); // pre-set to skip mode prompt
    const mockTask = createMockTask();

    mockTask._promptAdapter.run
      .mockResolvedValueOnce("no")
      .mockResolvedValueOnce("1.1.0");

    await versionTask.task(ctx, mockTask);

    expect(mockedFilterConfigPackages).not.toHaveBeenCalled();
  });

  it("no → independent: does not set changesetConsumed", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx("independent");
    const mockTask = createMockTask();

    mockTask._promptAdapter.run
      .mockResolvedValueOnce("no")
      .mockResolvedValueOnce("1.1.0")
      .mockResolvedValueOnce("2.0.0");

    await versionTask.task(ctx, mockTask);

    expect(ctx.runtime.changesetConsumed).toBeFalsy();
  });

  it("no → independent (mode prompt shown): applies filter after mode selection", async () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();
    const versionTask = subtasks[0];
    const ctx = makeTwoPkgCtx(); // no pre-set versioning → mode prompt shown
    const mockTask = createMockTask();

    mockTask._promptAdapter.run
      .mockResolvedValueOnce("no")
      .mockResolvedValueOnce("independent") // mode prompt
      .mockResolvedValueOnce("1.1.0")       // pkgA
      .mockResolvedValueOnce("2.0.0");      // pkgB keep current

    await versionTask.task(ctx, mockTask);

    expect(mockedFilterConfigPackages).toHaveBeenCalled();
    const filterArg = mockedFilterConfigPackages.mock.calls[0][1] as Set<string>;
    expect(filterArg.has("packages/b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts 2>&1 | tail -20
```
Expected: new `no` branch tests FAIL.

- [ ] **Step 3: Implement filtering in `handleManualMultiPackage` after `handleIndependentMode`**

In `packages/core/src/tasks/required-missing-information.ts`, modify the end of `handleManualMultiPackage`:

```ts
async function handleManualMultiPackage(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  graph: Map<string, string[]>,
  bumps?: Map<string, VersionBump>,
  status?: ReturnType<typeof getStatus>,
): Promise<void> {
  // ... existing note/output setup code stays unchanged ...

  let mode: "fixed" | "independent";

  if (ctx.config.versioning) {
    mode = ctx.config.versioning;
  } else {
    const choice = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "select",
      message: "How should packages be versioned?",
      choices: [
        { message: "Fixed (all packages get same version)", name: "fixed" },
        { message: "Independent (per-package versions)", name: "independent" },
      ],
      name: "mode",
    });
    mode = choice as "fixed" | "independent";
  }

  if (mode === "fixed") {
    await handleFixedMode(ctx, task, packageInfos, currentVersions, bumps);
    return; // No per-package filtering for fixed mode
  }

  // Independent mode
  await handleIndependentMode(ctx, task, packageInfos, currentVersions, graph, bumps);

  // Filter out packages where selected version === current version.
  // handleIndependentMode stores ALL packages in versionPlan.packages, including
  // "keep current" ones. We exclude them from the pipeline here.
  const plan = ctx.runtime.versionPlan;
  if (plan && plan.mode === "independent") {
    const publishPaths = new Set<string>();
    for (const [pkgPath, selectedVersion] of plan.packages) {
      if (selectedVersion !== (currentVersions.get(pkgPath) ?? "")) {
        publishPaths.add(pkgPath);
      }
    }
    plan.packages = new Map(
      [...plan.packages].filter(([p]) => publishPaths.has(p)),
    );
    filterConfigPackages(ctx, publishPaths);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd packages/core && bun vitest --run
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tasks/required-missing-information.ts packages/core/tests/unit/tasks/required-missing-information.test.ts
git commit -m "feat: filter same-version packages in no-branch independent mode"
```

---

## Task 6: Coverage Check + Changeset

- [ ] **Step 1: Run coverage**

```bash
cd packages/core && bun run coverage
```
Expected: all thresholds pass (lines ≥ 95%, functions ≥ 95%, statements ≥ 95%, branches ≥ 90%).

If `filter-config.ts` or `required-missing-information.ts` is below threshold, add missing tests and re-run before proceeding.

- [ ] **Step 2: Format and typecheck**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm && bun run format && bun run typecheck
```
Expected: no errors.

- [ ] **Step 3: Add changeset**

```bash
bunx pubm add --packages packages/core --bump minor --message "Add three-choice changeset consumption prompt; packages with unchanged versions are now excluded from the publish pipeline"
```

- [ ] **Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for changeset consumption mode feature"
```
