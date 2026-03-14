# ManifestReader + Package Discovery 통합 리팩토링

## 문제

패키지 탐색, manifest 읽기, 버전 추출이 코드베이스 전반에 파편화되어 있다.

### manifest 읽기 중복 (7곳)

| 함수 | 위치 | 방식 |
|------|------|------|
| `getPackageJson()` | utils/package.ts | async, 캐싱 |
| `getJsrJson()` | utils/package.ts | async, 캐싱 |
| `JsEcosystem.readPackageJson()` | ecosystem/js.ts | async, 캐싱 없음 |
| `RustEcosystem.readCargoToml()` | ecosystem/rust.ts | async, 캐싱 없음 |
| `isPrivatePackage()` | monorepo/discover.ts | sync readFileSync |
| `readPackageDependencies()` | tasks/required-missing-information.ts | async readFile |
| `readJsonSafe()` | ecosystem/infer.ts | async |

### 버전 탐색 중복 (3곳)

| 함수 | 반환 |
|------|------|
| `discoverCurrentVersions()` | `Map<name, version>` |
| `discoverPackageInfos()` | `{ name, version, path }[]` |
| `version()` | 단일 버전 string |

셋 다 `discoverPackages()` + manifest 읽기를 반복한다.

### 버전 쓰기 중복 (5곳)

| 함수 | 위치 |
|------|------|
| `replaceVersion()` | utils/package.ts |
| `replaceVersionAtPath()` | utils/package.ts |
| `replaceVersions()` | utils/package.ts (내부에서 이름 재읽기) |
| `JsEcosystem.writeVersion()` | ecosystem/js.ts |
| `RustEcosystem.writeVersion()` | ecosystem/rust.ts |

### ecosystem 감지 중복 (2곳)

| 위치 | 방식 |
|------|------|
| `discover.ts` 로컬 `detectEcosystem()` | sync |
| `ecosystem/index.ts` `detectEcosystem()` | async |

### 재탐색 문제

`resolveConfig()`에서 이미 패키지를 탐색/resolve하지만, `required-missing-information.ts`와 `runner.ts`에서 `discoverPackageInfos()` / `discoverCurrentVersions()`를 호출해 재탐색한다. `ctx.config.packages`가 무시되고, config에 명시한 패키지와 런타임 탐색 결과가 불일치할 수 있다.

---

## 설계

### 1. ManifestReader

schema(파일명, 파서, 필드 매핑)를 주입받는 단일 클래스. 상속 없이 설정으로 확장한다.

```typescript
// manifest-reader.ts

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
    if (this.cache.has(packagePath)) {
      return this.cache.get(packagePath)!;
    }

    const raw = await readFile(
      join(packagePath, this.schema.file),
      "utf-8",
    );
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

특징:
- ecosystem/registry에 의존하지 않음
- 캐싱 내장 (같은 경로 재읽기 방지)
- `read(packagePath)` — 경로를 호출 시 받음 (static 소유 가능)
- `exists(packagePath)` — manifest 파일 존재 여부 확인
- `invalidate(packagePath)` / `clearCache()` — 버전 쓰기 후 stale 캐시 방지

### 2. Registry ↔ ManifestReader

각 Registry가 static으로 ManifestReader를 소유한다. registry는 자기 manifest 형식을 안다.

```typescript
class NpmRegistry extends Registry {
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
}

class JsrRegistry extends Registry {
  static reader = new ManifestReader({
    file: "jsr.json",
    parser: JSON.parse,
    fields: {
      name: (p) => (p.name as string) ?? "",
      version: (p) => (p.version as string) ?? "0.0.0",
      private: (p) => false,
      dependencies: (p) => [],
    },
  });
}

class CratesRegistry extends Registry {
  static reader = new ManifestReader({
    file: "Cargo.toml",
    parser: parseToml,
    fields: {
      name: (p) => ((p.package as Record<string, unknown>)?.name as string) ?? "",
      version: (p) => ((p.package as Record<string, unknown>)?.version as string) ?? "0.0.0",
      private: (p) => {
        const pkg = p.package as Record<string, unknown> | undefined;
        if (pkg?.publish === false) return true;
        if (Array.isArray(pkg?.publish) && (pkg.publish as unknown[]).length === 0) return true;
        return false;
      },
      dependencies: (p) => [
        ...Object.keys((p.dependencies as Record<string, unknown>) ?? {}),
        ...Object.keys((p["build-dependencies"] as Record<string, unknown>) ?? {}),
      ],
    },
  });
}
```

### 3. Ecosystem ↔ Registry

Ecosystem이 소속 registry들을 참조한다. manifest 읽기는 registry의 reader를 통해 접근한다.

```typescript
abstract class Ecosystem {
  constructor(public packagePath: string) {}

