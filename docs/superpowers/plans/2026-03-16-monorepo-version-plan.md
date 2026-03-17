# Monorepo VersionPlan Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual `ctx.runtime.version`/`ctx.runtime.versions` structure with a unified `VersionPlan` discriminated union, fixing independent monorepo versioning, git tags, GitHub releases, and plugin version resolution.

**Architecture:** Introduce `VersionPlan` type (`single | fixed | independent`) in `context.ts`, migrate all 15+ files that reference `ctx.runtime.version`/`versions`, refactor git tag parsing for package-prefixed tags, update GitHub release to support per-package releases, and add version callback support to plugins.

**Tech Stack:** TypeScript, Bun, Vitest, listr2

**Spec:** `docs/superpowers/specs/2026-03-16-monorepo-version-plan-design.md`

---

## Chunk 1: VersionPlan Type & Context Foundation

### Task 1: Define VersionPlan types and resolveVersion helper

**Files:**
- Modify: `packages/core/src/context.ts`

- [ ] **Step 1: Write test for resolveVersion helper**

Create `packages/core/tests/unit/version-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveVersion } from "../../src/context.js";
import type { VersionPlan } from "../../src/context.js";

describe("resolveVersion", () => {
  it("returns version for single mode", () => {
    const plan: VersionPlan = { mode: "single", version: "1.0.0", packageName: "my-pkg" };
    expect(resolveVersion(plan)).toBe("1.0.0");
  });

  it("returns version for fixed mode", () => {
    const plan: VersionPlan = {
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["a", "2.0.0"], ["b", "2.0.0"]]),
    };
    expect(resolveVersion(plan)).toBe("2.0.0");
  });

  it("returns picker result for independent mode", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([["@pubm/core", "1.0.0"], ["pubm", "2.0.0"]]),
    };
    expect(resolveVersion(plan, (pkgs) => pkgs.get("@pubm/core")!)).toBe("1.0.0");
  });

  it("throws when independent mode has no picker", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([["a", "1.0.0"]]),
    };
    expect(() => resolveVersion(plan)).toThrow("independent mode requires an explicit version picker");
  });

  it("ignores picker for single mode", () => {
    const plan: VersionPlan = { mode: "single", version: "1.0.0", packageName: "my-pkg" };
    expect(resolveVersion(plan, () => "9.9.9")).toBe("1.0.0");
  });

  it("ignores picker for fixed mode", () => {
    const plan: VersionPlan = {
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["a", "2.0.0"]]),
    };
    expect(resolveVersion(plan, () => "9.9.9")).toBe("2.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/version-plan.test.ts`
Expected: FAIL — `resolveVersion` not exported from context.js

- [ ] **Step 3: Add VersionPlan types and resolveVersion to context.ts**

Add the following types and function to `packages/core/src/context.ts`:

```ts
export interface SingleVersionPlan {
  mode: "single";
  version: string;
  packageName: string;
}

export interface FixedVersionPlan {
  mode: "fixed";
  version: string;
  packages: Map<string, string>;
}

export interface IndependentVersionPlan {
  mode: "independent";
  packages: Map<string, string>;
}

export type VersionPlan =
  | SingleVersionPlan
  | FixedVersionPlan
  | IndependentVersionPlan;

export function resolveVersion(
  plan: VersionPlan,
  picker?: (packages: Map<string, string>) => string,
): string {
  if (plan.mode === "single") return plan.version;
  if (plan.mode === "fixed") return plan.version;
  if (!picker) {
    throw new Error(
      "independent mode requires an explicit version picker. " +
        "Provide a picker function or set the 'version' option.",
    );
  }
  return picker(plan.packages);
}
```

Update `PubmContext.runtime` type — remove `version?: string`, `versions?: Map<string, string>`, and `releaseContext?: ReleaseContext` fields. Add `versionPlan?: VersionPlan`. Also remove the now-dead `import type { ReleaseContext } from "./tasks/github-release.js"` at the top of the file:

```ts
runtime: {
  versionPlan?: VersionPlan;
  changesetConsumed?: boolean;
  tag: string;
  promptEnabled: boolean;
  cleanWorkingTree: boolean;
  pluginRunner: PluginRunner;
  scopeCreated?: boolean;
  packageCreated?: boolean;
  npmOtp?: string;
  npmOtpPromise?: Promise<string>;
};
```

- [ ] **Step 4: Export new types from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export type {
  VersionPlan,
  SingleVersionPlan,
  FixedVersionPlan,
  IndependentVersionPlan,
} from "./context.js";
export { resolveVersion } from "./context.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/version-plan.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 6: Update existing context test**

Update `packages/core/tests/unit/context.test.ts` — change assertions from `ctx.runtime.version`/`ctx.runtime.versions` to `ctx.runtime.versionPlan`:

```ts
// Old:
expect(ctx.runtime.version).toBeUndefined();
expect(ctx.runtime.versions).toBeUndefined();
// New:
expect(ctx.runtime.versionPlan).toBeUndefined();

// Old:
ctx.runtime.version = "1.0.0";
expect(ctx.runtime.version).toBe("1.0.0");
// New:
ctx.runtime.versionPlan = { mode: "single", version: "1.0.0", packageName: "test" };
expect(ctx.runtime.versionPlan.version).toBe("1.0.0");
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/index.ts packages/core/tests/unit/version-plan.test.ts packages/core/tests/unit/context.test.ts
git commit -m "feat(core): add VersionPlan type and resolveVersion helper"
```

