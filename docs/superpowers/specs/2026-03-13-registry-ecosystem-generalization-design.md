# Registry/Ecosystem Generalization Design

## Problem

Registry와 Ecosystem별 비즈니스 로직이 일반화된 인터페이스 없이 ~35곳에서 타입별 분기 처리(switch문, 문자열 비교, 정적 매핑)로 구현되어 있다. 새 registry 추가 시 약 20개 파일을 수정해야 하며, 확장성과 유지보수성이 떨어진다.

## Goals

1. 새 registry/ecosystem 추가 시 수정 범위를 최소화 (클래스 1개 + 카탈로그 등록 1곳)
2. runner 등 소비자 코드에서 registry/ecosystem 타입별 분기 제거
3. PyPI, Maven 등 미래 registry도 동일 패턴으로 추가 가능한 구조

## Approach: 혼합 — 인스턴스 행위는 인터페이스, 정적 메타데이터는 카탈로그

- **런타임 행위** → Registry/Ecosystem 공통 인터페이스 확장
- **정적 메타데이터** (인스턴스 생성 전 참조 필요) → 중앙 카탈로그

분리 기준: 정보를 얼마나 자주 참조하는지, 참조 주체가 인스턴스인지 팩토리/설정 단계인지.

---

## 1. 중앙 카탈로그

### 1.1 Registry Descriptor

파일: `packages/core/src/registry/catalog.ts`

```ts
export interface RegistryDescriptor {
  key: string;
  ecosystem: EcosystemKey;
  label: string;
  tokenConfig: TokenEntry;
  needsPackageScripts: boolean;
  factory: (packageName?: string) => Promise<Registry>;
}
```

통합 대상 (현재 흩어진 매핑):
- `grouping.ts` — `registryEcosystemMap`, `registryLabel()` switch문
- `required-conditions-check.ts` — `registryRequirementsMap`
- `token.ts` — `TOKEN_CONFIG`
- `registry/index.ts` — `registryMap`, `getRegistry()` 분기

### 1.2 Ecosystem Descriptor

파일: `packages/core/src/ecosystem/catalog.ts`

```ts
export interface EcosystemDescriptor {
  key: EcosystemKey;
  label: string;
  defaultRegistries: RegistryType[];
  ecosystemClass: new (path: string) => Ecosystem;
  detect: (packagePath: string) => Promise<boolean>;
}
```

통합 대상:
- `grouping.ts` — `ecosystemLabel()` switch문
- `ecosystem/index.ts` — `registryToEcosystem` 매핑
- `monorepo/discover.ts` — `defaultRegistries` 매핑

### 1.3 카탈로그 API

```ts
class RegistryCatalog {
  register(descriptor: RegistryDescriptor): void;
  get(key: string): RegistryDescriptor;
  getByEcosystem(ecosystem: EcosystemKey): RegistryDescriptor[];
  all(): RegistryDescriptor[];
}

class EcosystemCatalog {
  register(descriptor: EcosystemDescriptor): void;
  get(key: EcosystemKey): EcosystemDescriptor;
  detect(packagePath: string): Promise<EcosystemDescriptor | null>;
  all(): EcosystemDescriptor[];
}
```

### 1.4 Registry 등록 예시

```ts
// packages/core/src/registry/catalog.ts

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
    tokenUrl: "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
    tokenUrlLabel: "npmjs.com",
  },
  needsPackageScripts: true,
  factory: () => npmRegistry(),
});

registryCatalog.register({
  key: "jsr",
  ecosystem: "js",
  label: "jsr",
  tokenConfig: { envVar: "JSR_TOKEN", /* ... */ },
  needsPackageScripts: false,
  factory: () => jsrRegistry(),
});

registryCatalog.register({
  key: "crates",
  ecosystem: "rust",
  label: "crates.io",
  tokenConfig: { envVar: "CARGO_REGISTRY_TOKEN", /* ... */ },
  needsPackageScripts: false,
  factory: (name) => cratesRegistry(name ?? "unknown"),
});
```

---

## 2. Registry 공통 인터페이스 확장

파일: `packages/core/src/registry/registry.ts`

