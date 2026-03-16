# Registry packagePath 전파 설계

## 문제

모노레포 환경에서 `npm publish`, `jsr publish`, `cargo publish` 등이 개별 패키지 디렉토리가 아닌 **루트 디렉토리**에서 실행됨. `PackageRegistry` 서브클래스가 `packagePath`를 저장하지 않아 publish 계열 메서드에 cwd를 설정할 수 없음.

CI에서 `pubm-monorepo@0.3.6` (루트, `private: true`)가 npm publish 대상이 되어 `EPRIVATE` 에러 발생.

**영향 범위:** npm, jsr, crates, custom 레지스트리 모두 동일한 버그가 잠재.

## 해결 방향

`PackageRegistry` 생성자에 `packagePath`를 필수 파라미터로 추가하고, publish/dryRunPublish 메서드에서 `this.packagePath`를 cwd로 사용.

## 변경 사항

### 1. PackageRegistry 기반 클래스

**파일:** `packages/core/src/registry/package-registry.ts`

```ts
// Before
constructor(public packageName: string, public registry?: string)

// After
constructor(public packageName: string, public packagePath: string, public registry?: string)
```

`dryRunPublish(_manifestDir?: string)` 시그니처에서 `_manifestDir` 파라미터 제거 — `this.packagePath` 사용으로 통일.

### 2. NpmPackageRegistry

**파일:** `packages/core/src/registry/npm.ts`

- 생성자: `constructor(packageName: string, packagePath: string, registry?: string)` — 기존 `packageName?` optional을 필수로 변경
- `npm()` 메서드에 cwd 파라미터 추가: `protected async npm(args: string[], cwd?: string)` — `runNpm(args, cwd)` 호출, `runNpm`도 cwd를 `exec`에 전달
- `publish(otp?)` — `this.npm(args, this.packagePath)` 로 cwd 전달
- `publishProvenance()` — 동일
- `dryRunPublish()` — `exec` 호출에 `nodeOptions: { cwd: this.packagePath, env: { ... } }` (기존 env와 cwd 병합)
- `npm()` 을 사용하는 비-publish 메서드 (`whoami`, `access list collaborators`, `view`, `profile get`)는 cwd 전달하지 않음 — 이들은 패키지 디렉토리에 종속되지 않음

### 3. JsrPackageRegistry

**파일:** `packages/core/src/registry/jsr.ts`

- 생성자: `constructor(packageName: string, packagePath: string, registry?: string)`
- `publish()` — `exec` 호출에 `nodeOptions: { cwd: this.packagePath }` 추가
- `dryRunPublish()` — 동일

### 4. CratesPackageRegistry

**파일:** `packages/core/src/registry/crates.ts`

- 생성자: `constructor(packageName: string, packagePath: string, registry?: string)`
- `publish(manifestDir?)` → `publish()` — `manifestDir` 파라미터 제거, `this.packagePath`로 `--manifest-path` 구성
- `dryRunPublish(manifestDir?)` → `dryRunPublish()` — 동일

### 5. CustomPackageRegistry

**파일:** `packages/core/src/registry/custom-registry.ts`

- NpmPackageRegistry 상속으로 생성자는 자동 적용
- `npm()` override에 cwd 파라미터 추가: `override async npm(args: string[], cwd?: string)` — `exec` 호출에 `nodeOptions: { cwd }` 전달

### 6. Factory 함수

**npmPackageRegistry** (`npm.ts`):
```ts
const manifest = await NpmPackageRegistry.reader.read(packagePath);
return new NpmPackageRegistry(manifest.name, packagePath);
```

**jsrPackageRegistry** (`jsr.ts`):
```ts
const manifest = await JsrPackageRegistry.reader.read(packagePath);
return new JsrPackageRegistry(manifest.name, packagePath);
```

**cratesPackageRegistry** (`crates.ts`) — 시그니처 변경 + manifest 읽기 추가:
```ts
// Before: cratesPackageRegistry(packageName: string)
// After:
export async function cratesPackageRegistry(packagePath: string) {
  const manifest = await CratesPackageRegistry.reader.read(packagePath);
  return new CratesPackageRegistry(manifest.name, packagePath);
}
```

**customPackageRegistry** (`custom-registry.ts`):
```ts
return new CustomPackageRegistry(manifest.name, packagePath, registryUrl);
```

**catalog.ts private registry inline factory**:
```ts
return new CustomPackageRegistry(manifest.name, packagePath, config.url);
```

### 7. Task 레이어

#### crates.ts

- `createCratesPublishTask(packagePath: string)` — `packagePath` 필수로 변경
- `createCratesAvailableCheckTask(packagePath: string)` — 동일
- 직접 생성자 호출(`new CratesPackageRegistry(packageName)`)을 factory(`cratesPackageRegistry(packagePath)`)로 대체
- `registry.publish(packagePath)` → `registry.publish()` — 인자 없이 호출 (packagePath는 인스턴스가 보유)
- `getCrateName(packagePath: string)` — `packagePath` 필수로 변경
- backward-compat static exports (`cratesAvailableCheckTasks`, `cratesPublishTasks`) **제거** — 소스코드 미사용

