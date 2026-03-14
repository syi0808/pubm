# ManifestReader + Package Discovery Unification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate fragmented package discovery, manifest reading, and version writing into a unified architecture using ManifestReader with schema injection, Registry-owned readers, and Ecosystem delegation.

**Architecture:** ManifestReader is a single class that reads manifests via injected schemas (file, parser, field extractors). Each Registry class owns a static ManifestReader instance. Ecosystem delegates manifest reading through its associated registries. Config resolution populates `ResolvedPackageConfig[]` with name/version upfront, eliminating re-discovery at runtime.

**Tech Stack:** TypeScript, Bun, Vitest, Biome

**Spec:** `docs/superpowers/specs/2026-03-14-manifest-reader-package-discovery-unification-design.md`

**Pre-commit checklist (run after every commit):**
```bash
bun run format && bun run typecheck && bun run test
```

---

## Chunk 1: ManifestReader + Types Foundation

### Task 1: Create ManifestReader class

**Files:**
- Create: `packages/core/src/manifest/manifest-reader.ts`
- Test: `packages/core/tests/unit/manifest/manifest-reader.test.ts`

- [ ] **Step 1: Write failing tests for ManifestReader**

```typescript
// packages/core/tests/unit/manifest/manifest-reader.test.ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ManifestReader,
  type ManifestSchema,
} from "../../../src/manifest/manifest-reader.js";

const tmpDir = path.join(import.meta.dirname, "__fixtures__/manifest-reader");

const jsonSchema: ManifestSchema = {
  file: "package.json",
  parser: JSON.parse,
  fields: {
    name: (p) => (p.name as string) ?? "",
    version: (p) => (p.version as string) ?? "0.0.0",
    private: (p) => p.private === true,
    dependencies: (p) =>
      Object.keys((p.dependencies as Record<string, string>) ?? {}),
  },
};

describe("ManifestReader", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  describe("read", () => {
    it("reads and parses a manifest file", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-pkg",
          version: "1.2.3",
          dependencies: { foo: "^1.0.0" },
        }),
      );

      const reader = new ManifestReader(jsonSchema);
      const manifest = await reader.read(tmpDir);

      expect(manifest).toEqual({
        name: "test-pkg",
        version: "1.2.3",
        private: false,
        dependencies: ["foo"],
      });
    });

    it("caches results for same path", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "cached", version: "1.0.0" }),
      );

      const reader = new ManifestReader(jsonSchema);
      const first = await reader.read(tmpDir);
      // Modify file after first read
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "changed", version: "2.0.0" }),
      );
      const second = await reader.read(tmpDir);

      expect(first).toBe(second); // Same reference (cached)
      expect(second.name).toBe("cached");
    });

    it("throws when manifest file does not exist", async () => {
      const reader = new ManifestReader(jsonSchema);
      await expect(reader.read(tmpDir)).rejects.toThrow();
    });

    it("uses fallback values for missing fields", async () => {
      writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({}));

      const reader = new ManifestReader(jsonSchema);
      const manifest = await reader.read(tmpDir);

      expect(manifest.name).toBe("");
      expect(manifest.version).toBe("0.0.0");
      expect(manifest.private).toBe(false);
      expect(manifest.dependencies).toEqual([]);
    });
  });

  describe("exists", () => {
    it("returns true when manifest file exists", async () => {
      writeFileSync(path.join(tmpDir, "package.json"), "{}");
      const reader = new ManifestReader(jsonSchema);
      expect(await reader.exists(tmpDir)).toBe(true);
    });

    it("returns false when manifest file does not exist", async () => {
      const reader = new ManifestReader(jsonSchema);
      expect(await reader.exists(tmpDir)).toBe(false);
    });
  });

  describe("invalidate", () => {
    it("clears cached entry for a specific path", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "original", version: "1.0.0" }),
      );

      const reader = new ManifestReader(jsonSchema);
      await reader.read(tmpDir);

      // Modify and invalidate
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "updated", version: "2.0.0" }),
      );
      reader.invalidate(tmpDir);

      const result = await reader.read(tmpDir);
      expect(result.name).toBe("updated");
    });
  });

  describe("clearCache", () => {
    it("clears all cached entries", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "before", version: "1.0.0" }),
      );

      const reader = new ManifestReader(jsonSchema);
      await reader.read(tmpDir);

      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "after", version: "2.0.0" }),
      );
      reader.clearCache();

      const result = await reader.read(tmpDir);
      expect(result.name).toBe("after");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/manifest/manifest-reader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ManifestReader**

```typescript
// packages/core/src/manifest/manifest-reader.ts
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface PackageManifest {
  name: string;
  version: string;
  private: boolean;
  dependencies: string[];
}

export interface ManifestSchema {
  file: string;
  parser: (raw: string) => Record<string, unknown>;
  fields: {
    name: (parsed: Record<string, unknown>) => string;
    version: (parsed: Record<string, unknown>) => string;
    private: (parsed: Record<string, unknown>) => boolean;
    dependencies: (parsed: Record<string, unknown>) => string[];
  };
}

export class ManifestReader {
  private cache = new Map<string, PackageManifest>();

  constructor(private schema: ManifestSchema) {}

  async read(packagePath: string): Promise<PackageManifest> {
    const cached = this.cache.get(packagePath);
    if (cached) return cached;

    const raw = await readFile(join(packagePath, this.schema.file), "utf-8");
    const parsed = this.schema.parser(raw);
    const manifest: PackageManifest = {
      name: this.schema.fields.name(parsed),
      version: this.schema.fields.version(parsed),
      private: this.schema.fields.private(parsed),
      dependencies: this.schema.fields.dependencies(parsed),
    };

    this.cache.set(packagePath, manifest);
    return manifest;
  }

  async exists(packagePath: string): Promise<boolean> {
    try {
      const s = await stat(join(packagePath, this.schema.file));
      return s.isFile();
    } catch {
      return false;
    }
  }