### 2.1 새로 추가되는 멤버

```ts
export abstract class Registry {
  constructor(
    public packageName: string,
    public registry?: string,
  ) {}

  // --- 기존 abstract 메서드 유지 (변경 없음) ---
  abstract ping(): Promise<boolean>;
  abstract isInstalled(): Promise<boolean>;
  abstract distTags(): Promise<string[]>;
  abstract version(): Promise<string>;
  abstract publish(): Promise<boolean>;
  abstract isPublished(): Promise<boolean>;
  abstract isVersionPublished(version: string): Promise<boolean>;
  abstract hasPermission(): Promise<boolean>;
  abstract isPackageNameAvaliable(): Promise<boolean>;
  abstract getRequirements(): RegistryRequirements;

  // --- 새로 추가 ---

  /** 여러 패키지를 동시에 publish할 수 있는지 여부 */
  get concurrentPublish(): boolean {
    return true;
  }

  /** sequential publish 시 패키지 경로를 의존성 순서로 정렬 */
  async orderPackages(paths: string[]): Promise<string[]> {
    return paths;
  }

  /** 토큰 주입 시 추가로 설정해야 할 환경변수 */
  additionalEnvVars(): Record<string, string> {
    return {};
  }

  /** dry-run publish */
  async dryRunPublish(_manifestDir?: string): Promise<void> {}
}
```

### 2.2 구현체별 override

**CratesRegistry:**
```ts
get concurrentPublish(): boolean {
  return false;
}

async orderPackages(paths: string[]): Promise<string[]> {
  return sortCratesByDependencyOrder(paths);
}
```

**NpmRegistry:**
```ts
additionalEnvVars(): Record<string, string> {
  const token = process.env.NODE_AUTH_TOKEN;
  if (!token) return {};
  return { "npm_config_//registry.npmjs.org/:_authToken": token };
}
```

**JsrRegistry, PypiRegistry, MavenRegistry 등:** 기본값 사용 (override 불필요)

---

## 3. Ecosystem 공통 인터페이스 확장

파일: `packages/core/src/ecosystem/ecosystem.ts`

### 3.1 기존 RustEcosystem 전용 메서드를 base로 이동

```ts
export abstract class Ecosystem {
  constructor(public packagePath: string) {}

  // --- 기존 abstract 메서드 유지 (변경 없음) ---
  abstract packageName(): Promise<string>;
  abstract readVersion(): Promise<string>;
  abstract writeVersion(newVersion: string): Promise<void>;
  abstract manifestFiles(): string[];
  abstract defaultTestCommand(): Promise<string> | string;
  abstract defaultBuildCommand(): Promise<string> | string;
  abstract supportedRegistries(): RegistryType[];

  // --- 새로 추가 (기본 구현 제공) ---

  /** sibling 패키지 간 의존성 버전 업데이트 */
  async updateSiblingDependencyVersions(
    _siblingVersions: Map<string, string>,
  ): Promise<boolean> {
    return false;
  }

  /** lockfile 동기화 */
  async syncLockfile(): Promise<string | undefined> {
    return undefined;
  }

  /** 패키지 의존성 목록 */
  async dependencies(): Promise<string[]> {
    return [];
  }

  /** manifest 파일 감지 */
  static detect(_packagePath: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
```

`RustEcosystem`은 이 메서드들을 이미 구현하고 있으므로 변경 없음. `JsEcosystem`과 미래의 `PythonEcosystem` 등은 기본값을 사용.

---

## 4. 소비자 코드 변경 상세

### 4.1 `runner.ts`

**Before:**
```ts
function registryTask(registry: string) {
  switch (registry) {
    case "npm": return npmPublishTasks;
    case "jsr": return jsrPublishTasks;
    default: return npmPublishTasks;
  }
}

if (registry !== "crates") {
  return registryTask(registry);
}
const sortedPaths = await sortCratesByDependencyOrder(packagePaths);
// ... sequential task
```