---

### Task 2: Git tag helpers — extractVersion, extractPrefix, tagsByPackage, latestTagForPackage

**Files:**
- Modify: `packages/core/src/git.ts`

- [ ] **Step 1: Write tests for tag helpers**

Create `packages/core/tests/unit/git-tag-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractVersion, extractPrefix } from "../../src/git.js";

describe("extractVersion", () => {
  it("extracts from scoped package tag", () => {
    expect(extractVersion("@pubm/core@0.4.0")).toBe("0.4.0");
  });
  it("extracts from unscoped package tag", () => {
    expect(extractVersion("pubm@0.4.0")).toBe("0.4.0");
  });
  it("extracts from v-prefix tag", () => {
    expect(extractVersion("v0.4.0")).toBe("0.4.0");
  });
  it("extracts from bare version tag", () => {
    expect(extractVersion("0.4.0")).toBe("0.4.0");
  });
  it("handles prerelease versions", () => {
    expect(extractVersion("@pubm/core@1.0.0-beta.1")).toBe("1.0.0-beta.1");
  });
});

describe("extractPrefix", () => {
  it("extracts scoped package prefix", () => {
    expect(extractPrefix("@pubm/core@0.4.0")).toBe("@pubm/core");
  });
  it("extracts unscoped package prefix", () => {
    expect(extractPrefix("pubm@0.4.0")).toBe("pubm");
  });
  it("extracts v prefix", () => {
    expect(extractPrefix("v0.4.0")).toBe("v");
  });
  it("returns empty for bare version", () => {
    expect(extractPrefix("0.4.0")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/git-tag-helpers.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement extractVersion and extractPrefix in git.ts**

Add exported helper functions to `packages/core/src/git.ts`:

```ts
export function extractVersion(tag: string): string {
  const atIndex = tag.lastIndexOf("@");
  if (atIndex > 0) return tag.slice(atIndex + 1);
  return tag.replace(/^v/, "");
}