  // 소속 registry 클래스들 (서브클래스에서 정의)
  abstract registryClasses(): (typeof Registry)[];

  // 첫 번째로 존재하는 manifest에서 읽기 (jsr-only 패키지 대응)
  async readManifest(): Promise<PackageManifest> {
    for (const RegistryClass of this.registryClasses()) {
      if (await RegistryClass.reader.exists(this.packagePath)) {
        return RegistryClass.reader.read(this.packagePath);
      }
    }
    throw new Error(`No manifest found at ${this.packagePath}`);
  }

  // 모든 registry의 reader에서 버전 읽기 (불일치 감지용)
  async readRegistryVersions(): Promise<Map<RegistryType, string>> {
    const versions = new Map<RegistryType, string>();
    for (const RegistryClass of this.registryClasses()) {
      if (await RegistryClass.reader.exists(this.packagePath)) {
        const manifest = await RegistryClass.reader.read(this.packagePath);
        versions.set(RegistryClass.registryType, manifest.version);
      }
    }
    return versions;
  }

  // 기존 메서드들은 reader에 위임
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

  // 쓰기는 서브클래스에서 구현
  abstract writeVersion(newVersion: string): Promise<void>;
  abstract manifestFiles(): string[];
  abstract defaultTestCommand(): Promise<string> | string;
  abstract defaultBuildCommand(): Promise<string> | string;
  abstract supportedRegistries(): RegistryType[];

  // 3-phase 버전 쓰기 지원 (base class no-op, 서브클래스에서 override)
  async updateSiblingDependencyVersions(
    _siblingVersions: Map<string, string>,
  ): Promise<boolean> {
    return false;
  }

  async syncLockfile(): Promise<string | undefined> {
    return undefined;
  }
}

class JsEcosystem extends Ecosystem {
  registryClasses() { return [NpmRegistry, JsrRegistry]; }
  // writeVersion: package.json + jsr.json 모두 업데이트 (기존 구현 유지)
  // updateSiblingDependencyVersions: base class no-op (향후 구현 가능)
  // syncLockfile: base class no-op (향후 구현 가능)
}

class RustEcosystem extends Ecosystem {
  registryClasses() { return [CratesRegistry]; }
  // writeVersion: Cargo.toml 업데이트 (기존 구현 유지)
  // updateSiblingDependencyVersions: sibling crate dependency version 업데이트 (기존 구현 유지)
  // syncLockfile: cargo update --package (기존 구현 유지)
}
```

### 4. ResolvedPackageConfig

```typescript
// config/types.ts

export interface ResolvedPackageConfig extends PackageConfig {
  name: string;
  version: string;
  registryVersions?: Map<RegistryType, string>; // registry별 버전 불일치 시에만 존재
}

export interface ResolvedPubmConfig
  extends Required<Omit<PubmConfig, "packages" | "validate" | "registries">> {
  packages: ResolvedPackageConfig[];
  validate: Required<ValidateConfig>;
  discoveryEmpty?: boolean;
}
```

- `version` — 첫 번째로 존재하는 manifest의 버전 (primary)
- `registryVersions` — 불일치 시에만 채워짐 (예: `{ npm: "1.2.0", jsr: "1.3.0" }`)

참고: `ResolvedPackageConfig`는 `PackageConfig`를 extends하지만, `registries` 타입이 `(RegistryType | PrivateRegistryConfig)[]`에서 resolve된 `RegistryType[]`로 좁혀져야 한다. 이는 `resolveConfig()` 내에서 private registry를 등록하고 key로 변환하는 기존 로직을 유지하되, 타입을 명시적으로 override한다.

```typescript
export interface ResolvedPackageConfig extends Omit<PackageConfig, "registries"> {
  name: string;
  version: string;
  registries: RegistryType[];
  registryVersions?: Map<RegistryType, string>;
}
```

### 5. discoverPackages() 리팩토링

```typescript
// monorepo/discover.ts

export interface ResolvedPackage {
  name: string;
  version: string;
  path: string;
  ecosystem: EcosystemKey;
  registries: RegistryType[];
  dependencies: string[];
  registryVersions?: Map<RegistryType, string>;
}