  invalidate(packagePath: string): void {
    this.cache.delete(packagePath);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/manifest/manifest-reader.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/manifest/manifest-reader.ts packages/core/tests/unit/manifest/manifest-reader.test.ts
git commit -m "feat: add ManifestReader with schema injection and caching"
```

---

### Task 2: Add ResolvedPackageConfig type

**Files:**
- Modify: `packages/core/src/config/types.ts`
- Test: `packages/core/tests/unit/config/defaults.test.ts` (typecheck validates)

- [ ] **Step 1: Add ResolvedPackageConfig to types.ts**

Add after the existing `PackageConfig` interface in `packages/core/src/config/types.ts`:

```typescript
export interface ResolvedPackageConfig extends Omit<PackageConfig, "registries"> {
  name: string;
  version: string;
  dependencies: string[];
  registries: RegistryType[];
  registryVersions?: Map<RegistryType, string>;
}
```

Note: `dependencies` is included because `buildPackageNodes()` in `required-missing-information.ts` needs dependency data for the dependency graph. Without it, Task 8 migration will fail.

Also requires importing `RegistryType` from `../types/options.js` in types.ts.

Do NOT change `ResolvedPubmConfig.packages` type yet — keep it as `PackageConfig[]` for now. Switch to `ResolvedPackageConfig[]` in Task 6 when `resolveConfig()` is updated, to avoid cascading type errors across the codebase before consumers are migrated.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: All pass (no existing code references the new type yet).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/config/types.ts
git commit -m "feat: add ResolvedPackageConfig type with name, version, registryVersions"
```

---

### Task 3: Add static ManifestReader to Registry classes

**Files:**
- Modify: `packages/core/src/registry/registry.ts`
- Modify: `packages/core/src/registry/npm.ts`
- Modify: `packages/core/src/registry/jsr.ts`
- Modify: `packages/core/src/registry/crates.ts`
- Test: `packages/core/tests/unit/registry/manifest-reader-integration.test.ts`

- [ ] **Step 1: Write failing tests for registry ManifestReader integration**

```typescript
// packages/core/tests/unit/registry/manifest-reader-integration.test.ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NpmRegistry } from "../../../src/registry/npm.js";
import { JsrRegistry } from "../../../src/registry/jsr.js";
import { CratesRegistry } from "../../../src/registry/crates.js";

const tmpDir = path.join(import.meta.dirname, "__fixtures__/registry-readers");

describe("Registry static readers", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    // Clear caches between tests
    NpmRegistry.reader.clearCache();
    JsrRegistry.reader.clearCache();
    CratesRegistry.reader.clearCache();
  });

  describe("NpmRegistry.reader", () => {
    it("reads package.json manifest", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "@scope/my-pkg",
          version: "2.0.0",
          private: false,
          dependencies: { lodash: "^4.0.0" },
          devDependencies: { vitest: "^1.0.0" },
        }),
      );

      const manifest = await NpmRegistry.reader.read(tmpDir);
      expect(manifest.name).toBe("@scope/my-pkg");
      expect(manifest.version).toBe("2.0.0");
      expect(manifest.private).toBe(false);
      expect(manifest.dependencies).toContain("lodash");
      expect(manifest.dependencies).toContain("vitest");
    });

    it("detects private packages", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "private-pkg", version: "1.0.0", private: true }),
      );

      const manifest = await NpmRegistry.reader.read(tmpDir);
      expect(manifest.private).toBe(true);
    });
  });

  describe("JsrRegistry.reader", () => {
    it("reads jsr.json manifest", async () => {
      writeFileSync(
        path.join(tmpDir, "jsr.json"),
        JSON.stringify({ name: "@scope/jsr-pkg", version: "3.0.0" }),
      );

      const manifest = await JsrRegistry.reader.read(tmpDir);
      expect(manifest.name).toBe("@scope/jsr-pkg");
      expect(manifest.version).toBe("3.0.0");
      expect(manifest.private).toBe(false); // jsr has no private concept
      expect(manifest.dependencies).toEqual([]);
    });
  });

  describe("CratesRegistry.reader", () => {
    it("reads Cargo.toml manifest", async () => {
      writeFileSync(
        path.join(tmpDir, "Cargo.toml"),
        [
          "[package]",
          'name = "my-crate"',
          'version = "0.5.0"',
          "",
          "[dependencies]",
          'serde = "1.0"',
          "",
          "[build-dependencies]",
          'cc = "1.0"',
        ].join("\n"),
      );

      const manifest = await CratesRegistry.reader.read(tmpDir);
      expect(manifest.name).toBe("my-crate");
      expect(manifest.version).toBe("0.5.0");
      expect(manifest.private).toBe(false);
      expect(manifest.dependencies).toContain("serde");
      expect(manifest.dependencies).toContain("cc");
    });

    it("detects private crates (publish = false)", async () => {
      writeFileSync(
        path.join(tmpDir, "Cargo.toml"),
        [
          "[package]",
          'name = "private-crate"',
          'version = "1.0.0"',
          "publish = false",
        ].join("\n"),
      );

      const manifest = await CratesRegistry.reader.read(tmpDir);
      expect(manifest.private).toBe(true);
    });

    it("detects private crates (publish = [])", async () => {
      writeFileSync(
        path.join(tmpDir, "Cargo.toml"),
        [
          "[package]",
          'name = "private-crate"',
          'version = "1.0.0"',
          "publish = []",
        ].join("\n"),
      );

      const manifest = await CratesRegistry.reader.read(tmpDir);
      expect(manifest.private).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/registry/manifest-reader-integration.test.ts`
Expected: FAIL — `NpmRegistry.reader` does not exist

- [ ] **Step 3: Add static `reader` property to Registry base class and each implementation**

Add to `packages/core/src/registry/registry.ts`:
```typescript
import type { ManifestReader } from "../manifest/manifest-reader.js";

export abstract class Registry {
  static reader: ManifestReader;
  static registryType: string;
  // ... existing abstract methods
}
```

Add to `packages/core/src/registry/npm.ts`:
```typescript
import { ManifestReader } from "../manifest/manifest-reader.js";

export class NpmRegistry extends Registry {
  static reader = new ManifestReader({
    file: "package.json",
    parser: JSON.parse,
    fields: {
      name: (p) => (p.name as string) ?? "",
      version: (p) => (p.version as string) ?? "0.0.0",
      private: (p) => p.private === true,
      dependencies: (p) =>
        Object.keys({
          ...(p.dependencies as Record<string, string>),
          ...(p.devDependencies as Record<string, string>),
          ...(p.peerDependencies as Record<string, string>),
        }),
    },
  });
  static registryType = "npm" as const;
  // ... existing methods
}
```

Add to `packages/core/src/registry/jsr.ts`:
```typescript
import { ManifestReader } from "../manifest/manifest-reader.js";

// Note: class name has typo "JsrRegisry" — keep existing name for now
export class JsrRegisry extends Registry {
  static reader = new ManifestReader({
    file: "jsr.json",
    parser: JSON.parse,
    fields: {
      name: (p) => (p.name as string) ?? "",
      version: (p) => (p.version as string) ?? "0.0.0",
      private: (_p) => false,
      dependencies: (_p) => [],
    },
  });
  static registryType = "jsr" as const;
  // ... existing methods
}
```

Add to `packages/core/src/registry/crates.ts`:
```typescript
import { parse as parseToml } from "smol-toml";
import { ManifestReader } from "../manifest/manifest-reader.js";

export class CratesRegistry extends Registry {
  static reader = new ManifestReader({
    file: "Cargo.toml",
    parser: parseToml as (raw: string) => Record<string, unknown>,
    fields: {
      name: (p) =>
        ((p.package as Record<string, unknown>)?.name as string) ?? "",
      version: (p) =>
        ((p.package as Record<string, unknown>)?.version as string) ?? "0.0.0",
      private: (p) => {
        const pkg = p.package as Record<string, unknown> | undefined;
        if (pkg?.publish === false) return true;
        if (Array.isArray(pkg?.publish) && (pkg.publish as unknown[]).length === 0)
          return true;
        return false;
      },
      dependencies: (p) => [
        ...Object.keys((p.dependencies as Record<string, unknown>) ?? {}),
        ...Object.keys(
          (p["build-dependencies"] as Record<string, unknown>) ?? {},
        ),
      ],
    },
  });
  static registryType = "crates" as const;
  // ... existing methods
}
```

Notes:
- For the test imports, the current pattern uses factory functions (`npmRegistry()`, `jsrRegistry()`, etc.) that return instances. The static `reader` property needs to be accessed on the class itself, not the instance. The classes are already exported from their respective files.
- `CustomRegistry` extends `NpmRegistry`, so it inherits `NpmRegistry.reader` automatically. No changes needed for `custom-registry.ts`.
- `JsrRegisry` has a typo in the class name — keep the existing name for now to avoid unrelated churn.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/registry/manifest-reader-integration.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All pass (existing tests should still work since we only added new properties)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/manifest/ packages/core/src/registry/registry.ts packages/core/src/registry/npm.ts packages/core/src/registry/jsr.ts packages/core/src/registry/crates.ts packages/core/tests/unit/registry/manifest-reader-integration.test.ts packages/core/tests/unit/manifest/
git commit -m "feat: add static ManifestReader to Registry classes"
```

---

## Chunk 2: Ecosystem Refactor

### Task 4: Refactor Ecosystem base class to delegate to Registry readers

**Files:**
- Modify: `packages/core/src/ecosystem/ecosystem.ts`
- Modify: `packages/core/src/ecosystem/js.ts`
- Modify: `packages/core/src/ecosystem/rust.ts`
- Test: `packages/core/tests/unit/ecosystem/manifest-delegation.test.ts`

- [ ] **Step 1: Write failing tests for Ecosystem manifest delegation**

```typescript
// packages/core/tests/unit/ecosystem/manifest-delegation.test.ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsEcosystem } from "../../../src/ecosystem/js.js";
import { RustEcosystem } from "../../../src/ecosystem/rust.js";
import { NpmRegistry } from "../../../src/registry/npm.js";
import { JsrRegistry } from "../../../src/registry/jsr.js";
import { CratesRegistry } from "../../../src/registry/crates.js";

const tmpDir = path.join(import.meta.dirname, "__fixtures__/eco-delegation");

describe("Ecosystem manifest delegation", () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    NpmRegistry.reader.clearCache();
    JsrRegistry.reader.clearCache();
    CratesRegistry.reader.clearCache();
  });