export function extractPrefix(tag: string): string {
  const atIndex = tag.lastIndexOf("@");
  if (atIndex > 0) return tag.slice(0, atIndex);
  return tag.startsWith("v") ? "v" : "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/git-tag-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Update `tags()` sorting and `previousTag()` in git.ts**

Replace `tags()` sorting from `semver.compareIdentifiers` to `extractVersion`-based:

```ts
async tags(): Promise<string[]> {
  try {
    const raw = (await this.git(["tag", "-l"])).trim().split("\n").filter(Boolean);
    return raw.sort((a, b) => {
      const va = extractVersion(a);
      const vb = extractVersion(b);
      try {
        return semver.compare(va, vb);
      } catch {
        return semver.compareIdentifiers(va, vb);
      }
    });
  } catch (error) {
    throw new GitError("Failed to run `git tag -l`", { cause: error });
  }
}
```

Replace `previousTag()`:

```ts
async previousTag(tag: string): Promise<string | null> {
  try {
    const prefix = extractPrefix(tag);
    const allTags = await this.tags();
    const samePrefixTags = allTags.filter((t) => extractPrefix(t) === prefix);
    const sorted = samePrefixTags.sort((a, b) =>
      semver.compare(extractVersion(a), extractVersion(b)),
    );
    const idx = sorted.indexOf(tag);
    return idx > 0 ? (sorted[idx - 1] ?? null) : null;
  } catch {
    return null;
  }
}
```

Add `tagsByPackage()` and `latestTagForPackage()`:

```ts
async tagsByPackage(packageName: string): Promise<string[]> {
  try {
    const raw = (await this.git(["tag", "-l", `${packageName}@*`]))
      .trim()
      .split("\n")
      .filter(Boolean);
    return raw;
  } catch {
    return [];
  }
}

async latestTagForPackage(packageName: string): Promise<string | null> {
  const tags = await this.tagsByPackage(packageName);
  if (tags.length === 0) return null;
  const sorted = tags.sort((a, b) => {
    const va = a.slice(packageName.length + 1);
    const vb = b.slice(packageName.length + 1);
    return semver.compare(va, vb);
  });
  return sorted[sorted.length - 1] ?? null;
}
```

- [ ] **Step 6: Run all git tests**

Run: `cd packages/core && bun vitest --run tests/unit/git-tag-helpers.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/git.ts packages/core/tests/unit/git-tag-helpers.test.ts
git commit -m "feat(core): add package-prefixed tag parsing and tag helpers"
```

---

## Chunk 2: Migrate Version Setting (required-missing-information, cli, runner snapshot)

### Task 3: Migrate required-missing-information.ts to produce VersionPlan

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`
- Modify: `packages/core/tests/unit/tasks/required-missing-information.test.ts`

- [ ] **Step 1: Update handleSinglePackage to set versionPlan**

In `packages/core/src/tasks/required-missing-information.ts`, find all 3 version-setting paths and replace them:

**handleSinglePackage (around line 299 and 322):**
```ts
// Old:
ctx.runtime.version = bump.newVersion;
// New:
ctx.runtime.versionPlan = {
  mode: "single",
  version: bump.newVersion,
  packageName: ctx.config.packages[0].name,
};

// Old:
ctx.runtime.version = nextVersion;
// New:
ctx.runtime.versionPlan = {
  mode: "single",
  version: nextVersion,
  packageName: ctx.config.packages[0].name,
};
```

- [ ] **Step 2: Update handleFixedMode to set versionPlan**

**handleFixedMode (around line 587-594):**
```ts
// Old:
ctx.runtime.version = nextVersion;
const versions = new Map<string, string>();
for (const name of currentVersions.keys()) {
  versions.set(name, nextVersion);
}
ctx.runtime.versions = versions;

// New:
const packages = new Map<string, string>();
for (const name of currentVersions.keys()) {
  packages.set(name, nextVersion);
}
ctx.runtime.versionPlan = {
  mode: "fixed",
  version: nextVersion,
  packages,
};
```

- [ ] **Step 3: Update handleIndependentMode to set versionPlan**

Find where `ctx.runtime.versions` is set in handleIndependentMode and replace:
```ts
// Old:
ctx.runtime.versions = versions;
// New:
ctx.runtime.versionPlan = {
  mode: "independent",
  packages: versions,
};
```

- [ ] **Step 4: Update skip condition that checks version existence**

Around line 175-176:
```ts
// Old:
!!ctx.runtime.version || (!!ctx.runtime.versions && ctx.runtime.versions.size > 0),
// New:
!!ctx.runtime.versionPlan,
```

Around line 193-194 (fallback version display):
```ts
// Old:
ctx.runtime.version ?? ctx.runtime.versions?.values().next().value;
// New:
ctx.runtime.versionPlan
  ? ctx.runtime.versionPlan.mode === "independent"
    ? [...ctx.runtime.versionPlan.packages.values()][0]
    : ctx.runtime.versionPlan.version
  : undefined;
```

- [ ] **Step 5: Update tests in required-missing-information.test.ts**

Replace all `ctx.runtime.version` / `ctx.runtime.versions` assertions with `ctx.runtime.versionPlan` checks. Pattern:

```ts
// Old:
expect(ctx.runtime.version).toBe("1.1.0");
// New:
expect(ctx.runtime.versionPlan).toEqual({
  mode: "single",
  version: "1.1.0",
  packageName: expect.any(String),
});

// Old:
expect(ctx.runtime.versions).toEqual(new Map([...]));
// New (fixed):
expect(ctx.runtime.versionPlan).toEqual({
  mode: "fixed",
  version: "1.1.0",
  packages: new Map([...]),
});
// New (independent):
expect(ctx.runtime.versionPlan).toEqual({
  mode: "independent",
  packages: new Map([...]),
});
```

- [ ] **Step 6: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tasks/required-missing-information.ts packages/core/tests/unit/tasks/required-missing-information.test.ts
git commit -m "refactor(core): migrate required-missing-information to VersionPlan"
```

---

### Task 4: Migrate CLI version setting (cli.ts)

**Files:**
- Modify: `packages/pubm/src/cli.ts`
- Modify: `packages/pubm/tests/unit/cli.test.ts`

- [ ] **Step 1: Update all version assignments in cli.ts**

Import `VersionPlan` type. Replace all `ctx.runtime.version` and `ctx.runtime.versions` assignments:

**Line ~160 (nextVersion from CLI option):**
```ts
// Old:
if (nextVersion) { ctx.runtime.version = nextVersion; }
// New:
if (nextVersion) {
  if (resolvedConfig.packages.length <= 1) {
    ctx.runtime.versionPlan = {
      mode: "single",
      version: nextVersion,
      packageName: resolvedConfig.packages[0]?.name ?? "",
    };
  } else {
    const packages = new Map(resolvedConfig.packages.map((p) => [p.name, nextVersion]));
    ctx.runtime.versionPlan = { mode: "fixed", version: nextVersion, packages };
  }
}
```

**Line ~171 (snapshot placeholder):**
```ts
// Old:
ctx.runtime.version = "snapshot";
// New:
ctx.runtime.versionPlan = {
  mode: "single",
  version: "snapshot",
  packageName: resolvedConfig.packages[0]?.name ?? "",
};
```

**Line ~183-197 (CI publish-only):**

The current code uses `latestTag()?.slice(1)` which only strips `v` prefix. For package-prefixed tags (`@pubm/core@0.4.0`), `slice(1)` produces invalid results. Use `extractVersion()` instead, and handle independent mode via per-package tag lookup.

```ts
// Old:
const latestVersion = (await git.latestTag())?.slice(1);
// ...
ctx.runtime.version = latestVersion;

// New:
import { extractVersion } from "@pubm/core";

if (resolvedConfig.packages.length <= 1) {
  const latestTag = await git.latestTag();
  if (!latestTag) throw new Error("Cannot find the latest tag...");
  const latestVersion = extractVersion(latestTag);
  if (!valid(latestVersion)) throw new Error("Cannot parse the latest tag...");
  ctx.runtime.versionPlan = {
    mode: "single",
    version: latestVersion,
    packageName: resolvedConfig.packages[0]?.name ?? "",
  };
} else {
  // Multi-package: look up per-package tags
  const packages = new Map<string, string>();
  for (const pkg of resolvedConfig.packages) {
    const pkgTag = await git.latestTagForPackage(pkg.name);
    if (pkgTag) {
      packages.set(pkg.name, extractVersion(pkgTag));
    } else {
      // Fallback: use latest v-prefix tag
      const latestTag = await git.latestTag();
      if (latestTag) packages.set(pkg.name, extractVersion(latestTag));
    }
  }
  if (packages.size === 0) throw new Error("Cannot find any release tags...");

  const allSame = new Set(packages.values()).size === 1;
  const mode = resolvedConfig.versioning ?? (allSame ? "fixed" : "independent");
  if (mode === "fixed") {
    ctx.runtime.versionPlan = {
      mode: "fixed",
      version: [...packages.values()][0],
      packages,
    };
  } else {
    ctx.runtime.versionPlan = { mode: "independent", packages };
  }
}
```

**Lines ~210-226 (CI changeset bumps):**
```ts
// Old block
if (bumps.size === 1) {
  const [, bump] = [...bumps][0];
  ctx.runtime.version = bump.newVersion;
} else {
  ctx.runtime.versions = new Map(...);
  if (resolvedConfig.versioning === "fixed") {
    ctx.runtime.version = [...bumps.values()][0].newVersion;
  } else {
    ctx.runtime.version = [...bumps.values()][0].newVersion;
  }
}

// New block
const bumpedPackages = new Map(
  [...bumps].map(([name, bump]) => [name, bump.newVersion]),
);
if (bumps.size === 1) {
  const [name, bump] = [...bumps][0];
  ctx.runtime.versionPlan = {
    mode: "single",
    version: bump.newVersion,
    packageName: name,
  };
} else {
  const allSame = new Set(bumpedPackages.values()).size === 1;
  const mode = resolvedConfig.versioning ?? (allSame ? "fixed" : "independent");
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
```

**Line ~239 (version existence check):**
```ts
// Old:
if (!ctx.runtime.version && !ctx.runtime.versions) {
// New:
if (!ctx.runtime.versionPlan) {
```

- [ ] **Step 2: Update cli.test.ts assertions**

Replace `ctx.runtime.version`/`ctx.runtime.versions` assertions with `ctx.runtime.versionPlan` equivalents.

- [ ] **Step 3: Run tests**

Run: `cd packages/pubm && bun vitest --run tests/unit/cli.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/pubm/src/cli.ts packages/pubm/tests/unit/cli.test.ts
git commit -m "refactor(cli): migrate CLI version setting to VersionPlan"
```

---

### Task 5: Migrate runner.ts snapshot path and formatVersionSummary

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Update formatVersionSummary and formatVersionPlan**

```ts
// Old formatVersionSummary (lines 269-277):
function formatVersionSummary(ctx: PubmContext): string {
  if (ctx.runtime.versions && ctx.runtime.versions.size > 1) {
    return [...ctx.runtime.versions].map(([name, ver]) => `${name}@${ver}`).join(", ");
  }
  return `v${ctx.runtime.version}`;
}

// New:
function formatVersionSummary(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (!plan) return "unknown";
  if (plan.mode === "independent") {
    return [...plan.packages].map(([name, ver]) => `${name}@${ver}`).join(", ");
  }
  return `v${plan.version}`;
}

// Old formatVersionPlan (lines 279-287):
// New:
function formatVersionPlan(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (!plan) return "";
  if (plan.mode === "independent" || plan.mode === "fixed") {
    return `Target versions:\n${[...plan.packages]
      .map(([name, ver]) => `  ${name}: ${ver}`)
      .join("\n")}`;
  }
  return `Target version: v${plan.version}`;
}
```

- [ ] **Step 2: Update snapshot path (lines ~467, ~503, ~530)**

```ts
// Old (line 467):
ctx.runtime.version = snapshotVersion;
// New:
ctx.runtime.versionPlan = {
  mode: "single",
  version: snapshotVersion,
  packageName: ctx.config.packages[0].name,
};

// Old (line 503):
const tagName = `v${ctx.runtime.version}`;
// New:
const tagName = `v${ctx.runtime.versionPlan!.version}`;

// Old (line 530):
color.blueBright(ctx.runtime.version ?? "")
// New:
color.blueBright(ctx.runtime.versionPlan ? formatVersionSummary(ctx) : "")
```

- [ ] **Step 3: Run format and typecheck to confirm no obvious breaks**

Run: `cd packages/core && bun run typecheck`
Note: This will show errors in other files (npm.ts, jsr.ts, etc.) that still reference `ctx.runtime.version` — that's expected and will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): migrate runner snapshot path and formatVersionSummary to VersionPlan"
```

---

## Chunk 3: Migrate Publish Tasks & Prerequisites

### Task 6: Migrate npm.ts, jsr.ts, crates.ts, dry-run-publish.ts

**Files:**
- Modify: `packages/core/src/tasks/npm.ts`
- Modify: `packages/core/src/tasks/jsr.ts`
- Modify: `packages/core/src/tasks/crates.ts`
- Modify: `packages/core/src/tasks/dry-run-publish.ts`

These files all follow the same pattern: `ctx.runtime.version!` is used for version checking and display. Each publish task already receives a package context, so we need to resolve the correct version from the plan.

- [ ] **Step 1: Add a getPackageVersion helper in runner.ts or a shared location**

Add to `packages/core/src/tasks/runner.ts` (or inline in each file):

```ts
function getPackageVersion(ctx: PubmContext, packageName: string): string {
  const plan = ctx.runtime.versionPlan!;
  if (plan.mode === "single") return plan.version;
  if (plan.mode === "fixed") return plan.version;
  return plan.packages.get(packageName) ?? "";
}
```

Export it or keep it local. Since all publish tasks import from runner context, consider adding it to `context.ts`:

```ts
export function getPackageVersion(ctx: PubmContext, packageName: string): string {
  const plan = ctx.runtime.versionPlan!;
  if (plan.mode === "single") return plan.version;
  if (plan.mode === "fixed") return plan.version;
  return plan.packages.get(packageName) ?? "";
}
```

- [ ] **Step 2: Replace ctx.runtime.version in npm.ts**

Pattern for all references (npm.ts has ~5 references):
```ts
// Old:
ctx.runtime.version!
// New:
getPackageVersion(ctx, npm.packageName)
```

Import `getPackageVersion` from `../context.js`.

- [ ] **Step 3: Replace ctx.runtime.version in jsr.ts**

Same pattern — replace `ctx.runtime.version!` with `getPackageVersion(ctx, jsr.packageName)`.

- [ ] **Step 4: Replace ctx.runtime.version in crates.ts**

Same pattern — replace `ctx.runtime.version!` with `getPackageVersion(ctx, packageName)` (crates.ts already has `packageName` in scope).

- [ ] **Step 5: Replace ctx.runtime.version in dry-run-publish.ts**

Same pattern for all 9 references. Each publish section has the registry name in scope.

- [ ] **Step 6: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: Fewer errors than before (these 4 files should be clean now)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tasks/npm.ts packages/core/src/tasks/jsr.ts packages/core/src/tasks/crates.ts packages/core/src/tasks/dry-run-publish.ts packages/core/src/context.ts
git commit -m "refactor(core): migrate publish tasks to VersionPlan"
```

---

### Task 7: Migrate prerequisites-check.ts — remove tag check, update version refs

**Files:**
- Modify: `packages/core/src/tasks/prerequisites-check.ts`

- [ ] **Step 1: Remove the "Checking git tag existence" task block**

Remove lines 154-178 (the entire task block that checks `v${ctx.runtime.version}`). This check moves to the "Bumping version" task in runner.ts (Task 9).

- [ ] **Step 2: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: prerequisites-check.ts should be clean

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tasks/prerequisites-check.ts
git commit -m "refactor(core): remove tag existence check from prerequisites (moves to version bump)"
```

---

## Chunk 4: Runner Version Bump, Commit, Tag, Release

### Task 8: Rewrite runner.ts version bump section (commit message, tags)

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

This is the largest single change. The "Bumping version" task (lines ~760-964) needs to be rewritten to use `versionPlan.mode` instead of the `isIndependent`/`hasMultiPackageVersions` flags.

- [ ] **Step 1: Replace isIndependent/hasMultiPackageVersions with versionPlan.mode**

Remove lines 771-776:
```ts
// Remove:
const versions = ctx.runtime.versions;
const hasMultiPackageVersions = versions !== undefined && versions.size > 0;
const isIndependent = hasMultiPackageVersions && new Set(versions.values()).size > 1;
```

Replace with:
```ts
const plan = ctx.runtime.versionPlan!;
```

- [ ] **Step 2: Rewrite the version write + commit + tag section**

Replace the entire `if (hasMultiPackageVersions) { ... } else { ... }` block (lines ~828-963) with mode-based logic:

```ts
if (plan.mode === "single") {
  // Single package: write version for all config packages (e.g., platform binaries share the version)
  const singleVersions = new Map(
    ctx.config.packages.map((pkg) => [pkg.name, plan.version]),
  );
  const replaced = await writeVersions(ctx, singleVersions);
  for (const f of replaced) await git.stage(f);

  // Changesets
  if (ctx.runtime.changesetConsumed) {
    // ... existing changeset logic for single package
  }

  task.output = "Running plugin afterVersion hooks...";
  await ctx.runtime.pluginRunner.runHook("afterVersion", ctx);
  await git.stage(".");

  // Tag existence check (moved from prerequisites)
  const tagName = `v${plan.version}`;
  if (await git.checkTagExist(tagName)) {
    if (ctx.runtime.promptEnabled) {
      const deleteTag = await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
        type: "toggle",
        message: `The Git tag '${tagName}' already exists. Delete it?`,
        enabled: "Yes",
        disabled: "No",
      });
      if (deleteTag) {
        await git.deleteTag(tagName);
      } else {
        throw new Error(`Git tag '${tagName}' already exists.`);
      }
    } else {
      throw new Error(`Git tag '${tagName}' already exists. Remove it manually or use a different version.`);
    }
  }

  const commit = await git.commit(tagName);
  commited = true;
  await git.createTag(tagName, commit);
  tagCreated = true;

} else if (plan.mode === "fixed") {
  // Fixed monorepo: same version for all packages
  const replaced = await writeVersions(ctx, plan.packages);
  for (const f of replaced) await git.stage(f);

  if (ctx.runtime.changesetConsumed) {
    // Changelog at root
    const changesets = readChangesets(process.cwd());
    if (changesets.length > 0) {
      const allEntries = [...plan.packages.keys()].flatMap(
        (pkgName) => buildChangelogEntries(changesets, pkgName),
      );
      if (allEntries.length > 0) {
        writeChangelogToFile(process.cwd(), generateChangelog(plan.version, allEntries));
      }
      deleteChangesetFiles(process.cwd(), changesets);
    }
  }

  task.output = "Running plugin afterVersion hooks...";
  await ctx.runtime.pluginRunner.runHook("afterVersion", ctx);
  await git.stage(".");

  const tagName = `v${plan.version}`;
  if (await git.checkTagExist(tagName)) {
    if (ctx.runtime.promptEnabled) {
      const deleteTag = await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
        type: "toggle",
        message: `The Git tag '${tagName}' already exists. Delete it?`,
        enabled: "Yes", disabled: "No",
      });
      if (deleteTag) { await git.deleteTag(tagName); }
      else { throw new Error(`Git tag '${tagName}' already exists.`); }
    } else {
      throw new Error(`Git tag '${tagName}' already exists.`);
    }
  }

  const commit = await git.commit(tagName);
  commited = true;
  await git.createTag(tagName, commit);
  tagCreated = true;

} else {
  // Independent monorepo
  const replaced = await writeVersions(ctx, plan.packages);
  for (const f of replaced) await git.stage(f);

  if (ctx.runtime.changesetConsumed) {
    // Per-package changelogs
    const changesets = readChangesets(process.cwd());
    if (changesets.length > 0) {
      for (const [pkgName, pkgVersion] of plan.packages) {
        const entries = buildChangelogEntries(changesets, pkgName);
        if (entries.length > 0) {
          const pkgConfig = ctx.config.packages.find((p) => p.name === pkgName);
          const changelogDir = pkgConfig
            ? path.resolve(process.cwd(), pkgConfig.path)
            : process.cwd();
          writeChangelogToFile(changelogDir, generateChangelog(pkgVersion, entries));
        }
      }
      deleteChangesetFiles(process.cwd(), changesets);
    }
  }

  task.output = "Running plugin afterVersion hooks...";
  await ctx.runtime.pluginRunner.runHook("afterVersion", ctx);
  await git.stage(".");

  // Tag existence checks for all packages
  for (const [pkgName, pkgVersion] of plan.packages) {
    const tagName = `${pkgName}@${pkgVersion}`;
    if (await git.checkTagExist(tagName)) {
      if (ctx.runtime.promptEnabled) {
        const deleteTag = await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
          type: "toggle",
          message: `The Git tag '${tagName}' already exists. Delete it?`,
          enabled: "Yes", disabled: "No",
        });
        if (deleteTag) { await git.deleteTag(tagName); }
        else { throw new Error(`Git tag '${tagName}' already exists.`); }
      } else {
        throw new Error(`Git tag '${tagName}' already exists.`);
      }
    }
  }

  // Commit with "Version Packages" message
  const commitMsg = `Version Packages\n\n${[...plan.packages]
    .map(([name, ver]) => `- ${name}: ${ver}`)
    .join("\n")}`;
  const commit = await git.commit(commitMsg);
  commited = true;

  // Create per-package tags
  for (const [pkgName, pkgVersion] of plan.packages) {
    await git.createTag(`${pkgName}@${pkgVersion}`, commit);
  }
  tagCreated = true;
}
```

- [ ] **Step 3: Update rollback logic**

The rollback block (lines ~780-822) references `isIndependent` and `versions`. Update to use `plan.mode`:

```ts
addRollback(async () => {
  if (tagCreated) {
    if (plan.mode === "independent") {
      for (const [pkgName, pkgVersion] of plan.packages) {
        try { await git.deleteTag(`${pkgName}@${pkgVersion}`); } catch { /* log */ }
      }
    } else {
      const tagName = `v${plan.version}`;
      try { await git.deleteTag(tagName); } catch { /* log */ }
    }
  }
  // ... existing commit reset logic
});
```

- [ ] **Step 4: Update remaining ctx.runtime.version references in runner.ts**

Search runner.ts for any remaining `ctx.runtime.version` or `ctx.runtime.versions` references and replace with `versionPlan`-based access. Key spots:

- Line ~641: `ctx.runtime.version ?? ""` → use `formatVersionSummary(ctx)` or `getPackageVersion`
- Line ~875: same
- Line ~942: same
- Line ~1084: `prerelease(ctx.runtime.version ?? "")` → `prerelease(plan.version)` or per-package

- [ ] **Step 5: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: runner.ts should be clean (or close to it)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): rewrite version bump/commit/tag to use VersionPlan.mode"
```