export async function discoverPackages(options: {
  cwd: string;
  packages?: PackageConfig[];
  ignore?: string[];
}): Promise<ResolvedPackage[]> {
  const { cwd, packages, ignore = [] } = options;

  // Phase 1: 경로 수집
  let targets: { path: string; ecosystem?: EcosystemType; registries?: RegistryType[] }[];

  if (packages && packages.length > 0) {
    // config.packages 제공 시 워크스페이스 탐색 완전히 스킵 (의도된 breaking change)
    targets = packages.map((pkg) => ({
      path: pkg.path,
      ecosystem: pkg.ecosystem,
      registries: pkg.registries as RegistryType[],
    }));
  } else {
    // 워크스페이스 탐색
    targets = await discoverFromWorkspace(cwd, ignore);
  }

  // Phase 2: 각 경로에서 Ecosystem 감지 → ManifestReader로 정보 수집 (병렬)
  const results = await Promise.all(
    targets.map((target) => resolvePackage(cwd, target)),
  );

  return results.filter((r): r is ResolvedPackage => r !== null);
}

async function resolvePackage(
  cwd: string,
  target: { path: string; ecosystem?: EcosystemType; registries?: RegistryType[] },
): Promise<ResolvedPackage | null> {
  const absPath = path.resolve(cwd, target.path);

  // Ecosystem 감지 (ecosystemCatalog.detect()로 통일)
  const ecosystemDescriptor = target.ecosystem
    ? ecosystemCatalog.get(target.ecosystem)
    : await ecosystemCatalog.detect(absPath);
  if (!ecosystemDescriptor) return null;

  // Ecosystem 인스턴스 생성
  const ecosystem = new ecosystemDescriptor.ecosystemClass(absPath);

  // ManifestReader를 통한 manifest 읽기
  const manifest = await ecosystem.readManifest();
  if (manifest.private) return null;

  // registry별 버전 불일치 감지
  const registryVersions = await ecosystem.readRegistryVersions();
  const versions = [...registryVersions.values()];
  const hasVersionMismatch = versions.length > 1 && !versions.every((v) => v === versions[0]);

  // registry 추론 (config에서 제공되지 않은 경우)
  const registries = target.registries ?? await inferRegistries(absPath, ecosystemDescriptor.key, cwd);

  return {
    name: manifest.name,
    version: manifest.version,
    path: target.path,
    ecosystem: ecosystemDescriptor.key,
    registries,
    dependencies: manifest.dependencies,
    ...(hasVersionMismatch ? { registryVersions } : {}),
  };
}
```

### 6. resolveConfig() 변경

```typescript
// config/defaults.ts

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

### 7. required-missing-information.ts 변경

재탐색 제거 — `ctx.config.packages`에서 바로 사용.

```typescript
task: async (ctx, task): Promise<void> => {
  const { packages } = ctx.config;
  const isSinglePackage = packages.length <= 1;

  // 버전 불일치 패키지 처리 (불일치 시에만 프롬프트)
  const mismatchedPackages = packages.filter((p) => p.registryVersions);
  if (mismatchedPackages.length > 0) {
    await handleVersionMismatch(ctx, task, mismatchedPackages);
  }

  if (isSinglePackage) {
    await handleSinglePackage(ctx, task);
  } else {
    await handleMultiPackage(ctx, task, packages);
  }
}
```

버전 불일치 프롬프트:

```typescript
async function handleVersionMismatch(
  ctx: PubmContext,
  task: ...,
  packages: ResolvedPackageConfig[],
): Promise<void> {
  for (const pkg of packages) {
    if (!pkg.registryVersions) continue;

    const entries = [...pkg.registryVersions.entries()]
      .map(([reg, ver]) => `${reg}: ${ver}`)
      .join(", ");

    const choice = await task.prompt(...).run({
      type: "select",
      message: `${pkg.name}의 registry별 버전이 다릅니다 (${entries})`,
      choices: [
        { message: "버전 통일", name: "unify" },
        { message: "registry별 독립 관리", name: "split" },
      ],
    });

    if (choice === "split") {
      // ctx.config.packages에서 해당 패키지를 registry별로 분리
      // 같은 name/path이지만 registries와 version이 다른 별도 항목으로
    }
  }
}
```

### 8. 버전 쓰기 통일 (3-phase orchestration)

`replaceVersion()`, `replaceVersionAtPath()`, `replaceVersions()`를 삭제하고, Ecosystem의 3-phase 메서드로 통일한다.

3-phase 패턴:
1. **Phase 1**: 각 패키지 manifest에 버전 쓰기 (`writeVersion()`)
2. **Phase 2**: sibling dependency 업데이트 (`updateSiblingDependencyVersions()`) — Rust에서 필요: `cargo publish` 시 path dependency가 무시되므로 sibling crate의 version 필드를 맞춰야 함
3. **Phase 3**: lockfile 동기화 (`syncLockfile()`)

