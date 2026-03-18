# Ecosystem Descriptor & Changeset Path-Based Identification — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change changeset identification from package name to filesystem path, and introduce EcosystemDescriptor for registry-aware display names.

**Architecture:** Changeset YAML stores path as key. Parsing accepts both name and path input via a resolver function, normalizing to path internally. EcosystemDescriptor is an abstract class with JS/Rust subclasses that encapsulate display name fallback logic (npm→jsr→path for JS, crates→path for Rust). Descriptor is consumed only by changeset display and GitHub Release.

**Tech Stack:** TypeScript, Vitest, Bun

**Spec:** `docs/superpowers/specs/2026-03-18-ecosystem-descriptor-changeset-path-design.md`

---

## File Structure

**New files:**
- `packages/core/src/ecosystem/descriptor.ts` — `EcosystemDescriptor` abstract class
- `packages/core/src/ecosystem/js-descriptor.ts` — `JsEcosystemDescriptor` (npm/jsr fallback)
- `packages/core/src/ecosystem/rust-descriptor.ts` — `RustEcosystemDescriptor` (crates fallback)
- `packages/core/src/changeset/resolve.ts` — `createKeyResolver` function
- `packages/core/tests/unit/ecosystem/descriptor.test.ts` — descriptor tests
- `packages/core/tests/unit/changeset/resolve.test.ts` — resolver tests

**Modified files:**
- `packages/core/src/changeset/parser.ts` — `Release.name` → `Release.path`, add `resolveKey` param
- `packages/core/src/changeset/writer.ts` — `release.name` → `release.path`
- `packages/core/src/changeset/version.ts` — `release.name` → `release.path`, accept `resolveKey` param and pass to `readChangesets`
- `packages/core/src/changeset/status.ts` — `release.name` → `release.path`, accept `resolveKey` param and pass to `readChangesets`
- `packages/core/src/changeset/changelog.ts` — `packageName` param → `packagePath`
- `packages/core/src/changeset/reader.ts` — pass `resolveKey` to `parseChangeset`
- `packages/core/src/changeset/index.ts` — re-export new modules
- `packages/core/src/ecosystem/ecosystem.ts` — add abstract `createDescriptor()`
- `packages/core/src/ecosystem/js.ts` — implement `createDescriptor()`
- `packages/core/src/ecosystem/rust.ts` — implement `createDescriptor()`
- `packages/core/src/tasks/runner.ts` — changelog + GitHub Release call sites, pass resolver to `readChangesets`
- `packages/core/src/tasks/required-missing-information.ts` — path-keyed Maps
- `packages/core/src/tasks/github-release.ts` — `packageName` → `displayLabel`
- `packages/core/src/assets/types.ts` — `ReleaseContext.packageName` → `displayLabel`
- `packages/core/src/index.ts` — export new types
- `packages/pubm/src/commands/add.ts` — build Release with path
- `packages/pubm/src/commands/version-cmd.ts` — path-keyed Maps, pass resolver to `readChangesets`/`calculateVersionBumps`
- `packages/plugins/plugin-brew/src/brew-core.ts` — `releaseCtx.packageName` → `releaseCtx.displayLabel`
- `packages/plugins/plugin-brew/src/brew-tap.ts` — `releaseCtx.packageName` → `releaseCtx.displayLabel`

**Modified test files:**
- `packages/core/tests/unit/changeset/parser.test.ts`
- `packages/core/tests/unit/changeset/writer.test.ts`
- `packages/core/tests/unit/changeset/version.test.ts`
- `packages/core/tests/unit/changeset/status.test.ts`
- `packages/core/tests/unit/changeset/changelog.test.ts`
- `packages/core/tests/unit/changeset/reader.test.ts`
- `packages/core/tests/unit/ecosystem/js.test.ts`
- `packages/core/tests/unit/ecosystem/rust.test.ts`
- `packages/core/tests/unit/ecosystem/ecosystem.test.ts`

---

### Task 1: EcosystemDescriptor abstract class + JS/Rust subclasses

**Files:**
- Create: `packages/core/src/ecosystem/descriptor.ts`
- Create: `packages/core/src/ecosystem/js-descriptor.ts`
- Create: `packages/core/src/ecosystem/rust-descriptor.ts`
- Create: `packages/core/tests/unit/ecosystem/descriptor.test.ts`