---

### Task 9: Rewrite GitHub release section in runner.ts

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`
- Modify: `packages/core/src/tasks/github-release.ts`

- [ ] **Step 1: Update createGitHubRelease signature**

Change `packages/core/src/tasks/github-release.ts`:

```ts
// Old:
export async function createGitHubRelease(
  ctx: PubmContext,
  changelogBody?: string,
): Promise<ReleaseContext>

// New:
export async function createGitHubRelease(
  ctx: PubmContext,
  options: {
    packageName: string;
    version: string;
    tag: string;
    changelogBody?: string;
  },
): Promise<ReleaseContext>
```

Add `packageName` to `ReleaseContext`:
```ts
export interface ReleaseContext {
  packageName: string;
  version: string;
  tag: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}
```

Update the function body:
- Remove internal `git.latestTag()` call — use `options.tag`
- Use `options.version` for prerelease check
- Use `options.tag` for release name and tag_name
- Set `packageName` in return value from `options.packageName`
- `previousTag` calculated from `options.tag` via `git.previousTag(options.tag) ?? git.firstCommit()`

- [ ] **Step 2: Rewrite "Creating GitHub Release" task in runner.ts**

Replace lines ~592-666 (the release creation + afterRelease tasks):

```ts
{
  title: "Creating GitHub Release",
  task: async (ctx, task): Promise<void> => {
    const plan = ctx.runtime.versionPlan!;
    const git = new Git();

    if (plan.mode === "independent") {
      // Per-package releases
      for (const [pkgName, pkgVersion] of plan.packages) {
        const tag = `${pkgName}@${pkgVersion}`;
        task.output = `Creating release for ${tag}...`;

        const pkgConfig = ctx.config.packages.find((p) => p.name === pkgName);
        let changelogBody: string | undefined;
        if (pkgConfig) {
          const changelogPath = join(process.cwd(), pkgConfig.path, "CHANGELOG.md");
          if (existsSync(changelogPath)) {
            changelogBody = parseChangelogSection(
              readFileSync(changelogPath, "utf-8"),
              pkgVersion,
            ) ?? undefined;
          }
        }

        const result = await createGitHubRelease(ctx, {
          packageName: pkgName,
          version: pkgVersion,
          tag,
          changelogBody,
        });
        task.output = `Release created: ${result.releaseUrl}`;
        await ctx.runtime.pluginRunner.runAfterReleaseHook(ctx, result);
      }
    } else {
      // Single or fixed: one release
      const version = plan.version;
      const tag = `v${version}`;
      task.output = `Creating release for ${tag}...`;

      let changelogBody: string | undefined;
      if (plan.mode === "fixed") {
        // Combine per-package changelogs
        const sections: string[] = [];
        for (const [pkgName, pkgVersion] of plan.packages) {
          const pkgConfig = ctx.config.packages.find((p) => p.name === pkgName);
          if (!pkgConfig) continue;
          const changelogPath = join(process.cwd(), pkgConfig.path, "CHANGELOG.md");
          if (existsSync(changelogPath)) {
            const section = parseChangelogSection(
              readFileSync(changelogPath, "utf-8"),
              pkgVersion,
            );
            if (section) sections.push(`## ${pkgName} v${pkgVersion}\n\n${section}`);
          }
        }
        if (sections.length > 0) changelogBody = sections.join("\n\n---\n\n");
      } else {
        // Single package
        const changelogPath = join(process.cwd(), "CHANGELOG.md");
        if (existsSync(changelogPath)) {
          changelogBody = parseChangelogSection(
            readFileSync(changelogPath, "utf-8"),
            version,
          ) ?? undefined;
        }
      }

      const packageName = plan.mode === "single"
        ? plan.packageName
        : ctx.config.packages[0]?.name ?? "";
      const result = await createGitHubRelease(ctx, {
        packageName,
        version,
        tag,
        changelogBody,
      });
      task.output = `Release created: ${result.releaseUrl}`;
      await ctx.runtime.pluginRunner.runAfterReleaseHook(ctx, result);
    }
  },
},
```

Remove the separate "Running after-release hooks" task (lines ~654-666) since afterRelease is now called inline.

- [ ] **Step 3: Update release draft section (lines ~1042-1093)**

Replace with versionPlan-based logic:

```ts
const plan = ctx.runtime.versionPlan!;