Phase 2, 3은 Ecosystem base class에서 no-op 기본 구현. Rust만 override하며, JS는 향후 필요 시 구현.

```typescript
// 일반화된 orchestrator 함수

async function writeVersionsForEcosystem(
  ecosystems: { eco: Ecosystem; pkg: ResolvedPackageConfig }[],
  versions: Map<string, string>,
): Promise<string[]> {
  const modifiedFiles: string[] = [];

  // Phase 1: 각 패키지 manifest에 버전 쓰기
  for (const { eco } of ecosystems) {
    const name = await eco.packageName();
    const version = versions.get(name);
    if (version) {
      await eco.writeVersion(version);
      // 캐시 무효화 (버전이 변경되었으므로)
      for (const RegistryClass of eco.registryClasses()) {
        RegistryClass.reader.invalidate(eco.packagePath);
      }
    }
  }

  // Phase 2: sibling dependency 업데이트
  if (ecosystems.length > 1) {
    await Promise.all(
      ecosystems.map(({ eco }) =>
        eco.updateSiblingDependencyVersions(versions),
      ),
    );
  }

  // Phase 3: lockfile 동기화
  for (const { eco } of ecosystems) {
    const lockfilePath = await eco.syncLockfile();
    if (lockfilePath) modifiedFiles.push(lockfilePath);
  }

  return modifiedFiles;
}
```

기존 `replaceVersion()` 등의 호출부는 이 orchestrator로 대체:

```typescript
// runner.ts 등에서
const ecosystems = ctx.config.packages.map((pkg) => {
  const absPath = path.resolve(cwd, pkg.path);
  const descriptor = ecosystemCatalog.get(pkg.ecosystem);
  const eco = new descriptor.ecosystemClass(absPath);
  return { eco, pkg };
});

await writeVersionsForEcosystem(ecosystems, versions);
```

### 9. inferRegistries() 리팩토링

ManifestReader 결과를 재사용하도록 변경한다. 현재 내부에서 `readJsonSafe()`로 package.json을 다시 읽는 부분을 ManifestReader 캐시에서 가져온다.

`inferJsRegistries()`가 `publishConfig.registry`와 package name(scoped registry용)에 접근해야 하는데, `PackageManifest` 인터페이스에는 이 필드가 없다. `NpmRegistry.reader`의 캐시에서 raw parsed 데이터가 필요하므로, `ManifestReader`에 raw 접근 메서드를 추가하거나, `inferRegistries()`에서 `publishConfig` 접근은 직접 파일 읽기를 유지한다.

실용적 접근: `inferRegistries()`는 `discoverPackages()` 내부에서만 호출되며, 이 시점에 ManifestReader가 이미 해당 파일을 캐싱하고 있으므로, filesystem 수준 캐시(OS page cache)에 의해 실질적 I/O 중복은 발생하지 않는다. `publishConfig` 접근을 위해 `PackageManifest` 인터페이스를 오염시키지 않는다.

### 10. findOutFile() 유지

`findOutFile()`은 상위 디렉토리를 탐색하는 유틸 함수로, ManifestReader와 다른 목적을 갖는다. `.npmignore`, `.gitignore` 등 manifest가 아닌 파일 탐색에도 사용되므로 삭제하지 않고 유지한다.

단, `getPackageJson()` / `getJsrJson()`에서 `findOutFile()`을 통해 manifest를 찾는 패턴은 ManifestReader로 대체된다. `findOutFile()` 자체는 범용 유틸로 남긴다.

### 11. getPackageJson() / getJsrJson() cross-fallback 처리

현재 `getPackageJson()`은 package.json이 없으면 `getJsrJson()`으로 fallback하고, `getJsrJson()`은 반대로 fallback한다 (`jsrJsonToPackageJson()` / `packageJsonToJsrJson()` 변환).

이 fallback은 `Ecosystem.readManifest()`가 대체한다. `readManifest()`는 `registryClasses()` 순서대로 manifest 존재 여부를 확인하며, 첫 번째로 존재하는 manifest를 읽는다. jsr-only 패키지(package.json 없음)의 경우:

- `JsEcosystem.registryClasses()` = `[NpmRegistry, JsrRegistry]`
- `NpmRegistry.reader.exists()` → false (package.json 없음)
- `JsrRegistry.reader.exists()` → true
- `JsrRegistry.reader.read()` 결과 반환

따라서 cross-fallback 변환 로직(`jsrJsonToPackageJson` 등)은 불필요해지며 삭제 가능하다.

---

## 삭제 목록

### 함수 삭제

