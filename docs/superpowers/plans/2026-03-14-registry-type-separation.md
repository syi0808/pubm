# Registry 타입 분리 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Registry` 클래스를 `RegistryConnector`(레지스트리 수준)와 `PackageRegistry`(패키지 수준)로 분리하여, manifest 없이도 레지스트리 수준 작업(ping 등)을 수행할 수 있게 한다.

**Architecture:** 기존 `Registry` abstract class를 두 개의 abstract class로 분리. `RegistryDescriptor`에 `connector()` 팩토리와 `concurrentPublish`/`orderPackages` 정적 설정 추가. 모든 태스크 파일에서 사용하는 쪽을 용도에 맞게 변경.

**Tech Stack:** TypeScript, Vitest, listr2, Bun

**Spec:** `docs/superpowers/specs/2026-03-14-registry-type-separation-design.md`

---

## 파일 구조

### 신규 생성

| 파일 | 역할 |
|------|------|
| `packages/core/src/registry/connector.ts` | `RegistryConnector` abstract class |
| `packages/core/src/registry/package-registry.ts` | `PackageRegistry` abstract class (`reader` static 포함) |

### 주요 변경

| 파일 | 변경 |
|------|------|
| `packages/core/src/registry/npm.ts` | `NpmRegistry` → `NpmConnector` + `NpmPackageRegistry` |
| `packages/core/src/registry/jsr.ts` | `JsrRegisry` → `JsrConnector` + `JsrPackageRegistry` |
| `packages/core/src/registry/crates.ts` | `CratesRegistry` → `CratesConnector` + `CratesPackageRegistry` |
| `packages/core/src/registry/custom-registry.ts` | `CustomRegistry` → `CustomPackageRegistry` (extends `NpmPackageRegistry`) |
| `packages/core/src/registry/catalog.ts` | `RegistryDescriptor`에 `connector`, `concurrentPublish`, `orderPackages` 추가 |
| `packages/core/src/registry/registry.ts` | 삭제 (connector.ts + package-registry.ts로 대체) |
| `packages/core/src/registry/index.ts` | `getRegistry()` → `getConnector()` + `getPackageRegistry()` |
| `packages/core/src/tasks/required-conditions-check.ts` | ping에서 `connector()` 사용 |
| `packages/core/src/tasks/runner.ts` | `concurrentPublish`/`orderPackages`를 descriptor에서 참조 |
| `packages/core/src/tasks/npm.ts` | `npmRegistry()` → `npmPackageRegistry()` |
| `packages/core/src/tasks/jsr.ts` | `jsrRegistry()` → `jsrPackageRegistry()` |
| `packages/core/src/tasks/crates.ts` | `CratesRegistry` → `CratesPackageRegistry` |
| `packages/core/src/tasks/dry-run-publish.ts` | factory 함수 변경 |
| `packages/core/src/tasks/required-missing-information.ts` | factory 함수 변경 |
| `packages/core/src/ecosystem/ecosystem.ts` | `Registry` → `PackageRegistry` 타입 참조 |
| `packages/core/src/ecosystem/js.ts` | `NpmRegistry`/`JsrRegisry` → `NpmPackageRegistry`/`JsrPackageRegistry` |
| `packages/core/src/ecosystem/rust.ts` | `CratesRegistry` → `CratesPackageRegistry` |
| `packages/core/src/plugin/types.ts` | `Registry` → `PackageRegistry` 타입 참조 |
| `packages/core/src/plugin/runner.ts` | `Registry` → `PackageRegistry` 타입 참조 |
| `packages/core/src/index.ts` | export 경로 변경 (필요 시) |

---

## Chunk 1: Abstract class 분리 및 npm 구현 분리

### Task 1: `RegistryConnector` abstract class 생성

**Files:**
- Create: `packages/core/src/registry/connector.ts`
- Test: `packages/core/tests/unit/registry/connector.test.ts`

- [ ] **Step 1: Write test for RegistryConnector contract**