if (plan.mode === "independent") {
  let first = true;
  for (const [pkgName, pkgVersion] of plan.packages) {
    const tag = `${pkgName}@${pkgVersion}`;
    // Build release draft URL
    const releaseDraftUrl = new URL(`${repositoryUrl}/releases/new`);
    releaseDraftUrl.searchParams.set("tag", tag);
    releaseDraftUrl.searchParams.set("prerelease", `${!!prerelease(pkgVersion)}`);
    // ... body from commits

    if (first) {
      await openUrl(releaseDraftUrl.toString());
      first = false;
    }
    const linkUrl = link(tag, releaseDraftUrl.toString());
    task.title += ` ${linkUrl}`;
  }
} else {
  const tag = `v${plan.version}`;
  // ... existing single release draft logic with plan.version
}
```

- [ ] **Step 4: Remove ctx.runtime.releaseContext references**

Remove:
- `ctx.runtime.releaseContext = result;` (line ~651)
- The skip condition `!ctx.runtime.releaseContext` (line ~656)
- The afterRelease task block (already merged into release task)

- [ ] **Step 5: Run typecheck**

Run: `cd packages/core && bun run typecheck`
Expected: runner.ts and github-release.ts should be clean

- [ ] **Step 6: Update runner-coverage.test.ts**

Replace `releaseCtx.runtime.releaseContext` assertions with verification that `runAfterReleaseHook` was called with a `ReleaseContext` that includes `packageName`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tasks/runner.ts packages/core/src/tasks/github-release.ts packages/core/tests/unit/tasks/runner-coverage.test.ts
git commit -m "refactor(core): rewrite GitHub release for per-package support with VersionPlan"
```

