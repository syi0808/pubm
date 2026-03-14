# Registry 타입 분리 설계

## 문제

현재 `Registry` 추상 클래스가 레지스트리 수준 작업(ping, isInstalled)과 패키지 수준 작업(publish, checkAvailability)을 하나로 묶고 있다. Registry 인스턴스를 생성하려면 반드시 manifest를 읽어야 하므로, ping만 필요한 사전 체크에서도 `jsr.json`을 읽으려다 실패한다.

모노레포에서 루트에 `jsr.json`이 없으면 ENOENT 발생:

```
✖ ENOENT: no such file or directory, open '/path/to/monorepo/jsr.json'
```

## 실행 단위 정책

배포 파이프라인의 모든 태스크를 네 가지 실행 단위로 분류한다.

### 프로젝트 수준 (Project-level)

프로젝트 전체에서 1회 실행. 특정 레지스트리나 패키지와 무관.

| 태스크 | 설명 |
|--------|------|
| Verifying current branch | 릴리스 브랜치 확인 |
| Checking remote history | git fetch/pull 필요 여부 |
| Checking local working tree | 커밋되지 않은 변경사항 확인 |
| Checking commits since last release | 마지막 태그 이후 커밋 존재 여부 |
| Checking git tag existence | 버전 태그 중복 확인 |
| Checking git version | git 버전 호환성 확인 |
| Checking version information | 버전 선택 프롬프트 (single/multi) |
| Checking tag information | pre-release 태그 선택 프롬프트 |
| Bumping version | package.json/jsr.json 버전 업데이트, git commit/tag |
| Pushing tags to GitHub | git push --follow-tags |
| Creating release draft | GitHub release draft 생성 |

### 에코시스템 수준 (Ecosystem-level)

JS, Rust 등 에코시스템별로 1회 실행.

| 태스크 | 설명 |
|--------|------|
| Checking test/build scripts exist | package.json에 test/build 스크립트 존재 확인 (JS 에코시스템) |
| Running tests | 에코시스템별 test 스크립트 실행 |
| Building the project | 에코시스템별 build 스크립트 실행 |

### 레지스트리 수준 (Registry-level)

npm, jsr, crates.io 등 레지스트리별로 1회 실행. manifest(packageName) 불필요.

| 태스크 | 설명 |
|--------|------|
| Ping registry | 레지스트리 접속 가능 여부 |
| isInstalled | CLI 도구 설치 여부 (npm, jsr, cargo) |
| version | CLI 도구 버전 확인 |

`RegistryDescriptor` 정적 설정으로 관리:

| 설정 | 설명 |
|------|------|
| concurrentPublish | 패키지 동시 배포 가능 여부 (crates: false, npm/jsr: true) |
| orderPackages | 배포 순서 결정 (crates: dependency order) |

### 패키지 수준 (Package-level)

특정 패키지 경로의 manifest에서 읽은 `packageName`이 필요한 작업.

| 태스크 | 설명 |
|--------|------|
| checkAvailability | 레지스트리 설치 확인 + 패키지명 유효성 + 권한 확인 |
| publish | 레지스트리에 배포 |
| dryRunPublish | 배포 dry-run |
| isPublished | 패키지가 이미 배포되었는지 확인 |
| isVersionPublished | 특정 버전이 이미 배포되었는지 확인 |
| hasPermission | 배포 권한 확인 |
| distTags | dist-tag 목록 조회 |

## 타입 분리 설계

### 현재 구조

```
Registry (abstract)
├── packageName: string (필수)
├── ping()
├── isInstalled()
├── version()
├── publish()
├── checkAvailability()
├── isPublished()
├── ...
└── factory() → manifest 읽기 → new Registry(packageName)
```

### 새 구조

```
RegistryConnector (abstract)
├── ping()
├── isInstalled()
└── version()

PackageRegistry (abstract)
├── packageName: string (필수)
├── publish()
├── dryRunPublish()
├── checkAvailability()
├── isPublished()
├── isVersionPublished()
├── hasPermission()
├── isPackageNameAvailable()
├── distTags()
└── getRequirements()
```

### RegistryConnector

레지스트리 자체에 대한 작업. `packageName` 없이 생성 가능.

