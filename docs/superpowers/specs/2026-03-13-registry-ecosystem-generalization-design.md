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
  /** 토큰 주입 시 추가로 설정할 환경변수 (인스턴스 생성 없이 접근 가능) */
  additionalEnvVars?: (token: string) => Record<string, string>;
  /** 토큰 URL에 동적 치환이 필요한 경우 (예: npm의 ~username 치환) */
  resolveTokenUrl?: (baseUrl: string) => Promise<string>;
  /** publish 성공 메시지에 표시할 패키지명 해석 */
  resolveDisplayName?: (ctx: { packages?: PackageConfig[] }) => Promise<string[]>;
  factory: (packageName?: string) => Promise<Registry>;
}
```

> **설계 원칙**: `additionalEnvVars`, `resolveTokenUrl`, `resolveDisplayName`은 인스턴스 생성 전 또는 sync 컨텍스트에서 필요한 정보이므로 Registry 인스턴스 메서드가 아닌 Descriptor에 배치한다.

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
  tokenConfig: { envVar: "JSR_TOKEN", /* ... */ },
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
  tokenConfig: { envVar: "CARGO_REGISTRY_TOKEN", /* ... */ },
  needsPackageScripts: false,
  resolveDisplayName: async (ctx) => {
    return ctx.packages
      ?.filter((pkg) => pkg.registries.includes("crates"))
      .map((pkg) => pkg.path) ?? ["crate"];
  },
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

  /** dry-run publish */
  async dryRunPublish(_manifestDir?: string): Promise<void> {}

  /**
   * availability check 수행.
   * 각 registry가 자신의 check 로직(isInstalled, hasPermission, auto-install 등)을
   * 내부적으로 처리한다. task는 listr2 task wrapper를 받아 prompt/output 제어.
   */
  async checkAvailability(_task: ListrTaskWrapper): Promise<void> {
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

**JsrRegistry:** (auto-install prompt를 checkAvailability에서 처리)
```ts
async checkAvailability(task: ListrTaskWrapper): Promise<void> {
  if (!(await this.isInstalled())) {
    const install = await task.prompt(/* toggle: install jsr? */);
    if (install) {
      task.output = "Installing jsr...";
      await npmRegistry().installGlobally("jsr");
    } else {
      throw new Error("jsr is not installed.");
    }
  }
  // scope/package 가용성 체크
  await super.checkAvailability(task);
}
```

**NpmRegistry, PypiRegistry, MavenRegistry 등:** 기본 `checkAvailability()` 사용 (override 불필요)

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
}
```

> **참고**: `detect()`는 `EcosystemDescriptor.detect`에만 존재한다. Ecosystem base class에는 두지 않는다. 감지 로직의 단일 진입점은 `ecosystemCatalog.detect()`이다.

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

// availability check — Registry.checkAvailability()를 사용하여 일반화
function createAvailabilityTask(
  registryKey: RegistryType,
  packagePaths: string[],
): ListrTask<Ctx> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) return { title: registryKey, task: async () => {} };

  if (packagePaths.length <= 1) {
    return {
      title: `Checking ${descriptor.label} availability`,
      task: async (_ctx, task) => {
        const registry = await descriptor.factory(/* packageName */);
        await registry.checkAvailability(task);
      },
    };
  }

  // multi-package: 각 패키지별 availability check
  return {
    title: `Checking ${descriptor.label} availability`,
    task: (_ctx, parentTask) =>
      parentTask.newListr(
        packagePaths.map((packagePath) => ({
          title: packagePath,
          task: async (_ctx, task) => {
            const registry = await descriptor.factory(packagePath);
            await registry.checkAvailability(task);
          },
        })),
        { concurrent: true },
      ),
  };
}
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
// additionalEnvVars는 Descriptor에 있으므로 인스턴스 생성 불필요 (sync 유지)