---

## Chunk 5: Plugin Changes & Config Update

### Task 10: Update external-version-sync plugin

**Files:**
- Modify: `packages/plugins/plugin-external-version-sync/src/types.ts`
- Modify: `packages/plugins/plugin-external-version-sync/src/index.ts`
- Modify: `packages/plugins/plugin-external-version-sync/tests/integration/external-version-sync.test.ts`

- [ ] **Step 1: Add version callback to types**

In `types.ts`, add to `ExternalVersionSyncOptions`:

```ts
export interface ExternalVersionSyncOptions {
  targets: SyncTarget[];
  version?: (packages: Map<string, string>) => string;
}
```

- [ ] **Step 2: Update afterVersion hook in index.ts**

```ts
hooks: {
  afterVersion: async (ctx) => {
    const cwd = process.cwd();
    const plan = ctx.runtime.versionPlan!;
    let version: string;

    if (plan.mode === "independent") {
      if (options.version) {
        version = options.version(plan.packages);
      } else {
        throw new Error(
          "external-version-sync: 'version' callback is required in independent mode. " +
          "Provide a version picker, e.g. version: (pkgs) => pkgs.get('@pubm/core') ?? ''",
        );
      }
    } else {
      version = plan.version;
    }

    const errors: string[] = [];
    for (const target of options.targets) {
      try {
        const filePath = path.isAbsolute(target.file)
          ? target.file
          : path.resolve(cwd, target.file);
        syncVersionInFile(filePath, version, target);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${target.file}: ${message}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `external-version-sync failed for ${errors.length} target(s):\n${errors.join("\n")}`,
      );
    }
  },
},
```