```typescript
// packages/core/tests/unit/registry/connector.test.ts
import { describe, expect, it } from "vitest";
import { RegistryConnector } from "../../../src/registry/connector.js";

class TestConnector extends RegistryConnector {
  async ping(): Promise<boolean> {
    return true;
  }
  async isInstalled(): Promise<boolean> {
    return true;
  }
  async version(): Promise<string> {
    return "1.0.0";
  }
}

describe("RegistryConnector", () => {
  it("stores registryUrl", () => {
    const connector = new TestConnector("https://registry.npmjs.org");
    expect(connector.registryUrl).toBe("https://registry.npmjs.org");
  });

  it("requires ping, isInstalled, version methods", async () => {
    const connector = new TestConnector("https://example.com");
    expect(await connector.ping()).toBe(true);
    expect(await connector.isInstalled()).toBe(true);
    expect(await connector.version()).toBe("1.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/connector.test.ts`
Expected: FAIL — cannot resolve `connector.js`

- [ ] **Step 3: Write RegistryConnector class**

```typescript
// packages/core/src/registry/connector.ts
export abstract class RegistryConnector {
  constructor(public registryUrl: string) {}

  abstract ping(): Promise<boolean>;
  abstract isInstalled(): Promise<boolean>;
  abstract version(): Promise<string>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/connector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add RegistryConnector abstract class
```

---

### Task 2: `PackageRegistry` abstract class 생성

**Files:**
- Create: `packages/core/src/registry/package-registry.ts`
- Test: `packages/core/tests/unit/registry/package-registry.test.ts`

- [ ] **Step 1: Write test for PackageRegistry contract**

```typescript
// packages/core/tests/unit/registry/package-registry.test.ts
import { describe, expect, it } from "vitest";
import { PackageRegistry } from "../../../src/registry/package-registry.js";

class TestPackageRegistry extends PackageRegistry {
  async publish(): Promise<boolean> { return true; }
  async dryRunPublish(): Promise<void> {}
  async isPublished(): Promise<boolean> { return false; }
  async isVersionPublished(): Promise<boolean> { return false; }
  async hasPermission(): Promise<boolean> { return true; }
  async isPackageNameAvailable(): Promise<boolean> { return true; }
  async distTags(): Promise<string[]> { return []; }
  async checkAvailability(): Promise<void> {}
  getRequirements() { return { needsPackageScripts: false, requiredManifest: "test.json" }; }
}

describe("PackageRegistry", () => {
  it("stores packageName and registry", () => {
    const reg = new TestPackageRegistry("my-package", "https://registry.npmjs.org");
    expect(reg.packageName).toBe("my-package");
    expect(reg.registry).toBe("https://registry.npmjs.org");
  });

  it("has default checkAvailability implementation", async () => {
    const reg = new TestPackageRegistry("my-package");
    // default implementation checks isInstalled → isPackageNameAvailable → hasPermission
    await expect(reg.checkAvailability({} as any)).resolves.toBeUndefined();
  });

  it("has default dryRunPublish as no-op", async () => {
    const reg = new TestPackageRegistry("my-package");
    await expect(reg.dryRunPublish()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/package-registry.test.ts`
Expected: FAIL — cannot resolve `package-registry.js`

- [ ] **Step 3: Write PackageRegistry class**

기존 `registry.ts`의 `Registry` 클래스에서 패키지 수준 부분을 옮긴다. `reader` static property, `registryType` static property, `checkAvailability` default implementation 포함.

```typescript
// packages/core/src/registry/package-registry.ts
import type { ManifestReader } from "../manifest/manifest-reader.js";

export interface RegistryRequirements {
  needsPackageScripts: boolean;
  requiredManifest: string;
}

export abstract class PackageRegistry {
  static reader: ManifestReader;
  static registryType: string;

  constructor(
    public packageName: string,
    public registry?: string,  // 주의: 기존 속성명 'registry' 유지 (하위 호환)
  ) {}

  abstract publish(): Promise<boolean>;
  abstract isPublished(): Promise<boolean>;
  abstract isVersionPublished(version: string): Promise<boolean>;
  abstract hasPermission(): Promise<boolean>;
  abstract isPackageNameAvailable(): Promise<boolean>;
  abstract distTags(): Promise<string[]>;
  abstract getRequirements(): RegistryRequirements;

  async dryRunPublish(_manifestDir?: string): Promise<void> {
    // Default no-op: registries that support dry-run override this
  }

  async checkAvailability(
    // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
    _task: any,
  ): Promise<void> {
    const available = await this.isPackageNameAvailable();
    if (!available) {
      const hasAccess = await this.hasPermission();
      if (!hasAccess) {
        throw new Error(`No permission to publish ${this.packageName}.`);
      }
    }
  }
}
```