- [ ] **Step 1: Write tests for JsEcosystemDescriptor**

```typescript
// packages/core/tests/unit/ecosystem/descriptor.test.ts
import { describe, expect, it } from "vitest";
import { JsEcosystemDescriptor } from "../../src/ecosystem/js-descriptor.js";
import { RustEcosystemDescriptor } from "../../src/ecosystem/rust-descriptor.js";

describe("JsEcosystemDescriptor", () => {
  it("returns npmName as displayName when both exist", () => {
    const d = new JsEcosystemDescriptor("packages/core", "@pubm/core", "@jsr/pubm-core");
    expect(d.displayName).toBe("@pubm/core");
  });

  it("returns jsrName as displayName when npm is absent", () => {
    const d = new JsEcosystemDescriptor("packages/core", undefined, "@jsr/pubm-core");
    expect(d.displayName).toBe("@jsr/pubm-core");
  });

  it("falls back to path when no names exist", () => {
    const d = new JsEcosystemDescriptor("packages/core");
    expect(d.displayName).toBe("packages/core");
  });

  it("returns label with jsr in parentheses when names differ", () => {
    const d = new JsEcosystemDescriptor("packages/core", "@pubm/core", "@jsr/pubm-core");
    expect(d.displayLabel).toBe("@pubm/core (@jsr/pubm-core)");
  });

  it("returns plain displayName as label when names are identical", () => {
    const d = new JsEcosystemDescriptor("packages/core", "@pubm/core", "@pubm/core");
    expect(d.displayLabel).toBe("@pubm/core");
  });

  it("returns plain displayName as label when only npm exists", () => {
    const d = new JsEcosystemDescriptor("packages/core", "@pubm/core");
    expect(d.displayLabel).toBe("@pubm/core");
  });

  it("returns jsr as label when only jsr exists", () => {
    const d = new JsEcosystemDescriptor("packages/core", undefined, "@jsr/pubm-core");
    expect(d.displayLabel).toBe("@jsr/pubm-core");
  });
});

describe("RustEcosystemDescriptor", () => {
  it("returns cratesName as displayName", () => {
    const d = new RustEcosystemDescriptor("crates/my-crate", "my-crate");
    expect(d.displayName).toBe("my-crate");
  });

  it("falls back to path when no crates name", () => {
    const d = new RustEcosystemDescriptor("crates/my-crate");
    expect(d.displayName).toBe("crates/my-crate");
  });

  it("displayLabel equals displayName", () => {
    const d = new RustEcosystemDescriptor("crates/my-crate", "my-crate");
    expect(d.displayLabel).toBe("my-crate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/descriptor.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement EcosystemDescriptor, JsEcosystemDescriptor, RustEcosystemDescriptor**

```typescript
// packages/core/src/ecosystem/descriptor.ts
export abstract class EcosystemDescriptor {
  constructor(public readonly path: string) {}

  abstract get displayName(): string;
  abstract get displayLabel(): string;
}
```

```typescript
// packages/core/src/ecosystem/js-descriptor.ts
import { EcosystemDescriptor } from "./descriptor.js";

export class JsEcosystemDescriptor extends EcosystemDescriptor {
  constructor(
    path: string,
    public readonly npmName?: string,
    public readonly jsrName?: string,
  ) {
    super(path);
  }

  get displayName(): string {
    return this.npmName ?? this.jsrName ?? this.path;
  }

  get displayLabel(): string {
    if (this.npmName && this.jsrName && this.npmName !== this.jsrName) {
      return `${this.npmName} (${this.jsrName})`;
    }
    return this.displayName;
  }
}
```

```typescript
// packages/core/src/ecosystem/rust-descriptor.ts
import { EcosystemDescriptor } from "./descriptor.js";

export class RustEcosystemDescriptor extends EcosystemDescriptor {
  constructor(
    path: string,
    public readonly cratesName?: string,
  ) {
    super(path);
  }

  get displayName(): string {
    return this.cratesName ?? this.path;
  }