- [ ] **Step 3: Update test**

In `external-version-sync.test.ts`, replace:
```ts
// Old:
ctx.runtime.version = version;
// New:
ctx.runtime.versionPlan = { mode: "single", version, packageName: "test-pkg" };
```

Add a test for independent mode with version callback.

- [ ] **Step 4: Run tests**

Run: `cd packages/plugins/plugin-external-version-sync && bun vitest --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/plugin-external-version-sync/
git commit -m "feat(plugin-external-version-sync): add version callback for independent mode"
```

---

### Task 11: Update plugin-brew

**Files:**
- Modify: `packages/plugins/plugin-brew/src/types.ts`
- Modify: `packages/plugins/plugin-brew/src/brew-tap.ts`
- Modify: `packages/plugins/plugin-brew/src/brew-core.ts`

- [ ] **Step 1: Add packageName to types**

```ts
export interface BrewTapOptions {
  formula: string;
  repo?: string;
  packageName?: string;
}

export interface BrewCoreOptions {
  formula: string;
  packageName?: string;
}
```

- [ ] **Step 2: Add packageName filter to brew-tap.ts afterRelease hook**

At the start of `afterRelease`:
```ts
afterRelease: async (_ctx, releaseCtx) => {
  if (options.packageName && releaseCtx.packageName !== options.packageName) {
    return;
  }
  // ... existing logic
}
```