참고: 기존 `Registry.checkAvailability`는 `isInstalled()`도 체크했지만, `isInstalled()`은 레지스트리 수준 작업이므로 `RegistryConnector`로 이동. `PackageRegistry.checkAvailability`에서는 제거한다. `isInstalled` 체크는 `required-conditions-check.ts`에서 connector를 통해 별도로 수행.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/package-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add PackageRegistry abstract class
```

---

### Task 3: NpmRegistry를 NpmConnector + NpmPackageRegistry로 분리

**Files:**
- Modify: `packages/core/src/registry/npm.ts`
- Modify: `packages/core/tests/unit/registry/npm.test.ts`

- [ ] **Step 1: npm.test.ts 업데이트 — NpmConnector 테스트 추가**

기존 `NpmRegistry` 테스트 중 `ping`, `isInstalled`, `version` 테스트를 `NpmConnector` describe 블록으로 이동. 나머지는 `NpmPackageRegistry` describe 블록으로 이동.

기존 테스트 파일에서:
- `new NpmRegistry("my-package")` → 패키지 수준 테스트는 `new NpmPackageRegistry("my-package")`
- connector 수준 테스트는 `new NpmConnector()`

import 변경:
```typescript
import { NpmConnector, NpmPackageRegistry, npmConnector, npmPackageRegistry } from "../../../src/registry/npm.js";
```

`beforeEach`에서:
```typescript
let connector: NpmConnector;
let registry: NpmPackageRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetch = vi.fn();
  vi.stubGlobal("fetch", mockedFetch);
  connector = new NpmConnector();
  registry = new NpmPackageRegistry("my-package");
});
```

`npmRegistry()` factory 테스트가 있다면 → `npmPackageRegistry(path)` 테스트로 변경.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/npm.test.ts`
Expected: FAIL — `NpmConnector` not exported

- [ ] **Step 3: npm.ts 리팩토링**

`NpmRegistry` 클래스를 두 클래스로 분리:

```typescript
// packages/core/src/registry/npm.ts
import { RegistryConnector } from "./connector.js";
import { PackageRegistry, type RegistryRequirements } from "./package-registry.js";
// ... 기존 import

// 공통 npm 실행 헬퍼 (Connector와 PackageRegistry 양쪽에서 사용)
async function runNpm(args: string[]): Promise<string> {
  const { stdout } = await exec("npm", args, { throwOnError: true });
  return stdout;
}

export class NpmConnector extends RegistryConnector {
  constructor(registryUrl = "https://registry.npmjs.org") {
    super(registryUrl);
  }

  async ping(): Promise<boolean> {
    try {
      await exec("npm", ["ping"], { throwOnError: true });
      return true;
    } catch (error) {
      throw new NpmError("Failed to run `npm ping`", { cause: error });
    }
  }

  async isInstalled(): Promise<boolean> {
    try {
      await runNpm(["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async version(): Promise<string> {
    try {
      return runNpm(["--version"]);
    } catch (error) {
      throw new NpmError("Failed to run `npm --version`", { cause: error });
    }
  }
}

export class NpmPackageRegistry extends PackageRegistry {
  static override reader = new ManifestReader({
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
  static override registryType = "npm" as const;

  constructor(packageName?: string, registry?: string) {
    super(packageName ?? "", registry ?? "https://registry.npmjs.org");
  }

  protected async npm(args: string[]): Promise<string> {
    return runNpm(args);
  }

  // ... isPublished, isVersionPublished, userName, isLoggedIn,
  //     collaborators, hasPermission, distTags, publish, publishProvenance,
  //     dryRunPublish, twoFactorAuthMode, isPackageNameAvailable, getRequirements,
  //     installGlobally 등 기존 패키지 수준 메서드 전부
}

export function npmConnector(): NpmConnector {
  return new NpmConnector();
}

export async function npmPackageRegistry(packagePath?: string): Promise<NpmPackageRegistry> {
  if (packagePath) {
    const manifest = await NpmPackageRegistry.reader.read(packagePath);
    return new NpmPackageRegistry(manifest.name);
  }
  const manifest = await NpmPackageRegistry.reader.read(process.cwd());
  return new NpmPackageRegistry(manifest.name);
}
```

