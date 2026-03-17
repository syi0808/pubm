# Version Plan Path-Based Key Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `versionPlan.packages` key from `packageName` to `packagePath` so version lookup works when registry-specific names differ from config names (e.g., jsr.json name ≠ package.json name).

**Architecture:** The `versionPlan` types change their key semantics from name→path. All creation sites convert name→path at the boundary. All consumption sites that need display names resolve path→name via `ctx.config.packages`. Legacy `ctx.runtime.version`/`versions` fields are removed.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-version-plan-path-key-design.md`

---

## Chunk 1: Core Types, Version Lookup, and Defense-in-Depth

### Task 1: Update `context.ts` types and functions

**Files:**
- Modify: `packages/core/src/context.ts`
- Test: `packages/core/tests/unit/context.test.ts`
- Test: `packages/core/tests/unit/version-plan.test.ts`

- [ ] **Step 1: Update the test for `SingleVersionPlan` field rename**

In `packages/core/tests/unit/context.test.ts`, change all `packageName` references to `packagePath`:

```typescript
// Line 91-95: change packageName to packagePath
ctx.runtime.versionPlan = {
  mode: "single",
  version: "1.0.0",
  packagePath: "packages/test",
};
```

```typescript
// Line 112-116: change packageName to packagePath
ctx.runtime.versionPlan = {
  mode: "single",
  version: "1.2.3",
  packagePath: "packages/my-pkg",
};
expect(getPackageVersion(ctx, "packages/my-pkg")).toBe("1.2.3");
```

```typescript
// Lines 124-126: change keys to paths
packages: new Map([["packages/a", "2.0.0"]]),
// ...
expect(getPackageVersion(ctx, "packages/a")).toBe("2.0.0");
```

```typescript
// Lines 133-139: change keys to paths
packages: new Map([
  ["packages/a", "1.0.0"],
  ["packages/b", "2.0.0"],
]),
// ...
expect(getPackageVersion(ctx, "packages/b")).toBe("2.0.0");
```

```typescript
// Lines 144-148: change keys to paths
packages: new Map([["packages/a", "1.0.0"]]),
// ...
expect(getPackageVersion(ctx, "unknown-path")).toBe("");
```

Remove the two tests that reference `ctx.runtime.version` fallback (lines 151-160):
- "falls back to runtime.version when no versionPlan"
- "returns empty string when no versionPlan and no runtime.version"

Remove assertions on `ctx.runtime.version` and `ctx.runtime.versions` in "initializes runtime" test (lines 72-73).

Remove the `ctx.runtime.version = "1.0.0"` line and its assertion in "runtime is mutable" test (lines 89, 96).

In `packages/core/tests/unit/version-plan.test.ts`, change all `packageName` references to `packagePath`:

```typescript
// Line 10: packageName → packagePath
packagePath: "packages/my-pkg",
// Line 54: same
packagePath: "packages/my-pkg",
```

Change Map keys from names to paths in independent/fixed tests:

```typescript
// Line 19-21
packages: new Map([
  ["packages/a", "2.0.0"],
  ["packages/b", "2.0.0"],
]),
```

```typescript
// Line 30-32
packages: new Map([
  ["packages/core", "1.0.0"],
  ["packages/pubm", "2.0.0"],
]),
// Line 35
expect(resolveVersion(plan, (pkgs) => pkgs.get("packages/core")!)).toBe("1.0.0");
```

```typescript
// Line 43
packages: new Map([["packages/a", "1.0.0"]]),
// Line 63
packages: new Map([["packages/a", "2.0.0"]]),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/context.test.ts tests/unit/version-plan.test.ts`
Expected: FAIL — `packageName` still exists, `packagePath` not recognized

- [ ] **Step 3: Update `context.ts` implementation**

In `packages/core/src/context.ts`:

Change `SingleVersionPlan.packageName` → `packagePath`:
```typescript
export interface SingleVersionPlan {
  mode: "single";
  version: string;
  packagePath: string;
}
```

Change `getPackageVersion` parameter name and remove fallback:
```typescript
export function getPackageVersion(
  ctx: PubmContext,
  packagePath: string,
): string {
  const plan = ctx.runtime.versionPlan;
  if (plan) {
    if (plan.mode === "single") return plan.version;
    if (plan.mode === "fixed") return plan.version;
    return plan.packages.get(packagePath) ?? "";
  }
  return "";
}
```

Remove `version` and `versions` from `PubmContext.runtime`:
```typescript
runtime: {
  changesetConsumed?: boolean;
  tag: string;
  promptEnabled: boolean;
  cleanWorkingTree: boolean;
  pluginRunner: PluginRunner;
  versionPlan?: VersionPlan;
  releaseContext?: ReleaseContext;
  scopeCreated?: boolean;
  packageCreated?: boolean;
  npmOtp?: string;
  npmOtpPromise?: Promise<string>;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/context.test.ts tests/unit/version-plan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context.ts packages/core/tests/unit/context.test.ts packages/core/tests/unit/version-plan.test.ts
git commit -m "refactor(core): change versionPlan key from packageName to packagePath"
```

### Task 2: Add `isVersionPublished` empty version guard

**Files:**
- Modify: `packages/core/src/registry/npm.ts:102`
- Modify: `packages/core/src/registry/jsr.ts:200`
- Modify: `packages/core/src/registry/crates.ts:183`
- Test: `packages/core/tests/unit/registry/version-published.test.ts`

- [ ] **Step 1: Add test for empty version guard**

In `packages/core/tests/unit/registry/version-published.test.ts`, add a test (or update existing) for each registry:

```typescript
it("returns false for empty version string", async () => {
  // For each registry type, verify isVersionPublished("") returns false
  // without making any fetch call
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/version-published.test.ts`
Expected: FAIL — empty version currently hits the network

- [ ] **Step 3: Add guard to all three implementations**

In `packages/core/src/registry/npm.ts:102`:
```typescript
async isVersionPublished(version: string): Promise<boolean> {
  if (!version) return false;
  try {
    // ... existing code
```

In `packages/core/src/registry/jsr.ts:200`:
```typescript
async isVersionPublished(version: string): Promise<boolean> {
  if (!version) return false;
  try {
    // ... existing code
```

In `packages/core/src/registry/crates.ts:183`:
```typescript
async isVersionPublished(version: string): Promise<boolean> {
  if (!version) return false;
  try {
    // ... existing code
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/version-published.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry/npm.ts packages/core/src/registry/jsr.ts packages/core/src/registry/crates.ts packages/core/tests/unit/registry/version-published.test.ts
git commit -m "fix(core): guard isVersionPublished against empty version string"
```

---

## Chunk 2: Publish Tasks (Bug Fix)

### Task 3: Update publish tasks to use `packagePath` for version lookup

**Files:**
- Modify: `packages/core/src/tasks/jsr.ts:28`
- Modify: `packages/core/src/tasks/npm.ts:28`
- Modify: `packages/core/src/tasks/crates.ts:54`
- Modify: `packages/core/src/tasks/dry-run-publish.ts:71,95,158`
- Test: `packages/core/tests/unit/tasks/jsr-already-published.test.ts`
- Test: `packages/core/tests/unit/tasks/npm-already-published.test.ts`
- Test: `packages/core/tests/unit/tasks/crates-already-published.test.ts`
- Test: `packages/core/tests/unit/tasks/dry-run-already-published.test.ts`

- [ ] **Step 1: Update already-published tests to use `versionPlan` instead of `ctx.runtime.version`**

All four test files create mock contexts like:
```typescript
const ctx = { runtime: { promptEnabled: true, version: "1.0.0" } } as any;
```

Change all to use `versionPlan`:
```typescript
const ctx = {
  runtime: {
    promptEnabled: true,
    versionPlan: { mode: "single", version: "1.0.0", packagePath: "packages/core" },
  },
} as any;
```

Ensure the `isVersionPublished` mock is called with `"1.0.0"` (still the same expected value).

For `jsr-already-published.test.ts`, the `createJsrPublishTask("packages/core")` call already passes the correct `packagePath`.

For `npm-already-published.test.ts`, same pattern. Check the actual packagePath used in `createNpmPublishTask` call and match it.

For `crates-already-published.test.ts` and `dry-run-already-published.test.ts`, same pattern.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/jsr-already-published.test.ts tests/unit/tasks/npm-already-published.test.ts tests/unit/tasks/crates-already-published.test.ts tests/unit/tasks/dry-run-already-published.test.ts`
Expected: FAIL — tasks still call `getPackageVersion(ctx, registryName)` but version fallback is removed

- [ ] **Step 3: Update publish task files**

In `packages/core/src/tasks/jsr.ts:28`:
```typescript
// Before:
const version = getPackageVersion(ctx, jsr.packageName);
// After:
const version = getPackageVersion(ctx, packagePath);
```

In `packages/core/src/tasks/npm.ts:28`:
```typescript
// Before:
const version = getPackageVersion(ctx, npm.packageName);
// After:
const version = getPackageVersion(ctx, packagePath);
```

In `packages/core/src/tasks/crates.ts:54`:
```typescript
// Before:
const version = getPackageVersion(ctx, packageName);
// After:
const version = getPackageVersion(ctx, packagePath);
```

In `packages/core/src/tasks/dry-run-publish.ts`:

Line 71:
```typescript
// Before:
const version = getPackageVersion(ctx, npm.packageName);
// After:
const version = getPackageVersion(ctx, packagePath);
```

Line 95:
```typescript
// Before:
const version = getPackageVersion(ctx, jsr.packageName);
// After:
const version = getPackageVersion(ctx, packagePath);
```

Line 158:
```typescript
// Before:
const version = getPackageVersion(ctx, packageName);
// After:
const version = getPackageVersion(ctx, packagePath);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/jsr-already-published.test.ts tests/unit/tasks/npm-already-published.test.ts tests/unit/tasks/crates-already-published.test.ts tests/unit/tasks/dry-run-already-published.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/jsr.ts packages/core/src/tasks/npm.ts packages/core/src/tasks/crates.ts packages/core/src/tasks/dry-run-publish.ts packages/core/tests/unit/tasks/jsr-already-published.test.ts packages/core/tests/unit/tasks/npm-already-published.test.ts packages/core/tests/unit/tasks/crates-already-published.test.ts packages/core/tests/unit/tasks/dry-run-already-published.test.ts
git commit -m "fix(core): use packagePath for version lookup in publish tasks"
```

---

## Chunk 3: Manifest Writing

### Task 4: Update `writeVersionsForEcosystem` to use path-keyed map

**Files:**
- Modify: `packages/core/src/manifest/write-versions.ts`

- [ ] **Step 1: Update test fixtures to use path-keyed maps**

Find existing tests for `writeVersionsForEcosystem` in `packages/core/tests/unit/manifest/`. Update any `versions` Map fixtures from name-keyed to path-keyed (matching `eco.packagePath`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/manifest/`
Expected: FAIL — implementation still looks up by name

- [ ] **Step 3: Update `writeVersionsForEcosystem` implementation**

Replace the current implementation:

```typescript
export async function writeVersionsForEcosystem(
  ecosystems: { eco: Ecosystem; pkg: ResolvedPackageConfig }[],
  versions: Map<string, string>,
): Promise<string[]> {
  const modifiedFiles: string[] = [];

  // Phase 1: Write versions to manifests (path-keyed)
  for (const { eco } of ecosystems) {
    const version = versions.get(eco.packagePath);
    if (version) {
      await eco.writeVersion(version);
      // Invalidate ManifestReader cache
      for (const RegistryClass of eco.registryClasses()) {
        RegistryClass.reader.invalidate(eco.packagePath);
      }
    }
  }

  // Phase 2: Build name-keyed map for sibling dependency updates
  if (ecosystems.length > 1) {
    const nameKeyedVersions = new Map<string, string>();
    for (const { eco } of ecosystems) {
      const name = await eco.packageName();
      const version = versions.get(eco.packagePath);
      if (version) nameKeyedVersions.set(name, version);
    }
    await Promise.all(
      ecosystems.map(({ eco }) =>
        eco.updateSiblingDependencyVersions(nameKeyedVersions),
      ),
    );
  }

  // Phase 3: Sync lockfiles
  for (const { eco } of ecosystems) {
    const lockfilePath = await eco.syncLockfile();
    if (lockfilePath) modifiedFiles.push(lockfilePath);
  }

  return modifiedFiles;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/manifest/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/manifest/write-versions.ts
git commit -m "refactor(core): use path-keyed map in writeVersionsForEcosystem"
```

---

## Chunk 4: Runner — Version Plan Creation and Consumption

### Task 5: Update `runner.ts` — snapshot flow and helper function

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Add `getPackageName` helper and update `formatVersionSummary` / `formatVersionPlan`**

Add after the imports (around line 57):
```typescript
function getPackageName(ctx: PubmContext, packagePath: string): string {
  return ctx.config.packages.find((p) => p.path === packagePath)?.name ?? packagePath;
}
```

Update `formatVersionSummary` (line 256-274):
```typescript
function formatVersionSummary(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (plan) {
    if (plan.mode === "independent") {
      return [...plan.packages]
        .map(([pkgPath, ver]) => `${getPackageName(ctx, pkgPath)}@${ver}`)
        .join(", ");
    }
    return `v${plan.version}`;
  }
  return "";
}
```

Update `formatVersionPlan` (line 276-294):
```typescript
function formatVersionPlan(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (plan) {
    if (plan.mode === "independent" || plan.mode === "fixed") {
      return `Target versions:\n${[...plan.packages]
        .map(([pkgPath, ver]) => `  ${getPackageName(ctx, pkgPath)}: ${ver}`)
        .join("\n")}`;
    }
    return `Target version: v${plan.version}`;
  }
  return "";
}
```

- [ ] **Step 2: Update snapshot flow (lines 474-505)**

```typescript
// Line 474: delete ctx.runtime.version assignment
// Line 475-479: change packageName to packagePath
ctx.runtime.versionPlan = {
  mode: "single",
  version: snapshotVersion,
  packagePath: ctx.config.packages[0].path,
};

// Line 484-486: change Map key from name to path
const snapshotVersions = new Map([
  [ctx.config.packages[0].path, snapshotVersion],
]);

// Line 501-503: same for restore
const restoreVersions = new Map([
  [ctx.config.packages[0].path, currentVersion],
]);
```

- [ ] **Step 3: Update snapshot tag creation (line 515) and success message (line 542)**

```typescript
// Line 515: ctx.runtime.version → versionPlan
const tagName = `v${ctx.runtime.versionPlan!.version}`;
```

```typescript
// Line 542: ctx.runtime.version → versionPlan
console.log(
  `\n\n📸 Successfully published snapshot ${parts.join(", ")} ${ui.chalk.blueBright(ctx.runtime.versionPlan?.version ?? "")} 📸\n`,
);
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): add getPackageName helper, update runner format functions and snapshot flow"
```

### Task 6: Update `runner.ts` — CI GitHub release (lines 620-730)

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Update CI GitHub release — independent mode (lines 627-665)**

```typescript
// Line 627: rename variable
for (const [pkgPath, pkgVersion] of plan.packages) {
  const pkgName = getPackageName(ctx, pkgPath);
  const tag = `${pkgName}@${pkgVersion}`;
  task.output = `Creating release for ${tag}...`;

  let changelogBody: string | undefined;
  const pkgConfig = ctx.config.packages.find(
    (p) => p.path === pkgPath,
  );
  // ... rest stays the same but uses pkgName for createGitHubRelease
  const result = await createGitHubRelease(ctx, {
    packageName: pkgName,
    version: pkgVersion,
    tag,
    changelogBody,
  });
```

- [ ] **Step 2: Update CI GitHub release — fixed mode (lines 674-697)**

```typescript
// Line 676: rename variable and fix .find()
for (const [pkgPath, pkgVersion] of plan.packages) {
  const pkgName = getPackageName(ctx, pkgPath);
  const pkgConfig = ctx.config.packages.find(
    (p) => p.path === pkgPath,
  );
  // ... rest uses pkgName for display
  if (section) {
    sections.push(
      `## ${pkgName} v${pkgVersion}\n\n${section}`,
    );
  }
```

- [ ] **Step 3: Update single mode `packageName` access (lines 712-715)**

```typescript
const packageName =
  plan.mode === "single"
    ? getPackageName(ctx, plan.packagePath)
    : (ctx.config.packages[0]?.name ?? "");
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): update CI GitHub release to use path-based plan"
```

### Task 7: Update `runner.ts` — version bump (lines 838-1115)

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Update rollback tag deletion (lines 847-855)**

```typescript
for (const [pkgPath, pkgVersion] of plan.packages) {
  const pkgName = getPackageName(ctx, pkgPath);
  try {
    await git.deleteTag(`${pkgName}@${pkgVersion}`);
  } catch (tagError) {
    rollbackError(
      `Failed to delete tag ${pkgName}@${pkgVersion}: ${tagError instanceof Error ? tagError.message : tagError}`,
    );
  }
}
```

- [ ] **Step 2: Update single mode `writeVersions` call (lines 900-906)**

```typescript
const singleVersions = new Map(
  ctx.config.packages.map((pkg) => [
    pkg.path,
    plan.version,
  ]),
);
const replaced = await writeVersions(ctx, singleVersions);
```

- [ ] **Step 3: Update fixed mode changelog (lines 981-983)**

```typescript
const allEntries = [...plan.packages.keys()].flatMap(
  (pkgPath) =>
    buildChangelogEntries(changesets, getPackageName(ctx, pkgPath)),
);
```

- [ ] **Step 4: Update independent mode changelog and tags (lines 1046-1113)**

```typescript
// Line 1046: rename and resolve name
for (const [pkgPath, pkgVersion] of plan.packages) {
  const pkgName = getPackageName(ctx, pkgPath);
  const entries = buildChangelogEntries(changesets, pkgName);
  if (entries.length > 0) {
    const pkgConfig = ctx.config.packages.find(
      (p) => p.path === pkgPath,
    );
    const changelogDir = pkgConfig
      ? path.resolve(process.cwd(), pkgConfig.path)
      : process.cwd();
    writeChangelogToFile(
      changelogDir,
      generateChangelog(pkgVersion, entries),
    );
  }
}
```

```typescript
// Line 1074: tag existence checks
for (const [pkgPath, pkgVersion] of plan.packages) {
  const pkgName = getPackageName(ctx, pkgPath);
  const tagName = `${pkgName}@${pkgVersion}`;
  // ... rest uses tagName
```

```typescript
// Line 1102: commit message
const commitMsg = `Version Packages\n\n${[...plan.packages]
  .map(([pkgPath, ver]) => `- ${getPackageName(ctx, pkgPath)}: ${ver}`)
  .join("\n")}`;
```

```typescript
// Line 1111: tag creation
for (const [pkgPath, pkgVersion] of plan.packages) {
  const pkgName = getPackageName(ctx, pkgPath);
  await git.createTag(`${pkgName}@${pkgVersion}`, commit);
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): update runner version bump to use path-based plan"
```

### Task 8: Update `runner.ts` — release draft (lines 1200-1278)

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Update release draft independent mode (lines 1211-1246)**

```typescript
for (const [pkgPath, pkgVersion] of plan.packages) {
  const pkgName = getPackageName(ctx, pkgPath);
  const tag = `${pkgName}@${pkgVersion}`;
  // ... rest uses tag and pkgVersion
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): update release draft to use path-based plan"
```

---

## Chunk 5: Version Plan Creation Sites

### Task 9: Update `cli.ts` — all versionPlan creation sites

**Files:**
- Modify: `packages/pubm/src/cli.ts`
- Test: `packages/pubm/tests/unit/cli.test.ts`

- [ ] **Step 1: Update `cli.test.ts` assertions**

Change all `versionPlan` assertions to use `packagePath` instead of `packageName`, and path-keyed Maps instead of name-keyed Maps. Remove all assertions on `ctx.runtime.version` and `ctx.runtime.versions`.

Examples:
```typescript
// Line 298-302: single mode
expect(ctx.runtime.versionPlan).toEqual({
  mode: "single",
  version: "1.2.3",
  packagePath: ".",  // default single-package path
});

// Line 327-331: snapshot mode
expect(ctx.runtime.versionPlan).toEqual({
  mode: "single",
  version: "snapshot",
  packagePath: ".",
});

// Line 459-466: fixed multi-package
expect(ctx.runtime.versionPlan).toEqual({
  mode: "fixed",
  version: "2.0.0",
  packages: new Map([
    ["packages/a", "2.0.0"],
    ["packages/b", "2.0.0"],
  ]),
});

// Line 499-505: independent multi-package
expect(ctx.runtime.versionPlan).toEqual({
  mode: "independent",
  packages: new Map([
    ["packages/a", "1.0.0"],
    ["packages/b", "2.0.0"],
  ]),
});
```

Remove assertions like `expect(ctx.runtime.version).toBe(...)` and `expect(ctx.runtime.versions).toEqual(...)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/pubm && bun vitest --run tests/unit/cli.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `cli.ts` implementation**

Line 170-176 (explicit version, single package):
```typescript
if (nextVersion) {
  if (resolvedConfig.packages.length <= 1) {
    ctx.runtime.versionPlan = {
      mode: "single",
      version: nextVersion,
      packagePath: resolvedConfig.packages[0]?.path ?? ".",
    };
  } else {
    const packages = new Map(
      resolvedConfig.packages.map((p) => [p.path, nextVersion]),
    );
    ctx.runtime.versionPlan = {
      mode: "fixed",
      version: nextVersion,
      packages,
    };
  }
}
```

Lines 196-201 (snapshot):
```typescript
ctx.runtime.versionPlan = {
  mode: "single",
  version: "snapshot",
  packagePath: resolvedConfig.packages[0]?.path ?? ".",
};
```

Lines 211-239 (CI --publishOnly/--ci):
```typescript
if (options.publishOnly || options.ci) {
  if (resolvedConfig.packages.length <= 1) {
    const pkg = resolvedConfig.packages[0];
    ctx.runtime.versionPlan = {
      mode: "single",
      version: pkg.version,
      packagePath: pkg.path,
    };
  } else if (resolvedConfig.versioning === "independent") {
    ctx.runtime.versionPlan = {
      mode: "independent",
      packages: new Map(
        resolvedConfig.packages.map((p) => [p.path, p.version]),
      ),
    };
  } else {
    const version = resolvedConfig.packages[0].version;
    ctx.runtime.versionPlan = {
      mode: "fixed",
      version,
      packages: new Map(
        resolvedConfig.packages.map((p) => [p.path, p.version]),
      ),
    };
  }
}
```

Lines 242-302 (CI changesets):
At changeset-based versionPlan creation, convert name→path at the boundary:
```typescript
if (bumps.size === 1) {
  const [name, bump] = [...bumps][0];
  const pkg = resolvedConfig.packages.find((p) => p.name === name);
  ctx.runtime.versionPlan = {
    mode: "single",
    version: bump.newVersion,
    packagePath: pkg?.path ?? ".",
  };
} else {
  const bumpedPackages = new Map(
    [...bumps].map(([name, bump]) => {
      const pkg = resolvedConfig.packages.find((p) => p.name === name);
      return [pkg?.path ?? name, bump.newVersion];
    }),
  );
  const allSame = new Set(bumpedPackages.values()).size === 1;
  const mode =
    resolvedConfig.versioning ??
    (allSame ? "fixed" : "independent");
  if (mode === "fixed") {
    ctx.runtime.versionPlan = {
      mode: "fixed",
      version: [...bumpedPackages.values()][0],
      packages: bumpedPackages,
    };
  } else {
    ctx.runtime.versionPlan = {
      mode: "independent",
      packages: bumpedPackages,
    };
  }
}
ctx.runtime.changesetConsumed = true;
```

Remove ALL `ctx.runtime.version = ...` and `ctx.runtime.versions = ...` assignments throughout `cli.ts`.

Update validation check (line 305-308):
```typescript
if (!ctx.runtime.versionPlan) {
  throw new Error(
    "Version must be set in the CI environment. Please define the version before proceeding.",
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/pubm && bun vitest --run tests/unit/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/pubm/src/cli.ts packages/pubm/tests/unit/cli.test.ts
git commit -m "refactor(cli): use path-based keys in versionPlan creation"
```

### Task 10: Update `required-missing-information.ts`

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`

- [ ] **Step 1: Update `handleSinglePackage` (lines 303-337)**

Change both versionPlan creation sites to use `packagePath`:
```typescript
// Line 304-309
ctx.runtime.versionPlan = {
  mode: "single",
  version: bump.newVersion,
  packagePath: ctx.config.packages[0].path,
};

// Line 332-337
ctx.runtime.versionPlan = {
  mode: "single",
  version: nextVersion,
  packagePath: ctx.config.packages[0].path,
};
```

Remove all `ctx.runtime.version = ...` assignments (lines 304, 332).

- [ ] **Step 2: Update `promptChangesetRecommendations` (lines 457-468)**

Convert name→path at the boundary:
```typescript
if (choice === "accept") {
  const versions = new Map<string, string>();
  for (const [name, bump] of bumps) {
    const pkg = ctx.config.packages.find((p) => p.name === name);
    versions.set(pkg?.path ?? name, bump.newVersion);
  }
  ctx.runtime.versionPlan = {
    mode: "independent",
    packages: versions,
  };
  ctx.runtime.changesetConsumed = true;
  return true;
}
```

Remove `ctx.runtime.versions = versions;` assignment.

- [ ] **Step 3: Update `handleFixedMode` (lines 609-619)**

Convert name→path at the boundary:
```typescript
const packages = new Map<string, string>();
for (const name of currentVersions.keys()) {
  const pkg = ctx.config.packages.find((p) => p.name === name);
  packages.set(pkg?.path ?? name, nextVersion);
}
ctx.runtime.versionPlan = {
  mode: "fixed",
  version: nextVersion,
  packages,
};
```

Remove `ctx.runtime.version = nextVersion;` and `ctx.runtime.versions = packages;` assignments.

- [ ] **Step 4: Update `handleIndependentMode` (lines 759-763)**

Convert name→path at the boundary:
```typescript
const pathVersions = new Map<string, string>();
for (const [name, ver] of versions) {
  const pkg = ctx.config.packages.find((p) => p.name === name);
  pathVersions.set(pkg?.path ?? name, ver);
}
ctx.runtime.versionPlan = {
  mode: "independent",
  packages: pathVersions,
};
```

Remove `ctx.runtime.versions = versions;` assignment.

- [ ] **Step 5: Run tests to verify**

Run: `cd packages/core && bun vitest --run`
Expected: PASS — all core tests pass with updated creation sites

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tasks/required-missing-information.ts
git commit -m "refactor(core): use path-based keys in required-missing-information versionPlan creation"
```

---

## Chunk 6: Plugin and Final Cleanup

### Task 11: Update `plugin-external-version-sync`

**Files:**
- Modify: `packages/plugins/plugin-external-version-sync/src/index.ts`
- Test: `packages/plugins/plugin-external-version-sync/tests/integration/external-version-sync.test.ts`

- [ ] **Step 1: Update plugin implementation**

In `packages/plugins/plugin-external-version-sync/src/index.ts`:

Remove the fallback to `ctx.runtime.version` (line 39-41):
```typescript
// Before:
} else {
  // Fallback during migration
  version = ctx.runtime.version!;
}

// After:
} else {
  throw new Error(
    "external-version-sync: versionPlan is not set.",
  );
}
```

Also update the error message for independent mode (line 32) to use path-based example:
```typescript
// Before:
"Provide a version picker, e.g. version: (pkgs) => pkgs.get('@pubm/core') ?? ''"
// After:
"Provide a version picker, e.g. version: (pkgs) => pkgs.get('packages/core') ?? ''"
```

- [ ] **Step 2: Update integration tests**

Change versionPlan fixtures in test files to use `packagePath` instead of `packageName` for single mode, and path-keyed Maps for independent mode.

- [ ] **Step 3: Run tests**

Run: `cd packages/plugins/plugin-external-version-sync && bun vitest --run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/plugins/plugin-external-version-sync/
git commit -m "refactor(plugin-external-version-sync): use path-based versionPlan, remove legacy fallback"
```

### Task 12: Full test suite verification

- [ ] **Step 1: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS — all type errors resolved

- [ ] **Step 2: Run full test suite**

Run: `bun run test`
Expected: PASS — all tests pass

- [ ] **Step 3: Fix any remaining compilation or test failures**

Address any files that still reference `ctx.runtime.version`, `ctx.runtime.versions`, or `plan.packageName`. Use the compiler errors to find them.

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "fix(core): resolve remaining path-key migration issues"
```