- [ ] **Step 3: Add packageName filter to brew-core.ts afterRelease hook**

Same pattern as brew-tap.

- [ ] **Step 4: Run typecheck**

Run: `cd packages/plugins/plugin-brew && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/plugin-brew/
git commit -m "feat(plugin-brew): add packageName filter for per-package releases"
```

---

### Task 12: Update root pubm.config.ts

**Files:**
- Modify: `pubm.config.ts`

- [ ] **Step 1: Add version callback and packageName**

```ts
export default defineConfig({
  versioning: "independent",
  packages: [
    { path: "packages/core" },
    { path: "packages/pubm" },
    { path: "packages/pubm/platforms/*" },
    { path: "packages/plugins/plugin-external-version-sync" },
    { path: "packages/plugins/plugin-brew" },
  ],
  plugins: [
    brewTap({
      formula: "Formula/pubm.rb",
      packageName: "pubm",
    }),
    externalVersionSync({
      targets: [
        { file: "website/src/i18n/landing.ts", pattern: /v\d+\.\d+\.\d+/ },
        {
          file: "plugins/pubm-plugin/.claude-plugin/plugin.json",
          jsonPath: "version",
        },
        {
          file: ".claude-plugin/marketplace.json",
          jsonPath: "metadata.version",
        },
        {
          file: ".claude-plugin/marketplace.json",
          jsonPath: "plugins.0.version",
        },
      ],
      version: (packages) => packages.get("packages/core") ?? "",
    }),
  ],
});
```

- [ ] **Step 2: Restore version fields in .claude-plugin files**

Add `"version": "0.4.0"` back to:
- `.claude-plugin/marketplace.json` (in `metadata` and in `plugins[0]`)
- `plugins/pubm-plugin/.claude-plugin/plugin.json`

- [ ] **Step 3: Commit**

```bash
git add pubm.config.ts .claude-plugin/marketplace.json plugins/pubm-plugin/.claude-plugin/plugin.json
git commit -m "fix: update config with version callback and restore .claude-plugin version fields"
```

---

## Chunk 6: Final Verification

### Task 13: Full test suite and cleanup

- [ ] **Step 1: Run format**

Run: `bun run format`

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors

- [ ] **Step 3: Run all tests**

Run: `bun run test`
Expected: PASS — all tests pass

- [ ] **Step 4: Fix any remaining failures**

Address any test failures from tests that still reference old `ctx.runtime.version`/`versions`/`releaseContext`.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(core): resolve remaining VersionPlan migration issues"
```