하위 호환을 위해 기존 `npmRegistry` 이름도 당분간 re-export:
```typescript
/** @deprecated Use npmPackageRegistry */
export const npmRegistry = npmPackageRegistry;
/** @deprecated Use NpmPackageRegistry */
export const NpmRegistry = NpmPackageRegistry;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/npm.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
refactor(core): split NpmRegistry into NpmConnector + NpmPackageRegistry
```

---

### Task 4: JsrRegisry를 JsrConnector + JsrPackageRegistry로 분리

**Files:**
- Modify: `packages/core/src/registry/jsr.ts`
- Modify: `packages/core/tests/unit/registry/jsr.test.ts`

동일한 패턴으로 분리. `JsrRegisry` (기존 오타 포함 이름) → `JsrConnector` + `JsrPackageRegistry`.

- [ ] **Step 1: jsr.test.ts 업데이트**

`ping`, `isInstalled`, `version` 테스트 → `JsrConnector` 블록.
나머지 → `JsrPackageRegistry` 블록.
import 변경: `JsrConnector, JsrPackageRegistry, jsrConnector, jsrPackageRegistry`

하위 호환 re-export도 테스트:
```typescript
import { JsrRegisry, jsrRegistry } from "../../../src/registry/jsr.js";
// JsrRegisry === JsrPackageRegistry
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/jsr.test.ts`

- [ ] **Step 3: jsr.ts 리팩토링**

`JsrConnector`:
- `ping()` — `ping` 명령으로 jsr.io 호스트 접속 확인
- `isInstalled()` — `jsr --version`
- `version()` — `jsr --version`

`JsrPackageRegistry`:
- 기존 `JsrRegisry`의 나머지 메서드 전부
- `JsrClient` 클래스는 그대로 유지 (API 클라이언트)

하위 호환:
```typescript
/** @deprecated Use JsrPackageRegistry */
export const JsrRegisry = JsrPackageRegistry;
/** @deprecated Use jsrPackageRegistry */
export const jsrRegistry = jsrPackageRegistry;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/jsr.test.ts`

- [ ] **Step 5: Commit**

```
refactor(core): split JsrRegisry into JsrConnector + JsrPackageRegistry
```

---

### Task 5: CratesRegistry를 CratesConnector + CratesPackageRegistry로 분리

**Files:**
- Modify: `packages/core/src/registry/crates.ts`
- Modify: `packages/core/tests/unit/registry/crates.test.ts`

- [ ] **Step 1: crates.test.ts 업데이트**

`ping`, `isInstalled` 테스트 → `CratesConnector` 블록.
나머지 → `CratesPackageRegistry` 블록.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/crates.test.ts`

- [ ] **Step 3: crates.ts 리팩토링**

`CratesConnector`:
- `ping()` — `fetch crates.io/api/v1`
- `isInstalled()` — `cargo --version`
- `version()` — `cargo --version`

`CratesPackageRegistry`:
- 기존 나머지 메서드
- `orderPackages()` 메서드는 제거 (descriptor로 이동, Task 7에서 처리)

하위 호환:
```typescript
/** @deprecated Use CratesPackageRegistry */
export const CratesRegistry = CratesPackageRegistry;
/** @deprecated Use cratesPackageRegistry */
export const cratesRegistry = cratesPackageRegistry;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/crates.test.ts`

- [ ] **Step 5: Commit**

```
refactor(core): split CratesRegistry into CratesConnector + CratesPackageRegistry
```

---

### Task 6: CustomRegistry 업데이트

**Files:**
- Modify: `packages/core/src/registry/custom-registry.ts`
- Modify: `packages/core/tests/unit/registry/custom-registry.test.ts`

- [ ] **Step 1: custom-registry.test.ts 업데이트**

`CustomRegistry` → `CustomPackageRegistry`, `NpmRegistry` → `NpmPackageRegistry` import 변경.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/custom-registry.test.ts`

- [ ] **Step 3: custom-registry.ts 변경**

