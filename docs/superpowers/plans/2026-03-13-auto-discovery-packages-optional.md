# Auto-Discovery: Make `packages` Optional — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `packages` config optional by auto-discovering publishable packages from workspace configuration, extending workspace detection to Cargo/Deno/Bun, and filtering private packages.

**Architecture:** `resolveConfig` becomes async and calls `discoverPackages` when `packages` is unset. `detectWorkspace` returns an array of all detected workspaces (supporting polyglot monorepos). `discoverPackages` filters out private/unpublishable packages and falls back to cwd as a single package when no workspace is found.

**Tech Stack:** TypeScript, Vitest, `smol-toml` (TOML parsing), `jsonc-parser` (JSONC parsing)

**Spec:** `docs/superpowers/specs/2026-03-13-auto-discovery-packages-optional-design.md`

---

## Chunk 1: Workspace Detection Extension

### Task 1: Add dependencies

**Files:**
- Modify: `packages/core/package.json`

Note: `smol-toml` is already a dependency. Only `jsonc-parser` needs to be added.

- [ ] **Step 1: Install jsonc-parser**

```bash
cd packages/core && bun add jsonc-parser
```

- [ ] **Step 2: Verify installation**

```bash
cd packages/core && bun run build
```
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json bun.lockb
git commit -m "deps: add jsonc-parser for Deno workspace detection"
```

### Task 2: Extend `WorkspaceInfo` type and return array

**Files:**
- Modify: `packages/core/src/monorepo/workspace.ts`
- Test: `packages/core/tests/unit/monorepo/workspace.test.ts`

- [ ] **Step 1: Write failing tests for new return type**

In `packages/core/tests/unit/monorepo/workspace.test.ts`, the existing tests assert `detectWorkspace` returns a single `WorkspaceInfo | null`. Update all existing tests to expect `WorkspaceInfo[]` instead:

```typescript
// Change all existing test expectations from:
expect(result).toBeNull();
// To:
expect(result).toEqual([]);

