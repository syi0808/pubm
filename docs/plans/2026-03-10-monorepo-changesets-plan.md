# Monorepo Changeset Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make changeset workflow fully support monorepo/multi-package projects with both fixed and independent versioning modes.

**Architecture:** Extend the version prompt and version bump pipeline to discover all packages, calculate per-package bumps, and apply versioning mode (fixed/independent). Leverage existing `discoverPackages()`, `calculateVersionBumps()`, `buildDependencyGraph()`, and group utilities.

**Tech Stack:** TypeScript, enquirer (via `@listr2/prompt-adapter-enquirer`), listr2, semver, commander

---

## Task 1: Per-Package Version Replacement for JS Monorepos

Currently `replaceVersion()` in `src/utils/package.ts` only updates root `package.json`/`jsr.json`. For monorepos, each package's manifest needs to be updated independently.

**Files:**
- Modify: `src/utils/package.ts`
- Test: `tests/unit/utils/package.test.ts`

**Step 1: Add `replaceVersionAtPath` function**

Add a new function that replaces the version in a specific package.json file at a given path:

```typescript
export async function replaceVersionAtPath(
  version: string,
  packagePath: string,
): Promise<string[]> {
  const files: string[] = [];

  const packageJsonPath = path.join(packagePath, "package.json");
  try {
    const raw = (await readFile(packageJsonPath)).toString();
    await writeFile(packageJsonPath, raw.replace(versionRegex, `$1${version}$2`));
    files.push(packageJsonPath);
  } catch {}

  const jsrJsonPath = path.join(packagePath, "jsr.json");
  try {
    const raw = (await readFile(jsrJsonPath)).toString();
    await writeFile(jsrJsonPath, raw.replace(versionRegex, `$1${version}$2`));
    files.push(jsrJsonPath);
  } catch {}

  return files;
}
```

**Step 2: Add `replaceVersions` function for multi-package**

```typescript
export async function replaceVersions(
  versions: Map<string, string>,
  packages: PackageConfig[],
): Promise<string[]> {
  const allFiles: string[] = [];

  for (const pkg of packages) {
    const pkgVersion = versions.get(pkg.path) ?? versions.values().next().value;
    if (!pkgVersion) continue;
    const files = await replaceVersionAtPath(pkgVersion, path.resolve(pkg.path));
    allFiles.push(...files);
  }

  // Handle Rust crates (existing logic)
  const cratePackages = packages.filter((pkg) => pkg.registries.includes("crates"));
  // ... existing crate logic, but with per-crate versions from the map

  return [...new Set(allFiles)];
}
```

**Step 3: Export from index, run tests**

Run: `bun run format && bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git commit -m "feat: add per-package version replacement for JS monorepos"
```

---

## Task 2: Multi-Package Version Discovery Helper

Create a helper that discovers all packages and their current versions, returning a `Map<string, string>` of package names to versions.

**Files:**
- Create: `src/changeset/packages.ts`
- Test: `tests/unit/changeset/packages.test.ts`
- Modify: `src/changeset/index.ts` (add export)

**Step 1: Write the failing test**

```typescript
// tests/unit/changeset/packages.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/monorepo/discover.js", () => ({
  discoverPackages: vi.fn(),
}));

vi.mock("../../src/utils/package.js", () => ({
  getPackageJson: vi.fn(),
}));

import { discoverPackages } from "../../src/monorepo/discover.js";
import { getPackageJson } from "../../src/utils/package.js";
import { discoverCurrentVersions } from "../../src/changeset/packages.js";

const mockedDiscoverPackages = vi.mocked(discoverPackages);
const mockedGetPackageJson = vi.mocked(getPackageJson);

describe("discoverCurrentVersions", () => {
  it("returns single package when no workspace detected", async () => {
    mockedDiscoverPackages.mockReturnValue([]);
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
    });

    const result = await discoverCurrentVersions("/tmp/project");
    expect(result.size).toBe(1);
    expect(result.get("my-pkg")).toBe("1.0.0");
  });

  it("returns multiple packages for monorepo", async () => {
    mockedDiscoverPackages.mockReturnValue([
      { path: "packages/core", registries: ["npm"], ecosystem: "js" },
      { path: "packages/cli", registries: ["npm"], ecosystem: "js" },
    ]);
    mockedGetPackageJson
      .mockResolvedValueOnce({ name: "@pubm/core", version: "1.2.0" })
      .mockResolvedValueOnce({ name: "@pubm/cli", version: "0.9.1" });

    const result = await discoverCurrentVersions("/tmp/project");
    expect(result.size).toBe(2);
    expect(result.get("@pubm/core")).toBe("1.2.0");
    expect(result.get("@pubm/cli")).toBe("0.9.1");
  });
});
```