```typescript
import { exec } from "../utils/exec.js";
import { NpmPackageRegistry } from "./npm.js";

export class CustomPackageRegistry extends NpmPackageRegistry {
  async npm(args: string[]): Promise<string> {
    const { stdout } = await exec(
      "npm",
      args.concat("--registry", this.registry!),
      { throwOnError: true },
    );
    return stdout;
  }
}

export async function customPackageRegistry(
  packagePath?: string,
  registryUrl?: string,
): Promise<CustomPackageRegistry> {
  if (packagePath) {
    const manifest = await NpmPackageRegistry.reader.read(packagePath);
    return new CustomPackageRegistry(manifest.name, registryUrl);
  }
  const manifest = await NpmPackageRegistry.reader.read(process.cwd());
  return new CustomPackageRegistry(manifest.name, registryUrl);
}

/** @deprecated */
export const CustomRegistry = CustomPackageRegistry;
/** @deprecated */
export const customRegistry = customPackageRegistry;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/custom-registry.test.ts`

- [ ] **Step 5: Commit**

```
refactor(core): rename CustomRegistry to CustomPackageRegistry
```

---

## Chunk 2: RegistryDescriptor, catalog, index 업데이트

### Task 7: RegistryDescriptor에 connector, concurrentPublish, orderPackages 추가

**Files:**
- Modify: `packages/core/src/registry/catalog.ts`
- Modify: `packages/core/tests/unit/registry/catalog.test.ts`

- [ ] **Step 1: catalog.test.ts에 connector/concurrentPublish 테스트 추가**

```typescript
describe("RegistryDescriptor connector", () => {
  it("npm descriptor has connector that returns NpmConnector", () => {
    const desc = registryCatalog.get("npm");
    const connector = desc!.connector();
    expect(connector).toBeInstanceOf(NpmConnector);
  });

  it("npm descriptor has concurrentPublish true", () => {
    const desc = registryCatalog.get("npm");
    expect(desc!.concurrentPublish).toBe(true);
  });

  it("crates descriptor has concurrentPublish false", () => {
    const desc = registryCatalog.get("crates");
    expect(desc!.concurrentPublish).toBe(false);
  });

  it("crates descriptor has orderPackages function", () => {
    const desc = registryCatalog.get("crates");
    expect(desc!.orderPackages).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts`

- [ ] **Step 3: catalog.ts 수정**

`RegistryDescriptor` 인터페이스에 추가:

```typescript
export interface RegistryDescriptor {
  // ... 기존 필드
  concurrentPublish: boolean;
  orderPackages?: (paths: string[]) => Promise<string[]>;
  connector: () => RegistryConnector;
  // factory는 packagePath 필수로 변경
  factory: (packagePath: string) => Promise<PackageRegistry>;
}
```

각 `registryCatalog.register()` 호출에 추가:

npm:
```typescript
connector: () => npmConnector(),
concurrentPublish: true,
factory: (packagePath) => npmPackageRegistry(packagePath),
```

jsr:
```typescript
connector: () => jsrConnector(),
concurrentPublish: true,
factory: (packagePath) => jsrPackageRegistry(packagePath),
```

crates:
```typescript
connector: () => cratesConnector(),
concurrentPublish: false,
orderPackages: (paths) => sortCratesByDependencyOrder(paths),
factory: (name) => cratesPackageRegistry(name),
```

`resolveDisplayName`의 `process.cwd()` 호출은 유지 (catalog 자체에서 fallback으로 사용하는 것이므로, 이 함수는 `ctx.packages`가 있으면 그쪽에서 이름을 가져옴).

`registerPrivateRegistry` 함수도 업데이트:
```typescript
connector: () => npmConnector(), // private registry도 npm 기반
concurrentPublish: true,
factory: async (packagePath) => {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new CustomPackageRegistry(manifest.name, config.url);
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts`

- [ ] **Step 5: Commit**

```
feat(core): add connector, concurrentPublish, orderPackages to RegistryDescriptor
```

---

### Task 8: registry/index.ts 업데이트

**Files:**
- Modify: `packages/core/src/registry/index.ts`
- Modify: `packages/core/tests/unit/registry/index.test.ts`

- [ ] **Step 1: index.test.ts 업데이트**

기존 `getRegistry()` 테스트를 `getPackageRegistry()`로 변경하고, `getConnector()` 테스트 추가.

