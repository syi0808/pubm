# Manifest-Based Registry Inference Design

## Problem

현재 pubm config에서 `registries`를 명시적으로 받고 있지만, catalog pattern 도입 이후 ecosystem과 registry의 관계가 catalog에 이미 정의되어 있어 중복이다. 또한 jsr config 자동 생성 같은 자동화는 제거하는 방향이므로, registries를 config에서 직접 받을 필요가 없다.

대신 매니페스트 파일(package.json, jsr.json, Cargo.toml 등)과 외부 설정(.npmrc 등)을 분석해 레지스트리를 자동 추론하고, private registry는 패키지 단위로 설정할 수 있어야 한다.

## Goals

1. `PubmConfig.registries` 글로벌 필드 제거
2. 매니페스트 파일 기반 레지스트리 자동 추론을 기본 동작으로
3. ecosystem별 private registry 지원 (token 관리 포함)
4. monorepo 패키지별 override 유지
5. website/ 문서 및 README 업데이트

## Approach: Manifest-First with Package-Level Private Registry

Config에서 registries를 제거하고, 매니페스트 파일 탐지를 1차 추론 소스로 사용한다. Private registry는 패키지의 `registries` 배열 내에서 object 형태로 정의한다.

---

## 1. Config 구조 변경

### Before

```ts
// pubm.config.ts
export default {
  registries: ["npm", "jsr"],           // 글로벌 registries
  packages: [
    { path: "packages/a", registries: ["npm", "jsr"] },  // required
  ]
}
```

### After

```ts
// pubm.config.ts
export default {
  // registries 필드 없음 — 매니페스트에서 자동 추론

  testCommand: "bun test",
  buildCommand: "bun run build",

  packages: [
    { path: "packages/a" },                          // 자동 추론
    { path: "packages/b", registries: ["npm"] },     // override: npm만
    { path: "packages/c", registries: [              // private registry 포함
      "npm",
      {
        url: "https://npm.internal.com",
        token: { envVar: "INTERNAL_NPM_TOKEN" }
      }
    ]},
  ]
}
```

### Type 변경

`packages/core/src/config/types.ts`:

```ts
// 제거
// registries?: RegistryType[];  (글로벌)

// 변경
interface PackageConfig {
  path: string;
  registries?: (RegistryType | PrivateRegistryConfig)[];  // optional, 추론 기본
  ecosystem?: EcosystemKey;       // override용
  buildCommand?: string;
  testCommand?: string;
}

// 신규
interface PrivateRegistryConfig {
  url: string;
  token: { envVar: string };
}
```

## 2. 매니페스트 기반 레지스트리 추론

### 추론 로직

신규 함수 `inferRegistries(packagePath, ecosystem)`:

```
패키지 디렉토리 스캔
  ├── package.json 존재? → ecosystem: js
  │     ├── jsr.json 존재? → registries에 "jsr" 추가
  │     ├── publishConfig.registry 확인 (package.json)
  │     │     → 공식 npm이 아닌 URL이면 npm 대신 private registry로 대체
  │     ├── 프로젝트 레벨 .npmrc의 registry 확인
  │     │     → publishConfig가 없고, 공식 npm이 아닌 URL이면 npm 대신 private registry로 대체
  │     └── 기본: "npm" 추가
  ├── jsr.json만 존재? (package.json 없음) → ecosystem: js, registries: ["jsr"]
  ├── Cargo.toml 존재? → ecosystem: rust
  │     ├── [package] publish 필드 또는 .cargo/config.toml의 [registries] 확인
  │     │     → private crates registry 추가
  │     └── 기본: "crates" 추가
  └── 매니페스트 없음 → 에러
```

**publishConfig.registry 의미**: npm 관례에 따라, `publishConfig.registry`가 설정되면 기본 npm registry를 **대체**한다 (추가가 아님).

**.npmrc 파싱 범위**: 프로젝트 레벨 `.npmrc`만 읽는다. 사용자/글로벌 `.npmrc`는 스캔하지 않는다. Scoped registry(`@scope:registry=...`)는 패키지 scope와 매칭해서 처리한다. `publishConfig.registry`가 있으면 `.npmrc`보다 우선한다.

**Rust private registry**: `Cargo.toml`의 `[package] publish` 필드와 `.cargo/config.toml`의 `[registries.<name>]` 섹션을 모두 확인한다.

### 파일 위치

`packages/core/src/ecosystem/infer.ts` (신규):

```ts
export async function inferRegistries(
  packagePath: string,
  ecosystem: Ecosystem,
): Promise<RegistryType[]> {
  // ecosystem.manifestFiles()로 매니페스트 확인
  // 파일 존재 여부 + 내부 필드 + 외부 설정 파싱
  // PrivateRegistryConfig는 이 시점에서 이미 정규화되어 string key로 반환
  // 추론된 레지스트리 목록 반환
}
```

### 우선순위

`PackageConfig.registries` override > 매니페스트 추론

```ts
// monorepo/discover.ts
const registries = configPkg?.registries ?? await inferRegistries(absPath, ecosystem);
```

## 3. Private Registry 정규화 및 Catalog 통합

Config의 private registry 정보는 **정규화 단계**를 거쳐 string key로 변환된 뒤, `registryCatalog`에 동적 등록된다. 이후 파이프라인 전체에서 `RegistryType` (string)만 사용한다.