**After:**
```ts
async function createRegistryPublishTask(
  registryKey: RegistryType,
  packagePaths: string[],
) {
  const descriptor = registryCatalog.get(registryKey);
  const registry = await descriptor.factory();

  const paths = registry.concurrentPublish
    ? packagePaths
    : await registry.orderPackages(packagePaths);

  return {
    title: `Publishing to ${descriptor.label}`,
    task: (_ctx, task) =>
      task.newListr(
        paths.map((p) => createPublishTaskForPath(registryKey, p)),
        { concurrent: registry.concurrentPublish },
      ),
  };
}
```

dry-run도 동일한 패턴:
```ts
async function createRegistryDryRunTask(
  registryKey: RegistryType,
  packagePaths: string[],
) {
  const descriptor = registryCatalog.get(registryKey);
  const registry = await descriptor.factory();

  const paths = registry.concurrentPublish
    ? packagePaths
    : await registry.orderPackages(packagePaths);

  return {
    title: `Dry-run ${descriptor.label} publish`,
    task: (_ctx, task) =>
      task.newListr(
        paths.map((p) => createDryRunTaskForPath(registry, p)),
        { concurrent: registry.concurrentPublish },
      ),
  };
}
```

### 4.2 `grouping.ts`

**Before:**
```ts
const registryEcosystemMap: Record<string, EcosystemKey> = {
  npm: "js", jsr: "js", crates: "rust",
};

export function ecosystemLabel(ecosystem: EcosystemKey): string {
  switch (ecosystem) { case "rust": return "Rust ecosystem"; ... }
}

export function registryLabel(registry: RegistryType): string {
  switch (registry) { case "npm": return "npm"; ... }
}
```

**After:**
```ts
function resolveEcosystem(registry: RegistryType, fallback?: EcosystemKey): EcosystemKey {
  return registryCatalog.get(registry).ecosystem ?? fallback ?? "js";
}

export function ecosystemLabel(ecosystem: EcosystemKey): string {
  return ecosystemCatalog.get(ecosystem).label;
}

export function registryLabel(registry: RegistryType): string {
  return registryCatalog.get(registry).label;
}
```

### 4.3 `required-conditions-check.ts`

**Before:**
```ts
const registryRequirementsMap: Record<string, { needsPackageScripts: boolean }> = {
  npm: { needsPackageScripts: true },
  jsr: { needsPackageScripts: false },
  crates: { needsPackageScripts: false },
};

switch (registryKey) {
  case "npm": return npmAvailableCheckTasks;
  case "jsr": return jsrAvailableCheckTasks;
  case "crates": ...
}
```

**After:**
```ts
function needsPackageScripts(registries: string[]): boolean {
  return registries.some((r) => registryCatalog.get(r).needsPackageScripts);
}

// availability check는 Registry 인터페이스에 추가하거나,
// 각 registry의 기존 메서드(isInstalled, hasPermission, isPackageNameAvaliable)를
// 조합하여 일반화된 task를 생성
```

### 4.4 `token.ts`

**Before:**
```ts
export const TOKEN_CONFIG: Record<string, TokenEntry> = { npm: {...}, jsr: {...}, crates: {...} };

if (registry === "npm") {
  originals[NPM_AUTH_ENV_VAR] = process.env[NPM_AUTH_ENV_VAR];
  process.env[NPM_AUTH_ENV_VAR] = token;
}
```

**After:**
```ts
// TOKEN_CONFIG 제거 — registryCatalog.get(key).tokenConfig 사용

export function injectTokensToEnv(tokens: Record<string, string>): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const [registryKey, token] of Object.entries(tokens)) {
    const config = registryCatalog.get(registryKey).tokenConfig;
    originals[config.envVar] = process.env[config.envVar];
    process.env[config.envVar] = token;

    // 추가 환경변수 처리 (일반화)
    const registry = await registryCatalog.get(registryKey).factory();
    for (const [envVar, value] of Object.entries(registry.additionalEnvVars())) {
      originals[envVar] = process.env[envVar];
      process.env[envVar] = value;
    }
  }

  return () => { /* restore originals */ };
}
```

### 4.5 `ecosystem/index.ts`

**Before:**
```ts
const registryToEcosystem: Record<string, new (path: string) => Ecosystem> = {
  npm: JsEcosystem, jsr: JsEcosystem, crates: RustEcosystem,
};
```