// And from:
expect(result).toEqual({ type: "pnpm", patterns: ["packages/*"] });
// To:
expect(result).toEqual([{ type: "pnpm", patterns: ["packages/*"] }]);
```

Update every existing test case to match the new array return type.

**Important:** The "pnpm-workspace.yaml takes priority" test (currently asserts `readFileSync` called once) must be rewritten. With the array return, `detectWorkspace` no longer returns early — it checks all workspace files. Rewrite this test to verify that when pnpm is found, the JS workspace detection is skipped (no npm/yarn/bun in the result), but Cargo/Deno detection still runs:

```typescript
it("skips JS workspace detection when pnpm-workspace.yaml is found", () => {
  mockedExistsSync.mockImplementation((p) =>
    String(p).endsWith("pnpm-workspace.yaml") ||
    String(p).endsWith("package.json"),
  );
  mockedReadFileSync.mockImplementation((p) => {
    if (String(p).endsWith("pnpm-workspace.yaml")) return "packages:\n  - libs/*\n";
    return JSON.stringify({ workspaces: ["packages/*"] });
  });
  mockedYamlParse.mockReturnValue({ packages: ["libs/*"] });

  const result = detectWorkspace("/project");

  expect(result).toEqual([{ type: "pnpm", patterns: ["libs/*"] }]);
  // package.json workspaces should NOT produce an npm/bun entry
  expect(result.some((w) => w.type === "npm" || w.type === "bun")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/core && bun vitest --run tests/unit/monorepo/workspace.test.ts
```
Expected: All existing tests FAIL (return type mismatch)

- [ ] **Step 3: Update `detectWorkspace` to return `WorkspaceInfo[]`**

In `packages/core/src/monorepo/workspace.ts`:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseJsonc } from "jsonc-parser";
import { parse } from "yaml";

export interface WorkspaceInfo {
  type: "pnpm" | "npm" | "yarn" | "bun" | "cargo" | "deno";
  patterns: string[];
  exclude?: string[]; // Cargo workspace exclude patterns
}

export function detectWorkspace(cwd?: string): WorkspaceInfo[] {
  const root = cwd ?? process.cwd();
  const workspaces: WorkspaceInfo[] = [];

  // 1. Check pnpm-workspace.yaml
  const pnpmWorkspacePath = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    const content = readFileSync(pnpmWorkspacePath, "utf-8");
    const parsed = parse(content);
    const packages: string[] = parsed?.packages ?? [];
    workspaces.push({ type: "pnpm", patterns: packages });
  }

  // 2. Check Cargo.toml [workspace]
  const cargoTomlPath = join(root, "Cargo.toml");
  if (existsSync(cargoTomlPath)) {
    const content = readFileSync(cargoTomlPath, "utf-8");
    try {
      const parsed = parseToml(content);
      const workspace = parsed.workspace as
        | { members?: string[]; exclude?: string[] }
        | undefined;
      if (workspace?.members && Array.isArray(workspace.members)) {
        workspaces.push({
          type: "cargo",
          patterns: workspace.members,
          ...(workspace.exclude?.length ? { exclude: workspace.exclude } : {}),
        });
      }
    } catch {
      // Invalid TOML or no workspace section
    }
  }

  // 3. Check deno.json / deno.jsonc
  for (const denoFile of ["deno.json", "deno.jsonc"]) {
    const denoPath = join(root, denoFile);
    if (existsSync(denoPath)) {
      const content = readFileSync(denoPath, "utf-8");
      try {
        const parsed = denoFile.endsWith(".jsonc")
          ? parseJsonc(content)
          : JSON.parse(content);
        if (Array.isArray(parsed?.workspace)) {
          // Normalize leading ./ from Deno workspace paths
          const patterns = parsed.workspace.map((p: string) =>
            p.startsWith("./") ? p.slice(2) : p,
          );
          workspaces.push({
            type: "deno",
            patterns,
          });
        }
      } catch {
        // Invalid JSON/JSONC
      }
      break; // Only read one deno config
    }
  }

  // Skip JS workspace detection if pnpm already found (pnpm uses package.json too)
  if (!workspaces.some((w) => w.type === "pnpm")) {
    const packageJsonPath = join(root, "package.json");
    if (existsSync(packageJsonPath)) {
      const content = readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);

      if (pkg.workspaces) {
        // 4. Check bunfig.toml for bun detection
        const bunfigPath = join(root, "bunfig.toml");
        const isBun = existsSync(bunfigPath);

        if (Array.isArray(pkg.workspaces)) {
          workspaces.push({
            type: isBun ? "bun" : "npm",
            patterns: pkg.workspaces,
          });
        } else if (
          typeof pkg.workspaces === "object" &&
          Array.isArray(pkg.workspaces.packages)
        ) {
          workspaces.push({
            type: isBun ? "bun" : "yarn",
            patterns: pkg.workspaces.packages,
          });
        }
      }
    }
  }

  return workspaces;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/core && bun vitest --run tests/unit/monorepo/workspace.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/monorepo/workspace.ts packages/core/tests/unit/monorepo/workspace.test.ts
git commit -m "refactor!: detectWorkspace returns array for polyglot monorepo support

BREAKING CHANGE: detectWorkspace now returns WorkspaceInfo[] instead of WorkspaceInfo | null"
```

### Task 3: Add Cargo workspace detection tests

**Files:**
- Test: `packages/core/tests/unit/monorepo/workspace.test.ts`

- [ ] **Step 1: Write Cargo workspace tests**

Add to `packages/core/tests/unit/monorepo/workspace.test.ts`:

```typescript
// Add mock for smol-toml at the top with other mocks
vi.mock("smol-toml", () => ({
  parse: vi.fn(),
}));

import { parse as parseToml } from "smol-toml";
const mockedParseToml = vi.mocked(parseToml);
```

Add test cases:

```typescript
it("detects Cargo workspace from Cargo.toml", () => {
  mockedExistsSync.mockImplementation((path) =>
    String(path).endsWith("Cargo.toml"),
  );
  mockedReadFileSync.mockReturnValue('[workspace]\nmembers = ["crates/*"]');
  mockedParseToml.mockReturnValue({
    workspace: { members: ["crates/*"] },
  });

  const result = detectWorkspace("/project");

  expect(result).toEqual([
    { type: "cargo", patterns: ["crates/*"] },
  ]);
});

it("ignores Cargo.toml without [workspace] section", () => {
  mockedExistsSync.mockImplementation((path) =>
    String(path).endsWith("Cargo.toml"),
  );
  mockedReadFileSync.mockReturnValue('[package]\nname = "my-crate"');
  mockedParseToml.mockReturnValue({
    package: { name: "my-crate" },
  });

  const result = detectWorkspace("/project");

  expect(result).toEqual([]);
});

it("detects both pnpm and Cargo workspaces in polyglot repo", () => {
  mockedExistsSync.mockImplementation((p) =>
    String(p).endsWith("pnpm-workspace.yaml") ||
    String(p).endsWith("Cargo.toml"),
  );
  mockedReadFileSync.mockImplementation((p) => {
    if (String(p).endsWith("pnpm-workspace.yaml"))
      return "packages:\n  - packages/*\n";
    if (String(p).endsWith("Cargo.toml"))
      return '[workspace]\nmembers = ["crates/*"]';
    return "";
  });
  mockedYamlParse.mockReturnValue({ packages: ["packages/*"] });
  mockedParseToml.mockReturnValue({
    workspace: { members: ["crates/*"] },
  });

  const result = detectWorkspace("/project");

  expect(result).toEqual([
    { type: "pnpm", patterns: ["packages/*"] },
    { type: "cargo", patterns: ["crates/*"] },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd packages/core && bun vitest --run tests/unit/monorepo/workspace.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/unit/monorepo/workspace.test.ts
git commit -m "test: add Cargo workspace detection tests"
```

### Task 4: Add Deno and Bun workspace detection tests

**Files:**
- Test: `packages/core/tests/unit/monorepo/workspace.test.ts`

- [ ] **Step 1: Write Deno and Bun tests**

Add mock for jsonc-parser at top:

```typescript
vi.mock("jsonc-parser", () => ({
  parse: vi.fn(),
}));

import { parse as parseJsonc } from "jsonc-parser";
const mockedParseJsonc = vi.mocked(parseJsonc);
```

Add test cases:

```typescript
it("detects Deno workspace from deno.json and strips ./ prefix", () => {
  mockedExistsSync.mockImplementation((path) =>
    String(path).endsWith("deno.json"),
  );
  mockedReadFileSync.mockReturnValue(
    JSON.stringify({ workspace: ["./packages/add", "./packages/sub"] }),
  );

  const result = detectWorkspace("/project");

  // Leading ./ is stripped for micromatch compatibility
  expect(result).toEqual([
    { type: "deno", patterns: ["packages/add", "packages/sub"] },
  ]);
});

it("detects Deno workspace from deno.jsonc with JSONC parser", () => {
  mockedExistsSync.mockImplementation((path) =>
    String(path).endsWith("deno.jsonc"),
  );
  mockedReadFileSync.mockReturnValue(
    '{ "workspace": ["./packages/*"] /* comment */ }',
  );
  mockedParseJsonc.mockReturnValue({ workspace: ["./packages/*"] });

  const result = detectWorkspace("/project");

  expect(result).toEqual([
    { type: "deno", patterns: ["./packages/*"] },
  ]);
});

it("detects Bun workspace when bunfig.toml exists alongside package.json workspaces", () => {
  mockedExistsSync.mockImplementation(
    (p) =>
      String(p).endsWith("bunfig.toml") ||
      String(p).endsWith("package.json"),
  );
  mockedReadFileSync.mockReturnValue(
    JSON.stringify({ workspaces: ["packages/*"] }),
  );

  const result = detectWorkspace("/project");

  expect(result).toEqual([
    { type: "bun", patterns: ["packages/*"] },
  ]);
});

it("detects npm (not bun) when no bunfig.toml exists", () => {
  mockedExistsSync.mockImplementation(
    (p) =>
      !String(p).endsWith("pnpm-workspace.yaml") &&
      !String(p).endsWith("Cargo.toml") &&
      !String(p).endsWith("deno.json") &&
      !String(p).endsWith("deno.jsonc") &&
      !String(p).endsWith("bunfig.toml") &&
      String(p).endsWith("package.json"),
  );
  mockedReadFileSync.mockReturnValue(
    JSON.stringify({ workspaces: ["packages/*"] }),
  );

  const result = detectWorkspace("/project");

  expect(result).toEqual([
    { type: "npm", patterns: ["packages/*"] },
  ]);
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/core && bun vitest --run tests/unit/monorepo/workspace.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/unit/monorepo/workspace.test.ts
git commit -m "test: add Deno and Bun workspace detection tests"
```

---

## Chunk 2: Discovery Modifications

### Task 5: Update `discoverPackages` for multi-workspace and private filtering

**Files:**
- Modify: `packages/core/src/monorepo/discover.ts`
- Test: `packages/core/tests/unit/monorepo/discover.test.ts`

- [ ] **Step 1: Write failing tests for private package filtering**

Add to `packages/core/tests/unit/monorepo/discover.test.ts`. First update the mock setup — `detectWorkspace` now returns `WorkspaceInfo[]`:

```typescript
// Update the existing mock return values throughout the file.
// Change all:
mockedDetectWorkspace.mockReturnValue({ type: "pnpm", patterns: ["packages/*"] });
// To:
mockedDetectWorkspace.mockReturnValue([{ type: "pnpm", patterns: ["packages/*"] }]);

// Change all:
mockedDetectWorkspace.mockReturnValue(null);
// To:
mockedDetectWorkspace.mockReturnValue([]);
```

Then add a new mock for reading manifests to check private field. We need `readFileSync` from the existing fs mock:

```typescript
// Add readFileSync to the existing fs mock imports at the top
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
const mockedReadFileSync = vi.mocked(readFileSync);
```

Update the fs mock at the top to include `readFileSync`:

```typescript
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));
```

Also mock `smol-toml` for Rust private package checks:

```typescript
vi.mock("smol-toml", () => ({
  parse: vi.fn(),
}));

import { parse as parseToml } from "smol-toml";
const mockedParseToml = vi.mocked(parseToml);
```

Add test cases:

```typescript
it("filters out JS packages with private: true", async () => {
  mockedDetectWorkspace.mockReturnValue([
    { type: "pnpm", patterns: ["packages/*"] },
  ]);
  setupDirectoryEntries(["packages/public-pkg", "packages/private-pkg"]);
  mockedExistsSync.mockImplementation((p) =>
    String(p).endsWith("package.json"),
  );
  mockedReadFileSync.mockImplementation((p) => {
    if (String(p).includes("private-pkg"))
      return JSON.stringify({ name: "private-pkg", private: true });
    return JSON.stringify({ name: "public-pkg" });
  });
  mockedInferRegistries.mockResolvedValue(["npm"]);

  const result = await discoverPackages({ cwd: "/project" });

  expect(result).toHaveLength(1);
  expect(result[0].path).toBe(path.join("packages", "public-pkg"));
});

it("filters out Rust packages with publish = false", async () => {
  mockedDetectWorkspace.mockReturnValue([
    { type: "cargo", patterns: ["crates/*"] },
  ]);
  setupDirectoryEntries(["crates/published", "crates/internal"]);
  mockedExistsSync.mockImplementation((p) =>
    String(p).endsWith("Cargo.toml"),
  );
  mockedReadFileSync.mockReturnValue(""); // Content read by parseToml mock
  mockedParseToml.mockImplementation((_content) => {
    // The mock is called per-file; use call order to differentiate
    // First call = published (no publish field), second = internal (publish = false)
    return { package: { name: "pkg" } };
  });
  // Override parseToml for specific paths by checking readFileSync calls
  let tomlCallCount = 0;
  mockedParseToml.mockImplementation(() => {
    tomlCallCount++;
    if (tomlCallCount === 2) {
      return { package: { name: "internal", publish: false } };
    }
    return { package: { name: "published" } };
  });
  mockedInferRegistries.mockResolvedValue(["crates"]);

  const result = await discoverPackages({ cwd: "/project" });

  expect(result).toHaveLength(1);
  expect(result[0].path).toBe(path.join("crates", "published"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/core && bun vitest --run tests/unit/monorepo/discover.test.ts
```
Expected: New tests FAIL, existing tests may also fail due to `detectWorkspace` return type change

- [ ] **Step 3: Update `discoverPackages` implementation**

In `packages/core/src/monorepo/discover.ts`:

```typescript
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import { parse as parseToml } from "smol-toml";
import type { PackageConfig } from "../config/types.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { inferRegistries } from "../ecosystem/infer.js";
import type { RegistryType } from "../types/options.js";
import { detectWorkspace } from "./workspace.js";

type EcosystemType = "js" | "rust";

export interface DiscoverOptions {
  cwd: string;
  ignore?: string[];
  configPackages?: PackageConfig[];
}

export interface DiscoveredPackage {
  path: string;
  registries: RegistryType[];
  ecosystem: EcosystemType;
}

function detectEcosystem(packageDir: string): EcosystemType | null {
  for (const descriptor of ecosystemCatalog.all()) {
    const eco = new descriptor.ecosystemClass(packageDir);
    const manifests = eco.manifestFiles();
    if (manifests.some((m) => existsSync(path.join(packageDir, m)))) {
      return descriptor.key as EcosystemType;
    }
  }
  return null;
}

function isPrivatePackage(packageDir: string, ecosystem: EcosystemType): boolean {
  if (ecosystem === "js") {
    const pkgJsonPath = path.join(packageDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        return pkg.private === true;
      } catch {
        return false;
      }
    }
  }

  if (ecosystem === "rust") {
    const cargoTomlPath = path.join(packageDir, "Cargo.toml");
    if (existsSync(cargoTomlPath)) {
      try {
        const parsed = parseToml(readFileSync(cargoTomlPath, "utf-8"));
        const pkg = parsed.package as { publish?: boolean | string[] } | undefined;
        if (pkg?.publish === false) return true;
        if (Array.isArray(pkg?.publish) && pkg.publish.length === 0) return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

function matchesIgnore(pkgPath: string, ignorePatterns: string[]): boolean {
  const normalized = toForwardSlash(pkgPath);
  return ignorePatterns.some((pattern) => {
    const regex = new RegExp(
      `^${toForwardSlash(pattern).replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
    );
    return regex.test(normalized);
  });
}