### 정규화 단계 (Config Resolution)

Config 로드 직후, `packages[].registries` 배열의 `PrivateRegistryConfig` object를 처리:

```ts
// config/resolve.ts (config resolution 단계)
function resolvePackageRegistries(
  packages: PackageConfig[],
): ResolvedPackageConfig[] {
  for (const pkg of packages) {
    if (!pkg.registries) continue;
    pkg.registries = pkg.registries.map(r => {
      if (typeof r === "string") return r;
      // 1. PrivateRegistryConfig → registryCatalog에 동적 등록
      const key = registerPrivateRegistry(r, ecosystemKey);
      // 2. object를 정규화된 string key로 대체
      return key;
    });
  }
}
```

이 단계 이후 `PackageConfig.registries`는 순수 `RegistryType[]`이 되므로, downstream 파이프라인 (`grouping.ts`, `token.ts`, `registries.ts` 등)에 타입 변경이 불필요하다.

### URL 정규화 규칙

`normalizeRegistryUrl(url)`: protocol과 trailing slash를 제거한 전체 경로를 key로 사용.

- `https://npm.internal.com` → `"npm.internal.com"`
- `https://npm.internal.com/team-a/` → `"npm.internal.com/team-a"`
- `https://npm.pkg.github.com` → `"npm.pkg.github.com"`

전체 경로를 사용하여 같은 호스트의 서로 다른 registry 경로가 충돌하지 않도록 한다.

### Catalog 동적 등록

```ts
// registry/catalog.ts
function registerPrivateRegistry(
  config: PrivateRegistryConfig,
  ecosystemKey: EcosystemKey,
): string {
  const key = normalizeRegistryUrl(config.url);

  registryCatalog.register({
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

**CustomRegistry 생성자 주의**: `NpmRegistry`의 `registry` class field가 super() 이후 덮어쓰는 문제가 있다. `CustomRegistry`에 생성자를 추가하여 URL을 명시적으로 설정해야 한다.

### Token 관리

- **CI 환경**: `envVar`로 환경변수에서 주입
- **로컬 환경**: `pubm secrets`로 `SecureStore`에 저장/관리
- **Token key**: URL 기반 (e.g., `"npm.internal.com-token"`) → `-token` 접미사로 OS keychain에 저장

## 4. 영향받는 모듈

| 파일 | 변경 내용 |
|------|-----------|
| `config/types.ts` | `registries` 글로벌 필드 제거, `PackageConfig.registries` optional, `PrivateRegistryConfig` 추가 |
| `config/defaults.ts` | 기본 registries `["npm", "jsr"]` 제거, `defaultRegistries` fallback 역할 명확화 |
| `config/resolve.ts` (또는 기존 resolution 로직) | PrivateRegistryConfig 정규화 단계 추가 |
| `types/options.ts` | `Options.registries` 관련 타입 업데이트 |
| `options.ts` | config → options resolution에서 registries 처리 변경 |
| `ecosystem/index.ts` | `detectEcosystem()` registries 파라미터 제거 |
| `ecosystem/catalog.ts` | `defaultRegistries`는 inferRegistries fallback으로 유지 |
| `ecosystem/infer.ts` (신규) | `inferRegistries()` 매니페스트 기반 추론 |
| `monorepo/discover.ts` | `inferRegistries()` 호출, registries 추론으로 전환 |
| `registry/catalog.ts` | private registry 동적 등록 (`registerPrivateRegistry`) 추가 |
| `registry/custom.ts` | `CustomRegistry`에 생성자 추가 (URL 설정) |
| `utils/token.ts` | private registry token 주입 처리 |
| `utils/registries.ts` | `collectRegistries()` 타입 확인 (정규화 이후이므로 변경 최소) |
| `tasks/preflight.ts` | registries 참조 확인 |
| `tasks/required-conditions-check.ts` | registries 참조 확인 |
| `tasks/runner.ts` | 변경 최소 (catalog 기반이라 자동) |
| `tasks/grouping.ts` | 변경 최소 (catalog 기반이라 자동) |

### Migration 참고

기존 config에 글로벌 `registries` 필드가 있는 경우, config validation 단계에서 deprecation warning을 출력한다. 필드 자체는 무시된다.

## 5. Docs 변경

### website/ (Astro 문서 사이트)
- Config 가이드: `registries` 필드 제거, 매니페스트 기반 추론 설명
- Private registry 가이드: packages 내 private registry 설정 + token 관리
- Monorepo 가이드: 자동 추론 + override 패턴 예시

### README.md
- Quick Start config 예시 업데이트
- registries 관련 설명을 매니페스트 추론 기반으로 변경

**참고**: docs 수정은 sonnet 4.6 모델로 수행

## Design Principles

1. **Manifest-first**: 매니페스트 파일이 truth source, config은 override용
2. **Convention over configuration**: 대부분의 경우 config 없이도 올바른 레지스트리 추론
3. **Package-level private registry**: private registry는 사용하는 패키지에서 직접 정의
4. **Catalog 통합**: private registry도 기존 catalog pattern으로 통합, 파이프라인 코드 변경 최소화
5. **SecureStore 기반 token**: OS keychain 우선, fallback으로 암호화 DB