```typescript
export abstract class RegistryConnector {
  constructor(public registryUrl: string) {}

  abstract ping(): Promise<boolean>;
  abstract isInstalled(): Promise<boolean>;
  abstract version(): Promise<string>;
}
```

구현체:
- `NpmConnector` — `npm ping`, `npm --version`
- `JsrConnector` — `ping jsr.io`, `jsr --version`
- `CratesConnector` — `fetch crates.io/api/v1`, `cargo --version`

### PackageRegistry

특정 패키지에 대한 작업. `packageName` 필수.

```typescript
export abstract class PackageRegistry {
  constructor(
    public packageName: string,
    public registryUrl?: string,
  ) {}

  abstract publish(): Promise<boolean>;
  abstract dryRunPublish(manifestDir?: string): Promise<void>;
  abstract checkAvailability(task: any): Promise<void>;
  abstract isPublished(): Promise<boolean>;
  abstract isVersionPublished(version: string): Promise<boolean>;
  abstract hasPermission(): Promise<boolean>;
  abstract isPackageNameAvailable(): Promise<boolean>;
  abstract distTags(): Promise<string[]>;
  abstract getRequirements(): RegistryRequirements;
}
```

구현체:
- `NpmPackageRegistry` — 기존 NpmRegistry의 패키지 수준 메서드
- `JsrPackageRegistry` — 기존 JsrRegisry의 패키지 수준 메서드
- `CratesPackageRegistry` — 기존 CratesRegistry의 패키지 수준 메서드

### RegistryDescriptor 변경

```typescript
export interface RegistryDescriptor {
  key: string;
  ecosystem: EcosystemKey;
  label: string;
  tokenConfig: TokenEntry;
  needsPackageScripts: boolean;
  concurrentPublish: boolean;           // 추가: Registry 인스턴스에서 이동
  orderPackages?: (paths: string[]) => Promise<string[]>;  // 추가: Registry 인스턴스에서 이동

  connector: () => RegistryConnector;   // 추가: manifest 불필요
  factory: (packagePath: string) => Promise<PackageRegistry>;  // 변경: packagePath 필수

  // 기존 유지
  additionalEnvVars?: (token: string) => Record<string, string>;
  resolveTokenUrl?: (baseUrl: string) => Promise<string>;
  resolveDisplayName?: (ctx: { packages?: PackageConfig[] }) => Promise<string[]>;
}
```

### factory 함수 변경

```typescript
// 현재
export async function npmRegistry(): Promise<NpmRegistry> {
  const manifest = await NpmRegistry.reader.read(process.cwd());
  return new NpmRegistry(manifest.name);
}

// 변경 후
export function npmConnector(): NpmConnector {
  return new NpmConnector();
}

export async function npmPackageRegistry(packagePath: string): Promise<NpmPackageRegistry> {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new NpmPackageRegistry(manifest.name);
}
```

## 파이프라인 태스크별 listr2 출력 예시

### 일반 배포 파이프라인 (TTY, 모노레포, npm + jsr)

```
❯ Prerequisites check (for deployment reliability)
  ✔ Verifying current branch is a release branch
  ✔ Checking if remote history is clean
  ✔ Checking if the local working tree is clean
  ✔ Checking if commits exist since the last release
  ✔ Checking git tag existence

❯ Required conditions check (for pubm tasks)
  ❯ Ping registries                                    ← 레지스트리 수준 (RegistryConnector)
    ❯ JavaScript ecosystem
      ✔ Ping npm                                       ← npmConnector().ping()
      ✔ Ping jsr                                       ← jsrConnector().ping()
  ✔ Checking if test and build scripts exist            ← 에코시스템 수준
  ✔ Checking git version                               ← 프로젝트 수준
  ❯ Checking available registries for publishing        ← 패키지 수준 (PackageRegistry)
    ❯ JavaScript ecosystem
      ❯ Checking npm availability
        ✔ packages/core                                ← npmPackageRegistry("packages/core")
        ✔ packages/cli                                 ← npmPackageRegistry("packages/cli")
        ✔ packages/plugins/plugin-brew                 ← npmPackageRegistry("packages/plugins/plugin-brew")
      ❯ Checking jsr availability
        ✔ packages/core                                ← jsrPackageRegistry("packages/core")

❯ Checking required information                         ← 프로젝트 수준
  ✔ Checking version information
  ✔ Checking tag information

❯ Running tests                                         ← 에코시스템 수준
  ✔ JavaScript ecosystem (bun run test)
❯ Building the project                                  ← 에코시스템 수준
  ✔ JavaScript ecosystem (bun run build)
❯ Bumping version (v1.2.0)                              ← 프로젝트 수준
❯ Publishing (4 targets)                                ← 패키지 수준 (PackageRegistry)
  ❯ JavaScript ecosystem
    ❯ Running npm publish
      ✔ @pubm/core
      ✔ pubm
      ✔ @pubm/plugin-brew
    ❯ Running jsr publish
      ✔ @pubm/core
❯ Running post-publish hooks                            ← 프로젝트 수준
❯ Pushing tags to GitHub                                ← 프로젝트 수준
❯ Creating release draft on GitHub (v1.2.0)             ← 프로젝트 수준
```

