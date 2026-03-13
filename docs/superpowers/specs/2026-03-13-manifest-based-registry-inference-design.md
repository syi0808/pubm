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
  │     ├── .npmrc의 registry 또는 package.json의 publishConfig.registry 확인
  │     │     → 공식 npm이 아닌 URL이면 private registry로 추가
  │     └── 기본: "npm" 추가
  ├── Cargo.toml 존재? → ecosystem: rust
  │     ├── [registries] 섹션 또는 publish 필드 확인
  │     │     → private crates registry 추가
  │     └── 기본: "crates" 추가
  └── 매니페스트 없음 → 에러
```

### 파일 위치

`packages/core/src/ecosystem/infer.ts` (신규):

```ts
export async function inferRegistries(
  packagePath: string,
  ecosystem: Ecosystem,
): Promise<(RegistryType | PrivateRegistryConfig)[]> {
  // ecosystem.manifestFiles()로 매니페스트 확인
  // 파일 존재 여부 + 내부 필드 + 외부 설정 파싱
  // 추론된 레지스트리 목록 반환
}
```

### 우선순위

`PackageConfig.registries` override > 매니페스트 추론

```ts
// monorepo/discover.ts
const registries = configPkg?.registries ?? await inferRegistries(absPath, ecosystem);
```

## 3. Private Registry Catalog 통합

Config의 private registry 정보를 런타임에 `registryCatalog`에 동적 등록한다.

### 등록 흐름

1. Config 로드 시 `packages[].registries`에서 object 타입(PrivateRegistryConfig) 수집
2. 각 private registry를 `registryCatalog`에 동적 등록:
   - `key`: URL 기반 정규화 (e.g., `"npm.internal.com"`)
   - `ecosystem`: 해당 패키지의 ecosystem에서 추론
   - `factory`: `CustomRegistry(url)` 생성
   - `tokenConfig`: config의 token 정보 + SecureStore 연동
3. 이후 파이프라인에서는 내장 registry와 동일하게 처리

### Token 관리

- **CI 환경**: `envVar`로 환경변수에서 주입
- **로컬 환경**: `pubm secrets`로 `SecureStore`에 저장/관리
- **Token key**: URL 기반 (e.g., `"npm.internal.com-token"`) → `-token` 접미사로 OS keychain에 저장

```ts
// registry/catalog.ts에 동적 등록
registryCatalog.register({
  key: normalizeUrl(config.url),           // "npm.internal.com"
  ecosystem: ecosystemKey,                  // 패키지의 ecosystem에서 추론
  label: config.url,
  tokenConfig: {
    envVar: config.token.envVar,
    dbKey: `${normalizeUrl(config.url)}-token`,
    ghSecretName: config.token.envVar,
    promptLabel: `Token for ${config.url}`,
    tokenUrl: config.url,
    tokenUrlLabel: normalizeUrl(config.url),
  },
  needsPackageScripts: false,
  factory: async (packageName) => new CustomRegistry(packageName, config.url),
});
```

## 4. 영향받는 모듈

| 파일 | 변경 내용 |
|------|-----------|
| `config/types.ts` | `registries` 글로벌 필드 제거, `PackageConfig.registries` optional, `PrivateRegistryConfig` 추가 |
| `config/defaults.ts` | 기본 registries `["npm", "jsr"]` 제거 |
| `ecosystem/index.ts` | `detectEcosystem()` registries 파라미터 제거 |
| `ecosystem/infer.ts` (신규) | `inferRegistries()` 매니페스트 기반 추론 |
| `monorepo/discover.ts` | `inferRegistries()` 호출, registries 추론으로 전환 |
| `registry/catalog.ts` | private registry 동적 등록 로직 추가 |
| `utils/token.ts` | private registry token 주입 처리 |
| `tasks/runner.ts` | 변경 최소 (catalog 기반이라 자동) |
| `tasks/grouping.ts` | 변경 최소 (catalog 기반이라 자동) |

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