  describe("JsEcosystem", () => {
    it("reads manifest from package.json via registry reader", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "js-pkg", version: "1.0.0" }),
      );

      const eco = new JsEcosystem(tmpDir);
      const manifest = await eco.readManifest();
      expect(manifest.name).toBe("js-pkg");
      expect(manifest.version).toBe("1.0.0");
    });

    it("falls back to jsr.json when package.json missing", async () => {
      writeFileSync(
        path.join(tmpDir, "jsr.json"),
        JSON.stringify({ name: "jsr-only-pkg", version: "2.0.0" }),
      );

      const eco = new JsEcosystem(tmpDir);
      const manifest = await eco.readManifest();
      expect(manifest.name).toBe("jsr-only-pkg");
      expect(manifest.version).toBe("2.0.0");
    });

    it("detects registry version mismatch", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "pkg", version: "1.0.0" }),
      );
      writeFileSync(
        path.join(tmpDir, "jsr.json"),
        JSON.stringify({ name: "pkg", version: "1.1.0" }),
      );

      const eco = new JsEcosystem(tmpDir);
      const versions = await eco.readRegistryVersions();
      expect(versions.get("npm")).toBe("1.0.0");
      expect(versions.get("jsr")).toBe("1.1.0");
    });

    it("delegates packageName() to readManifest()", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "delegated", version: "1.0.0" }),
      );

      const eco = new JsEcosystem(tmpDir);
      expect(await eco.packageName()).toBe("delegated");
    });

    it("delegates readVersion() to readManifest()", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "pkg", version: "3.2.1" }),
      );

      const eco = new JsEcosystem(tmpDir);
      expect(await eco.readVersion()).toBe("3.2.1");
    });

    it("delegates isPrivate() to readManifest()", async () => {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "pkg", version: "1.0.0", private: true }),
      );

      const eco = new JsEcosystem(tmpDir);
      expect(await eco.isPrivate()).toBe(true);
    });

    it("returns registryClasses with NpmRegistry and JsrRegistry", () => {
      const eco = new JsEcosystem(tmpDir);
      const classes = eco.registryClasses();
      expect(classes).toHaveLength(2);
    });
  });

  describe("RustEcosystem", () => {
    it("reads manifest from Cargo.toml via registry reader", async () => {
      writeFileSync(
        path.join(tmpDir, "Cargo.toml"),
        ['[package]', 'name = "rust-crate"', 'version = "0.1.0"'].join("\n"),
      );

      const eco = new RustEcosystem(tmpDir);
      const manifest = await eco.readManifest();
      expect(manifest.name).toBe("rust-crate");
      expect(manifest.version).toBe("0.1.0");
    });

    it("delegates dependencies() to readManifest()", async () => {
      writeFileSync(
        path.join(tmpDir, "Cargo.toml"),
        [
          "[package]",
          'name = "crate"',
          'version = "1.0.0"',
          "",
          "[dependencies]",
          'serde = "1.0"',
          'tokio = "1.0"',
        ].join("\n"),
      );

      const eco = new RustEcosystem(tmpDir);
      const deps = await eco.dependencies();
      expect(deps).toContain("serde");
      expect(deps).toContain("tokio");
    });
  });

  describe("error handling", () => {
    it("throws when no manifest exists", async () => {
      const eco = new JsEcosystem(tmpDir);
      await expect(eco.readManifest()).rejects.toThrow("No manifest found");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/manifest-delegation.test.ts`
Expected: FAIL — `readManifest`, `registryClasses` do not exist

- [ ] **Step 3: Refactor Ecosystem base class**

In `packages/core/src/ecosystem/ecosystem.ts`, add the new methods. Keep existing abstract methods (`packageName`, `readVersion`, `dependencies`) but change them from abstract to concrete implementations that delegate to `readManifest()`. Remove them from subclasses.

```typescript
// packages/core/src/ecosystem/ecosystem.ts
import type { PackageManifest } from "../manifest/manifest-reader.js";
import type { Registry } from "../registry/registry.js";
import type { RegistryType } from "../types/options.js";

export abstract class Ecosystem {
  constructor(public packagePath: string) {}

  abstract registryClasses(): (typeof Registry)[];

  async readManifest(): Promise<PackageManifest> {
    for (const RegistryClass of this.registryClasses()) {
      if (await RegistryClass.reader.exists(this.packagePath)) {
        return RegistryClass.reader.read(this.packagePath);
      }
    }
    throw new Error(`No manifest found at ${this.packagePath}`);
  }

  async readRegistryVersions(): Promise<Map<RegistryType, string>> {
    const versions = new Map<RegistryType, string>();
    for (const RegistryClass of this.registryClasses()) {
      if (await RegistryClass.reader.exists(this.packagePath)) {
        const manifest = await RegistryClass.reader.read(this.packagePath);
        versions.set(RegistryClass.registryType as RegistryType, manifest.version);
      }
    }
    return versions;
  }

  async packageName(): Promise<string> {
    return (await this.readManifest()).name;
  }

  async readVersion(): Promise<string> {
    return (await this.readManifest()).version;
  }

  async dependencies(): Promise<string[]> {
    return (await this.readManifest()).dependencies;
  }

  async isPrivate(): Promise<boolean> {
    return (await this.readManifest()).private;
  }

  // Keep existing abstract/virtual methods
  abstract writeVersion(newVersion: string): Promise<void>;
  abstract manifestFiles(): string[];
  abstract defaultTestCommand(): Promise<string> | string;
  abstract defaultBuildCommand(): Promise<string> | string;
  abstract supportedRegistries(): RegistryType[];

  async updateSiblingDependencyVersions(
    _siblingVersions: Map<string, string>,
  ): Promise<boolean> {
    return false;
  }

  async syncLockfile(): Promise<string | undefined> {
    return undefined;
  }
}
```

- [ ] **Step 4: Update JsEcosystem**

In `packages/core/src/ecosystem/js.ts`:
- Add `registryClasses()` returning `[NpmRegistry, JsrRegistry]`
- Remove `readPackageJson()` private method
- Remove `packageName()` override (now in base class)
- Remove `readVersion()` override (now in base class)
- Keep `writeVersion()`, `manifestFiles()`, `defaultTestCommand()`, `defaultBuildCommand()`, `supportedRegistries()`
- Keep `static detect()` method

```typescript
import { NpmRegistry } from "../registry/npm.js";
import { JsrRegistry } from "../registry/jsr.js";
import type { Registry } from "../registry/registry.js";

export class JsEcosystem extends Ecosystem {
  static async detect(packagePath: string): Promise<boolean> {
    // existing implementation
  }

  registryClasses(): (typeof Registry)[] {
    return [NpmRegistry, JsrRegistry] as unknown as (typeof Registry)[];
  }

  // writeVersion stays — it writes to both package.json + jsr.json
  async writeVersion(newVersion: string): Promise<void> {
    // existing implementation (reads files directly for writing)
  }

  // Keep remaining methods unchanged
  manifestFiles(): string[] { return ["package.json"]; }
  async defaultTestCommand(): Promise<string> { /* existing */ }
  async defaultBuildCommand(): Promise<string> { /* existing */ }
  supportedRegistries(): RegistryType[] { return ["npm", "jsr"]; }
}
```

- [ ] **Step 5: Update RustEcosystem**

In `packages/core/src/ecosystem/rust.ts`:
- Add `registryClasses()` returning `[CratesRegistry]`
- Remove `readCargoToml()` private method
- Remove `packageName()` override
- Remove `readVersion()` override
- Remove `dependencies()` override (now in base class via ManifestReader)
- Keep `writeVersion()`, `updateSiblingDependencyVersions()`, `syncLockfile()`, etc.

Note: `updateSiblingDependencyVersions()` and `syncLockfile()` still need to read Cargo.toml directly for their specific purposes (modifying dependency sections, finding lockfile). These are write/mutation operations that go beyond what ManifestReader provides.

```typescript
import { CratesRegistry } from "../registry/crates.js";
import type { Registry } from "../registry/registry.js";

export class RustEcosystem extends Ecosystem {
  static async detect(packagePath: string): Promise<boolean> {
    // existing implementation
  }

  registryClasses(): (typeof Registry)[] {
    return [CratesRegistry] as unknown as (typeof Registry)[];
  }

  // writeVersion, updateSiblingDependencyVersions, syncLockfile — keep existing
  // manifestFiles, defaultTestCommand, defaultBuildCommand, supportedRegistries — keep existing
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/manifest-delegation.test.ts`
Expected: All PASS

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `bun run format && bun run typecheck && bun run test`
Expected: Some existing ecosystem tests may need adjustments since `packageName()` and `readVersion()` are no longer abstract. Fix any failures.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ecosystem/ packages/core/tests/unit/ecosystem/
git commit -m "refactor: delegate Ecosystem manifest reading to Registry ManifestReaders"
```

---

## Chunk 3: discoverPackages() Refactor + resolveConfig() Update

### Task 5: Refactor discoverPackages() to use Ecosystem + ManifestReader

**Files:**
- Modify: `packages/core/src/monorepo/discover.ts`
- Modify: `packages/core/tests/unit/monorepo/discover.test.ts`

- [ ] **Step 1: Update ResolvedPackage interface and discoverPackages()**

In `packages/core/src/monorepo/discover.ts`:

1. Replace `DiscoveredPackage` with `ResolvedPackage` (or add `ResolvedPackage` and keep `DiscoveredPackage` temporarily for backwards compat):

```typescript
export interface ResolvedPackage {
  name: string;
  version: string;
  path: string;
  ecosystem: EcosystemKey;
  registries: RegistryType[];
  dependencies: string[];
  registryVersions?: Map<RegistryType, string>;
}
```

2. Remove local `detectEcosystem()` function — use `ecosystemCatalog.detect()` instead
3. Remove `isPrivatePackage()` function — use `ManifestReader.read().private` instead
4. Refactor `discoverPackages()`:
   - When `options.packages` is provided, skip workspace discovery entirely
   - Use `ecosystemCatalog.detect()` for ecosystem detection
   - Use `ecosystem.readManifest()` for private check and info extraction
   - Use `ecosystem.readRegistryVersions()` for version mismatch detection

Extract workspace discovery into `discoverFromWorkspace()` helper.

- [ ] **Step 2: Update existing discover tests**

Update `packages/core/tests/unit/monorepo/discover.test.ts` to reflect the new return type (`ResolvedPackage` with name/version fields). Also add tests for:
- `config.packages` skipping workspace discovery
- Version mismatch detection between registries

- [ ] **Step 3: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/monorepo/discover.test.ts`
Expected: All PASS

- [ ] **Step 4: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`
Expected: May have failures in files still using old `DiscoveredPackage` type. Fix imports as needed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/monorepo/discover.ts packages/core/tests/unit/monorepo/discover.test.ts
git commit -m "refactor: discoverPackages uses Ecosystem ManifestReader, returns ResolvedPackage"
```

---

### Task 6: Update resolveConfig() to produce ResolvedPackageConfig[]

**Files:**
- Modify: `packages/core/src/config/types.ts`
- Modify: `packages/core/src/config/defaults.ts`
- Modify: `packages/core/tests/unit/config/defaults.test.ts`

- [ ] **Step 1: Switch ResolvedPubmConfig.packages to ResolvedPackageConfig[]**

In `packages/core/src/config/types.ts`, update `ResolvedPubmConfig`:

```typescript
export interface ResolvedPubmConfig
  extends Required<Omit<PubmConfig, "packages" | "validate" | "registries">> {
  packages: ResolvedPackageConfig[];  // Changed from PackageConfig[]
  validate: Required<ValidateConfig>;
  discoveryEmpty?: boolean;
}
```

- [ ] **Step 2: Update resolveConfig()**

In `packages/core/src/config/defaults.ts`, replace the existing package resolution logic with a call to the refactored `discoverPackages()`:

```typescript
import { discoverPackages } from "../monorepo/discover.js";
import type { ResolvedPackageConfig } from "./types.js";

export async function resolveConfig(
  config: PubmConfig,
  cwd?: string,
): Promise<ResolvedPubmConfig> {
  const resolvedCwd = cwd ?? process.cwd();

  const discovered = await discoverPackages({
    cwd: resolvedCwd,
    packages: config.packages,
    ignore: config.ignore,
  });

  const packages: ResolvedPackageConfig[] = discovered.map((pkg) => ({
    path: pkg.path,
    name: pkg.name,
    version: pkg.version,
    dependencies: pkg.dependencies,
    ecosystem: pkg.ecosystem as "js" | "rust",
    registries: pkg.registries,
    ...(pkg.registryVersions ? { registryVersions: pkg.registryVersions } : {}),
  }));

  return {
    ...defaultConfig,
    ...config,
    packages,
    validate: { ...defaultValidate, ...config.validate },
    snapshotTemplate: config.snapshotTemplate ?? defaultConfig.snapshotTemplate,
    plugins: config.plugins ?? [],
    ...(discovered.length === 0 ? { discoveryEmpty: true } : {}),
  };
}
```

Remove the old `discoverPackages` call and private registry normalization logic that is now handled inside `discoverPackages()`.

- [ ] **Step 3: Fix type errors in context.ts**

`packages/core/src/context.ts` — `PubmContext.config` references `ResolvedPubmConfig` which now has `ResolvedPackageConfig[]`. No changes needed if the interface is defined correctly, but verify.

- [ ] **Step 4: Fix type errors in grouping.ts**

`packages/core/src/tasks/grouping.ts` — `collectEcosystemRegistryGroups()` accepts `RegistrySource` which includes `packages`. Update to accept `ResolvedPackageConfig[]`.

- [ ] **Step 5: Fix type errors in test files**

Update test files that construct mock `ResolvedPubmConfig` to include `name`, `version`, `dependencies` on packages. Key files:
- `packages/core/tests/unit/config/defaults.test.ts`
- `packages/core/tests/unit/tasks/runner.test.ts` (mock config)
- `packages/core/tests/unit/tasks/required-missing-information.test.ts` (mock config)

- [ ] **Step 6: Update config tests**

In `packages/core/tests/unit/config/defaults.test.ts`, update assertions to check for `name` and `version` fields on resolved packages.

- [ ] **Step 7: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/config/ packages/core/src/context.ts packages/core/src/tasks/grouping.ts packages/core/tests/
git commit -m "refactor: resolveConfig produces ResolvedPackageConfig with name/version"
```

---

## Chunk 4: Version Write Orchestrator + Consumer Migration

### Task 7: Create writeVersionsForEcosystem orchestrator

**Files:**
- Create: `packages/core/src/manifest/write-versions.ts`
- Test: `packages/core/tests/unit/manifest/write-versions.test.ts`

- [ ] **Step 1: Write failing tests**

Test the 3-phase orchestration: writeVersion → updateSiblingDependencyVersions → syncLockfile. Use mock ecosystems to verify the orchestration flow.

```typescript
// packages/core/tests/unit/manifest/write-versions.test.ts
import { describe, expect, it, vi } from "vitest";
import { writeVersionsForEcosystem } from "../../../src/manifest/write-versions.js";
import type { Ecosystem } from "../../../src/ecosystem/ecosystem.js";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";

function createMockEcosystem(name: string): Ecosystem {
  return {
    packagePath: `/mock/${name}`,
    packageName: vi.fn().mockResolvedValue(name),
    writeVersion: vi.fn().mockResolvedValue(undefined),
    updateSiblingDependencyVersions: vi.fn().mockResolvedValue(false),
    syncLockfile: vi.fn().mockResolvedValue(undefined),
    registryClasses: vi.fn().mockReturnValue([{
      reader: { invalidate: vi.fn() },
    }]),
  } as unknown as Ecosystem;
}

function createMockPkg(name: string): ResolvedPackageConfig {
  return {
    path: `packages/${name}`,
    name,
    version: "1.0.0",
    registries: ["npm"],
  } as ResolvedPackageConfig;
}

describe("writeVersionsForEcosystem", () => {
  it("calls writeVersion for each package with matching version", async () => {
    const eco = createMockEcosystem("pkg-a");
    const versions = new Map([["pkg-a", "2.0.0"]]);

    await writeVersionsForEcosystem(
      [{ eco, pkg: createMockPkg("pkg-a") }],
      versions,
    );

    expect(eco.writeVersion).toHaveBeenCalledWith("2.0.0");
  });

  it("calls updateSiblingDependencyVersions when multiple packages", async () => {
    const ecoA = createMockEcosystem("a");
    const ecoB = createMockEcosystem("b");
    const versions = new Map([["a", "2.0.0"], ["b", "2.0.0"]]);

    await writeVersionsForEcosystem(
      [
        { eco: ecoA, pkg: createMockPkg("a") },
        { eco: ecoB, pkg: createMockPkg("b") },
      ],
      versions,
    );

    expect(ecoA.updateSiblingDependencyVersions).toHaveBeenCalledWith(versions);
    expect(ecoB.updateSiblingDependencyVersions).toHaveBeenCalledWith(versions);
  });

  it("skips updateSiblingDependencyVersions for single package", async () => {
    const eco = createMockEcosystem("solo");
    const versions = new Map([["solo", "2.0.0"]]);

    await writeVersionsForEcosystem(
      [{ eco, pkg: createMockPkg("solo") }],
      versions,
    );

    expect(eco.updateSiblingDependencyVersions).not.toHaveBeenCalled();
  });

  it("calls syncLockfile and collects modified files", async () => {
    const eco = createMockEcosystem("pkg");
    (eco.syncLockfile as ReturnType<typeof vi.fn>).mockResolvedValue("/path/to/Cargo.lock");
    const versions = new Map([["pkg", "2.0.0"]]);

    const files = await writeVersionsForEcosystem(
      [{ eco, pkg: createMockPkg("pkg") }],
      versions,
    );

    expect(files).toContain("/path/to/Cargo.lock");
  });

  it("invalidates ManifestReader cache after writing", async () => {
    const mockInvalidate = vi.fn();
    const eco = {
      ...createMockEcosystem("pkg"),
      registryClasses: vi.fn().mockReturnValue([{
        reader: { invalidate: mockInvalidate },
      }]),
    } as unknown as Ecosystem;
    const versions = new Map([["pkg", "2.0.0"]]);

    await writeVersionsForEcosystem(
      [{ eco, pkg: createMockPkg("pkg") }],
      versions,
    );

    expect(mockInvalidate).toHaveBeenCalledWith("/mock/pkg");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/manifest/write-versions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement writeVersionsForEcosystem**

```typescript
// packages/core/src/manifest/write-versions.ts
import type { ResolvedPackageConfig } from "../config/types.js";
import type { Ecosystem } from "../ecosystem/ecosystem.js";

export async function writeVersionsForEcosystem(
  ecosystems: { eco: Ecosystem; pkg: ResolvedPackageConfig }[],
  versions: Map<string, string>,
): Promise<string[]> {
  const modifiedFiles: string[] = [];

  // Phase 1: Write versions to manifests
  for (const { eco } of ecosystems) {
    const name = await eco.packageName();
    const version = versions.get(name);
    if (version) {
      await eco.writeVersion(version);
      for (const RegistryClass of eco.registryClasses()) {
        RegistryClass.reader.invalidate(eco.packagePath);
      }
    }
  }

  // Phase 2: Update sibling dependency versions
  if (ecosystems.length > 1) {
    await Promise.all(
      ecosystems.map(({ eco }) =>
        eco.updateSiblingDependencyVersions(versions),
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

Run: `cd packages/core && bun vitest --run tests/unit/manifest/write-versions.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/manifest/write-versions.ts packages/core/tests/unit/manifest/write-versions.test.ts
git commit -m "feat: add writeVersionsForEcosystem 3-phase orchestrator"
```

---

### Task 8: Migrate required-missing-information.ts to use ctx.config.packages

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`
- Modify: `packages/core/tests/unit/tasks/required-missing-information.test.ts`

- [ ] **Step 1: Update required-missing-information.ts**

Key changes:
1. Remove imports of `discoverCurrentVersions`, `discoverPackageInfos`, `getPackageJson`, `version`
2. Remove `readPackageDependencies()` function
3. Replace `discoverPackageInfos(cwd)` calls with `ctx.config.packages`
4. Replace `discoverCurrentVersions(cwd)` with `new Map(ctx.config.packages.map(p => [p.name, p.version]))`
5. Replace `version()` call with `ctx.config.packages[0].version`
6. Replace `readPackageDependencies()` usage with data from `ctx.config.packages` (dependencies will need to come from Ecosystem or be added to ResolvedPackageConfig)
7. Add `handleVersionMismatch()` function for registry version mismatch prompts
8. Update `PackageInfos` type alias to use `ResolvedPackageConfig[]`

Note: `buildPackageNodes()` reads dependencies for the dependency graph. `ResolvedPackageConfig` includes `dependencies: string[]` (added in Task 2), populated from `ResolvedPackage.dependencies` during `resolveConfig()`. Use `ctx.config.packages[i].dependencies` directly.

- [ ] **Step 2: Update tests**

Update mock setup in `packages/core/tests/unit/tasks/required-missing-information.test.ts`:
- Remove mocks for `discoverPackageInfos`, `discoverCurrentVersions`, `version`, `getPackageJson`
- Provide `ctx.config.packages` as `ResolvedPackageConfig[]` with name/version

- [ ] **Step 3: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts`
Expected: All PASS

- [ ] **Step 4: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/required-missing-information.ts packages/core/tests/unit/tasks/required-missing-information.test.ts
git commit -m "refactor: required-missing-information uses ctx.config.packages instead of re-discovery"
```

---

### Task 9: Migrate runner.ts to use ctx.config.packages

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`
- Modify: `packages/core/tests/unit/tasks/runner.test.ts`
- Modify: `packages/core/tests/unit/tasks/runner-coverage.test.ts`

- [ ] **Step 1: Update runner.ts**

Key changes:
1. Remove imports of `discoverPackageInfos`, `getPackageJson`, `getJsrJson`, `version`, `replaceVersion`, `replaceVersionAtPath`
2. Replace all `discoverPackageInfos(process.cwd())` calls (lines ~440, ~587, ~820) with `ctx.config.packages`
3. Replace `replaceVersion()` / `replaceVersionAtPath()` calls with `writeVersionsForEcosystem()`
4. Replace `getPackageJson()` calls with data from `ctx.config.packages`

- [ ] **Step 2: Update runner tests**

Remove mocks for deleted functions, update test setup to provide `ctx.config.packages`.

- [ ] **Step 3: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner.test.ts tests/unit/tasks/runner-coverage.test.ts`
Expected: All PASS

- [ ] **Step 4: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/runner.ts packages/core/tests/unit/tasks/
git commit -m "refactor: runner uses ctx.config.packages and writeVersionsForEcosystem"
```

---

### Task 10: Migrate CLI commands

**Files:**
- Modify: `packages/pubm/src/commands/add.ts`
- Modify: `packages/pubm/src/commands/version-cmd.ts`
- Modify: related test files in `packages/pubm/tests/`

- [ ] **Step 1: Update add.ts**

Replace `discoverPackages()` + `getPackageJson()` pattern with `ctx.config.packages`.

- [ ] **Step 2: Update version-cmd.ts**

Replace `discoverCurrentVersions()`, `discoverPackageInfos()`, `replaceVersion()`, `replaceVersionAtPath()` with `ctx.config.packages` and `writeVersionsForEcosystem()`.

- [ ] **Step 3: Update related tests**

Fix test mocks and assertions.

- [ ] **Step 4: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`

- [ ] **Step 5: Commit**

```bash
git add packages/pubm/src/commands/ packages/pubm/tests/
git commit -m "refactor: CLI commands use ctx.config.packages instead of re-discovery"
```

---

## Chunk 5: Cleanup — Delete Old Code + Update Exports

### Task 11: Update patchCachedJsrJson usage in jsr.ts

**Files:**
- Modify: `packages/core/src/tasks/jsr.ts`
- Modify: `packages/core/tests/unit/tasks/jsr.test.ts`

- [ ] **Step 1: Replace patchCachedJsrJson with ManifestReader cache invalidation**

In `packages/core/src/tasks/jsr.ts`, find the `patchCachedJsrJson()` call (line ~205) and replace with `JsrRegistry.reader.invalidate(packagePath)`.

- [ ] **Step 2: Update jsr tests**

- [ ] **Step 3: Run tests and commit**

Run: `bun run format && bun run typecheck && bun run test`

```bash
git add packages/core/src/tasks/jsr.ts packages/core/tests/unit/tasks/jsr.test.ts
git commit -m "refactor: replace patchCachedJsrJson with ManifestReader cache invalidation"
```

---

### Task 12: Delete old functions from utils/package.ts

**Files:**
- Modify: `packages/core/src/utils/package.ts`
- Modify: `packages/core/tests/unit/utils/package.test.ts`
- Modify: `packages/core/tests/unit/utils/replace-version.test.ts`

- [ ] **Step 1: Delete functions from utils/package.ts**

Remove:
- `getPackageJson()` (lines 50-87)
- `getJsrJson()` (lines 89-126)
- `packageJsonToJsrJson()` (lines 128-182)
- `jsrJsonToPackageJson()` (lines 184-210)
- `version()` (lines 212-225)
- `replaceVersion()` (lines 229-338)
- `replaceVersionAtPath()` (lines 340-368)
- `replaceVersions()` (lines 370-435)
- `patchCachedJsrJson()` (lines 18-23)
- `cachedPackageJson` and `cachedJsrJson` variables

Keep:
- `findOutFile()` (lines 25-48)
- `versionRegex` (if still used by Ecosystem.writeVersion)
- Any other utilities not related to manifest reading/version writing

- [ ] **Step 2: Delete or update tests**

- Remove tests for deleted functions from `package.test.ts`
- Remove `replace-version.test.ts` entirely (covered by write-versions.test.ts)
- Keep `findOutFile` tests

- [ ] **Step 3: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`
Expected: May surface remaining references to deleted functions — fix all.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/utils/package.ts packages/core/tests/unit/utils/
git commit -m "refactor: remove deprecated manifest reading and version writing functions"
```

---

### Task 13: Delete changeset/packages.ts and update barrel exports

**Files:**
- Delete: `packages/core/src/changeset/packages.ts`
- Modify: `packages/core/src/changeset/index.ts`
- Modify: `packages/core/src/index.ts`
- Delete: `packages/core/tests/unit/changeset/packages.test.ts`

- [ ] **Step 1: Delete changeset/packages.ts**

Remove the entire file — `discoverCurrentVersions()`, `discoverPackageInfos()`, and `PackageVersionInfo` are all replaced.

- [ ] **Step 2: Update changeset/index.ts barrel**

Remove exports:
```typescript
// Remove these lines:
discoverCurrentVersions,
discoverPackageInfos,
type PackageVersionInfo,
```

- [ ] **Step 3: Update core/index.ts barrel**

Remove old exports:
```typescript
// Remove:
discoverCurrentVersions,
discoverPackageInfos,
PackageVersionInfo,
getPackageJson,
replaceVersion,
replaceVersionAtPath,
version,
```

Add new exports:
```typescript
// Add:
export { ManifestReader, type ManifestSchema, type PackageManifest } from "./manifest/manifest-reader.js";
export { writeVersionsForEcosystem } from "./manifest/write-versions.js";
export type { ResolvedPackage } from "./monorepo/discover.js";
export type { ResolvedPackageConfig } from "./config/types.js";
```

- [ ] **Step 4: Delete changeset/packages.test.ts**

- [ ] **Step 5: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All pass. Any remaining references to deleted exports will surface as type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/changeset/ packages/core/src/index.ts packages/core/tests/unit/changeset/
git commit -m "refactor: remove changeset/packages.ts, update barrel exports"
```

---

### Task 14: Update remaining registry/ecosystem callers

**Files:**
- Modify: `packages/core/src/registry/catalog.ts` (uses `getPackageJson`/`getJsrJson`)
- Modify: `packages/core/src/registry/npm.ts` (uses `getPackageJson`)
- Modify: `packages/core/src/registry/jsr.ts` (uses `getPackageJson`/`getJsrJson`)
- Modify: `packages/core/src/registry/custom-registry.ts` (uses `getPackageJson`)
- Modify: `packages/core/src/tasks/required-conditions-check.ts` (uses `getPackageJson`)
- Modify: related test files

- [ ] **Step 1: Replace getPackageJson/getJsrJson calls in registry files**

These registries use `getPackageJson()`/`getJsrJson()` to get the package name for display. Replace with `NpmRegistry.reader.read()` or similar:

```typescript
// Instead of: const pkg = await getPackageJson({ cwd });
// Use: const manifest = await NpmRegistry.reader.read(cwd);
// Then: manifest.name
```

Important: For `jsr.ts` registry, the current code may call `getPackageJson()` which internally falls back to `getJsrJson()` for jsr-only packages. The replacement `NpmRegistry.reader.read()` will NOT fall back. Use `Ecosystem.readManifest()` or try `NpmRegistry.reader` first then `JsrRegistry.reader` for jsr-only package support.

- [ ] **Step 2: Update required-conditions-check.ts**

Replace `getPackageJson()` with the appropriate ManifestReader call or `ctx.config.packages`.

- [ ] **Step 3: Update inferRegistries in ecosystem/infer.ts (spec section 9)**

`readJsonSafe()` in `infer.ts` reads package.json for `publishConfig.registry` and package name. Since `PackageManifest` does not include `publishConfig`, keep direct file reads for `publishConfig` access. However:
- Delete the `readJsonSafe()` helper (use `NpmRegistry.reader.read()` for name, direct `readFile` for publishConfig)
- The OS page cache eliminates actual I/O duplication since ManifestReader already read the same file

- [ ] **Step 4: Add jsr-only package test**

Add a test to verify that registries and ecosystem handle jsr-only packages (no package.json, only jsr.json) correctly after the migration. This validates the cross-fallback replacement (spec section 11).

```typescript
// Add to registry tests or ecosystem tests:
it("handles jsr-only package (no package.json)", async () => {
  // Create fixture with only jsr.json, no package.json
  // Verify NpmRegistry.reader.exists() returns false
  // Verify JsrRegistry.reader.read() succeeds
  // Verify ecosystem.readManifest() falls back to jsr.json
});
```

- [ ] **Step 5: Update test files**

Fix mocks in:
- `packages/core/tests/unit/registry/catalog.test.ts`
- `packages/core/tests/unit/registry/npm.test.ts`
- `packages/core/tests/unit/registry/jsr.test.ts`
- `packages/core/tests/unit/registry/custom-registry.test.ts`
- `packages/core/tests/unit/ecosystem/infer.test.ts`

- [ ] **Step 6: Check validate module**

Run: grep for `getPackageJson` in `packages/core/src/validate/` to verify no migration needed. If found, replace with ManifestReader.

- [ ] **Step 7: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/registry/ packages/core/src/ecosystem/infer.ts packages/core/src/tasks/required-conditions-check.ts packages/core/tests/unit/registry/ packages/core/tests/unit/ecosystem/
git commit -m "refactor: replace getPackageJson/getJsrJson with ManifestReader in registries and infer"
```

---

### Task 15: Final cleanup — barrel files, grep verification, DiscoveredPackage removal

**Files:**
- Modify: `packages/core/src/monorepo/discover.ts`
- Create: `packages/core/src/manifest/index.ts`
- Modify: `packages/core/src/monorepo/index.ts` (if exists — update exports for ResolvedPackage)
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create manifest/index.ts barrel**

```typescript
// packages/core/src/manifest/index.ts
export {
  ManifestReader,
  type ManifestSchema,
  type PackageManifest,
} from "./manifest-reader.js";
export { writeVersionsForEcosystem } from "./write-versions.js";
```

- [ ] **Step 2: Update monorepo/index.ts barrel**

If `packages/core/src/monorepo/index.ts` exists and exports `DiscoveredPackage` or `discoverPackages`, update to export `ResolvedPackage` instead.

- [ ] **Step 3: Remove DiscoveredPackage interface if no longer used**

Check for remaining references. If `DiscoveredPackage` is only used internally and all external consumers use `ResolvedPackage`, remove it.

- [ ] **Step 4: Clean up discover.ts**

Remove unused helper functions:
- `detectEcosystem()` (local, sync version)
- `isPrivatePackage()`
- `matchesIgnore()` (if moved into `discoverFromWorkspace`)
- `resolvePatterns()` (if moved)

- [ ] **Step 5: Grep verification — ensure no remaining references to deleted functions**

Run grep for all deleted function names across the entire codebase:

```bash
rg "(getPackageJson|getJsrJson|discoverPackageInfos|discoverCurrentVersions|replaceVersion|replaceVersionAtPath|replaceVersions|patchCachedJsrJson|jsrJsonToPackageJson|packageJsonToJsrJson|readPackageDependencies|isPrivatePackage|PackageVersionInfo)" packages/core/src/ packages/pubm/src/ --type ts
```

Expected: No matches (except in test fixtures or comments). Fix any remaining references.

- [ ] **Step 6: Verify findOutFile() only used for non-manifest purposes**

```bash
rg "findOutFile" packages/core/src/ --type ts
```

Verify remaining calls are for `.npmignore`, `.gitignore`, or similar — not for locating manifests.

- [ ] **Step 7: Run full pre-commit checks**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All pass — this is the final cleanup.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/monorepo/ packages/core/src/manifest/ packages/core/src/index.ts
git commit -m "refactor: final cleanup — barrel files, remove DiscoveredPackage and unused helpers"
```

---

## Post-Implementation

- [ ] **Run full CI checks**: `bun run build && bun run check && bun run typecheck && bun run test`
- [ ] **Verify coverage thresholds still met**: `bun run coverage`
- [ ] **Manual smoke test**: Run `bun run release` in dry-run mode on the pubm repo itself to verify the publish pipeline works end-to-end