function resolvePatterns(cwd: string, patterns: string[]): string[] {
  const entries = readdirSync(cwd, { recursive: true, encoding: "utf-8" });

  const dirs = entries.filter((entry) => {
    const fullPath = path.join(cwd, entry);
    try {
      return statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });

  const normalizedDirs = dirs.map((d) => d.replace(/\\/g, "/"));
  const matched = micromatch(normalizedDirs, patterns);

  return matched.map((d) => path.resolve(cwd, d));
}

export async function discoverPackages(
  options: DiscoverOptions,
): Promise<DiscoveredPackage[]> {
  const { cwd, ignore = [], configPackages = [] } = options;

  const workspaces = detectWorkspace(cwd);
  const discovered = new Map<string, DiscoveredPackage>();

  // Process all detected workspaces
  for (const workspace of workspaces) {
    if (workspace.patterns.length === 0) continue;
    let dirs = resolvePatterns(cwd, workspace.patterns);

    // Apply Cargo workspace exclude patterns
    if (workspace.exclude?.length) {
      const excludeDirs = new Set(
        resolvePatterns(cwd, workspace.exclude).map((d) => path.resolve(d)),
      );
      dirs = dirs.filter((d) => !excludeDirs.has(path.resolve(d)));
    }

    for (const dir of dirs) {
      const relativePath = path.relative(cwd, dir);
      const key = toForwardSlash(relativePath);
      if (discovered.has(key)) continue; // deduplicate across workspaces
      if (matchesIgnore(relativePath, ignore)) continue;

      const ecosystem = detectEcosystem(dir);
      if (!ecosystem) continue;
      if (isPrivatePackage(dir, ecosystem)) continue;

      discovered.set(key, {
        path: relativePath,
        registries: await inferRegistries(dir, ecosystem, cwd),
        ecosystem,
      });
    }
  }

  // Single-package fallback: no workspace detected and no config packages
  if (workspaces.length === 0 && configPackages.length === 0) {
    const ecosystem = detectEcosystem(cwd);
    if (ecosystem && !isPrivatePackage(cwd, ecosystem)) {
      discovered.set(".", {
        path: ".",
        registries: await inferRegistries(cwd, ecosystem, cwd),
        ecosystem,
      });
    }
  }

  // Merge config packages (config overrides auto-detected)
  for (const configPkg of configPackages) {
    const key = toForwardSlash(configPkg.path);
    const nativePath = path.normalize(configPkg.path);
    const existing = discovered.get(key);

    if (existing) {
      discovered.set(key, {
        ...existing,
        registries: (configPkg.registries ??
          existing.registries) as RegistryType[],
        ecosystem: configPkg.ecosystem ?? existing.ecosystem,
      });
    } else {
      const absPath = path.join(cwd, configPkg.path);
      const ecosystem = configPkg.ecosystem ?? detectEcosystem(absPath);

      if (ecosystem) {
        discovered.set(key, {
          path: nativePath,
          registries: (configPkg.registries ??
            (await inferRegistries(absPath, ecosystem, cwd))) as RegistryType[],
          ecosystem,
        });
      }
    }
  }

  return Array.from(discovered.values());
}
```

- [ ] **Step 4: Run all discover tests**

```bash
cd packages/core && bun vitest --run tests/unit/monorepo/discover.test.ts
```
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/monorepo/discover.ts packages/core/tests/unit/monorepo/discover.test.ts
git commit -m "feat: add private package filtering and single-package fallback to discoverPackages"
```

### Task 6: Add single-package fallback tests

**Files:**
- Test: `packages/core/tests/unit/monorepo/discover.test.ts`

- [ ] **Step 1: Write single-package fallback tests**

```typescript
it("falls back to cwd as single package when no workspace detected", async () => {
  mockedDetectWorkspace.mockReturnValue([]);
  mockedExistsSync.mockImplementation((p) =>
    String(p).endsWith("package.json"),
  );
  mockedReadFileSync.mockReturnValue(
    JSON.stringify({ name: "my-pkg" }),
  );
  mockedInferRegistries.mockResolvedValue(["npm"]);

  const result = await discoverPackages({ cwd: "/project" });

  expect(result).toEqual([
    { path: ".", registries: ["npm"], ecosystem: "js" },
  ]);
});

it("returns empty when single package is private", async () => {
  mockedDetectWorkspace.mockReturnValue([]);
  mockedExistsSync.mockImplementation((p) =>
    String(p).endsWith("package.json"),
  );
  mockedReadFileSync.mockReturnValue(
    JSON.stringify({ name: "my-pkg", private: true }),
  );

  const result = await discoverPackages({ cwd: "/project" });

  expect(result).toEqual([]);
});

it("returns empty when no ecosystem detected at cwd", async () => {
  mockedDetectWorkspace.mockReturnValue([]);
  mockedExistsSync.mockReturnValue(false);

  const result = await discoverPackages({ cwd: "/project" });

  expect(result).toEqual([]);
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/core && bun vitest --run tests/unit/monorepo/discover.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/unit/monorepo/discover.test.ts
git commit -m "test: add single-package fallback tests for discoverPackages"
```

---

## Chunk 3: Config Resolution & Integration

### Task 7: Make `resolveConfig` async with discovery integration

**Files:**
- Modify: `packages/core/src/config/defaults.ts`
- Modify: `packages/core/src/config/types.ts`
- Test: `packages/core/tests/unit/config/defaults.test.ts`

- [ ] **Step 1: Add `discoveryEmpty` flag to `ResolvedPubmConfig`**

In `packages/core/src/config/types.ts`, add the flag:

```typescript
export interface ResolvedPubmConfig
  extends Required<Omit<PubmConfig, "packages" | "validate" | "registries">> {
  packages: PackageConfig[];
  validate: Required<ValidateConfig>;
  discoveryEmpty?: boolean;
}
```

- [ ] **Step 2: Write failing tests for async resolveConfig**

In `packages/core/tests/unit/config/defaults.test.ts`, update all test calls from sync to async:

```typescript
// Change all:
const resolved = resolveConfig({});
// To:
const resolved = await resolveConfig({});

// Mark all test functions as async:
it("returns full defaults when no config provided", async () => {
```

Add the discoverPackages mock at the top:

```typescript
vi.mock("../../../src/monorepo/discover.js", () => ({
  discoverPackages: vi.fn(),
}));

import { discoverPackages } from "../../../src/monorepo/discover.js";
const mockedDiscoverPackages = vi.mocked(discoverPackages);
```

Add new test cases:

```typescript
it("calls discoverPackages when packages not specified", async () => {
  mockedDiscoverPackages.mockResolvedValue([
    { path: "packages/a", registries: ["npm"], ecosystem: "js" },
  ]);

  const resolved = await resolveConfig({}, "/project");

  expect(mockedDiscoverPackages).toHaveBeenCalledWith({ cwd: "/project" });
  expect(resolved.packages).toEqual([
    { path: "packages/a", registries: ["npm"], ecosystem: "js" },
  ]);
});

it("sets discoveryEmpty when no packages discovered", async () => {
  mockedDiscoverPackages.mockResolvedValue([]);

  const resolved = await resolveConfig({}, "/project");

  expect(resolved.discoveryEmpty).toBe(true);
  expect(resolved.packages).toEqual([]);
});

it("does not call discoverPackages when packages are specified", async () => {
  const resolved = await resolveConfig({
    packages: [{ path: "my-pkg" }],
  });

  expect(mockedDiscoverPackages).not.toHaveBeenCalled();
  expect(resolved.packages).toEqual([{ path: "my-pkg" }]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/core && bun vitest --run tests/unit/config/defaults.test.ts
```
Expected: FAIL

- [ ] **Step 4: Implement async `resolveConfig`**

In `packages/core/src/config/defaults.ts`:

```typescript
import { discoverPackages } from "../monorepo/discover.js";
import {
  registerPrivateRegistry,
  registryCatalog,
} from "../registry/catalog.js";
import type {
  PrivateRegistryConfig,
  PubmConfig,
  ResolvedPubmConfig,
  ValidateConfig,
} from "./types.js";

const defaultValidate: Required<ValidateConfig> = {
  cleanInstall: true,
  entryPoints: true,
  extraneousFiles: true,
};

const defaultConfig = {
  versioning: "independent" as const,
  branch: "main",
  changelog: true as boolean | string,
  changelogFormat: "default" as string,
  commit: false,
  access: "public" as const,
  fixed: [] as string[][],
  linked: [] as string[][],
  updateInternalDependencies: "patch" as const,
  ignore: [] as string[],
  snapshotTemplate: "{tag}-{timestamp}",
  tag: "latest",
  contents: ".",
  saveToken: true,
  releaseDraft: true,
  releaseNotes: true,
  rollbackStrategy: "individual" as const,
};

export async function resolveConfig(
  config: PubmConfig,
  cwd?: string,
): Promise<ResolvedPubmConfig> {
  if (config.registries) {
    console.warn(
      '[pubm] The global "registries" field is deprecated. Registries are now inferred from manifest files or specified per-package in the "packages" array.',
    );
  }

  const { registries: _ignored, ...configWithoutRegistries } = config;

  let packages: PubmConfig["packages"];
  let discoveryEmpty: boolean | undefined;

  if (config.packages) {
    // Explicit packages: normalize registries
    packages = config.packages.map((pkg) => {
      if (!pkg.registries) return pkg;

      const normalizedRegistries = pkg.registries.map((entry) => {
        if (typeof entry === "string") return entry;
        const ecosystemKey = resolveEcosystemKey(pkg, entry);
        return registerPrivateRegistry(entry, ecosystemKey);
      });

      return { ...pkg, registries: normalizedRegistries };
    });
  } else {
    // Auto-discover packages
    const resolvedCwd = cwd ?? process.cwd();
    const discovered = await discoverPackages({ cwd: resolvedCwd });

    if (discovered.length === 0) {
      discoveryEmpty = true;
      packages = [];
    } else {
      packages = discovered.map((d) => ({
        path: d.path,
        registries: d.registries,
        ecosystem: d.ecosystem,
      }));
    }
  }

  return {
    ...defaultConfig,
    ...configWithoutRegistries,
    packages,
    validate: { ...defaultValidate, ...config.validate },
    snapshotTemplate: config.snapshotTemplate ?? defaultConfig.snapshotTemplate,
    plugins: config.plugins ?? [],
    ...(discoveryEmpty ? { discoveryEmpty } : {}),
  };
}

function resolveEcosystemKey(
  pkg: { ecosystem?: string; registries?: (string | PrivateRegistryConfig)[] },
  _entry: PrivateRegistryConfig,
): string {
  if (pkg.ecosystem) return pkg.ecosystem;

  const firstStringRegistry = pkg.registries?.find(
    (r): r is string => typeof r === "string",
  );
  if (firstStringRegistry) {
    const descriptor = registryCatalog.get(firstStringRegistry);
    if (descriptor) return descriptor.ecosystem;
  }

  return "js";
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/core && bun vitest --run tests/unit/config/defaults.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/defaults.ts packages/core/src/config/types.ts packages/core/tests/unit/config/defaults.test.ts
git commit -m "feat!: make resolveConfig async with auto-discovery integration

BREAKING CHANGE: resolveConfig now returns Promise<ResolvedPubmConfig> instead of ResolvedPubmConfig"
```

### Task 8: Update callers of `resolveConfig` and `detectWorkspace`

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/changeset/packages.ts`

- [ ] **Step 1: Update `pubm()` in `index.ts`**

In `packages/core/src/index.ts`, change the `pubm` function:

```typescript
export async function pubm(options: Options): Promise<void> {
  const config = await loadConfig();
  const plugins = config?.plugins ?? [];
  const pluginRunner = new PluginRunner(plugins);
  const configOptions: Partial<Options> = {};

  if (config) {
    const resolved = await resolveConfig(config);
    if (resolved.discoveryEmpty) {
      throw new Error(
        "[pubm] No publishable packages found. Add a pubm.config.ts with a packages array, or ensure your workspace contains non-private packages.",
      );
    }
    if (resolved.packages) {
      configOptions.packages = resolved.packages;
    }
  }

  const resolvedOptions = resolveOptions({ ...configOptions, ...options });

  await run({ ...resolvedOptions, pluginRunner });
}
```

- [ ] **Step 2: Simplify `changeset/packages.ts`**

With single-package fallback now built into `discoverPackages`, the `else` branches in `discoverCurrentVersions` and `discoverPackageInfos` become dead code when called without config. However, keep them as safety fallbacks for now — no change needed since the functions still work correctly. The `discoverPackages` fallback just means the `discovered.length > 0` branch will now cover single packages too.

No code changes needed here — the existing fallback is harmless and provides defense-in-depth.

- [ ] **Step 3: Update any other callers of `detectWorkspace` that expect single result**

Search for all callers:

```bash
cd packages/core && grep -rn "detectWorkspace" src/ --include="*.ts" | grep -v "workspace.ts"
```

Update `discover.ts` — already done in Task 5. Check if there are other callers and update them to handle the array return.

- [ ] **Step 4: Run full test suite**

```bash
cd packages/core && bun vitest --run
```
Expected: All PASS

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: handle discoveryEmpty in pubm entry point"
```

### Task 8.5: Verify and update `packages/pubm/src/commands/add.ts`

**Files:**
- Modify: `packages/pubm/src/commands/add.ts` (if needed)

The `add` command calls `discoverPackages({ cwd })` at line 50. With the single-package fallback now built into `discoverPackages`, the `else` branch (when `discovered.length === 0`) that falls back to reading the root `package.json` may become dead code for most scenarios.

- [ ] **Step 1: Review current `add.ts` behavior**

Read `packages/pubm/src/commands/add.ts` and identify the `discovered.length === 0` fallback branch.

- [ ] **Step 2: Keep existing fallback as defense-in-depth**

No code changes needed — the existing fallback is harmless and provides safety for edge cases where `discoverPackages` returns empty (e.g., no ecosystem detected). The behavioral change is that single-package repos now get discovered automatically, so the fallback triggers less often.

- [ ] **Step 3: Run the CLI typecheck to verify no type errors**

```bash
bun run typecheck
```
Expected: No type errors (the `discoverPackages` return type hasn't changed)

---

## Chunk 4: Documentation & Cleanup

### Task 9: Update documentation — remove ecosystem examples

**Files:**
- Modify: `website/src/content/docs/reference/config.mdx`

- [ ] **Step 1: Remove ecosystem field from PackageConfig interface example**

In `website/src/content/docs/reference/config.mdx` around line 254, remove the `ecosystem` line from the interface:

```typescript
interface PackageConfig {
  path: string;
  registries?: Array<"npm" | "jsr" | "crates" | PrivateRegistryConfig>;
  buildCommand?: string;
  testCommand?: string;
}
```

- [ ] **Step 2: Remove ecosystem field documentation section**

Remove lines ~299-304 (the `### ecosystem` section):

```markdown
### `ecosystem`

- Type: `"js" | "rust"`
- Required: no

Use this when the package type cannot be inferred reliably from the path and manifest files alone.
```

- [ ] **Step 3: Add auto-discovery note to the `packages` field documentation**

Find the `### packages` section and add a note about auto-discovery behavior:

```markdown
When omitted, `pubm` auto-discovers packages from your workspace configuration:

- `pnpm-workspace.yaml` (pnpm)
- `package.json` workspaces (npm, yarn, bun)
- `Cargo.toml` [workspace] (Rust)
- `deno.json` workspace (Deno)

Private packages (`"private": true` in `package.json`, `publish = false` in `Cargo.toml`) are automatically excluded.
```

- [ ] **Step 4: Commit**

```bash
git add website/src/content/docs/reference/config.mdx
git commit -m "docs: remove ecosystem field examples, add auto-discovery documentation"
```

### Task 10: Update translated documentation

**Files:**
- Modify: `website/src/content/docs/ko/reference/config.mdx`
- Modify: `website/src/content/docs/zh-cn/reference/config.mdx`

- [ ] **Step 1: Check and update Korean config reference**

Check if ecosystem is mentioned in the Korean config reference. If it references `PackageConfig` with ecosystem, remove it. Add the auto-discovery note in Korean.

- [ ] **Step 2: Check and update Chinese config reference**

Same as above for Chinese.

- [ ] **Step 3: Commit**

```bash
git add website/src/content/docs/ko/reference/config.mdx website/src/content/docs/zh-cn/reference/config.mdx
git commit -m "docs: update translated config references for auto-discovery"
```

### Task 11: Format, typecheck, test

**Files:** None (verification only)

- [ ] **Step 1: Run formatter**

```bash
bun run format
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```
Expected: No errors

- [ ] **Step 3: Run full test suite**

```bash
bun run test
```
Expected: All pass

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add packages/ website/ && git commit -m "style: apply formatting fixes"
```
(Only if there are changes)