#### dry-run-publish.ts

- `createCratesDryRunPublishTask(packagePath: string, siblingPaths?: string[])` — `packagePath` 필수, `siblingCrateNames` → `siblingPaths`
- `findUnpublishedSiblingDeps(packagePath, siblingPaths)` — sibling name 대신 path 배열 수신, `cratesPackageRegistry(siblingPath)` 사용하여 각 sibling의 name을 manifest에서 해석. 기존에는 name 비교(`deps.filter(d => siblingCrateNames.includes(d))`)였으나, path → name 해석 후 비교로 변경
- 내부 registry 생성도 모두 factory 사용
- backward-compat static export (`cratesDryRunPublishTask`) **제거**

#### runner.ts

- `siblingNames` → `siblingPaths`: `packagePaths`를 name으로 변환하지 않고 그대로 전달
- dry-run task map 시그니처: `(packagePath: string, siblingPaths?: string[])`

### 8. 테스트

#### fixture 추가

```
tests/fixtures/basic/Cargo.toml   # name = "test-crate", version = "1.0.0"
```

기존 `tests/fixtures/basic/`에 `package.json`, `jsr.json`이 이미 존재.

#### registry 단위 테스트 — fixture 경로 사용

각 테스트 파일에서 생성자 호출 시 fixture 경로 전달:

```ts
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");
registry = new NpmPackageRegistry("my-package", FIXTURE_PATH);
```

대상 파일 및 변경 수:
- `npm.test.ts` — 3곳 (line 143, 660, 693)
- `jsr.test.ts` — 4곳 (line 182, 472, 1077, 1099)
- `crates.test.ts` — 1곳 (line 100)
- `custom-registry.test.ts` — 3곳 (line 25, 141, 149)
- `version-published.test.ts` — 7곳 (npm 3곳, crates 2곳, jsr 2곳)

#### crates task 테스트

- mock 생성자에 `packagePath` 파라미터 반영
- `publish()`, `dryRunPublish()` 인자 없음 검증 (manifestDir 파라미터 제거)
- `siblingCrateNames` → `siblingPaths` 반영
- backward-compat export 테스트 → `create*` 함수에 fixture 경로 전달로 대체

#### runner 테스트

- `runner.test.ts`, `runner-coverage.test.ts` — backward-compat export mock 제거, `siblingNames` → `siblingPaths` 반영

## 변경하지 않는 것

- `RegistryConnector` 서브클래스 (`NpmConnector`, `JsrConnector`, `CratesConnector`) — 커넥터는 패키지 단위가 아닌 레지스트리 단위이므로 `packagePath` 불필요
- `RegistryDescriptor` 인터페이스의 `factory` 시그니처 — 이미 `(packagePath: string) => Promise<PackageRegistry>`
- `getPackageRegistry()` (`registry/index.ts`) — 이미 `packagePath`를 factory에 전달
- `tasks/required-conditions-check.ts` — `descriptor.factory(packagePath)` 경유로 registry 생성, factory가 `packagePath`를 전달하므로 변경 불필요
- `tasks/npm.ts`, `tasks/jsr.ts` — factory 함수 경유로 registry 생성, publish 메서드 내부에서 `this.packagePath` 사용하므로 task 파일 변경 불필요

## 참고: 기존 버그 수정

- `cratesPackageRegistry` factory가 `packageName`을 받도록 되어 있으나, `catalog.ts`에서 `packagePath`를 전달하고 있음. 이번 변경에서 `packagePath`를 받아 manifest에서 name을 읽도록 수정하여 기존 불일치 해소.

## 참고: Plugin API

`pluginPublishTasks()` (runner.ts)에서 plugin이 제공하는 registry의 `publish()`를 호출함. 현재 plugin은 자체 `PackageRegistry` 서브클래스를 구현하지 않고 별도 인터페이스를 사용하므로 (`ctx.runtime.pluginRunner.collectRegistries()`) 이번 변경에 영향 없음.

## 영향 요약

| 카테고리 | 파일 수 | 변경 규모 |
|---------|--------|----------|
| 기반 클래스 | 1 | 생성자 시그니처 |
| 서브클래스 | 4 | 생성자 + publish 메서드 cwd 전달 |
| Factory 함수 | 4 + catalog.ts 1곳 | 생성자 호출에 packagePath 추가 |
| Task 레이어 | 3 (crates, dry-run, runner) | factory 사용, static export 제거, siblingPaths |
| 테스트 fixture | 1 신규 (Cargo.toml) | — |
| 레지스트리 테스트 | 5 | 생성자에 fixture 경로 추가 |
| Task 테스트 | 4 | mock/검증 업데이트, backward-compat 제거 |