**Step 2: Write implementation**

```typescript
// src/changeset/packages.ts
import path from "node:path";
import { discoverPackages } from "../monorepo/discover.js";
import { getPackageJson } from "../utils/package.js";

export interface PackageVersionInfo {
  name: string;
  version: string;
  path: string;
}

/**
 * Discover all packages and their current versions.
 * For single packages, returns a Map with one entry.
 * For monorepos, returns a Map with all discovered packages.
 */
export async function discoverCurrentVersions(
  cwd: string,
): Promise<Map<string, string>> {
  const discovered = discoverPackages({ cwd });
  const versions = new Map<string, string>();

  if (discovered.length > 0) {
    for (const pkg of discovered) {
      const pkgCwd = path.resolve(cwd, pkg.path);
      try {
        const json = await getPackageJson({ cwd: pkgCwd });
        const name = json.name ?? pkg.path;
        versions.set(name, json.version ?? "0.0.0");
      } catch {
        versions.set(pkg.path, "0.0.0");
      }
    }
  } else {
    const json = await getPackageJson({ cwd });
    const name = json.name ?? "unknown";
    versions.set(name, json.version ?? "0.0.0");
  }

  return versions;
}

/**
 * Discover all packages with full info (name, version, path).
 */
export async function discoverPackageInfos(
  cwd: string,
): Promise<PackageVersionInfo[]> {
  const discovered = discoverPackages({ cwd });
  const infos: PackageVersionInfo[] = [];

  if (discovered.length > 0) {
    for (const pkg of discovered) {
      const pkgCwd = path.resolve(cwd, pkg.path);
      try {
        const json = await getPackageJson({ cwd: pkgCwd });
        infos.push({
          name: json.name ?? pkg.path,
          version: json.version ?? "0.0.0",
          path: pkg.path,
        });
      } catch {
        infos.push({ name: pkg.path, version: "0.0.0", path: pkg.path });
      }
    }
  } else {
    const json = await getPackageJson({ cwd });
    infos.push({
      name: json.name ?? "unknown",
      version: json.version ?? "0.0.0",
      path: ".",
    });
  }

  return infos;
}
```

**Step 3: Export, format, test, commit**

```bash
git commit -m "feat(changeset): add multi-package version discovery helper"
```

---

## Task 3: Multi-Package Changeset-Aware Version Prompt

Rewrite `required-missing-information.ts` to support multi-package version prompting per the design document.

**Files:**
- Modify: `src/tasks/required-missing-information.ts`

**Design Flow (from design document section 4 & 5):**

```
1. Discover all packages, show list with versions
2. Check pending changesets
   ├─ Changesets exist → show per-package recommendations
   │   "Changesets suggest:"
   │   "  @pubm/core  1.2.0 → 1.3.0 (minor: 2 changesets)"
   │   "  @pubm/cli   0.9.1 → 0.9.2 (patch: 1 changeset)"
   │   "Accept? (Y/n/customize)"
   │   ├─ Accept → set versions, changesetConsumed=true
   │   └─ Customize → manual flow
   │
   └─ No changesets → manual flow

3. Manual flow:
   ├─ Multiple packages
   │   ├─ Ask: sync versions? (if config.versioning not set)
   │   │   ├─ sync (fixed) → ask version once
   │   │   └─ no sync (independent) → ask per package
   │   └─ Dependency cascade: if dep version bumped, suggest bumping dependents
   │
   └─ Single package → ask version once
```