| 함수 | 위치 | 대체 |
|------|------|------|
| `discoverPackageInfos()` | changeset/packages.ts | `ctx.config.packages` |
| `discoverCurrentVersions()` | changeset/packages.ts | `ctx.config.packages`에서 Map 생성 |
| `readPackageDependencies()` | tasks/required-missing-information.ts | `ManifestReader` |
| `isPrivatePackage()` | monorepo/discover.ts | `ManifestReader.read().private` |
| `detectEcosystem()` (로컬) | monorepo/discover.ts | `ecosystemCatalog.detect()` |
| `version()` | utils/package.ts | config 또는 `Ecosystem.readVersion()` |
| `getPackageJson()` | utils/package.ts | `ManifestReader` |
| `getJsrJson()` | utils/package.ts | `ManifestReader` |
| `readJsonSafe()` | ecosystem/infer.ts | `ManifestReader` (단, publishConfig 접근은 직접 읽기 유지) |
| `replaceVersion()` | utils/package.ts | `writeVersionsForEcosystem()` orchestrator |
| `replaceVersionAtPath()` | utils/package.ts | `writeVersionsForEcosystem()` orchestrator |
| `replaceVersions()` | utils/package.ts | `writeVersionsForEcosystem()` orchestrator |
| `jsrJsonToPackageJson()` | utils/package.ts | `Ecosystem.readManifest()` fallback |
| `packageJsonToJsrJson()` | utils/package.ts | `Ecosystem.readManifest()` fallback |
| `patchCachedJsrJson()` | utils/package.ts | ManifestReader 캐시 무효화 |

### 함수 유지

| 함수 | 위치 | 이유 |
|------|------|------|
| `findOutFile()` | utils/package.ts | manifest 외 파일 탐색에 사용 (.npmignore, .gitignore 등) |

### 캐시 삭제

| 변수 | 위치 | 대체 |
|------|------|------|
| `cachedPackageJson` | utils/package.ts | `ManifestReader` 내부 캐시 |
| `cachedJsrJson` | utils/package.ts | `ManifestReader` 내부 캐시 |

### Ecosystem 메서드 리팩토링

| 메서드 | 변경 |
|------|------|
| `JsEcosystem.readPackageJson()` | 삭제, `readManifest()` → registry reader 위임 (base class) |
| `RustEcosystem.readCargoToml()` | 삭제, `readManifest()` → registry reader 위임 (base class) |
| `packageName()` | base class로 이동, `readManifest().name` 위임 |
| `readVersion()` | base class로 이동, `readManifest().version` 위임 |
| `dependencies()` | base class로 이동, `readManifest().dependencies` 위임 |
| `isPrivate()` | base class에 새로 추가, `readManifest().private` 위임 |
| `updateSiblingDependencyVersions()` | base class에 이미 no-op 존재, 유지 |
| `syncLockfile()` | base class에 이미 no-op 존재, 유지 |

### 소비부 수정

| 파일 | 변경 |
|------|------|
| `tasks/required-missing-information.ts` | `discoverPackageInfos`/`discoverCurrentVersions` → `ctx.config.packages` + 버전 불일치 프롬프트 |
| `tasks/runner.ts` (3곳) | `discoverPackageInfos` → `ctx.config.packages` |
| `commands/add.ts` | `discoverPackages` + `getPackageJson` → `ctx.config.packages` |
| `commands/version-cmd.ts` | `discoverCurrentVersions`/`discoverPackageInfos` → `ctx.config.packages` |

---

## public API 변경

이 변경은 breaking change이며 major 버전 범프가 필요하다.

### Breaking changes

- `discoverPackages()` 반환 타입: `DiscoveredPackage[]` → `ResolvedPackage[]`
- `config.packages` 제공 시 워크스페이스 탐색 스킵 (기존: 머지 방식)

### exports 삭제

| export | 위치 |
|------|------|
| `discoverCurrentVersions` | changeset/index.ts, core/index.ts |
| `discoverPackageInfos` | changeset/index.ts, core/index.ts |
| `PackageVersionInfo` | changeset/index.ts, core/index.ts |
| `getPackageJson` | utils 관련 export |
| `getJsrJson` | utils 관련 export |
| `version` | utils 관련 export |
| `replaceVersion` | utils 관련 export |
| `replaceVersionAtPath` | utils 관련 export |
| `replaceVersions` | utils 관련 export |

### exports 추가

| export | 위치 |
|------|------|
| `ManifestReader` | core/index.ts |
| `ManifestSchema` | core/index.ts |
| `PackageManifest` | core/index.ts |
| `ResolvedPackage` | core/index.ts |
| `ResolvedPackageConfig` | core/index.ts |
| `writeVersionsForEcosystem` | core/index.ts |