export function injectTokensToEnv(tokens: Record<string, string>): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const [registryKey, token] of Object.entries(tokens)) {
    const descriptor = registryCatalog.get(registryKey);
    if (!descriptor) continue;

    const config = descriptor.tokenConfig;
    originals[config.envVar] = process.env[config.envVar];
    process.env[config.envVar] = token;

    // 추가 환경변수 처리 — Descriptor에서 직접 참조 (async factory 호출 불필요)
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

## 6. 추가 변경 대상

### 6.1 `preflight.ts` — 토큰 URL 동적 치환

**Before:**
```ts
if (registry === "npm" && tokenUrl.includes("~")) {
  const result = await exec("npm", ["whoami"]);
  const username = result.stdout.trim();
  if (username) tokenUrl = tokenUrl.replace("~", username);
}
```

**After:**
```ts
const descriptor = registryCatalog.get(registry);
if (descriptor?.resolveTokenUrl) {
  tokenUrl = await descriptor.resolveTokenUrl(tokenUrl);
}
```

### 6.2 `runner.ts` — 성공 메시지

**Before:** 3개의 `if (registries.includes("npm/jsr/crates"))` 분기

**After:**
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

### 6.3 `dry-run-publish.ts` — 범위 명확화

`dry-run-publish.ts` 내부의 registry별 publish/dry-run 로직(`npmDryRunPublishTask`, `jsrDryRunPublishTask`, `createCratesDryRunPublishTask`)은 **registry 구현 내부 로직**이므로 이번 리팩토링의 대상이 아니다.

이번 리팩토링의 범위는 **소비자/오케스트레이션 코드의 분기 제거**이다:
- `runner.ts`의 `dryRunRegistryTask()` switch문 → 일반화된 `createRegistryDryRunTask()` 사용
- 각 registry의 dry-run 구현체는 기존대로 유지 (Registry 인터페이스 뒤에 캡슐화)

### 6.4 `monorepo/discover.ts` — ecosystem 감지

**Before:**
```ts
const defaultRegistries: Record<EcosystemType, RegistryType[]> = {
  js: ["npm", "jsr"],
  rust: ["crates"],
};
// 자체 detectEcosystem 함수
```

**After:**
```ts
// defaultRegistries → ecosystemCatalog.get(key).defaultRegistries
// detectEcosystem → ecosystemCatalog.detect(packagePath)
```

### 6.5 CustomRegistry 처리

`CustomRegistry`는 카탈로그에 등록하지 않는다. fallback으로만 동작한다:

- `registryCatalog.get(key)`는 미등록 key에 대해 `undefined`를 반환 (throw하지 않음)
- `getRegistry()`는 descriptor가 없으면 `customRegistry()`로 fallback
- Custom registry는 preflight 토큰 흐름을 사용하지 않으므로 `tokenConfig`가 불필요
- `NpmRegistry`를 상속하므로 기본 `checkAvailability()`, `concurrentPublish` 등을 그대로 사용

### 6.6 기본 registries 설정

`options.ts`와 `config/defaults.ts`의 `registries: ["npm", "jsr"]` 기본값은 **의도적 제품 결정**이다. JS가 primary use case이므로 기본값으로 유지한다. 이는 일반화 대상이 아닌 설정값이다.

### 6.7 `factory` 인터페이스의 `packageName` 파라미터

`factory: (packageName?: string) => Promise<Registry>`에서 `packageName`이 optional인 이유:
- npm/jsr: 내부적으로 `getPackageJson()`에서 패키지명을 해석
- crates: 외부에서 패키지명을 전달받아야 함

이 비대칭은 허용한다. 각 registry의 패키지명 해석 전략이 다르기 때문이며, factory 호출자(`getRegistry`)는 이미 `packageName`을 optional로 전달하고 있다. 새 registry 추가 시 필요하면 `packageName`을 사용, 불필요하면 무시한다.

---

## 7. 설계 원칙 요약

1. **소비자 코드에서 분기 제거** — runner, grouping, token 등은 registry/ecosystem 타입을 알지 못한다
2. **인스턴스 행위는 인터페이스** — `concurrentPublish`, `orderPackages()`, `checkAvailability()`, `dryRunPublish()` 등 런타임 동작은 Registry/Ecosystem 메서드로
3. **정적 메타데이터는 카탈로그** — `tokenConfig`, `label`, `ecosystem`, `additionalEnvVars`, `resolveTokenUrl` 등 인스턴스 생성 전에 필요한 정보는 Descriptor로
4. **registry 구현 내부 로직은 유지** — 각 registry의 publish/dry-run task 구현체(`npm.ts`, `jsr.ts`, `crates.ts`)는 Registry 인터페이스 뒤에 캡슐화된 상태로 유지
5. **CustomRegistry는 fallback** — 카탈로그 미등록 registry는 CustomRegistry로 처리

---

## 8. 미래 확장 시나리오

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
}

// 2. packages/core/src/ecosystem/java.ts
class JavaEcosystem extends Ecosystem {
  manifestFiles() { return ["pom.xml"]; }
}

// 3. 카탈로그 등록
registryCatalog.register({
  key: "maven",
  ecosystem: "java",
  label: "Maven Central",
  additionalEnvVars: (token) => ({ MAVEN_GPG_PASSPHRASE: token }),
  // ...
});
ecosystemCatalog.register({ key: "java", label: "Java ecosystem", ... });
```

Runner, token, grouping 등 기존 코드 수정 불필요.
