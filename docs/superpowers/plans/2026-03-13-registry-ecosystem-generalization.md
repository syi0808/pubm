# Registry/Ecosystem Generalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~35 registry/ecosystem type-specific branches across ~20 files by introducing a central catalog for static metadata and extending the common interface for runtime behavior.

**Architecture:** Two-layer approach — `RegistryCatalog` and `EcosystemCatalog` hold static metadata (labels, token config, ecosystem mappings) while the `Registry` and `Ecosystem` base classes gain new methods (`concurrentPublish`, `orderPackages`, `checkAvailability`) that encapsulate runtime behavior. Consumer code (runner, grouping, token, etc.) queries catalogs and calls interface methods instead of branching on type strings.

**Tech Stack:** TypeScript, Vitest, Bun, listr2

**Spec:** `docs/superpowers/specs/2026-03-13-registry-ecosystem-generalization-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/core/src/registry/catalog.ts` | `RegistryDescriptor` interface, `RegistryCatalog` class, npm/jsr/crates registrations |
| `packages/core/src/ecosystem/catalog.ts` | `EcosystemDescriptor` interface, `EcosystemCatalog` class, js/rust registrations |
| `packages/core/tests/unit/registry/catalog.test.ts` | Tests for RegistryCatalog |
| `packages/core/tests/unit/ecosystem/catalog.test.ts` | Tests for EcosystemCatalog |

### Modified Files
| File | Change |
|------|--------|
| `packages/core/src/registry/registry.ts` | Add `concurrentPublish`, `orderPackages()`, `checkAvailability()` |
| `packages/core/src/registry/crates.ts` | Override `concurrentPublish`, `orderPackages()` |
| `packages/core/src/registry/jsr.ts` | Override `checkAvailability()` |
| `packages/core/src/registry/index.ts` | Replace manual mapping with catalog lookup |
| `packages/core/src/ecosystem/ecosystem.ts` | Add `updateSiblingDependencyVersions()`, `syncLockfile()`, `dependencies()` |
| `packages/core/src/ecosystem/index.ts` | Replace `registryToEcosystem` with catalog lookup |
| `packages/core/src/tasks/grouping.ts` | Replace static maps and switch statements with catalog lookups |
| `packages/core/src/tasks/runner.ts` | Replace `registryTask()`/`dryRunRegistryTask()` switches and crates branches |
| `packages/core/src/tasks/required-conditions-check.ts` | Replace `registryRequirementsMap` and `createAvailabilityTask()` switch |
| `packages/core/src/tasks/preflight.ts` | Replace npm-specific token URL branch |
| `packages/core/src/utils/token.ts` | Replace `TOKEN_CONFIG` and npm env var branch with catalog |
| `packages/core/src/monorepo/discover.ts` | Replace local `defaultRegistries` and `detectEcosystem` |
| `packages/core/tests/unit/registry/index.test.ts` | Update to test catalog-based `getRegistry()` |
| `packages/core/tests/unit/ecosystem/index.test.ts` | Update to test catalog-based `detectEcosystem()` |
| `packages/core/tests/unit/utils/token.test.ts` | Update to test catalog-based token logic |
| `packages/core/tests/unit/tasks/grouping.test.ts` (new) | Test catalog-based grouping |

---

## Chunk 1: Catalog Infrastructure + Registry Interface Extension

### Task 1: Create RegistryCatalog

**Files:**
- Create: `packages/core/src/registry/catalog.ts`
- Test: `packages/core/tests/unit/registry/catalog.test.ts`

- [ ] **Step 1: Write failing tests for RegistryCatalog**

```ts
// packages/core/tests/unit/registry/catalog.test.ts
import { describe, expect, it } from "vitest";
import {
  RegistryCatalog,
  type RegistryDescriptor,
} from "../../../src/registry/catalog.js";

function createDescriptor(
  overrides: Partial<RegistryDescriptor> = {},
): RegistryDescriptor {
  return {
    key: "test",
    ecosystem: "js",
    label: "Test",
    tokenConfig: {
      envVar: "TEST_TOKEN",
      dbKey: "test-token",
      ghSecretName: "TEST_TOKEN",
      promptLabel: "test token",
      tokenUrl: "https://example.com",
      tokenUrlLabel: "example.com",
    },
    needsPackageScripts: false,
    factory: async () => ({}) as any,
    ...overrides,
  };
}

describe("RegistryCatalog", () => {
  it("registers and retrieves a descriptor by key", () => {
    const catalog = new RegistryCatalog();
    const desc = createDescriptor({ key: "npm" });
    catalog.register(desc);
    expect(catalog.get("npm")).toBe(desc);
  });

  it("returns undefined for unregistered key", () => {
    const catalog = new RegistryCatalog();
    expect(catalog.get("unknown")).toBeUndefined();
  });

  it("returns all registered descriptors", () => {
    const catalog = new RegistryCatalog();
    const npm = createDescriptor({ key: "npm" });
    const jsr = createDescriptor({ key: "jsr" });
    catalog.register(npm);
    catalog.register(jsr);
    expect(catalog.all()).toEqual([npm, jsr]);
  });

  it("filters descriptors by ecosystem", () => {
    const catalog = new RegistryCatalog();
    catalog.register(createDescriptor({ key: "npm", ecosystem: "js" }));
    catalog.register(createDescriptor({ key: "crates", ecosystem: "rust" }));
    const jsRegistries = catalog.getByEcosystem("js");
    expect(jsRegistries).toHaveLength(1);
    expect(jsRegistries[0].key).toBe("npm");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RegistryCatalog**

```ts
// packages/core/src/registry/catalog.ts
import type { PackageConfig } from "../config/types.js";
import type { Registry } from "./registry.js";

export type EcosystemKey = "js" | "rust" | string;

export interface TokenEntry {
  envVar: string;
  dbKey: string;
  ghSecretName: string;
  promptLabel: string;
  tokenUrl: string;
  tokenUrlLabel: string;
}

