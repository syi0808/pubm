# Manifest-Based Registry Inference Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove explicit `registries` from config and infer registries from manifest files, with package-level private registry support.

**Architecture:** Config types are updated first (PrivateRegistryConfig, optional registries). Then a normalization phase converts private registry objects to string keys via catalog registration. A new `inferRegistries()` function reads manifest files + external config to determine registries. Downstream pipeline (grouping, token, runner) needs minimal changes because the normalization phase produces pure `RegistryType[]`.

**Tech Stack:** TypeScript, Vitest, Bun, Biome

**Spec:** `docs/superpowers/specs/2026-03-13-manifest-based-registry-inference-design.md`

---

## Chunk 1: Types, Config Defaults, and Private Registry Normalization

### Task 1: Add PrivateRegistryConfig type and update PackageConfig

**Files:**
- Modify: `packages/core/src/config/types.ts`
- Test: `packages/core/tests/unit/config/defaults.test.ts`

- [ ] **Step 1: Update types**

In `packages/core/src/config/types.ts`, add the `PrivateRegistryConfig` interface and update `PackageConfig`:

```ts
export interface PrivateRegistryConfig {
  url: string;
  token: { envVar: string };
}

export interface PackageConfig {
  path: string;
  registries?: (RegistryType | PrivateRegistryConfig)[];  // was required RegistryType[]
  ecosystem?: EcosystemKey;
  buildCommand?: string;
  testCommand?: string;
}
```

Remove the `registries` field from `PubmConfig`. Keep it temporarily as `@deprecated` with a comment for migration warning support:

```ts
export interface PubmConfig {
  /** @deprecated Use manifest-based inference. This field is ignored. */
  registries?: RegistryType[];
  // ... rest unchanged
}
```

- [ ] **Step 2: Fix type errors from PackageConfig.registries becoming optional**

Run: `cd packages/core && bunx tsc --noEmit 2>&1 | head -50`

Fix any type errors caused by `registries` becoming optional on `PackageConfig`. The main callsites are in `monorepo/discover.ts` and `utils/registries.ts` — these will be updated in later tasks, so for now add non-null assertions or `?? []` as needed to keep compilation passing.

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `cd packages/core && bun vitest --run tests/unit/config/`
Expected: All existing config tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/config/types.ts
git commit -m "refactor(core): add PrivateRegistryConfig type, make PackageConfig.registries optional"
```

---

### Task 2: Remove hardcoded default registries

**Files:**
- Modify: `packages/core/src/config/defaults.ts`
- Modify: `packages/core/src/options.ts`
- Test: `packages/core/tests/unit/config/defaults.test.ts`

- [ ] **Step 1: Write failing tests for new defaults behavior**

In `packages/core/tests/unit/config/defaults.test.ts`, add/update tests:

```ts
it("should not include default registries in resolved config", () => {
  const resolved = resolveConfig({});
  expect(resolved.registries).toBeUndefined();
});

it("should not include default registries in default package", () => {
  const resolved = resolveConfig({});
  expect(resolved.packages[0].registries).toBeUndefined();
});

it("should warn when deprecated global registries field is present", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  resolveConfig({ registries: ["npm"] });
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining("registries"),
  );
  warnSpy.mockRestore();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/config/defaults.test.ts`
Expected: FAIL — defaults still include registries.

- [ ] **Step 3: Update defaults.ts**

In `packages/core/src/config/defaults.ts`:
- Remove `registries: ["npm", "jsr"]` from defaults
- Remove `registries` from default package config `{ path: "." }`
- Add deprecation warning when `config.registries` is present:

```ts
if (config.registries) {
  console.warn(
    "[pubm] The global 'registries' config field is deprecated and will be ignored. " +
    "Registries are now inferred from manifest files. " +
    "Use per-package 'registries' overrides if needed.",
  );
}
```

- [ ] **Step 4: Update options.ts**

In `packages/core/src/options.ts`:
- Remove `registries: ["npm", "jsr"]` from `defaultOptions`
- Make `registries` optional in `defaultOptions` or remove the field entirely

- [ ] **Step 5: Update Options types**

In `packages/core/src/types/options.ts`:
- Remove `registries` from `Options` and `ResolvedOptions` interfaces (registries are now per-package, not global)

- [ ] **Step 6: Fix compilation and update affected tests**

Run: `cd packages/core && bunx tsc --noEmit 2>&1 | head -80`

Fix type errors. Update existing tests in `defaults.test.ts` that assert on default registries values. The `collectRegistries()` function in `utils/registries.ts` will need its fallback to `ctx.registries` removed — update to only collect from packages.

- [ ] **Step 7: Run all tests**

Run: `cd packages/core && bun vitest --run tests/unit/config/ tests/unit/utils/registries.test.ts`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/config/defaults.ts packages/core/src/options.ts packages/core/src/types/options.ts packages/core/tests/unit/config/ packages/core/src/utils/registries.ts packages/core/tests/unit/utils/registries.test.ts
git commit -m "refactor(core): remove hardcoded default registries, add deprecation warning"
```