### 일반 배포 파이프라인 (TTY, 모노레포, npm + jsr + crates)

```
❯ Prerequisites check (for deployment reliability)
  ✔ Verifying current branch is a release branch
  ✔ Checking if remote history is clean
  ✔ Checking if the local working tree is clean
  ✔ Checking if commits exist since the last release
  ✔ Checking git tag existence

❯ Required conditions check (for pubm tasks)
  ❯ Ping registries                                    ← 레지스트리 수준
    ❯ JavaScript ecosystem
      ✔ Ping npm
      ✔ Ping jsr
    ❯ Rust ecosystem
      ✔ Ping crates.io
  ✔ Checking if test and build scripts exist            ← 에코시스템 수준
  ✔ Checking git version
  ❯ Checking available registries for publishing        ← 패키지 수준
    ❯ JavaScript ecosystem
      ❯ Checking npm availability
        ✔ packages/js-sdk
      ❯ Checking jsr availability
        ✔ packages/js-sdk
    ❯ Rust ecosystem
      ❯ Checking crates.io availability
        ✔ packages/rust-core
        ✔ packages/rust-cli

❯ Checking required information
  ✔ Checking version information
  ✔ Checking tag information

❯ Running tests                                         ← 에코시스템 수준
  ✔ JavaScript ecosystem (bun run test)
  ✔ Rust ecosystem (cargo test)
❯ Building the project                                  ← 에코시스템 수준
  ✔ JavaScript ecosystem (bun run build)
  ✔ Rust ecosystem (cargo build --release)
❯ Bumping version (v1.2.0)                              ← 프로젝트 수준
❯ Publishing (3 targets)
  ❯ JavaScript ecosystem
    ❯ Running npm publish
      ✔ my-js-sdk
    ❯ Running jsr publish
      ✔ @scope/my-js-sdk
  ❯ Rust ecosystem
    ❯ Publishing to crates.io (sequential)             ← concurrentPublish: false
      ✔ rust-core                                      ← orderPackages로 정렬 후 순차 실행
      ✔ rust-cli
❯ Running post-publish hooks
❯ Pushing tags to GitHub
❯ Creating release draft on GitHub (v1.2.0)
```

### Preflight 파이프라인

```
❯ Collecting registry tokens                            ← 프로젝트 수준

❯ Prerequisites check (for deployment reliability)
  ✔ Verifying current branch is a release branch
  ✔ Checking if remote history is clean
  ✔ Checking if the local working tree is clean
  ✔ Checking if commits exist since the last release
  ✔ Checking git tag existence

❯ Required conditions check (for pubm tasks)
  ❯ Ping registries                                    ← 레지스트리 수준
    ❯ JavaScript ecosystem
      ✔ Ping npm
      ✔ Ping jsr
  ✔ Checking if test and build scripts exist
  ✔ Checking git version
  ❯ Checking available registries for publishing        ← 패키지 수준
    ❯ JavaScript ecosystem
      ❯ Checking npm availability
        ✔ packages/core
      ❯ Checking jsr availability
        ✔ packages/core

❯ Validating publish (2 targets)                        ← 패키지 수준
  ❯ JavaScript ecosystem
    ❯ Dry-run npm publish
      ✔ @pubm/core
    ❯ Dry-run jsr publish
      ✔ @pubm/core
```

### CI 파이프라인