  get displayLabel(): string {
    return this.displayName;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/descriptor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ecosystem/descriptor.ts packages/core/src/ecosystem/js-descriptor.ts packages/core/src/ecosystem/rust-descriptor.ts packages/core/tests/unit/ecosystem/descriptor.test.ts
git commit -m "feat(core): add EcosystemDescriptor abstract class with JS and Rust implementations"
```

---

### Task 2: Add createDescriptor() to Ecosystem classes

**Files:**
- Modify: `packages/core/src/ecosystem/ecosystem.ts:8-67`
- Modify: `packages/core/src/ecosystem/js.ts:12-58`
- Modify: `packages/core/src/ecosystem/rust.ts:10-110`
- Modify: `packages/core/tests/unit/ecosystem/js.test.ts`
- Modify: `packages/core/tests/unit/ecosystem/rust.test.ts`
- Modify: `packages/core/tests/unit/ecosystem/ecosystem.test.ts`

- [ ] **Step 1: Write test for JsEcosystem.createDescriptor()**

Add a test to `packages/core/tests/unit/ecosystem/js.test.ts` that creates a JsEcosystem with a temp directory containing package.json (and optionally jsr.json), calls `createDescriptor()`, and verifies the returned JsEcosystemDescriptor has the correct npmName/jsrName.

- [ ] **Step 2: Write test for RustEcosystem.createDescriptor()**

Add a test to `packages/core/tests/unit/ecosystem/rust.test.ts` that creates a RustEcosystem with a temp directory containing Cargo.toml, calls `createDescriptor()`, and verifies the returned RustEcosystemDescriptor has the correct cratesName.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/js.test.ts tests/unit/ecosystem/rust.test.ts`
Expected: FAIL — `createDescriptor` not defined

- [ ] **Step 4: Add abstract method to Ecosystem base class**

In `packages/core/src/ecosystem/ecosystem.ts`, add:
```typescript
import type { EcosystemDescriptor } from "./descriptor.js";

// Add to abstract class Ecosystem:
abstract createDescriptor(): Promise<EcosystemDescriptor>;
```

- [ ] **Step 5: Implement createDescriptor() in JsEcosystem**

In `packages/core/src/ecosystem/js.ts`, add:
```typescript
import { JsEcosystemDescriptor } from "./js-descriptor.js";

// Add to class JsEcosystem:
async createDescriptor(): Promise<EcosystemDescriptor> {
  const npmReader = NpmPackageRegistry.reader;
  const jsrReader = JsrPackageRegistry.reader;

  const npmName = (await npmReader.exists(this.packagePath))
    ? (await npmReader.read(this.packagePath)).name
    : undefined;

  const jsrName = (await jsrReader.exists(this.packagePath))
    ? (await jsrReader.read(this.packagePath)).name
    : undefined;

  return new JsEcosystemDescriptor(this.packagePath, npmName, jsrName);
}
```

- [ ] **Step 6: Implement createDescriptor() in RustEcosystem**

In `packages/core/src/ecosystem/rust.ts`, add:
```typescript
import { RustEcosystemDescriptor } from "./rust-descriptor.js";

// Add to class RustEcosystem:
async createDescriptor(): Promise<EcosystemDescriptor> {
  const reader = CratesPackageRegistry.reader;

  const cratesName = (await reader.exists(this.packagePath))
    ? (await reader.read(this.packagePath)).name
    : undefined;

  return new RustEcosystemDescriptor(this.packagePath, cratesName);
}
```

- [ ] **Step 7: Fix any other Ecosystem subclass tests that break due to new abstract method**

Check `packages/core/tests/unit/ecosystem/ecosystem.test.ts` — if it instantiates a mock Ecosystem, add a stub `createDescriptor()`.

- [ ] **Step 8: Run all ecosystem tests**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/ecosystem/ecosystem.ts packages/core/src/ecosystem/js.ts packages/core/src/ecosystem/rust.ts packages/core/tests/unit/ecosystem/
git commit -m "feat(core): add createDescriptor() to Ecosystem classes"
```

---

### Task 3: Release type change (name → path) + key resolver

**Files:**
- Modify: `packages/core/src/changeset/parser.ts:1-53`
- Create: `packages/core/src/changeset/resolve.ts`
- Create: `packages/core/tests/unit/changeset/resolve.test.ts`
- Modify: `packages/core/tests/unit/changeset/parser.test.ts`

- [ ] **Step 1: Write tests for createKeyResolver**

```typescript
// packages/core/tests/unit/changeset/resolve.test.ts
import { describe, expect, it } from "vitest";
import { createKeyResolver } from "../../src/changeset/resolve.js";

describe("createKeyResolver", () => {
  const packages = [
    { name: "@pubm/core", path: "packages/core", version: "1.0.0", dependencies: [], registries: [] as any[] },
    { name: "pubm", path: "packages/pubm", version: "1.0.0", dependencies: [], registries: [] as any[] },
  ];

  it("returns path unchanged when key is a valid path", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("packages/core")).toBe("packages/core");
  });

  it("converts name to path", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("@pubm/core")).toBe("packages/core");
  });

  it("returns key as-is when no match found", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("unknown-pkg")).toBe("unknown-pkg");
  });
});
```

- [ ] **Step 2: Write test for parseChangeset with resolveKey**

Add to `packages/core/tests/unit/changeset/parser.test.ts`:
```typescript
it("resolves name to path via resolveKey", () => {
  const content = '---\n"@pubm/core": minor\n---\n\nsome change\n';
  const resolver = (key: string) => key === "@pubm/core" ? "packages/core" : key;
  const result = parseChangeset(content, "test.md", resolver);
  expect(result.releases[0].path).toBe("packages/core");
});