```typescript
describe("getConnector()", () => {
  it("returns connector from descriptor for known key", () => {
    const fakeConnector = { ping: vi.fn() };
    const fakeDescriptor = {
      connector: vi.fn().mockReturnValue(fakeConnector),
    };
    mockedCatalogGet.mockReturnValue(fakeDescriptor as any);

    const result = getConnector("npm");

    expect(mockedCatalogGet).toHaveBeenCalledWith("npm");
    expect(result).toBe(fakeConnector);
  });

  it("throws for unknown key", () => {
    mockedCatalogGet.mockReturnValue(undefined);
    expect(() => getConnector("unknown")).toThrow();
  });
});

describe("getPackageRegistry()", () => {
  it("returns registry from catalog factory for known key", async () => {
    const fakeRegistry = { packageName: "test" };
    const fakeDescriptor = {
      factory: vi.fn().mockResolvedValue(fakeRegistry),
    };
    mockedCatalogGet.mockReturnValue(fakeDescriptor as any);

    const result = await getPackageRegistry("npm", "packages/core");

    expect(fakeDescriptor.factory).toHaveBeenCalledWith("packages/core");
    expect(result).toBe(fakeRegistry);
  });

  it("returns custom registry for unknown key", async () => {
    mockedCatalogGet.mockReturnValue(undefined);
    const fakeCustom = { packageName: "custom" };
    mockedCustomPackageRegistry.mockResolvedValue(fakeCustom as any);

    const result = await getPackageRegistry("https://custom.registry.io", ".");

    expect(mockedCustomPackageRegistry).toHaveBeenCalled();
    expect(result).toBe(fakeCustom);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/registry/index.test.ts`

- [ ] **Step 3: index.ts 변경**

```typescript
import type { RegistryType } from "../types/options.js";
import { registryCatalog } from "./catalog.js";
import type { RegistryConnector } from "./connector.js";
import { customPackageRegistry } from "./custom-registry.js";
import type { PackageRegistry } from "./package-registry.js";

export function getConnector(registryKey: RegistryType): RegistryConnector {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) {
    throw new Error(`Unknown registry: ${registryKey}. Cannot create connector.`);
  }
  return descriptor.connector();
}

export async function getPackageRegistry(
  registryKey: RegistryType,
  packagePath: string,
): Promise<PackageRegistry> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) return await customPackageRegistry(packagePath);
  return await descriptor.factory(packagePath);
}

/** @deprecated Use getPackageRegistry */
export const getRegistry = getPackageRegistry;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/registry/index.test.ts`

- [ ] **Step 5: Commit**

```
refactor(core): add getConnector and getPackageRegistry, deprecate getRegistry
```

---

## Chunk 3: 태스크 파일 업데이트

참고: 기존 `registry.ts`는 아직 삭제하지 않는다. deprecated re-export를 통해 기존 import가 동작하는 상태를 유지하면서 소비자 코드를 먼저 모두 업데이트한다. `registry.ts` 삭제는 Chunk 4 마지막(Task 16)에서 수행.

### Task 10: required-conditions-check.ts — ping에서 connector 사용

**Files:**
- Modify: `packages/core/src/tasks/required-conditions-check.ts`
- Modify: `packages/core/tests/unit/tasks/required-conditions-check.test.ts`

- [ ] **Step 1: required-conditions-check.test.ts 업데이트**

ping 태스크 테스트에서 `getRegistry` mock → `getConnector` mock으로 변경.
connector는 `packageName` 없이 생성되므로 manifest 읽기가 없어야 함을 검증.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/required-conditions-check.test.ts`

- [ ] **Step 3: required-conditions-check.ts 변경**

```typescript
// import 변경
import { getConnector } from "../registry/index.js";

// ping 태스크에서:
task: async (): Promise<void> => {
  const connector = getConnector(registry);
  await connector.ping();
},
```

`getRegistry` import 제거 (availability 체크에서 `descriptor.factory(packagePath)`를 직접 사용하므로 `getRegistry`는 이미 불필요).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/required-conditions-check.test.ts`

- [ ] **Step 5: Commit**

```
fix(core): use RegistryConnector for ping — no manifest needed
```

---

### Task 11: runner.ts — concurrentPublish/orderPackages를 descriptor에서 참조

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`
- Modify: `packages/core/tests/unit/tasks/runner.test.ts`
- Modify: `packages/core/tests/unit/tasks/runner-coverage.test.ts`

- [ ] **Step 1: runner.test.ts 업데이트**

`collectPublishTasks` / `collectDryRunPublishTasks`에서 `descriptor.factory()` 호출 후 `reg.concurrentPublish`를 체크하는 부분 → `descriptor.concurrentPublish`로 변경.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner.test.ts`

- [ ] **Step 3: runner.ts 변경**