export interface RegistryDescriptor {
  key: string;
  ecosystem: EcosystemKey;
  label: string;
  tokenConfig: TokenEntry;
  needsPackageScripts: boolean;
  additionalEnvVars?: (token: string) => Record<string, string>;
  resolveTokenUrl?: (baseUrl: string) => Promise<string>;
  resolveDisplayName?: (ctx: {
    packages?: PackageConfig[];
  }) => Promise<string[]>;
  factory: (packageName?: string) => Promise<Registry>;
}

export class RegistryCatalog {
  private descriptors = new Map<string, RegistryDescriptor>();

  register(descriptor: RegistryDescriptor): void {
    this.descriptors.set(descriptor.key, descriptor);
  }

  get(key: string): RegistryDescriptor | undefined {
    return this.descriptors.get(key);
  }

  getByEcosystem(ecosystem: EcosystemKey): RegistryDescriptor[] {
    return [...this.descriptors.values()].filter(
      (d) => d.ecosystem === ecosystem,
    );
  }

  all(): RegistryDescriptor[] {
    return [...this.descriptors.values()];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry/catalog.ts packages/core/tests/unit/registry/catalog.test.ts
git commit -m "feat(core): add RegistryCatalog for centralized registry metadata"
```

---

### Task 2: Create EcosystemCatalog

**Files:**
- Create: `packages/core/src/ecosystem/catalog.ts`
- Test: `packages/core/tests/unit/ecosystem/catalog.test.ts`

- [ ] **Step 1: Write failing tests for EcosystemCatalog**

```ts
// packages/core/tests/unit/ecosystem/catalog.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  EcosystemCatalog,
  type EcosystemDescriptor,
} from "../../../src/ecosystem/catalog.js";

function createDescriptor(
  overrides: Partial<EcosystemDescriptor> = {},
): EcosystemDescriptor {
  return {
    key: "js",
    label: "JavaScript ecosystem",
    defaultRegistries: ["npm", "jsr"],
    ecosystemClass: class {} as any,
    detect: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("EcosystemCatalog", () => {
  it("registers and retrieves a descriptor by key", () => {
    const catalog = new EcosystemCatalog();
    const desc = createDescriptor({ key: "js" });
    catalog.register(desc);
    expect(catalog.get("js")).toBe(desc);
  });

  it("returns undefined for unregistered key", () => {
    const catalog = new EcosystemCatalog();
    expect(catalog.get("unknown")).toBeUndefined();
  });

  it("returns all registered descriptors", () => {
    const catalog = new EcosystemCatalog();
    const js = createDescriptor({ key: "js" });
    const rust = createDescriptor({ key: "rust" });
    catalog.register(js);
    catalog.register(rust);
    expect(catalog.all()).toEqual([js, rust]);
  });

  it("detects ecosystem by calling detect functions in order", async () => {
    const catalog = new EcosystemCatalog();
    const jsDetect = vi.fn().mockResolvedValue(false);
    const rustDetect = vi.fn().mockResolvedValue(true);
    catalog.register(createDescriptor({ key: "js", detect: jsDetect }));
    catalog.register(createDescriptor({ key: "rust", detect: rustDetect }));

    const result = await catalog.detect("/some/path");
    expect(result?.key).toBe("rust");
  });

  it("returns null when no ecosystem detected", async () => {
    const catalog = new EcosystemCatalog();
    catalog.register(
      createDescriptor({ detect: vi.fn().mockResolvedValue(false) }),
    );
    const result = await catalog.detect("/empty/path");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/catalog.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement EcosystemCatalog**

```ts
// packages/core/src/ecosystem/catalog.ts
import type { RegistryType } from "../types/options.js";
import type { Ecosystem } from "./ecosystem.js";

export type EcosystemKey = "js" | "rust" | string;

export interface EcosystemDescriptor {
  key: EcosystemKey;
  label: string;
  defaultRegistries: RegistryType[];
  ecosystemClass: new (path: string) => Ecosystem;
  detect: (packagePath: string) => Promise<boolean>;
}

export class EcosystemCatalog {
  private descriptors = new Map<EcosystemKey, EcosystemDescriptor>();

  register(descriptor: EcosystemDescriptor): void {
    this.descriptors.set(descriptor.key, descriptor);
  }

  get(key: EcosystemKey): EcosystemDescriptor | undefined {
    return this.descriptors.get(key);
  }

  async detect(packagePath: string): Promise<EcosystemDescriptor | null> {
    for (const descriptor of this.descriptors.values()) {
      if (await descriptor.detect(packagePath)) {
        return descriptor;
      }
    }
    return null;
  }

  all(): EcosystemDescriptor[] {
    return [...this.descriptors.values()];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ecosystem/catalog.ts packages/core/tests/unit/ecosystem/catalog.test.ts
git commit -m "feat(core): add EcosystemCatalog for centralized ecosystem metadata"
```

---

### Task 3: Register existing registries and ecosystems in catalogs

**Files:**
- Modify: `packages/core/src/registry/catalog.ts`
- Modify: `packages/core/src/ecosystem/catalog.ts`

This step populates the catalogs with the current npm/jsr/crates and js/rust entries. No consumers use them yet — that happens in later tasks.

- [ ] **Step 1: Write tests for default registrations**

Add to `packages/core/tests/unit/registry/catalog.test.ts`:

```ts
import { registryCatalog } from "../../../src/registry/catalog.js";

describe("default registrations", () => {
  it("has npm registered with ecosystem js", () => {
    const npm = registryCatalog.get("npm");
    expect(npm).toBeDefined();
    expect(npm!.ecosystem).toBe("js");
    expect(npm!.label).toBe("npm");
    expect(npm!.needsPackageScripts).toBe(true);
    expect(npm!.tokenConfig.envVar).toBe("NODE_AUTH_TOKEN");
  });

  it("has jsr registered with ecosystem js", () => {
    const jsr = registryCatalog.get("jsr");
    expect(jsr).toBeDefined();
    expect(jsr!.ecosystem).toBe("js");
    expect(jsr!.label).toBe("jsr");
    expect(jsr!.needsPackageScripts).toBe(false);
    expect(jsr!.tokenConfig.envVar).toBe("JSR_TOKEN");
  });

  it("has crates registered with ecosystem rust", () => {
    const crates = registryCatalog.get("crates");
    expect(crates).toBeDefined();
    expect(crates!.ecosystem).toBe("rust");
    expect(crates!.label).toBe("crates.io");
    expect(crates!.needsPackageScripts).toBe(false);
    expect(crates!.tokenConfig.envVar).toBe("CARGO_REGISTRY_TOKEN");
  });

  it("npm has additionalEnvVars", () => {
    const npm = registryCatalog.get("npm")!;
    expect(npm.additionalEnvVars).toBeDefined();
    const vars = npm.additionalEnvVars!("my-token");
    expect(vars["npm_config_//registry.npmjs.org/:_authToken"]).toBe(
      "my-token",
    );
  });
});
```

Add to `packages/core/tests/unit/ecosystem/catalog.test.ts`:

```ts
import { ecosystemCatalog } from "../../../src/ecosystem/catalog.js";

describe("default registrations", () => {
  it("has js ecosystem registered", () => {
    const js = ecosystemCatalog.get("js");
    expect(js).toBeDefined();
    expect(js!.label).toBe("JavaScript ecosystem");
    expect(js!.defaultRegistries).toEqual(["npm", "jsr"]);
  });

  it("has rust ecosystem registered", () => {
    const rust = ecosystemCatalog.get("rust");
    expect(rust).toBeDefined();
    expect(rust!.label).toBe("Rust ecosystem");
    expect(rust!.defaultRegistries).toEqual(["crates"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts tests/unit/ecosystem/catalog.test.ts`
Expected: FAIL — `registryCatalog` and `ecosystemCatalog` not exported

- [ ] **Step 3: Add registrations to catalog files**

Add to `packages/core/src/registry/catalog.ts` (after class definition):

```ts
import { exec } from "../utils/exec.js";
import { getJsrJson, getPackageJson } from "../utils/package.js";
import { cratesRegistry } from "./crates.js";
import { jsrRegistry } from "./jsr.js";
import { npmRegistry } from "./npm.js";

export const registryCatalog = new RegistryCatalog();

registryCatalog.register({
  key: "npm",
  ecosystem: "js",
  label: "npm",
  tokenConfig: {
    envVar: "NODE_AUTH_TOKEN",
    dbKey: "npm-token",
    ghSecretName: "NODE_AUTH_TOKEN",
    promptLabel: "npm access token",
    tokenUrl:
      "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
    tokenUrlLabel: "npmjs.com",
  },
  needsPackageScripts: true,
  additionalEnvVars: (token) => ({
    "npm_config_//registry.npmjs.org/:_authToken": token,
  }),
  resolveTokenUrl: async (baseUrl) => {
    if (!baseUrl.includes("~")) return baseUrl;
    const result = await exec("npm", ["whoami"]);
    const username = result.stdout.trim();
    return username ? baseUrl.replace("~", username) : baseUrl;
  },
  resolveDisplayName: async () => {
    const pkg = await getPackageJson();
    return pkg.name ? [pkg.name] : [];
  },
  factory: () => npmRegistry(),
});

registryCatalog.register({
  key: "jsr",
  ecosystem: "js",
  label: "jsr",
  tokenConfig: {
    envVar: "JSR_TOKEN",
    dbKey: "jsr-token",
    ghSecretName: "JSR_TOKEN",
    promptLabel: "jsr API token",
    tokenUrl: "https://jsr.io/account/tokens/create",
    tokenUrlLabel: "jsr.io",
  },
  needsPackageScripts: false,
  resolveDisplayName: async () => {
    const jsr = await getJsrJson();
    return jsr.name ? [jsr.name] : [];
  },
  factory: () => jsrRegistry(),
});

registryCatalog.register({
  key: "crates",
  ecosystem: "rust",
  label: "crates.io",
  tokenConfig: {
    envVar: "CARGO_REGISTRY_TOKEN",
    dbKey: "cargo-token",
    ghSecretName: "CARGO_REGISTRY_TOKEN",
    promptLabel: "crates.io API token",
    tokenUrl: "https://crates.io/settings/tokens/new",
    tokenUrlLabel: "crates.io",
  },
  needsPackageScripts: false,
  resolveDisplayName: async (ctx) => {
    return (
      ctx.packages
        ?.filter((pkg) => pkg.registries.includes("crates"))
        .map((pkg) => pkg.path) ?? ["crate"]
    );
  },
  factory: (name) => cratesRegistry(name ?? "unknown"),
});
```

Add to `packages/core/src/ecosystem/catalog.ts` (after class definition):

```ts
import { JsEcosystem } from "./js.js";
import { RustEcosystem } from "./rust.js";

export const ecosystemCatalog = new EcosystemCatalog();

ecosystemCatalog.register({
  key: "js",
  label: "JavaScript ecosystem",
  defaultRegistries: ["npm", "jsr"],
  ecosystemClass: JsEcosystem,
  detect: (path) => JsEcosystem.detect(path),
});

ecosystemCatalog.register({
  key: "rust",
  label: "Rust ecosystem",
  defaultRegistries: ["crates"],
  ecosystemClass: RustEcosystem,
  detect: (path) => RustEcosystem.detect(path),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts tests/unit/ecosystem/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry/catalog.ts packages/core/src/ecosystem/catalog.ts packages/core/tests/unit/registry/catalog.test.ts packages/core/tests/unit/ecosystem/catalog.test.ts
git commit -m "feat(core): register npm/jsr/crates and js/rust in catalogs"
```

---

### Task 4: Extend Registry base class

**Files:**
- Modify: `packages/core/src/registry/registry.ts`
- Modify: `packages/core/src/registry/crates.ts`
- Modify: `packages/core/src/registry/jsr.ts`

- [ ] **Step 1: Write tests for new Registry base methods**

Add to `packages/core/tests/unit/registry/catalog.test.ts` (or a new file if preferred):

```ts
describe("Registry base class defaults", () => {
  // Create a minimal concrete subclass for testing
  class TestRegistry extends Registry {
    ping = vi.fn();
    isInstalled = vi.fn().mockResolvedValue(true);
    distTags = vi.fn();
    version = vi.fn();
    publish = vi.fn();
    isPublished = vi.fn();
    isVersionPublished = vi.fn();
    hasPermission = vi.fn().mockResolvedValue(true);
    isPackageNameAvaliable = vi.fn().mockResolvedValue(true);
    getRequirements = vi.fn();
  }

  it("concurrentPublish defaults to true", () => {
    const reg = new TestRegistry("test-pkg");
    expect(reg.concurrentPublish).toBe(true);
  });

  it("orderPackages returns paths unchanged", async () => {
    const reg = new TestRegistry("test-pkg");
    const paths = ["/a", "/b", "/c"];
    expect(await reg.orderPackages(paths)).toEqual(paths);
  });

  it("checkAvailability succeeds when installed and available", async () => {
    const reg = new TestRegistry("test-pkg");
    await expect(reg.checkAvailability({} as any)).resolves.toBeUndefined();
  });

  it("checkAvailability throws when not installed", async () => {
    const reg = new TestRegistry("test-pkg");
    reg.isInstalled.mockResolvedValue(false);
    await expect(reg.checkAvailability({} as any)).rejects.toThrow(
      "not installed",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts`
Expected: FAIL — `concurrentPublish`, `orderPackages`, `checkAvailability` not defined

- [ ] **Step 3: Add new methods to Registry base class**

In `packages/core/src/registry/registry.ts`, add after `dryRunPublish`:

```ts
  get concurrentPublish(): boolean {
    return true;
  }

  async orderPackages(paths: string[]): Promise<string[]> {
    return paths;
  }

  async checkAvailability(
    // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
    _task: any,
  ): Promise<void> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error(`${this.packageName} registry is not installed.`);
    }
    const available = await this.isPackageNameAvaliable();
    if (!available) {
      const hasAccess = await this.hasPermission();
      if (!hasAccess) {
        throw new Error(`No permission to publish ${this.packageName}.`);
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Override in CratesRegistry**

In `packages/core/src/registry/crates.ts`, add to `CratesRegistry` class:

```ts
import { sortCratesByDependencyOrder } from "../utils/crate-graph.js";

get concurrentPublish(): boolean {
  return false;
}

async orderPackages(paths: string[]): Promise<string[]> {
  return sortCratesByDependencyOrder(paths);
}
```

- [ ] **Step 6: Override in JsrRegistry**

In `packages/core/src/registry/jsr.ts`, add `checkAvailability` override. This moves the auto-install prompt logic from `required-conditions-check.ts` into the registry itself:

```ts
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { warningBadge } from "../utils/cli.js";
import { npmRegistry } from "./npm.js";

async checkAvailability(
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
  task: any,
): Promise<void> {
  if (!(await this.isInstalled())) {
    const install = await task
      .prompt(ListrEnquirerPromptAdapter)
      .run<boolean>({
        type: "toggle",
        message: `${warningBadge} jsr is not installed. Do you want to install jsr?`,
        enabled: "Yes",
        disabled: "No",
      });

    if (install) {
      task.output = "Installing jsr...";
      const npm = await npmRegistry();
      await npm.installGlobally("jsr");
    } else {
      throw new Error("jsr is not installed. Please install jsr to proceed.");
    }
  }
  // Delegate to base class for package availability + permission checks
  await super.checkAvailability(task);
}
```

- [ ] **Step 7: Run full test suite**

Run: `cd packages/core && bun vitest --run`
Expected: PASS — no existing tests broken

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/registry/registry.ts packages/core/src/registry/crates.ts packages/core/src/registry/jsr.ts packages/core/tests/unit/registry/catalog.test.ts
git commit -m "feat(core): extend Registry base with concurrentPublish, orderPackages, checkAvailability"
```

---

### Task 5: Extend Ecosystem base class

**Files:**
- Modify: `packages/core/src/ecosystem/ecosystem.ts`

- [ ] **Step 1: Add default implementations for sibling dependency methods**

In `packages/core/src/ecosystem/ecosystem.ts`, add after existing abstract methods:

```ts
  async updateSiblingDependencyVersions(
    _siblingVersions: Map<string, string>,
  ): Promise<boolean> {
    return false;
  }

  async syncLockfile(): Promise<string | undefined> {
    return undefined;
  }

  async dependencies(): Promise<string[]> {
    return [];
  }
```

- [ ] **Step 2: Verify RustEcosystem already overrides these**

Check that `packages/core/src/ecosystem/rust.ts` already has implementations for `updateSiblingDependencyVersions`, `syncLockfile`, and `dependencies`. These should now be overrides of the base class methods rather than standalone additions.

- [ ] **Step 3: Run full test suite**

Run: `cd packages/core && bun vitest --run`
Expected: PASS — no existing tests broken

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ecosystem/ecosystem.ts
git commit -m "feat(core): add sibling dependency methods to Ecosystem base class"
```

---

## Chunk 2: Migrate Consumer Code to Catalogs

### Task 6: Migrate `registry/index.ts`

**Files:**
- Modify: `packages/core/src/registry/index.ts`
- Modify: `packages/core/tests/unit/registry/index.test.ts`

- [ ] **Step 1: Update tests to expect catalog-based behavior**

Rewrite `packages/core/tests/unit/registry/index.test.ts`:
- Remove mocks for `npmRegistry`, `jsrRegistry` (catalog handles this)
- Mock `registryCatalog.get()` instead
- Keep `customRegistry` mock for fallback test
- Test that unknown keys still fall back to `customRegistry()`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/registry/index.test.ts`
Expected: FAIL

- [ ] **Step 3: Replace `registry/index.ts` implementation**

Replace contents of `packages/core/src/registry/index.ts`:

```ts
import type { RegistryType } from "../types/options.js";
import { registryCatalog } from "./catalog.js";
import { customRegistry } from "./custom-registry.js";
import type { Registry } from "./registry.js";

export async function getRegistry(
  registryKey: RegistryType,
  packageName?: string,
): Promise<Registry> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) return await customRegistry();
  return await descriptor.factory(packageName);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/registry/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry/index.ts packages/core/tests/unit/registry/index.test.ts
git commit -m "refactor(core): migrate getRegistry() to catalog-based lookup"
```

---

### Task 7: Migrate `ecosystem/index.ts`

**Files:**
- Modify: `packages/core/src/ecosystem/index.ts`
- Modify: `packages/core/tests/unit/ecosystem/index.test.ts`

- [ ] **Step 1: Update tests to expect catalog-based detection**

Rewrite `packages/core/tests/unit/ecosystem/index.test.ts`:
- Mock `registryCatalog.get()` and `ecosystemCatalog.get()`/`ecosystemCatalog.detect()` instead of individual ecosystem classes
- Same test cases: npm→JsEcosystem, crates→RustEcosystem, auto-detect, null when no manifest

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/index.test.ts`
Expected: FAIL

- [ ] **Step 3: Replace `ecosystem/index.ts` implementation**

```ts
import type { RegistryType } from "../types/options.js";
import { ecosystemCatalog } from "./catalog.js";
import type { Ecosystem } from "./ecosystem.js";
import { registryCatalog } from "../registry/catalog.js";

export async function detectEcosystem(
  packagePath: string,
  registries?: RegistryType[],
): Promise<Ecosystem | null> {
  if (registries?.length) {
    const descriptor = registryCatalog.get(registries[0]);
    if (descriptor) {
      const ecoDescriptor = ecosystemCatalog.get(descriptor.ecosystem);
      if (ecoDescriptor) {
        return new ecoDescriptor.ecosystemClass(packagePath);
      }
    }
  }

  const detected = await ecosystemCatalog.detect(packagePath);
  if (detected) {
    return new detected.ecosystemClass(packagePath);
  }

  return null;
}

export { Ecosystem } from "./ecosystem.js";
export { JsEcosystem } from "./js.js";
export { RustEcosystem } from "./rust.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ecosystem/index.ts packages/core/tests/unit/ecosystem/index.test.ts
git commit -m "refactor(core): migrate detectEcosystem() to catalog-based lookup"
```

---

### Task 8: Migrate `utils/token.ts`

**Files:**
- Modify: `packages/core/src/utils/token.ts`
- Modify: `packages/core/tests/unit/utils/token.test.ts`

- [ ] **Step 1: Update tests**

Update `packages/core/tests/unit/utils/token.test.ts`:
- Replace `TOKEN_CONFIG` import with `registryCatalog` import
- Update `TOKEN_CONFIG` tests → test via `registryCatalog.get("npm").tokenConfig` etc.
- Keep `loadTokensFromDb` and `injectTokensToEnv` behavioral tests
- Add test: `injectTokensToEnv` sets npm's additional env var via catalog

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/utils/token.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite `token.ts` to use catalog**

```ts
import { registryCatalog } from "../registry/catalog.js";
import { SecureStore } from "./secure-store.js";

// Re-export TokenEntry type from catalog for backward compat
export type { TokenEntry } from "../registry/catalog.js";

export function loadTokens(registries: string[]): Record<string, string> {
  const store = new SecureStore();
  const tokens: Record<string, string> = {};

  for (const registry of registries) {
    const descriptor = registryCatalog.get(registry);
    if (!descriptor) continue;
    const config = descriptor.tokenConfig;

    const envValue = process.env[config.envVar];
    if (envValue) {
      tokens[registry] = envValue;
      continue;
    }

    const stored = store.get(config.dbKey);
    if (stored) tokens[registry] = stored;
  }

  return tokens;
}

export const loadTokensFromDb = loadTokens;

export function injectTokensToEnv(tokens: Record<string, string>): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const [registryKey, token] of Object.entries(tokens)) {
    const descriptor = registryCatalog.get(registryKey);
    if (!descriptor) continue;

    const config = descriptor.tokenConfig;
    originals[config.envVar] = process.env[config.envVar];
    process.env[config.envVar] = token;

    const extraVars = descriptor.additionalEnvVars?.(token) ?? {};
    for (const [envVar, value] of Object.entries(extraVars)) {
      originals[envVar] = process.env[envVar];
      process.env[envVar] = value;
    }
  }

  return () => {
    for (const [envVar, original] of Object.entries(originals)) {
      if (original === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = original;
      }
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/utils/token.test.ts`
Expected: PASS

- [ ] **Step 5: Add backward-compat `TOKEN_CONFIG` re-export**

To maintain incremental safety (preflight.ts and dry-run-publish.ts still import `TOKEN_CONFIG`), add a deprecated re-export at the bottom of the rewritten `token.ts`:

```ts
// Deprecated: use registryCatalog.get(key).tokenConfig instead.
// Kept temporarily for backward compat until all consumers are migrated.
export const TOKEN_CONFIG: Record<string, TokenEntry> = Object.fromEntries(
  registryCatalog.all().map((d) => [d.key, d.tokenConfig]),
);
```

This will be removed in Task 11 (preflight) and Task 11b (dry-run-publish) when those consumers are migrated.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/utils/token.ts packages/core/tests/unit/utils/token.test.ts
git commit -m "refactor(core): migrate token management to catalog-based lookup"
```

---

### Task 9: Migrate `tasks/grouping.ts`

**Files:**
- Modify: `packages/core/src/tasks/grouping.ts`
- Create: `packages/core/tests/unit/tasks/grouping.test.ts`

- [ ] **Step 1: Write tests for catalog-based grouping**

```ts
// packages/core/tests/unit/tasks/grouping.test.ts
import { describe, expect, it } from "vitest";
import {
  collectEcosystemRegistryGroups,
  ecosystemLabel,
  registryLabel,
} from "../../../src/tasks/grouping.js";

describe("ecosystemLabel", () => {
  it("returns label from ecosystem catalog", () => {
    expect(ecosystemLabel("js")).toBe("JavaScript ecosystem");
    expect(ecosystemLabel("rust")).toBe("Rust ecosystem");
  });
});

describe("registryLabel", () => {
  it("returns label from registry catalog", () => {
    expect(registryLabel("npm")).toBe("npm");
    expect(registryLabel("jsr")).toBe("jsr");
    expect(registryLabel("crates")).toBe("crates.io");
  });

  it("returns key as-is for unknown registry", () => {
    expect(registryLabel("custom-reg")).toBe("custom-reg");
  });
});

describe("collectEcosystemRegistryGroups", () => {
  it("groups npm and jsr under js ecosystem", () => {
    const groups = collectEcosystemRegistryGroups({
      registries: ["npm", "jsr"],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].ecosystem).toBe("js");
    expect(groups[0].registries).toHaveLength(2);
  });

  it("separates js and rust ecosystems", () => {
    const groups = collectEcosystemRegistryGroups({
      registries: ["npm", "crates"],
    });
    expect(groups).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/grouping.test.ts`
Expected: FAIL — catalog-based functions don't exist yet

- [ ] **Step 3: Rewrite `grouping.ts` to use catalogs**

Replace `registryEcosystemMap`, `ecosystemLabel()` switch, and `registryLabel()` switch:

```ts
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { registryCatalog } from "../registry/catalog.js";

function resolveEcosystem(
  registry: RegistryType,
  fallback?: PackageConfig["ecosystem"],
): EcosystemKey {
  const descriptor = registryCatalog.get(registry);
  return descriptor?.ecosystem ?? fallback ?? "js";
}

export function ecosystemLabel(ecosystem: EcosystemKey): string {
  return ecosystemCatalog.get(ecosystem)?.label ?? `${ecosystem} ecosystem`;
}

export function registryLabel(registry: RegistryType): string {
  return registryCatalog.get(registry)?.label ?? registry;
}
```

Keep `collectEcosystemRegistryGroups`, `countRegistryTargets`, and other functions — they just use `resolveEcosystem` internally which now calls the catalog.

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/grouping.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/grouping.ts packages/core/tests/unit/tasks/grouping.test.ts
git commit -m "refactor(core): migrate grouping to catalog-based lookups"
```

---

### Task 10: Migrate `tasks/required-conditions-check.ts`

**Files:**
- Modify: `packages/core/src/tasks/required-conditions-check.ts`

- [ ] **Step 1: Replace `registryRequirementsMap` with catalog lookup**

Replace:
```ts
const registryRequirementsMap: Record<string, { needsPackageScripts: boolean }> = { ... };
function needsPackageScripts(registries: string[]): boolean {
  return registries.some((r) => registryRequirementsMap[r]?.needsPackageScripts ?? true);
}
```
With:
```ts
function needsPackageScripts(registries: string[]): boolean {
  return registries.some((r) => registryCatalog.get(r)?.needsPackageScripts ?? true);
}
```

- [ ] **Step 2: Replace `createAvailabilityTask()` switch with generic implementation**

Replace the switch statement with:
```ts
const createAvailabilityTask = (
  registryKey: string,
  packagePaths: string[],
): ListrTask<Ctx> => {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) return { title: registryKey, task: async () => {} };

  if (packagePaths.length <= 1) {
    return {
      title: `Checking ${descriptor.label} availability`,
      task: async (_ctx, task): Promise<void> => {
        const registry = await descriptor.factory(packagePaths[0]);
        await registry.checkAvailability(task);
      },
    };
  }

  return {
    title: `Checking ${descriptor.label} availability`,
    task: (_ctx, parentTask): Listr<Ctx> =>
      parentTask.newListr(
        packagePaths.map((packagePath) => ({
          title: packagePath,
          task: async (_ctx, task): Promise<void> => {
            const registry = await descriptor.factory(packagePath);
            await registry.checkAvailability(task);
          },
        })),
        { concurrent: true },
      ),
  };
};
```

- [ ] **Step 3: Replace "Verifying if npm and jsr are installed" section**

This is now handled by `checkAvailability()` on each registry. Replace the hardcoded npm/jsr install check block with a generic one that iterates all registries.

- [ ] **Step 4: Remove unused imports**

Remove: `npmRegistry`, `jsrRegistry`, `npmAvailableCheckTasks`, `jsrAvailableCheckTasks`, `cratesAvailableCheckTasks`, `createCratesAvailableCheckTask`

Add: `import { registryCatalog } from "../registry/catalog.js";`

- [ ] **Step 5: Update test mocks**

In `packages/core/tests/unit/tasks/required-conditions-check.test.ts`:
- Remove mocks for `npmAvailableCheckTasks`, `jsrAvailableCheckTasks`, `cratesAvailableCheckTasks`, `createCratesAvailableCheckTask`
- Remove mocks for `npmRegistry`, `jsrRegistry` (used in the old install-check section)
- Add mock for `registryCatalog`:
```ts
vi.mock("../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn((key: string) => {
      const descriptors: Record<string, any> = {
        npm: {
          label: "npm",
          needsPackageScripts: true,
          factory: vi.fn().mockResolvedValue({
            checkAvailability: vi.fn(),
          }),
        },
        jsr: {
          label: "jsr",
          needsPackageScripts: false,
          factory: vi.fn().mockResolvedValue({
            checkAvailability: vi.fn(),
          }),
        },
        crates: {
          label: "crates.io",
          needsPackageScripts: false,
          factory: vi.fn().mockResolvedValue({
            checkAvailability: vi.fn(),
          }),
        },
      };
      return descriptors[key];
    }),
  },
}));
```

- [ ] **Step 6: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/required-conditions-check.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tasks/required-conditions-check.ts packages/core/tests/unit/tasks/required-conditions-check.test.ts
git commit -m "refactor(core): migrate required-conditions-check to catalog-based lookups"
```

---

### Task 11: Migrate `tasks/preflight.ts`

**Files:**
- Modify: `packages/core/src/tasks/preflight.ts`

- [ ] **Step 1: Replace `TOKEN_CONFIG` usage with catalog**

Replace:
```ts
import { loadTokensFromDb, TOKEN_CONFIG } from "../utils/token.js";
```
With:
```ts
import { loadTokensFromDb } from "../utils/token.js";
import { registryCatalog } from "../registry/catalog.js";
```

- [ ] **Step 2: Replace npm-specific token URL branch**

In `collectTokens()`, replace:
```ts
const config = TOKEN_CONFIG[registry];
if (!config || tokens[registry]) continue;
let { tokenUrl } = config;
if (registry === "npm" && tokenUrl.includes("~")) { ... }
```
With:
```ts
const descriptor = registryCatalog.get(registry);
if (!descriptor || tokens[registry]) continue;
const config = descriptor.tokenConfig;
let { tokenUrl } = config;
if (descriptor.resolveTokenUrl) {
  tokenUrl = await descriptor.resolveTokenUrl(tokenUrl);
}
```

- [ ] **Step 3: Replace `TOKEN_CONFIG` in `syncGhSecrets()`**

Replace `TOKEN_CONFIG[registry]` with `registryCatalog.get(registry)?.tokenConfig`.

- [ ] **Step 4: Run existing tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/preflight.test.ts`
Expected: PASS (may need mock updates for catalog)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/preflight.ts
git commit -m "refactor(core): migrate preflight token collection to catalog"
```

---

### Task 11b: Migrate `dry-run-publish.ts` and remove TOKEN_CONFIG shim

**Files:**
- Modify: `packages/core/src/tasks/dry-run-publish.ts`
- Modify: `packages/core/src/utils/token.ts`

- [ ] **Step 1: Replace `TOKEN_CONFIG` import in `dry-run-publish.ts`**

Replace:
```ts
import { TOKEN_CONFIG } from "../utils/token.js";
```
With:
```ts
import { registryCatalog } from "../registry/catalog.js";
```

- [ ] **Step 2: Update `withTokenRetry()` to use catalog**

Replace:
```ts
const config = TOKEN_CONFIG[registryKey];
if (!config) throw error;
```
With:
```ts
const descriptor = registryCatalog.get(registryKey);
if (!descriptor) throw error;
const config = descriptor.tokenConfig;
```

- [ ] **Step 3: Remove deprecated `TOKEN_CONFIG` re-export from `token.ts`**

Remove the backward-compat shim added in Task 8 Step 5:
```ts
// Remove this block:
export const TOKEN_CONFIG: Record<string, TokenEntry> = Object.fromEntries(
  registryCatalog.all().map((d) => [d.key, d.tokenConfig]),
);
```

- [ ] **Step 4: Verify no remaining `TOKEN_CONFIG` imports**

Run: `grep -rn 'TOKEN_CONFIG' packages/core/src/`
Expected: 0 results

- [ ] **Step 5: Run tests**

Run: `cd packages/core && bun vitest --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tasks/dry-run-publish.ts packages/core/src/utils/token.ts
git commit -m "refactor(core): migrate dry-run-publish to catalog, remove TOKEN_CONFIG shim"
```

---

### Task 12: Migrate `monorepo/discover.ts`

**Files:**
- Modify: `packages/core/src/monorepo/discover.ts`

- [ ] **Step 1: Replace local `defaultRegistries` and `detectEcosystem`**

Replace:
```ts
const defaultRegistries: Record<EcosystemType, RegistryType[]> = {
  js: ["npm", "jsr"],
  rust: ["crates"],
};

function detectEcosystem(packageDir: string): EcosystemType | null {
  if (existsSync(path.join(packageDir, "package.json"))) return "js";
  if (existsSync(path.join(packageDir, "Cargo.toml"))) return "rust";
  return null;
}
```
With:
```ts
import { ecosystemCatalog } from "../ecosystem/catalog.js";

function detectEcosystem(packageDir: string): EcosystemType | null {
  // Synchronous detection — check manifest files from catalog descriptors
  for (const descriptor of ecosystemCatalog.all()) {
    // Use a sync check since discoverPackages is sync
    const EcoClass = descriptor.ecosystemClass;
    const eco = new EcoClass(packageDir);
    const manifests = eco.manifestFiles();
    if (manifests.some((m) => existsSync(path.join(packageDir, m)))) {
      return descriptor.key as EcosystemType;
    }
  }
  return null;
}
```

Replace `defaultRegistries[ecosystem]` references with `ecosystemCatalog.get(ecosystem)?.defaultRegistries ?? []`.

- [ ] **Step 2: Run existing tests**

Run: `cd packages/core && bun vitest --run tests/unit/monorepo/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/monorepo/discover.ts
git commit -m "refactor(core): migrate monorepo discovery to catalog-based ecosystem detection"
```

---

## Chunk 3: Migrate Task Runner

### Task 13: Migrate `runner.ts` — publish/dry-run task dispatch

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Replace `registryTask()` and `dryRunRegistryTask()` switch statements**

Replace `registryTask()` (lines 81-90) and `dryRunRegistryTask()` (lines 140-149) and the crates-specific branches in `collectPublishTasks()` and `collectDryRunPublishTasks()` with generic catalog-based implementations.

New `collectPublishTasks()`:
```ts
async function collectPublishTasks(ctx: Ctx) {
  const groups = collectEcosystemRegistryGroups(ctx);

  const ecosystemTasks = await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packagePaths }) => {
          const descriptor = registryCatalog.get(registry);
          if (!descriptor) return registryTask(registry); // fallback for custom

          const reg = await descriptor.factory();
          const paths = reg.concurrentPublish
            ? packagePaths
            : await reg.orderPackages(packagePaths);

          return {
            title: `Publishing to ${descriptor.label}${reg.concurrentPublish ? "" : " (sequential)"}`,
            task: (_ctx: Ctx, task: NewListrParentTask<Ctx>) =>
              task.newListr(
                paths.map((p) => createPublishTaskForPath(registry, p)),
                { concurrent: reg.concurrentPublish },
              ),
          };
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        task: (_ctx: Ctx, task: NewListrParentTask<Ctx>) =>
          task.newListr(registryTasks, { concurrent: true }),
      };
    }),
  );

  return [...ecosystemTasks, ...pluginPublishTasks(ctx)];
}
```

Apply same pattern to `collectDryRunPublishTasks()`.

- [ ] **Step 2: Remove old `registryTask()` and `dryRunRegistryTask()` functions**

- [ ] **Step 3: Remove unused imports**

Remove: `import { RustEcosystem } from "../ecosystem/rust.js";`, `import { sortCratesByDependencyOrder } from "../utils/crate-graph.js";`
Add: `import { registryCatalog } from "../registry/catalog.js";`

**Note on `createPublishTaskForPath`:** This function bridges the generic dispatch to registry-specific task implementations. The existing per-registry publish task files (`npm.ts`, `jsr.ts`, `crates.ts`) remain unchanged — they are registry internals. The bridge maps a registry key to its publish task:

```ts
import { createCratesPublishTask } from "./crates.js";
import { jsrPublishTasks } from "./jsr.js";
import { npmPublishTasks } from "./npm.js";

// Registry key → publish task mapping (kept in runner, NOT in catalog)
// This is the only remaining mapping, but it's scoped to the runner's listr2 task
// orchestration — each entry delegates to the registry's existing publish task.
const publishTaskMap: Record<string, (packagePath?: string) => ListrTask<Ctx>> = {
  npm: () => npmPublishTasks,
  jsr: () => jsrPublishTasks,
  crates: (packagePath) => createCratesPublishTask(packagePath),
};

function createPublishTaskForPath(
  registryKey: string,
  packagePath: string,
): ListrTask<Ctx> {
  const factory = publishTaskMap[registryKey];
  if (!factory) return { title: `Publish to ${registryKey}`, task: async () => {} };
  return factory(packagePath);
}
```

> **Why this mapping stays in runner:** Per the spec (section 6.3), registry-specific publish task implementations are **registry internals**, not part of this refactoring. The runner must still know which task implementation to call — what's eliminated is the **dispatch branching** (switch/if statements that decide concurrency, ordering, etc.).

- [ ] **Step 4: Run existing runner tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner.test.ts tests/unit/tasks/runner-coverage.test.ts`
Expected: PASS (may need mock updates for catalog)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): migrate runner publish/dry-run dispatch to catalog"
```

---

### Task 14: Migrate `runner.ts` — success message

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

- [ ] **Step 1: Replace registry-specific success message block**

Replace lines 916-936 (the three `if (registries.includes(...))` blocks):

```ts
const registries = collectRegistries(ctx);
const parts: string[] = [];

for (const registryKey of registries) {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor?.resolveDisplayName) continue;
  const names = await descriptor.resolveDisplayName(ctx);
  for (const name of names) {
    parts.push(`${color.bold(name)} on ${descriptor.label}`);
  }
}
```

- [ ] **Step 2: Remove unused imports**

Remove: `getPackageJson`, `getJsrJson` (if only used here — check other usages in the file first)

- [ ] **Step 3: Replace `formatRegistryGroupSummary` crates special case**

Replace `registry === "crates" && packagePaths.length > 1` with a generic multi-package check:

```ts
const packageSummary = packagePaths.length > 1
  ? ` (${packagePaths.length} packages)`
  : "";
```

This removes the crates-specific check — any registry with multiple packages will show the count.

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner.test.ts tests/unit/tasks/runner-coverage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "refactor(core): migrate runner success message to catalog-based display names"
```

---

## Chunk 4: Final Verification

### Task 15: Full test suite + format + typecheck

- [ ] **Step 1: Run format**

Run: `bun run format`
Expected: Clean

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: All pass

- [ ] **Step 4: Verify no remaining type-specific branches**

Search for remaining branching patterns that should have been removed:

```bash
# These should return 0 results in consumer code (tasks/, utils/token.ts, ecosystem/index.ts, registry/index.ts)
grep -rn 'registry === "npm"\|registry === "jsr"\|registry === "crates"' packages/core/src/tasks/ packages/core/src/utils/token.ts packages/core/src/ecosystem/index.ts packages/core/src/registry/index.ts
grep -rn 'registryEcosystemMap\|registryRequirementsMap\|TOKEN_CONFIG' packages/core/src/
```

Allowed exceptions:
- Registry implementation files (`registry/npm.ts`, `registry/jsr.ts`, `registry/crates.ts`) may reference their own type
- `catalog.ts` files contain the registrations

- [ ] **Step 5: Fix any remaining issues found**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(core): finalize registry/ecosystem generalization"
```