**Key changes to Ctx interface:**

```typescript
interface Ctx {
  version?: string;
  versions?: Map<string, string>;  // per-package versions (for independent)
  changesetConsumed?: boolean;
  tag: string;
}
```

**Step 1: Implement the full multi-package prompt flow**

The implementation should:
1. Use `discoverCurrentVersions()` and `discoverPackageInfos()` from Task 2
2. Use `getStatus()` for changeset info
3. Use `calculateVersionBumps()` with ALL package versions
4. Load config for `versioning` mode and `fixed`/`linked` groups
5. Apply `applyFixedGroup`/`applyLinkedGroup` when applicable
6. Use `buildDependencyGraph()` for dependency cascade recommendations
7. Set either `ctx.version` (fixed) or `ctx.versions` (independent)

**Step 2: Run format and typecheck**

Run: `bun run format && bun run typecheck`

**Step 3: Commit**

```bash
git commit -m "feat: multi-package changeset-aware version prompt with sync and dependency cascade"
```

---

## Task 4: Multi-Package Version Bump in Runner

Update the "Bumping version" task in `runner.ts` to handle multiple packages with both fixed and independent versioning.

**Files:**
- Modify: `src/tasks/runner.ts`
- Modify: `src/types/options.ts` (add `versions` field)

**Step 1: Add `versions` to Options**

In `src/types/options.ts`:
```typescript
versions?: Map<string, string>;
```

**Step 2: Update CLI flow in `src/cli.ts`**

Pass `versions` from context through to pubm options, alongside existing `version`.

**Step 3: Modify "Bumping version" task in runner.ts**

Current behavior (single package):
- `replaceVersion(ctx.version, ctx.packages)` → one version for all
- One tag: `v${ctx.version}`
- One commit

New behavior:

**Fixed mode** (or single package):
- Same as current: one version, one tag, one commit
- Changeset consumption: iterate all packages for changelog entries

**Independent mode:**
- Per-package: `replaceVersionAtPath(version, pkgPath)` for each
- Per-package tags: `@pkgName-v${version}` (or configurable)
- Per-package changelog entries via `buildChangelogEntries`
- One commit containing all changes
- Multiple tags

```typescript
// Pseudo-code for the bumping task:
if (ctx.versions && ctx.versions.size > 1) {
  // Independent mode: per-package version replacement
  for (const [pkgName, pkgVersion] of ctx.versions) {
    const pkgPath = findPackagePath(pkgName, ctx.packages);
    await replaceVersionAtPath(pkgVersion, pkgPath);

    if (ctx.changesetConsumed) {
      const entries = buildChangelogEntries(changesets, pkgName);
      const content = generateChangelog(pkgVersion, entries);
      writeChangelogToFile(pkgPath, content); // per-package CHANGELOG
    }
  }

  // Create per-package tags
  for (const [pkgName, pkgVersion] of ctx.versions) {
    await git.createTag(`${pkgName}@${pkgVersion}`, commit);
  }
} else {
  // Fixed mode: existing single-version behavior
  await replaceVersion(ctx.version, ctx.packages);
  // ... existing changelog + tag logic
}
```

**Step 4: Run format, typecheck, tests**

Run: `bun run format && bun run typecheck && bun vitest --run`

**Step 5: Commit**

```bash
git commit -m "feat: multi-package version bump with fixed and independent mode support"
```

---

## Task 5: Multi-Package CI Auto-Detection

Update CI changeset detection in `cli.ts` to handle multiple packages.

**Files:**
- Modify: `src/cli.ts`

**Step 1: Replace single-package detection with multi-package**

Current CI detection reads one `getPackageJson()`. Change to:

```typescript
// In the CI else branch:
const status = getStatus(process.cwd());
if (status.hasChangesets) {
  const currentVersions = await discoverCurrentVersions(process.cwd());
  const bumps = calculateVersionBumps(currentVersions, process.cwd());

  if (bumps.size > 0) {
    // Apply fixed/linked groups from config
    const config = await loadConfig(process.cwd());
    if (config) {
      // ... apply groups (same logic as version-cmd.ts)
    }

    if (bumps.size === 1) {
      // Single package
      const [, bump] = [...bumps][0];
      context.version = bump.newVersion;
    } else {
      // Multi-package: set versions map
      context.versions = new Map(
        [...bumps].map(([name, bump]) => [name, bump.newVersion])
      );
      // For fixed mode, also set context.version to the shared version
      if (config?.versioning === "fixed") {
        context.version = [...bumps.values()][0].newVersion;
      }
    }
    context.changesetConsumed = true;

    console.log("Changesets detected:");
    for (const [name, bump] of bumps) {
      console.log(`  ${name}: ${bump.currentVersion} → ${bump.newVersion} (${bump.bumpType})`);
    }
  }
}
```

**Step 2: Run format, typecheck**

**Step 3: Commit**

```bash
git commit -m "feat: multi-package CI changeset auto-detection"
```

---

## Task 6: Multi-Package Version Command

Update `version-cmd.ts` to use `discoverCurrentVersions()` instead of reading only root package.json.

**Files:**
- Modify: `src/commands/version-cmd.ts`

**Step 1: Replace root-only package discovery**

Current (lines 43-55):
```typescript
const packageJson = await getPackageJson({ cwd });
const packageName = packageJson.name ?? "unknown";
const currentVersion = packageJson.version;
const currentVersions = new Map([[packageName, currentVersion]]);
```

Change to:
```typescript
const currentVersions = await discoverCurrentVersions(cwd);
if (currentVersions.size === 0) {
  throw new Error("No packages found.");
}
```

This makes `pubm changesets version` work correctly for monorepos — it will calculate and apply bumps for all discovered packages.

**Step 2: Update per-package version writing**

Currently calls `replaceVersion(newVersion, config?.packages)` once with one version. For independent mode, need to call per-package.

**Step 3: Run format, typecheck, tests**

Run: `bun run format && bun run typecheck && bun vitest --run tests/unit/commands/version-cmd.test.ts`

**Step 4: Commit**

```bash
git commit -m "feat(changeset): multi-package support in version command"
```

---

## Task 7: Multi-Package GitHub Release

Update GitHub Release creation to handle multi-package releases.

**Files:**
- Modify: `src/tasks/runner.ts` (CI release task)
- Modify: `src/tasks/github-release.ts`

**Step 1: Handle multi-package changelog in release body**

For independent mode with multiple packages, combine per-package changelog sections:

```typescript
// In CI "Creating GitHub Release" task:
let changelogBody: string | undefined;
const changelogPath = join(process.cwd(), "CHANGELOG.md");

if (ctx.versions && ctx.versions.size > 1) {
  // Multi-package: combine changelogs from per-package CHANGELOG.md files
  const sections: string[] = [];
  for (const [pkgName, pkgVersion] of ctx.versions) {
    const pkgChangelogPath = /* find per-package CHANGELOG */;
    if (existsSync(pkgChangelogPath)) {
      const content = readFileSync(pkgChangelogPath, "utf-8");
      const section = parseChangelogSection(content, pkgVersion);
      if (section) {
        sections.push(`## ${pkgName} v${pkgVersion}\n\n${section}`);
      }
    }
  }
  if (sections.length > 0) changelogBody = sections.join("\n\n---\n\n");
} else if (existsSync(changelogPath)) {
  // Single package: existing behavior
  const content = readFileSync(changelogPath, "utf-8");
  const section = parseChangelogSection(content, ctx.version);
  if (section) changelogBody = section;
}
```

**Step 2: Run format, typecheck**

**Step 3: Commit**

```bash
git commit -m "feat: multi-package GitHub Release with combined changelog"
```

---

## Task 8: Integration Testing and Verification

Verify the full multi-package changeset workflow works end-to-end.

**Step 1: Run full test suite**

```bash
bun run format && bun run typecheck && bun vitest --run
```

**Step 2: Verify no regressions in single-package mode**

Ensure all existing changeset tests still pass — single-package should work identically.

**Step 3: Fix any issues found**

**Step 4: Commit fixes**

```bash
git commit -m "fix: address issues found during multi-package verification"
```