`collectPublishTasks` 함수 (약 111행):
```typescript
// Before:
const reg = await descriptor.factory();
if (reg.concurrentPublish) { ... }
const paths = await reg.orderPackages(packagePaths);

// After:
if (descriptor.concurrentPublish) {
  return createPublishTaskForPath(registry, packagePaths[0]);
}
const paths = descriptor.orderPackages
  ? await descriptor.orderPackages(packagePaths)
  : packagePaths;
```

`collectDryRunPublishTasks` 함수 (약 197행)에도 동일 적용.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner.test.ts tests/unit/tasks/runner-coverage.test.ts`

- [ ] **Step 5: Commit**

```
refactor(core): use descriptor.concurrentPublish/orderPackages instead of Registry instance
```

---

### Task 12: npm.ts, jsr.ts, crates.ts, dry-run-publish.ts 태스크 파일 업데이트

**Files:**
- Modify: `packages/core/src/tasks/npm.ts`
- Modify: `packages/core/src/tasks/jsr.ts`
- Modify: `packages/core/src/tasks/crates.ts`
- Modify: `packages/core/src/tasks/dry-run-publish.ts`

- [ ] **Step 1: 각 태스크 파일의 import 변경**

`npm.ts`:
```typescript
import { NpmPackageRegistry, npmPackageRegistry } from "../registry/npm.js";
```

`jsr.ts`:
```typescript
import { JsrClient, JsrPackageRegistry, jsrPackageRegistry } from "../registry/jsr.js";
import { npmPackageRegistry } from "../registry/npm.js";
```

`crates.ts`:
```typescript
import { CratesPackageRegistry } from "../registry/crates.js";
```

`dry-run-publish.ts`:
```typescript
import { CratesPackageRegistry } from "../registry/crates.js";
import { jsrPackageRegistry } from "../registry/jsr.js";
import { npmPackageRegistry } from "../registry/npm.js";
```

함수 호출 부분도 변경:
- `npmRegistry()` → `npmPackageRegistry()`
- `jsrRegistry()` → `jsrPackageRegistry()`
- `new CratesRegistry(name)` → `new CratesPackageRegistry(name)`

- [ ] **Step 2: 관련 테스트 실행**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/`
Expected: 모든 태스크 테스트 PASS (deprecated re-export가 있으므로 mock이 여전히 동작)

- [ ] **Step 3: Commit**

```
refactor(core): update task files to use new registry class names
```

---

### Task 13: required-missing-information.ts 업데이트

**Files:**
- Modify: `packages/core/src/tasks/required-missing-information.ts`
- Modify: `packages/core/tests/unit/tasks/required-missing-information.test.ts`

- [ ] **Step 1: import 변경**

```typescript
import { jsrPackageRegistry } from "../registry/jsr.js";
import { npmPackageRegistry } from "../registry/npm.js";
```

함수 호출도 변경. 이 파일은 `distTags()` 호출을 위해 패키지 수준 registry가 필요하므로 `packagePath` 전달 필요. `ctx.config.packages[0]?.path`를 사용.

- [ ] **Step 2: 테스트 실행**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/required-missing-information.test.ts`

- [ ] **Step 3: Commit**

```
refactor(core): update required-missing-information to use PackageRegistry
```

---

## Chunk 4: Ecosystem, Plugin 타입 업데이트 및 정리

### Task 14: Ecosystem 클래스 타입 참조 업데이트

**Files:**
- Modify: `packages/core/src/ecosystem/ecosystem.ts`
- Modify: `packages/core/src/ecosystem/js.ts`
- Modify: `packages/core/src/ecosystem/rust.ts`

- [ ] **Step 1: ecosystem.ts 변경**

```typescript
// Before
import type { Registry } from "../registry/registry.js";
// ...
abstract registryClasses(): (typeof Registry)[];

// After
import type { PackageRegistry } from "../registry/package-registry.js";
// ...
abstract registryClasses(): (typeof PackageRegistry)[];
```

`readManifest()`, `readRegistryVersions()`에서 `RegClass.reader`, `RegClass.registryType` 접근은 `PackageRegistry`의 static property이므로 그대로 동작.

- [ ] **Step 2: js.ts 변경**

```typescript
import { JsrPackageRegistry } from "../registry/jsr.js";
import { NpmPackageRegistry } from "../registry/npm.js";
import type { PackageRegistry } from "../registry/package-registry.js";