it("passes path through when resolveKey is not provided", () => {
  const content = '---\n"packages/core": minor\n---\n\nsome change\n';
  const result = parseChangeset(content, "test.md");
  expect(result.releases[0].path).toBe("packages/core");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/changeset/resolve.test.ts tests/unit/changeset/parser.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement createKeyResolver**

```typescript
// packages/core/src/changeset/resolve.ts
import type { ResolvedPackageConfig } from "../config/types.js";

export function createKeyResolver(
  packages: Pick<ResolvedPackageConfig, "name" | "path">[],
): (key: string) => string {
  const nameToPath = new Map(packages.map((p) => [p.name, p.path]));
  const validPaths = new Set(packages.map((p) => p.path));

  return (key: string): string => {
    if (validPaths.has(key)) return key;
    const resolved = nameToPath.get(key);
    if (resolved) return resolved;
    return key;
  };
}
```

- [ ] **Step 5: Update Release interface and parseChangeset**

In `packages/core/src/changeset/parser.ts`:
- Change `Release.name` to `Release.path`
- Add optional `resolveKey` parameter to `parseChangeset`

```typescript
export interface Release {
  path: string;
  type: BumpType;
}

export function parseChangeset(
  content: string,
  fileName: string,
  resolveKey?: (key: string) => string,
): Changeset {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error(
      `Invalid changeset format in "${fileName}": missing frontmatter`,
    );
  }

  const yamlContent = match[1];
  const body = content.slice(match[0].length).trim();

  const parsed = parseYaml(yamlContent) as Record<string, string> | null;

  const releases: Release[] = [];

  if (parsed) {
    for (const [key, type] of Object.entries(parsed)) {
      if (!VALID_BUMP_TYPES.has(type)) {
        throw new Error(
          `Invalid bump type "${type}" for package "${key}" in "${fileName}". Expected: patch, minor, or major.`,
        );
      }
      const path = resolveKey ? resolveKey(key) : key;
      releases.push({ path, type: type as BumpType });
    }
  }

  const id = fileName.replace(/\.md$/, "");

  return { id, summary: body, releases };
}
```

- [ ] **Step 6: Update all existing parser tests to use `release.path` instead of `release.name`**

In `packages/core/tests/unit/changeset/parser.test.ts`, find and replace all `release.name` assertions with `release.path`.

- [ ] **Step 7: Run parser and resolve tests**

Run: `cd packages/core && bun vitest --run tests/unit/changeset/parser.test.ts tests/unit/changeset/resolve.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/changeset/parser.ts packages/core/src/changeset/resolve.ts packages/core/tests/unit/changeset/parser.test.ts packages/core/tests/unit/changeset/resolve.test.ts
git commit -m "feat(core): change Release.name to Release.path with key resolver"
```

---

### Task 4: Update changeset writer, status, version, changelog, reader

This task propagates `release.name` → `release.path` through the rest of the changeset module.

**Files:**
- Modify: `packages/core/src/changeset/writer.ts:84-123`
- Modify: `packages/core/src/changeset/status.ts:1-45`
- Modify: `packages/core/src/changeset/version.ts:1-51`
- Modify: `packages/core/src/changeset/changelog.ts:53-72`
- Modify: `packages/core/src/changeset/reader.ts:1-43`
- Modify: `packages/core/src/changeset/index.ts`
- Modify: `packages/core/tests/unit/changeset/writer.test.ts`
- Modify: `packages/core/tests/unit/changeset/status.test.ts`
- Modify: `packages/core/tests/unit/changeset/version.test.ts`
- Modify: `packages/core/tests/unit/changeset/changelog.test.ts`
- Modify: `packages/core/tests/unit/changeset/reader.test.ts`

- [ ] **Step 1: Update writer.ts**

In `packages/core/src/changeset/writer.ts`, change `release.name` to `release.path` in `generateChangesetContent()`:
```typescript
// Line 93: yamlObj[release.name] → yamlObj[release.path]
yamlObj[release.path] = release.type;
```

- [ ] **Step 2: Update writer tests**

In `packages/core/tests/unit/changeset/writer.test.ts`, update all Release objects from `{ name: "..." }` to `{ path: "..." }`.

- [ ] **Step 3: Run writer tests**

Run: `cd packages/core && bun vitest --run tests/unit/changeset/writer.test.ts`
Expected: PASS

- [ ] **Step 4: Update version.ts — add resolveKey param + release.path**

In `packages/core/src/changeset/version.ts`:
- Add `resolveKey` parameter to `calculateVersionBumps` and pass it to `readChangesets`
- Change all `release.name` to `release.path`

```typescript
export function calculateVersionBumps(
  currentVersions: Map<string, string>,
  cwd: string = process.cwd(),
  resolveKey?: (key: string) => string,
): Map<string, VersionBump> {
  const changesets = readChangesets(cwd, resolveKey);
  // ... rest uses release.path instead of release.name
```

- [ ] **Step 5: Update version tests**

In `packages/core/tests/unit/changeset/version.test.ts`, update test data and assertions from name to path.

- [ ] **Step 6: Run version tests**

Run: `cd packages/core && bun vitest --run tests/unit/changeset/version.test.ts`
Expected: PASS

- [ ] **Step 7: Update status.ts — add resolveKey param + release.path**

In `packages/core/src/changeset/status.ts`:
- Add `resolveKey` parameter to `getStatus` and pass it to `readChangesets`
- Change all `release.name` to `release.path`

```typescript
export function getStatus(
  cwd: string = process.cwd(),
  resolveKey?: (key: string) => string,
): Status {
  const changesets = readChangesets(cwd, resolveKey);
  // ... rest uses release.path instead of release.name
```

- [ ] **Step 8: Update status tests**

In `packages/core/tests/unit/changeset/status.test.ts`, update test data and assertions from name to path.

- [ ] **Step 9: Run status tests**

Run: `cd packages/core && bun vitest --run tests/unit/changeset/status.test.ts`
Expected: PASS

- [ ] **Step 10: Update changelog.ts**

In `packages/core/src/changeset/changelog.ts`:
```typescript
// Line 55: packageName → packagePath
export function buildChangelogEntries(
  changesets: Changeset[],
  packagePath: string,
): ChangelogEntry[] {
  // Line 61: release.name === packageName → release.path === packagePath
  if (release.path === packagePath) {
```

- [ ] **Step 11: Update changelog tests (release objects use `path`, parameter renamed to `packagePath`)**

In `packages/core/tests/unit/changeset/changelog.test.ts`, update test data (Release objects use `path`) and parameter names.

- [ ] **Step 12: Run changelog tests**

Run: `cd packages/core && bun vitest --run tests/unit/changeset/changelog.test.ts`
Expected: PASS

- [ ] **Step 13: Update reader.ts — add resolveKey parameter**

In `packages/core/src/changeset/reader.ts`:
```typescript
export function readChangesets(
  cwd: string = process.cwd(),
  resolveKey?: (key: string) => string,
): Changeset[] {
  // ...
  changesets.push(parseChangeset(content, file, resolveKey));
  // ...
}
```

- [ ] **Step 14: Update reader tests if needed**

Check `packages/core/tests/unit/changeset/reader.test.ts` — if tests create changeset files with name-based YAML, add resolver or update to path-based YAML.

- [ ] **Step 15: Update changeset/index.ts**

Add exports for new modules:
```typescript
export { createKeyResolver } from "./resolve.js";
```

- [ ] **Step 16: Run all changeset tests**

Run: `cd packages/core && bun vitest --run tests/unit/changeset/`
Expected: PASS

- [ ] **Step 17: Commit**

```bash
git add packages/core/src/changeset/ packages/core/tests/unit/changeset/
git commit -m "feat(core): propagate Release.path through changeset module"
```

---

### Task 5: Update required-missing-information.ts to path-based Maps

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`

- [ ] **Step 1: Create resolver and pass to getStatus/calculateVersionBumps**

At every call site in this file where `getStatus(cwd)` or `calculateVersionBumps(currentVersions, cwd)` is called, pass the resolver:

```typescript
import { createKeyResolver } from "../changeset/resolve.js";

// Build resolver from ctx.config.packages
const resolver = createKeyResolver(ctx.config.packages);
const status = getStatus(cwd, resolver);
const bumps = calculateVersionBumps(currentVersions, cwd, resolver);
```

- [ ] **Step 2: Update single-package changeset lookup (line 271-289)**

```typescript
// Before
const pkgName = pkg?.name ?? "";
const currentVersions = new Map([[pkgName, currentVersion]]);
const bumps = calculateVersionBumps(currentVersions, cwd);
const bump = bumps.get(pkgName);
const pkgStatus = status.packages.get(pkgName);

// After
const pkgPath = pkg?.path ?? "";
const currentVersions = new Map([[pkgPath, currentVersion]]);
const bumps = calculateVersionBumps(currentVersions, cwd, resolver);
const bump = bumps.get(pkgPath);
const pkgStatus = status.packages.get(pkgPath);
```
Keep `pkg?.name` for display strings only.

- [ ] **Step 3: Update multi-package changeset lookup (line 378)**

```typescript
// Before
const currentVersions = new Map(packageInfos.map((p) => [p.name, p.version]));
// After
const currentVersions = new Map(packageInfos.map((p) => [p.path, p.version]));
```

- [ ] **Step 4: Update promptChangesetRecommendations (line 430-490)**

Change these Map lookups from `pkg.name` to `pkg.path`:
- `bumps.get(pkg.name)` → `bumps.get(pkg.path)`
- `status.packages.get(pkg.name)` → `status.packages.get(pkg.path)`
- `notes.set(pkg.name, ...)` → `notes.set(pkg.path, ...)`

Keep `pkg.name` in display template literals (e.g., line 439 format string).

- [ ] **Step 5: Update independent version prompts (line 640-700)**

Change these Map operations from `pkg.name` to `pkg.path`:
- `bumps?.get(pkg.name)` → `bumps?.get(pkg.path)`
- `notes.set(pkg.name, ...)` → `notes.set(pkg.path, ...)`
- `versions.set(pkg.name, ...)` → `versions.set(pkg.path, ...)`
- `bumpedPackages.add(pkg.name)` → `bumpedPackages.add(pkg.path)`
- `activePackage: pkg.name` → `activePackage: pkg.path`

Trace `versions` Map downstream — it's consumed by `plan.packages` in runner.ts, which already uses path keys.

- [ ] **Step 6: Update renderPackageVersionSummary**

This function receives Maps for `currentVersions`, `selectedVersions`, `notes`, and `activePackage`. Update all callers to pass path-keyed values. Inside the function, lookups should use `pkg.path`. Display should use `pkg.name`.

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `cd packages/core && bun vitest --run`
Expected: PASS (or identify which tests need updating)

- [ ] **Step 7: Fix any broken tests**

Update test fixtures in `packages/core/tests/unit/tasks/` if they exist and use name-keyed Maps.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/tasks/required-missing-information.ts
git commit -m "refactor(core): switch required-missing-information to path-based Maps"
```

---

### Task 6: Update runner.ts changelog + GitHub Release call sites

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:1050-1200` (changelog), `packages/core/src/tasks/runner.ts:725-850` (GitHub Release)
- Modify: `packages/core/src/tasks/github-release.ts:67-187`
- Modify: `packages/core/src/assets/types.ts:81-87`

- [ ] **Step 1: Pass resolver to readChangesets calls in runner.ts**

Three `readChangesets(process.cwd())` calls (lines 1053, 1118, 1186) need the resolver:
```typescript
import { createKeyResolver } from "../changeset/resolve.js";

const resolver = createKeyResolver(ctx.config.packages);
const changesets = readChangesets(process.cwd(), resolver);
```

- [ ] **Step 2: Update buildChangelogEntries call sites in runner.ts**

Three call sites need updating:

**Single mode (line ~1055):**
```typescript
// Before: buildChangelogEntries(changesets, pkgName)
// After:
const pkgPath = ctx.config.packages[0]?.path ?? "";
const entries = buildChangelogEntries(changesets, pkgPath);
```

**Fixed mode (line ~1120-1125):**
```typescript
// Before: buildChangelogEntries(changesets, getPackageName(ctx, pkgPath))
// After:
buildChangelogEntries(changesets, pkgPath)
```

**Independent mode (line ~1188-1192):**
```typescript
// Before: buildChangelogEntries(changesets, pkgName) where pkgName = getPackageName(ctx, pkgPath)
// After:
const entries = buildChangelogEntries(changesets, pkgPath);
```

- [ ] **Step 2: Update ReleaseContext.packageName in assets/types.ts**

```typescript
// Before
export interface ReleaseContext {
  packageName: string;
  // ...
}

// After
export interface ReleaseContext {
  displayLabel: string;
  // ...
}
```

- [ ] **Step 3: Update createGitHubRelease in github-release.ts**

```typescript
// Change options.packageName to options.displayLabel
export async function createGitHubRelease(
  _ctx: PubmContext,
  options: {
    displayLabel: string;  // was packageName
    version: string;
    tag: string;
    changelogBody?: string;
    assets: PreparedAsset[];
  },
): Promise<ReleaseContext | null> {
  // ...
  return {
    displayLabel: options.displayLabel,  // was packageName
    // ...
  };
}
```

- [ ] **Step 4: Update createGitHubRelease call sites in runner.ts**

Where `packageName` is passed to `createGitHubRelease`, use descriptor's `displayLabel` instead:

```typescript
// Use getPackageName for now as display fallback, or build descriptor
const result = await createGitHubRelease(ctx, {
  displayLabel: getPackageName(ctx, pkgPath),  // was packageName
  version,
  tag,
  // ...
});
```

- [ ] **Step 5: Update any plugin consumers of ReleaseContext.packageName**

Search for `packageName` usage in plugin code (`packages/plugins/`). Update references to `displayLabel`.

- [ ] **Step 6: Run full test suite**

Run: `cd packages/core && bun vitest --run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tasks/runner.ts packages/core/src/tasks/github-release.ts packages/core/src/assets/types.ts
git commit -m "refactor(core): use path-based changelog lookups and displayLabel for GitHub Release"
```

---

### Task 7: Update version-cmd.ts to path-based Maps

**Files:**
- Modify: `packages/pubm/src/commands/version-cmd.ts:1-203`

- [ ] **Step 1: Update currentVersions Map key from name to path**

```typescript
// Line 47-48: Before
const currentVersions = new Map(config.packages.map((p) => [p.name, p.version]));
// After
const currentVersions = new Map(config.packages.map((p) => [p.path, p.version]));
```

- [ ] **Step 2: Create and pass resolver to calculateVersionBumps**

```typescript
import { createKeyResolver } from "@pubm/core";

const resolver = createKeyResolver(config.packages);
const bumps = calculateVersionBumps(currentVersions, cwd, resolver);
```

- [ ] **Step 3: Update group resolution to use path keys**

Line 64: `const allPackages = [...currentVersions.keys()]` — already returns paths after Step 1. But `applyFixedGroup` and `applyLinkedGroup` in `groups.ts` use name-based keys. Since groups are out of scope (spec says "dependency graph stays name-based"), these functions still expect name keys.

Solution: keep a separate name-keyed collection for group resolution only:
```typescript
const allPackageNames = config.packages.map((p) => p.name);
const resolvedFixed = resolveGroups(config.fixed, allPackageNames);
```

- [ ] **Step 4: Update buildChangelogEntries call**

```typescript
// Line 95: Before
const entries = buildChangelogEntries(changesets, name);
// After — `name` here is a bumps Map key, which is now a path
const entries = buildChangelogEntries(changesets, pkgPath);
```

Where `pkgPath` comes from iterating `bumps` (whose keys are now paths).

- [ ] **Step 5: Update package lookup from bumps**

```typescript
// Line 104: Before
const pkgConfig = config.packages.find((p) => p.name === name);
// After — bumps keys are paths
const pkgConfig = config.packages.find((p) => p.path === pkgPath);
```

- [ ] **Step 6: Update buildEcosystems function**

```typescript
// Line 145-146: Before
for (const [name] of bumps) {
  const pkg = packages.find((p) => p.name === name);
// After
for (const [pkgPath] of bumps) {
  const pkg = packages.find((p) => p.path === pkgPath);
```

- [ ] **Step 7: Update display output to use name for user-facing strings**

```typescript
// Line 90-91: display still shows name
const displayName = pkgConfig?.name ?? pkgPath;
console.log(`${displayName}: ${bump.currentVersion} → ${newVersion} (${bump.bumpType})`);
```

- [ ] **Step 8: Pass resolver to readChangesets**

```typescript
// Line 40: Before
const changesets = readChangesets(cwd);
// After
const resolver = createKeyResolver(config.packages);
const changesets = readChangesets(cwd, resolver);
```

- [ ] **Step 9: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/pubm/src/commands/version-cmd.ts
git commit -m "refactor(cli): switch version-cmd to path-based changeset Maps"
```

---

### Task 8: Update CLI add command

**Files:**
- Modify: `packages/pubm/src/commands/add.ts:1-136`

- [ ] **Step 1: Update non-interactive mode to accept name or path**

In `packages/pubm/src/commands/add.ts`, the `--packages` option currently passes names directly to `Release.name`. Update to use `Release.path`:

```typescript
// The resolver converts name→path if needed
const resolver = createKeyResolver(config.packages);
const releases = packages.map((input: string) => ({
  path: resolver(input),
  type: options.bump as BumpType,
}));
```

Import `createKeyResolver` from `@pubm/core`.

- [ ] **Step 2: Update interactive mode to store path in Release**

In the interactive selection loop (~line 109-120):
```typescript
// Before: releases.push({ name: pkg.name, type: bumpType as BumpType });
// After:
releases.push({ path: pkg.path, type: bumpType as BumpType });
```

Keep `pkg.name` for display in prompts (message strings).

- [ ] **Step 3: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/pubm/src/commands/add.ts
git commit -m "feat(cli): update add command to use path-based Release"
```

---

### Task 10: Update plugin-brew to use displayLabel

**Files:**
- Modify: `packages/plugins/plugin-brew/src/brew-core.ts:60-64`
- Modify: `packages/plugins/plugin-brew/src/brew-tap.ts:57-61`

- [ ] **Step 1: Update brew-core.ts**

```typescript
// Line 62: Before
releaseCtx.packageName !== options.packageName
// After
releaseCtx.displayLabel !== options.packageName
```

Note: `options.packageName` is a user-configured filter string — it stays as-is. Only the `releaseCtx` field name changes.

- [ ] **Step 2: Update brew-tap.ts**

```typescript
// Line 59: Before
releaseCtx.packageName !== options.packageName
// After
releaseCtx.displayLabel !== options.packageName
```

- [ ] **Step 3: Update plugin-brew tests if they reference ReleaseContext.packageName**

Search `packages/plugins/plugin-brew/tests/` for `packageName` in test fixtures and update to `displayLabel`.

- [ ] **Step 4: Run plugin-brew tests**

Run: `cd packages/plugins/plugin-brew && bun vitest --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/plugin-brew/
git commit -m "refactor(plugin-brew): use ReleaseContext.displayLabel"
```

---

### Task 11: Export new types + final integration

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/changeset/index.ts`

- [ ] **Step 1: Update exports in changeset/index.ts**

Ensure `createKeyResolver` is exported:
```typescript
export { createKeyResolver } from "./resolve.js";
```

- [ ] **Step 2: Update exports in core index.ts**

Export descriptor types:
```typescript
export { EcosystemDescriptor } from "./ecosystem/descriptor.js";
export { JsEcosystemDescriptor } from "./ecosystem/js-descriptor.js";
export { RustEcosystemDescriptor } from "./ecosystem/rust-descriptor.js";
```

- [ ] **Step 3: Run full pre-commit checklist**

```bash
bun run format
bun run typecheck
bun run test
bun run coverage
```
Expected: ALL PASS

- [ ] **Step 4: Fix any remaining failures**

Address test failures, type errors, or coverage drops.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/changeset/index.ts
git commit -m "feat(core): export EcosystemDescriptor and createKeyResolver"
```