**After:**
```ts
export async function detectEcosystem(
  packagePath: string,
  registries?: RegistryType[],
): Promise<Ecosystem | null> {
  if (registries?.length) {
    const ecosystemKey = registryCatalog.get(registries[0]).ecosystem;
    const descriptor = ecosystemCatalog.get(ecosystemKey);
    return new descriptor.ecosystemClass(packagePath);
  }

  return ecosystemCatalog.detect(packagePath);
}
```

### 4.6 `registry/index.ts`

**Before:**
```ts
if (registryKey === "crates") {
  return await cratesRegistry(packageName ?? "unknown");
}
const registry = registryMap[registryKey];
if (!registry) return await customRegistry();
```

**After:**
```ts
export async function getRegistry(
  registryKey: RegistryType,
  packageName?: string,
): Promise<Registry> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) return await customRegistry();
  return await descriptor.factory(packageName);
}
```

---

## 5. 제거되는 분기 요약

| 파일 | 제거 대상 | 대체 |
|------|-----------|------|
| `runner.ts` | `registryTask()` switch | `registryCatalog.get(key).factory()` |
| `runner.ts` | `dryRunRegistryTask()` switch | 동일 패턴 일반화 |
| `runner.ts` | `if (registry !== "crates")` 분기 2곳 | `registry.concurrentPublish` |
| `runner.ts` | 성공 메시지 `registries.includes("npm/jsr/crates")` 3곳 | 카탈로그 기반 반복 |
| `grouping.ts` | `registryEcosystemMap` | `registryCatalog.get(key).ecosystem` |
| `grouping.ts` | `ecosystemLabel()` switch | `ecosystemCatalog.get(key).label` |
| `grouping.ts` | `registryLabel()` switch | `registryCatalog.get(key).label` |
| `required-conditions-check.ts` | `registryRequirementsMap` | `registryCatalog.get(key).needsPackageScripts` |
| `required-conditions-check.ts` | `createAvailabilityTask()` switch | 일반화된 availability task |
| `token.ts` | `TOKEN_CONFIG` | `registryCatalog.get(key).tokenConfig` |
| `token.ts` | `if (registry === "npm")` | `registry.additionalEnvVars()` |
| `ecosystem/index.ts` | `registryToEcosystem` | `ecosystemCatalog` |
| `registry/index.ts` | `if (registryKey === "crates")` | `registryCatalog.get(key).factory()` |
| `monorepo/discover.ts` | `defaultRegistries` 매핑 | `ecosystemCatalog.get(key).defaultRegistries` |

총 ~35개 분기 → 0개. 새 registry 추가 시 수정: 클래스 1개 + 카탈로그 등록 1곳.

---

## 6. 미래 확장 시나리오

### PyPI 추가

```ts
// 1. packages/core/src/registry/pypi.ts
class PypiRegistry extends Registry { /* ... */ }

// 2. packages/core/src/ecosystem/python.ts
class PythonEcosystem extends Ecosystem {
  manifestFiles() { return ["pyproject.toml"]; }
  defaultBuildCommand() { return "python -m build"; }
  static detect(path) { /* pyproject.toml 확인 */ }
}

// 3. 카탈로그 등록
registryCatalog.register({ key: "pypi", ecosystem: "python", label: "PyPI", ... });
ecosystemCatalog.register({ key: "python", label: "Python ecosystem", ... });
```

### Maven 추가

```ts
// 1. packages/core/src/registry/maven.ts
class MavenRegistry extends Registry {
  get concurrentPublish() { return false; } // signing 때문에 sequential
  additionalEnvVars() { return { MAVEN_GPG_PASSPHRASE: "..." }; }
}

// 2. packages/core/src/ecosystem/java.ts
class JavaEcosystem extends Ecosystem {
  manifestFiles() { return ["pom.xml"]; }
}

// 3. 카탈로그 등록
registryCatalog.register({ key: "maven", ecosystem: "java", label: "Maven Central", ... });
ecosystemCatalog.register({ key: "java", label: "Java ecosystem", ... });
```

Runner, token, grouping 등 기존 코드 수정 불필요.