// registryClasses():
registryClasses(): (typeof PackageRegistry)[] {
  return [NpmPackageRegistry, JsrPackageRegistry] as unknown as (typeof PackageRegistry)[];
}
```

- [ ] **Step 3: rust.ts 변경**

```typescript
import { CratesPackageRegistry } from "../registry/crates.js";
import type { PackageRegistry } from "../registry/package-registry.js";

registryClasses(): (typeof PackageRegistry)[] {
  return [CratesPackageRegistry] as unknown as (typeof PackageRegistry)[];
}
```

`RustEcosystem`에서 `CratesRegistry.reader.exists()` 호출 → `CratesPackageRegistry.reader.exists()`

- [ ] **Step 4: 테스트 실행**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/`

- [ ] **Step 5: Commit**

```
refactor(core): update Ecosystem types from Registry to PackageRegistry
```

---

### Task 15: Plugin 타입 참조 업데이트

**Files:**
- Modify: `packages/core/src/plugin/types.ts`
- Modify: `packages/core/src/plugin/runner.ts`

- [ ] **Step 1: types.ts 변경**

```typescript
// Before
import type { Registry } from "../registry/registry.js";
// ...
registries?: Registry[];

// After
import type { PackageRegistry } from "../registry/package-registry.js";
// ...
registries?: PackageRegistry[];
```

- [ ] **Step 2: runner.ts 변경**

```typescript
// Before
import type { Registry } from "../registry/registry.js";

// After
import type { PackageRegistry } from "../registry/package-registry.js";
```

내부에서 `Registry` 타입을 사용하는 곳 → `PackageRegistry`로 변경.

- [ ] **Step 3: 테스트 실행**

Run: `cd packages/core && bun vitest --run tests/unit/plugin/`

- [ ] **Step 4: Commit**

```
refactor(core): update Plugin types from Registry to PackageRegistry
```

---

### Task 16: 오타 수정 (isPackageNameAvaliable → isPackageNameAvailable)

**Files:**
- Modify: `packages/core/src/registry/package-registry.ts`
- Modify: `packages/core/src/registry/npm.ts`
- Modify: `packages/core/src/registry/jsr.ts`
- Modify: `packages/core/src/registry/crates.ts`
- Modify: 관련 테스트 파일

기존 코드에서 `isPackageNameAvaliable`으로 오타가 있는 메서드명을 `isPackageNameAvailable`로 일괄 수정.

- [ ] **Step 1: 모든 소스/테스트 파일에서 `isPackageNameAvaliable` → `isPackageNameAvailable` rename**

Run: `cd packages/core && grep -r "isPackageNameAvaliable" src/ tests/` 로 대상 확인 후 일괄 수정.

- [ ] **Step 2: 테스트 실행**

Run: `cd packages/core && bun vitest --run`
Expected: PASS

- [ ] **Step 3: Commit**

```
fix(core): rename isPackageNameAvaliable to isPackageNameAvailable (typo)
```

---

### Task 17: deprecated re-export 정리, registry.ts 삭제 및 최종 검증

**Files:**
- Delete: `packages/core/src/registry/registry.ts`
- Modify: 모든 deprecated re-export가 있는 파일

- [ ] **Step 1: deprecated re-export 제거**

각 registry 파일에서 `@deprecated` 표시된 re-export 제거:
- `npm.ts`: `NpmRegistry`, `npmRegistry` re-export 제거
- `jsr.ts`: `JsrRegisry`, `jsrRegistry` re-export 제거
- `crates.ts`: `CratesRegistry`, `cratesRegistry` re-export 제거
- `custom-registry.ts`: `CustomRegistry`, `customRegistry` re-export 제거
- `index.ts`: `getRegistry` re-export 제거

- [ ] **Step 2: `packages/core/src/registry/registry.ts` 삭제**

모든 소비자가 `connector.ts` 또는 `package-registry.ts`를 사용하도록 업데이트되었으므로 이제 삭제 가능.

- [ ] **Step 3: 전체 빌드, typecheck, 테스트 실행**

Run: `bun run format && bun run typecheck && bun run test`
Expected: 모든 PASS

실패하면 남은 `import ... from "./registry.js"` 또는 deprecated 이름 사용처를 수정.

- [ ] **Step 4: Commit**

```
refactor(core): remove deprecated re-exports and delete old registry.ts
```