---

### Task 3: URL normalization utility

**Files:**
- Create: `packages/core/src/utils/normalize-registry-url.ts`
- Create: `packages/core/tests/unit/utils/normalize-registry-url.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeRegistryUrl } from "../../../src/utils/normalize-registry-url.js";

describe("normalizeRegistryUrl", () => {
  it("strips https protocol", () => {
    expect(normalizeRegistryUrl("https://npm.internal.com")).toBe("npm.internal.com");
  });

  it("strips http protocol", () => {
    expect(normalizeRegistryUrl("http://npm.internal.com")).toBe("npm.internal.com");
  });

  it("strips trailing slash", () => {
    expect(normalizeRegistryUrl("https://npm.internal.com/")).toBe("npm.internal.com");
  });

  it("preserves path segments", () => {
    expect(normalizeRegistryUrl("https://npm.internal.com/team-a/")).toBe("npm.internal.com/team-a");
  });

  it("handles github packages URL", () => {
    expect(normalizeRegistryUrl("https://npm.pkg.github.com")).toBe("npm.pkg.github.com");
  });

  it("handles URL without protocol", () => {
    expect(normalizeRegistryUrl("npm.internal.com")).toBe("npm.internal.com");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/utils/normalize-registry-url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement normalizeRegistryUrl**

```ts
export function normalizeRegistryUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/utils/normalize-registry-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/normalize-registry-url.ts packages/core/tests/unit/utils/normalize-registry-url.test.ts
git commit -m "feat(core): add normalizeRegistryUrl utility"
```

---

### Task 4: Fix CustomRegistry constructor for URL support

**Files:**
- Modify: `packages/core/src/registry/custom-registry.ts`
- Modify: `packages/core/src/registry/npm.ts`
- Test: `packages/core/tests/unit/registry/custom-registry.test.ts` (modify existing)

- [ ] **Step 1: Write failing test**

Add to existing `packages/core/tests/unit/registry/custom-registry.test.ts`:

```ts
describe("CustomRegistry URL support", () => {
  it("uses custom registry URL when provided", () => {
    const registry = new CustomRegistry("test-pkg", "https://npm.internal.com");
    expect(registry.registry).toBe("https://npm.internal.com");
  });

  it("falls back to npm registry when no URL provided", () => {
    const registry = new CustomRegistry("test-pkg");
    expect(registry.registry).toBe("https://registry.npmjs.org");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/custom-registry.test.ts`
Expected: FAIL — custom URL gets overwritten by NpmRegistry's class field.

- [ ] **Step 3: Fix NpmRegistry field initialization**

In `packages/core/src/registry/npm.ts`, change the `registry` field from a class field assignment to a constructor default:

```ts
// Before (line ~14):
// registry = "https://registry.npmjs.org";

// After — remove class field, add explicit constructor:
constructor(packageName?: string, registry?: string) {
  super(packageName, registry ?? "https://registry.npmjs.org");
}
```

Remove the class field `registry = "https://registry.npmjs.org"` line. The base `Registry` constructor sets `this.registry` via its `public registry?` parameter, so the value passed to `super()` will stick.

- [ ] **Step 4: Verify CustomRegistry inherits correctly**

After the NpmRegistry change, `CustomRegistry` (which extends `NpmRegistry` and has no constructor) will inherit the new NpmRegistry constructor. Verify that `new CustomRegistry("pkg", "https://custom.com")` passes the URL through to `super()` → `NpmRegistry(pkg, url)` → `Registry(pkg, url)`. If `CustomRegistry` has its own class fields that override `registry`, add an explicit constructor.

- [ ] **Step 5: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/registry/custom-registry.test.ts tests/unit/registry/npm.test.ts`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/registry/npm.ts packages/core/src/registry/custom-registry.ts packages/core/tests/unit/registry/custom-registry.test.ts
git commit -m "fix(core): fix NpmRegistry/CustomRegistry constructor to accept custom URL"
```

---

### Task 5: Private registry dynamic catalog registration

**Files:**
- Modify: `packages/core/src/registry/catalog.ts`
- Create: `packages/core/tests/unit/registry/private-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/unit/registry/private-registry.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { normalizeRegistryUrl } from "../../../src/utils/normalize-registry-url.js";

// Use a fresh catalog for each test to avoid polluting shared state
import { RegistryCatalog } from "../../../src/registry/catalog.js";
import { registerPrivateRegistry } from "../../../src/registry/catalog.js";
import type { PrivateRegistryConfig } from "../../../src/config/types.js";

describe("registerPrivateRegistry", () => {
  let catalog: RegistryCatalog;

  beforeEach(() => {
    catalog = new RegistryCatalog();
  });

  it("registers a private registry and returns normalized key", () => {
    const config: PrivateRegistryConfig = {
      url: "https://npm.internal.com",
      token: { envVar: "INTERNAL_NPM_TOKEN" },
    };
    const key = registerPrivateRegistry(config, "js", catalog);
    expect(key).toBe("npm.internal.com");
    expect(catalog.get(key)).toBeDefined();
    expect(catalog.get(key)?.ecosystem).toBe("js");
  });

  it("sets tokenConfig from private registry config", () => {
    const config: PrivateRegistryConfig = {
      url: "https://npm.internal.com",
      token: { envVar: "MY_TOKEN" },
    };
    const key = registerPrivateRegistry(config, "js", catalog);
    const descriptor = catalog.get(key)!;
    expect(descriptor.tokenConfig.envVar).toBe("MY_TOKEN");
    expect(descriptor.tokenConfig.dbKey).toBe("npm.internal.com-token");
  });

  it("creates a factory that produces CustomRegistry with correct URL", async () => {
    const config: PrivateRegistryConfig = {
      url: "https://npm.internal.com",
      token: { envVar: "MY_TOKEN" },
    };
    const key = registerPrivateRegistry(config, "js", catalog);
    const descriptor = catalog.get(key)!;
    const registry = await descriptor.factory("my-pkg");
    expect(registry.registry).toBe("https://npm.internal.com");
  });

  it("handles duplicate registration (same URL) without error", () => {
    const config: PrivateRegistryConfig = {
      url: "https://npm.internal.com",
      token: { envVar: "MY_TOKEN" },
    };
    registerPrivateRegistry(config, "js", catalog);
    registerPrivateRegistry(config, "js", catalog);
    expect(catalog.get("npm.internal.com")).toBeDefined();
  });

  it("supports rust ecosystem private registry", () => {
    const config: PrivateRegistryConfig = {
      url: "https://crates.internal.com",
      token: { envVar: "CRATES_TOKEN" },
    };
    const key = registerPrivateRegistry(config, "rust", catalog);
    expect(catalog.get(key)?.ecosystem).toBe("rust");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/registry/private-registry.test.ts`
Expected: FAIL — `registerPrivateRegistry` not exported.

- [ ] **Step 3: Implement registerPrivateRegistry**

In `packages/core/src/registry/catalog.ts`, add:

```ts
import { normalizeRegistryUrl } from "../utils/normalize-registry-url.js";
import type { PrivateRegistryConfig } from "../config/types.js";
import { CustomRegistry } from "./custom-registry.js";

export function registerPrivateRegistry(
  config: PrivateRegistryConfig,
  ecosystemKey: EcosystemKey,
  catalog: RegistryCatalog = registryCatalog,
): string {
  const key = normalizeRegistryUrl(config.url);

  if (catalog.get(key)) return key;  // Already registered

  catalog.register({
    key,
    ecosystem: ecosystemKey,
    label: config.url,
    tokenConfig: {
      envVar: config.token.envVar,
      dbKey: `${key}-token`,
      ghSecretName: config.token.envVar,
      promptLabel: `Token for ${config.url}`,
      tokenUrl: config.url,
      tokenUrlLabel: key,
    },
    needsPackageScripts: false,
    factory: async (packageName) => new CustomRegistry(packageName, config.url),
  });

  return key;
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/registry/private-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry/catalog.ts packages/core/tests/unit/registry/private-registry.test.ts
git commit -m "feat(core): add registerPrivateRegistry for dynamic catalog registration"
```

---

### Task 6: Config resolution — normalize PrivateRegistryConfig to string keys

**Files:**
- Modify: `packages/core/src/config/defaults.ts` (or create `packages/core/src/config/resolve.ts` if separation is cleaner)
- Test: `packages/core/tests/unit/config/defaults.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/core/tests/unit/config/defaults.test.ts`:

```ts
describe("private registry normalization", () => {
  it("normalizes PrivateRegistryConfig objects to string keys in packages", () => {
    const resolved = resolveConfig({
      packages: [
        {
          path: "packages/a",
          registries: [
            "npm",
            { url: "https://npm.internal.com", token: { envVar: "MY_TOKEN" } },
          ],
        },
      ],
    });
    expect(resolved.packages[0].registries).toEqual(["npm", "npm.internal.com"]);
  });

  it("registers private registry in catalog during normalization", () => {
    const { registryCatalog } = await import("../../../src/registry/catalog.js");
    resolveConfig({
      packages: [
        {
          path: "packages/a",
          registries: [
            { url: "https://npm.internal.com", token: { envVar: "MY_TOKEN" } },
          ],
        },
      ],
    });
    expect(registryCatalog.get("npm.internal.com")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/config/defaults.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement normalization in resolveConfig**

In `packages/core/src/config/defaults.ts`, add normalization logic in `resolveConfig()`:

```ts
import { registerPrivateRegistry } from "../registry/catalog.js";
import type { PrivateRegistryConfig } from "./types.js";

// Inside resolveConfig(), after merging defaults:
if (resolved.packages) {
  for (const pkg of resolved.packages) {
    if (!pkg.registries) continue;
    pkg.registries = pkg.registries.map((r) => {
      if (typeof r === "string") return r;
      // Detect ecosystem for this package (from first string registry or default)
      const ecosystemKey = resolveEcosystemKeyForPackage(pkg);
      return registerPrivateRegistry(r as PrivateRegistryConfig, ecosystemKey);
    });
  }
}
```

The `resolveEcosystemKeyForPackage()` helper should look at string registries in the array or fall back to "js":

```ts
function resolveEcosystemKeyForPackage(pkg: PackageConfig): EcosystemKey {
  if (pkg.ecosystem) return pkg.ecosystem;
  const firstStringRegistry = pkg.registries?.find((r) => typeof r === "string");
  if (firstStringRegistry) {
    const descriptor = registryCatalog.get(firstStringRegistry as string);
    if (descriptor) return descriptor.ecosystem;
  }
  return "js";
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/config/defaults.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/defaults.ts packages/core/tests/unit/config/defaults.test.ts
git commit -m "feat(core): normalize PrivateRegistryConfig to string keys in config resolution"
```

---

## Chunk 2: Manifest-Based Registry Inference

### Task 7: JS ecosystem registry inference

**Files:**
- Create: `packages/core/src/ecosystem/infer.ts`
- Create: `packages/core/tests/unit/ecosystem/infer.test.ts`

- [ ] **Step 1: Write failing tests for JS inference**

Create `packages/core/tests/unit/ecosystem/infer.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { stat, readFile } from "node:fs/promises";

vi.mock("node:fs/promises");

const mockedStat = vi.mocked(stat);
const mockedReadFile = vi.mocked(readFile);

describe("inferRegistries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockFileExists(...files: string[]) {
    mockedStat.mockImplementation(async (p) => {
      const path = typeof p === "string" ? p : p.toString();
      if (files.some((f) => path.endsWith(f))) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });
  }

  describe("JS ecosystem", () => {
    it("infers npm when only package.json exists", async () => {
      const { inferRegistries } = await import("../../../src/ecosystem/infer.js");
      mockFileExists("package.json");
      mockedReadFile.mockResolvedValue(JSON.stringify({ name: "test-pkg" }));

      const result = await inferRegistries("/project", "js");
      expect(result).toEqual(["npm"]);
    });

    it("infers npm + jsr when jsr.json exists", async () => {
      const { inferRegistries } = await import("../../../src/ecosystem/infer.js");
      mockFileExists("package.json", "jsr.json");
      mockedReadFile.mockResolvedValue(JSON.stringify({ name: "test-pkg" }));

      const result = await inferRegistries("/project", "js");
      expect(result).toContain("npm");
      expect(result).toContain("jsr");
    });

    it("infers jsr only when only jsr.json exists (no package.json)", async () => {
      const { inferRegistries } = await import("../../../src/ecosystem/infer.js");
      mockFileExists("jsr.json");

      const result = await inferRegistries("/project", "js");
      expect(result).toEqual(["jsr"]);
    });

    it("replaces npm with private registry from publishConfig.registry", async () => {
      const { inferRegistries } = await import("../../../src/ecosystem/infer.js");
      mockFileExists("package.json");
      mockedReadFile.mockImplementation(async (p) => {
        const path = typeof p === "string" ? p : p.toString();
        if (path.endsWith("package.json")) {
          return JSON.stringify({
            name: "test-pkg",
            publishConfig: { registry: "https://npm.internal.com" },
          });
        }
        throw new Error("ENOENT");
      });

      const result = await inferRegistries("/project", "js");
      expect(result).not.toContain("npm");
      expect(result).toContain("npm.internal.com");
    });

    it("replaces npm with private registry from project .npmrc", async () => {
      const { inferRegistries } = await import("../../../src/ecosystem/infer.js");
      mockFileExists("package.json", ".npmrc");
      mockedReadFile.mockImplementation(async (p) => {
        const path = typeof p === "string" ? p : p.toString();
        if (path.endsWith("package.json")) {
          return JSON.stringify({ name: "test-pkg" });
        }
        if (path.endsWith(".npmrc")) {
          return "registry=https://npm.internal.com\n";
        }
        throw new Error("ENOENT");
      });

      const result = await inferRegistries("/project", "js");
      expect(result).not.toContain("npm");
      expect(result).toContain("npm.internal.com");
    });

    it("publishConfig.registry takes precedence over .npmrc", async () => {
      const { inferRegistries } = await import("../../../src/ecosystem/infer.js");
      mockFileExists("package.json", ".npmrc");
      mockedReadFile.mockImplementation(async (p) => {
        const path = typeof p === "string" ? p : p.toString();
        if (path.endsWith("package.json")) {
          return JSON.stringify({
            name: "test-pkg",
            publishConfig: { registry: "https://npm.a.com" },
          });
        }
        if (path.endsWith(".npmrc")) {
          return "registry=https://npm.b.com\n";
        }
        throw new Error("ENOENT");
      });

      const result = await inferRegistries("/project", "js");
      expect(result).toContain("npm.a.com");
      expect(result).not.toContain("npm.b.com");
    });

    it("handles scoped registry from .npmrc", async () => {
      const { inferRegistries } = await import("../../../src/ecosystem/infer.js");
      mockFileExists("package.json", ".npmrc");
      mockedReadFile.mockImplementation(async (p) => {
        const path = typeof p === "string" ? p : p.toString();
        if (path.endsWith("package.json")) {
          return JSON.stringify({ name: "@scope/test-pkg" });
        }
        if (path.endsWith(".npmrc")) {
          return "@scope:registry=https://npm.internal.com\n";
        }
        throw new Error("ENOENT");
      });

      const result = await inferRegistries("/project", "js");
      expect(result).toContain("npm.internal.com");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/infer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement inferRegistries for JS**

Create `packages/core/src/ecosystem/infer.ts`:

```ts
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeRegistryUrl } from "../utils/normalize-registry-url.js";
import { registerPrivateRegistry } from "../registry/catalog.js";
import type { EcosystemKey } from "./catalog.js";
import type { RegistryType } from "../types/options.js";

const NPM_OFFICIAL = "registry.npmjs.org";

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function readJsonSafe(path: string): Promise<Record<string, any> | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function parseNpmrcRegistry(
  npmrcContent: string,
  packageName?: string,
): string | null {
  const lines = npmrcContent.split("\n");

  // Check scoped registry first
  if (packageName?.startsWith("@")) {
    const scope = packageName.split("/")[0];
    for (const line of lines) {
      const match = line.match(
        new RegExp(`^${scope.replace("/", "\\/")}:registry=(.+)$`),
      );
      if (match) return match[1].trim();
    }
  }

  // Check global registry
  for (const line of lines) {
    const match = line.match(/^registry=(.+)$/);
    if (match) return match[1].trim();
  }

  return null;
}

function isOfficialNpmRegistry(url: string): boolean {
  return normalizeRegistryUrl(url).includes(NPM_OFFICIAL);
}

function registryUrlToKey(url: string, ecosystemKey: EcosystemKey): string {
  const key = normalizeRegistryUrl(url);
  // Dynamically register as private registry with env var based on key
  registerPrivateRegistry(
    { url, token: { envVar: `${key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_TOKEN` } },
    ecosystemKey,
  );
  return key;
}

async function inferJsRegistries(packagePath: string, rootPath?: string): Promise<RegistryType[]> {
  const registries: RegistryType[] = [];

  const hasPackageJson = await fileExists(join(packagePath, "package.json"));
  const hasJsrJson = await fileExists(join(packagePath, "jsr.json"));

  if (!hasPackageJson && hasJsrJson) {
    return ["jsr"];
  }

  if (!hasPackageJson) {
    return [];
  }

  // Determine npm registry (official or private)
  const packageJson = await readJsonSafe(join(packagePath, "package.json"));
  const packageName = packageJson?.name as string | undefined;
  const publishConfigRegistry = packageJson?.publishConfig?.registry as string | undefined;

  let npmRegistryUrl: string | null = null;

  // 1. publishConfig.registry takes precedence
  if (publishConfigRegistry) {
    npmRegistryUrl = publishConfigRegistry;
  } else {
    // 2. .npmrc — check package dir first, then workspace root
    //    (In monorepos, .npmrc typically lives at root, not in individual packages)
    const npmrcContent =
      await readFileSafe(join(packagePath, ".npmrc"));
    if (npmrcContent) {
      npmRegistryUrl = parseNpmrcRegistry(npmrcContent, packageName);
    }
    // Also check workspace root .npmrc if package-level not found
    if (!npmRegistryUrl && rootPath && rootPath !== packagePath) {
      const rootNpmrc = await readFileSafe(join(rootPath, ".npmrc"));
      if (rootNpmrc) {
        npmRegistryUrl = parseNpmrcRegistry(rootNpmrc, packageName);
      }
    }
  }

  if (npmRegistryUrl && !isOfficialNpmRegistry(npmRegistryUrl)) {
    // Private registry replaces npm
    registries.push(registryUrlToKey(npmRegistryUrl, "js"));
  } else {
    registries.push("npm");
  }

  // jsr.json → add jsr
  if (hasJsrJson) {
    registries.push("jsr");
  }

  return registries;
}

async function inferRustRegistries(packagePath: string): Promise<RegistryType[]> {
  // Deferred: Rust private registry inference (Cargo.toml [package] publish
  // and .cargo/config.toml [registries]) is out of scope for this task.
  // Will be implemented as a follow-up when Rust private registries are needed.
  return ["crates"];
}

export async function inferRegistries(
  packagePath: string,
  ecosystemKey: EcosystemKey,
  rootPath?: string,
): Promise<RegistryType[]> {
  switch (ecosystemKey) {
    case "js":
      return inferJsRegistries(packagePath, rootPath);
    case "rust":
      return inferRustRegistries(packagePath);
    default:
      return [];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/infer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ecosystem/infer.ts packages/core/tests/unit/ecosystem/infer.test.ts
git commit -m "feat(core): add inferRegistries for manifest-based registry detection"
```

---

### Task 8: Remove registries parameter from detectEcosystem

**Files:**
- Modify: `packages/core/src/ecosystem/index.ts`
- Modify: `packages/core/tests/unit/ecosystem/index.test.ts`

- [ ] **Step 1: Update tests**

In `packages/core/tests/unit/ecosystem/index.test.ts`:
- Remove tests that pass registries to `detectEcosystem()`
- Update remaining tests to only pass `packagePath`
- Add test: `detectEcosystem` uses manifest detection only

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update detectEcosystem**

In `packages/core/src/ecosystem/index.ts`:

```ts
export async function detectEcosystem(
  packagePath: string,
): Promise<Ecosystem | null> {
  // Only auto-detect via manifest files
  const detected = await ecosystemCatalog.detect(packagePath);
  if (detected) {
    return new detected.ecosystemClass(packagePath);
  }
  return null;
}
```

Remove the `registries` parameter and the registry-based ecosystem resolution branch.

- [ ] **Step 4: Fix callsites**

Search for all callers of `detectEcosystem` and remove the second argument. Main callsites:
- `monorepo/discover.ts`
- Any other files passing registries

Run: `cd packages/core && bunx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ecosystem/index.ts packages/core/tests/unit/ecosystem/index.test.ts
git commit -m "refactor(core): remove registries parameter from detectEcosystem"
```

---

### Task 9: Integrate inferRegistries into monorepo discovery

**Files:**
- Modify: `packages/core/src/monorepo/discover.ts`
- Modify: `packages/core/tests/unit/monorepo/discover.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/core/tests/unit/monorepo/discover.test.ts`:

```ts
it("infers registries from manifest files when no config registries", async () => {
  // Setup: package with package.json + jsr.json → should infer ["npm", "jsr"]
  // No config packages provided
  // Assert: discovered package has inferred registries
});

it("uses config registries override when provided", async () => {
  // Setup: package with package.json + jsr.json
  // Config: { path: "packages/a", registries: ["npm"] }
  // Assert: discovered package has ["npm"] only
});

it("infers registries with private registry from publishConfig", async () => {
  // Setup: package.json with publishConfig.registry
  // Assert: discovered package has private registry key
});
```

Adjust mock setup based on existing patterns in `discover.test.ts` (mock `node:fs`, `detectWorkspace`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/monorepo/discover.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update discoverPackages**

In `packages/core/src/monorepo/discover.ts`:

```ts
import { inferRegistries } from "../ecosystem/infer.js";

// Replace the line that uses ecosystemCatalog.get(ecosystem)?.defaultRegistries:
// Before:
// registries: ecosystemCatalog.get(ecosystem)?.defaultRegistries ?? []
// After:
registries: await inferRegistries(absPath, ecosystem)
```

Also update the config merge logic:
```ts
// Before:
// registries: configPkg.registries ?? existing.registries
// After:
registries: configPkg.registries ?? await inferRegistries(absPath, ecosystem)
```

**IMPORTANT: `discoverPackages` sync-to-async migration.** `discoverPackages()` is currently synchronous. Adding `await inferRegistries()` requires making it `async`. This is a breaking change for all callers:

- [ ] **Step 4: Make discoverPackages async**

Change `export function discoverPackages(...)` to `export async function discoverPackages(...)` and update the return type to `Promise<DiscoveredPackage[]>`.

- [ ] **Step 5: Update all callers with await**

Search for all callers of `discoverPackages` and add `await`:

```bash
cd packages/core && grep -rn "discoverPackages" src/ --include="*.ts"
```

Known callers that need updating:
- `packages/core/src/changeset/packages.ts` — calls `discoverPackages()` synchronously, must add `await` and make the enclosing function async if needed
- `packages/core/src/monorepo/index.ts` — re-exports, update the type
- `packages/core/src/index.ts` — re-exports, verify

Pass `rootPath` to `inferRegistries()` so it can check workspace root `.npmrc`:
```ts
registries: await inferRegistries(absPath, ecosystem, options.rootPath)
```

- [ ] **Step 6: Fix compilation**

Run: `cd packages/core && bunx tsc --noEmit 2>&1 | head -50`

Fix all type errors cascading from the sync-to-async change.

- [ ] **Step 7: Update discover.test.ts**

Update test expectations — `discoverPackages` now returns a Promise, so tests must `await` the result.

- [ ] **Step 8: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/monorepo/discover.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/monorepo/discover.ts packages/core/src/monorepo/index.ts packages/core/src/changeset/packages.ts packages/core/tests/unit/monorepo/discover.test.ts
git commit -m "feat(core): integrate inferRegistries into monorepo discovery (async migration)"
```

---

## Chunk 3: Pipeline Cleanup and Integration

### Task 10: Update collectRegistries and grouping

**Files:**
- Modify: `packages/core/src/utils/registries.ts`
- Modify: `packages/core/tests/unit/utils/registries.test.ts`
- Modify: `packages/core/src/tasks/grouping.ts`
- Modify: `packages/core/tests/unit/tasks/grouping.test.ts`

- [ ] **Step 1: Update RegistrySource interface and collectRegistries**

In `packages/core/src/utils/registries.ts`:
- Update `RegistrySource` interface: make `registries` optional (or remove it)
- Remove the fallback to `ctx.registries` (global registries no longer exist)
- Only collect from `ctx.packages`
- If `ctx.packages` is empty, return `[]` (registries will be inferred during discovery)

Also update `RegistrySource` in `packages/core/src/tasks/grouping.ts` (same interface defined there):
- Make `registries` optional or remove it from the interface

- [ ] **Step 2: Update grouping if needed**

In `packages/core/src/tasks/grouping.ts`:
- The `collectEcosystemRegistryGroups()` function's else branch (lines ~83-86) that uses global registries — remove or update to only use packages
- Verify `resolveEcosystem()` still works (it uses `registryCatalog.get()` which now includes dynamically registered private registries)

- [ ] **Step 3: Update tests**

In `packages/core/tests/unit/utils/registries.test.ts`:
- Remove tests for `ctx.registries` fallback
- Add test: returns empty when no packages

In `packages/core/tests/unit/tasks/grouping.test.ts`:
- Update tests that rely on global registries

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/utils/registries.test.ts tests/unit/tasks/grouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/registries.ts packages/core/src/tasks/grouping.ts packages/core/tests/unit/utils/registries.test.ts packages/core/tests/unit/tasks/grouping.test.ts
git commit -m "refactor(core): update collectRegistries and grouping to remove global registries"
```

---

### Task 11: Update preflight and required-conditions-check

**Files:**
- Modify: `packages/core/src/tasks/preflight.ts`
- Modify: `packages/core/src/tasks/required-conditions-check.ts`
- Tests: Verify via existing tests

- [ ] **Step 1: Audit registries references**

Check `preflight.ts` and `required-conditions-check.ts` for any references to global `ctx.registries` or `options.registries`. These should now come from packages only.

- [ ] **Step 2: Update if needed**

Both files already use `registryCatalog.get()` for registry lookups, which will automatically work with dynamically registered private registries. The main concern is whether they reference `ctx.registries` directly — if so, update to use `collectRegistries(ctx)`.

- [ ] **Step 3: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/`
Expected: PASS.

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add packages/core/src/tasks/preflight.ts packages/core/src/tasks/required-conditions-check.ts
git commit -m "refactor(core): update task modules to use package-level registries only"
```

---

### Task 12: Full integration test run

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run all core tests**

Run: `cd packages/core && bun vitest --run`
Expected: All pass.

- [ ] **Step 3: Run full project checks**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All pass.

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "style: format code"
```

---

## Chunk 4: Documentation Updates

### Task 13: Update website docs (use sonnet 4.6)

**Files:**
- Modify: `website/` — config guide, private registry guide, monorepo guide

**Note:** This task should be executed with `model: "sonnet"` to use Sonnet 4.6 as requested by the user.

- [ ] **Step 1: Find website docs related to config/registries**

Search `website/` for files referencing `registries`, config examples, or registry setup guides.

- [ ] **Step 2: Update config guide**

- Remove references to global `registries` field
- Add explanation of manifest-based inference
- Add private registry configuration example in `packages[]`
- Add token management section

- [ ] **Step 3: Update monorepo guide**

- Update to show auto-inference as default
- Add override example

- [ ] **Step 4: Commit**

```bash
git add website/
git commit -m "docs(website): update config and registry docs for manifest-based inference"
```

---

### Task 14: Update README.md (use sonnet 4.6)

**Files:**
- Modify: `README.md`

**Note:** This task should be executed with `model: "sonnet"` to use Sonnet 4.6 as requested by the user.

- [ ] **Step 1: Update Quick Start section**

- Remove `registries` from config examples
- Show minimal config (just `packages` with paths, or zero-config)
- Add brief mention of automatic registry detection

- [ ] **Step 2: Update any registry-related sections**

- Replace explicit registry config with inference explanation
- Add private registry example if a dedicated section exists

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for manifest-based registry inference"
```

---

### Task 15: Final verification

- [ ] **Step 1: Run full project checks one more time**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All pass.

- [ ] **Step 2: Review git log**

Run: `git log --oneline -15`

Verify all commits are clean and well-structured.