```
[TITLE] Publishing (2 targets)
[DATA]  Concurrent publish tasks:
[DATA]  - JavaScript ecosystem > npm
[DATA]  - JavaScript ecosystem > jsr
  ❯ Running npm publish                                ← 패키지 수준
    ✔ @pubm/core
  ❯ Running jsr publish                                ← 패키지 수준
    ✔ @pubm/core
[TITLE] Creating GitHub Release (v1.2.0)
  ✔ GitHub Release created: https://github.com/...
[TITLE] Running after-release hooks
```

### Snapshot 파이프라인

```
❯ Prerequisites check (for deployment reliability)
  ✔ Verifying current branch is a release branch
  ✔ Checking if remote history is clean
  ✔ Checking if the local working tree is clean
  ✔ Checking if commits exist since the last release
  ✔ Checking git tag existence

❯ Required conditions check (for pubm tasks)
  ❯ Ping registries                                    ← 레지스트리 수준
    ❯ JavaScript ecosystem
      ✔ Ping npm
      ✔ Ping jsr
  ✔ Checking if test and build scripts exist
  ✔ Checking git version
  ❯ Checking available registries for publishing        ← 패키지 수준
    ❯ JavaScript ecosystem
      ✔ Checking npm availability
      ✔ Checking jsr availability

❯ Running tests                                         ← 에코시스템 수준
  ✔ JavaScript ecosystem (bun run test)
❯ Building the project                                  ← 에코시스템 수준
  ✔ JavaScript ecosystem (bun run build)
❯ Publishing snapshot (0.1.0-snapshot.20260314T1114)     ← 패키지 수준
  ❯ Running npm publish
    ✔ @pubm/core
  ❯ Running jsr publish
    ✔ @pubm/core
❯ Creating and pushing snapshot tag                     ← 프로젝트 수준
```

## 영향 범위

### 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `registry/registry.ts` | `Registry` → `RegistryConnector` + `PackageRegistry`로 분리 |
| `registry/npm.ts` | `NpmRegistry` → `NpmConnector` + `NpmPackageRegistry` |
| `registry/jsr.ts` | `JsrRegisry` → `JsrConnector` + `JsrPackageRegistry` |
| `registry/crates.ts` | `CratesRegistry` → `CratesConnector` + `CratesPackageRegistry` |
| `registry/custom-registry.ts` | `CustomRegistry` → `CustomPackageRegistry` |
| `registry/catalog.ts` | `RegistryDescriptor`에 `connector`, `concurrentPublish`, `orderPackages` 추가 |
| `registry/index.ts` | `getRegistry()` → `getConnector()` + `getPackageRegistry()` |
| `tasks/required-conditions-check.ts` | ping 태스크에서 `connector()` 사용 |
| `tasks/runner.ts` | `concurrentPublish`/`orderPackages`를 descriptor에서 참조 |
| `tasks/npm.ts` | `npmRegistry()` → `npmPackageRegistry()` |
| `tasks/jsr.ts` | `jsrRegistry()` → `jsrPackageRegistry()` |
| `tasks/crates.ts` | `CratesRegistry` → `CratesPackageRegistry` |
| `tasks/dry-run-publish.ts` | `npmRegistry()`/`jsrRegistry()` → `npmPackageRegistry()`/`jsrPackageRegistry()` |
| `tasks/required-missing-information.ts` | `npmRegistry()`/`jsrRegistry()` → 패키지 경로 전달 |

### 테스트 파일

| 파일 | 변경 내용 |
|------|----------|
| `tests/unit/registry/npm.test.ts` | `NpmConnector` + `NpmPackageRegistry` 분리 테스트 |
| `tests/unit/registry/jsr.test.ts` | `JsrConnector` + `JsrPackageRegistry` 분리 테스트 |
| `tests/unit/registry/crates.test.ts` | `CratesConnector` + `CratesPackageRegistry` 분리 테스트 |
| `tests/unit/registry/catalog.test.ts` | descriptor 변경 반영 |
| `tests/unit/registry/index.test.ts` | `getConnector()`/`getPackageRegistry()` 테스트 |
| `tests/unit/tasks/required-conditions-check.test.ts` | connector 사용 반영 |
| `tests/unit/tasks/runner.test.ts` | descriptor 기반 concurrent/order 테스트 |
| `tests/unit/tasks/runner-coverage.test.ts` | 동일 |
