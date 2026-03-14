# 패키지 수준 태스크 정책 반영 설계

## 문제

`2026-03-14-registry-type-separation-design.md`에서 정의한 실행 단위 정책 중, 패키지 수준 태스크가 정책을 위반하고 있다. npm/jsr의 publish, dry-run publish 태스크가 `packagePath`를 받지 않고 `process.cwd()` fallback을 사용하여, 모노레포 루트에서 실행 시 manifest 파일(jsr.json 등)을 찾지 못해 ENOENT 에러가 발생한다.

```
✖ ENOENT: no such file or directory, open '/path/to/monorepo/jsr.json'
```

## 위반 현황

프로젝트/에코시스템/레지스트리 수준은 정책을 준수하고 있으며, **위반은 패키지 수준에 집중**되어 있다.

| # | 위치 | 문제 |
|---|------|------|
| A | `dry-run-publish.ts` `npmDryRunPublishTask` | static 상수, `npmPackageRegistry()` packagePath 없음 |
| B | `dry-run-publish.ts` `jsrDryRunPublishTask` | static 상수, `jsrPackageRegistry()` packagePath 없음 |
| C | `runner.ts` `dryRunTaskMap` npm | factory가 packagePath 무시 |
| D | `runner.ts` `dryRunTaskMap` jsr | factory가 packagePath 무시 |
| E | `npm.ts` `npmPublishTasks` | static 상수, `npmPackageRegistry()` packagePath 없음 |
| F | `jsr.ts` `jsrPublishTasks` | static 상수, `jsrPackageRegistry()` packagePath 없음 |
| G | `runner.ts` `publishTaskMap` npm/jsr | factory가 packagePath 무시 |
| H | `catalog.ts` `resolveDisplayName` npm/jsr | `process.cwd()`로 manifest 읽기 |
| I | `jsr.ts:211` `jsrAvailableCheckTasks` 내부 `npmPackageRegistry()` | npm scoped name 확인에 packagePath 없이 호출 (dead code, M과 함께 삭제) |
| J | `required-missing-information.ts:189-190` | dist-tag 조회 시 `npmPackageRegistry()`/`jsrPackageRegistry()` packagePath 없이 호출 |
| K | `registry/jsr.ts:235` `checkAvailability` 내 `npmPackageRegistry()` | `installGlobally("jsr")` 용도로 호출, manifest 불필요 |
| L | `npm.ts:24` `npmAvailableCheckTasks` | dead code, packagePath 필수화 시 컴파일 에러 |
| M | `jsr.ts:32` `jsrAvailableCheckTasks` | dead code, packagePath 필수화 시 컴파일 에러 |

| N | `custom-registry.ts:24` `customPackageRegistry()` | `packagePath` optional, `process.cwd()` fallback |

**근본 원인**: `npmPackageRegistry()` / `jsrPackageRegistry()` / `customPackageRegistry()`의 `packagePath?: string` optional 시그니처가 `process.cwd()` fallback을 허용.

## 설계 원칙

스펙의 listr2 출력 예시를 목표 상태로 삼는다. 모든 패키지 수준 태스크는 `ctx.config.packages` 기반으로 패키지별 서브태스크를 생성한다.

### 목표 출력 (Preflight)

```
❯ Validating publish (2 targets)
  ❯ JavaScript ecosystem
    ❯ Dry-run npm publish
      ✔ @pubm/core
    ❯ Dry-run jsr publish
      ✔ @pubm/core
```

### 목표 출력 (Publish, 모노레포)

```
❯ Publishing (4 targets)
  ❯ JavaScript ecosystem
    ❯ Running npm publish
      ✔ @pubm/core
      ✔ pubm
      ✔ @pubm/plugin-brew
    ❯ Running jsr publish
      ✔ @pubm/core
```

## 변경 사항

### 1. collectPublishTasks / collectDryRunPublishTasks 구조 통합

현재 `collectPublishTasks`에서 concurrent registry(npm/jsr)는 단일 태스크를 반환하고, sequential registry(crates)만 패키지별 서브태스크를 생성한다. 이를 통합하여 모든 레지스트리가 패키지별 서브태스크를 생성하도록 변경한다.

**현재:**

```typescript
// concurrent registry: 단일 태스크 (패키지별 서브태스크 없음)
if (descriptor.concurrentPublish) {
  return createPublishTaskForPath(registry, packagePaths[0]);
}
```

**변경:**

```typescript
// 모든 레지스트리 공통: 패키지별 서브태스크 생성
const paths = descriptor.orderPackages
  ? await descriptor.orderPackages(packagePaths)
  : packagePaths;

return {
  title: `Running ${descriptor.label} publish`,
  task: (_, task) =>
    task.newListr(
      paths.map((p) => createPublishTaskForPath(registry, p)),
      { concurrent: descriptor.concurrentPublish },
    ),
};
```

`collectDryRunPublishTasks`도 동일한 구조로 변경.

### 2. 태스크 파일 factory 패턴 통일

crates의 기존 패턴(`createCratesPublishTask(packagePath)`)을 npm/jsr에도 적용한다.

#### dry-run-publish.ts

```typescript
// 현재: static 상수
export const npmDryRunPublishTask: ListrTask<PubmContext> = { ... };
export const jsrDryRunPublishTask: ListrTask<PubmContext> = { ... };

// 변경: factory 함수, packagePath 필수
export function createNpmDryRunPublishTask(packagePath: string): ListrTask<PubmContext> {
  return {
    title: packagePath,
    task: async (ctx, task) => {
      const npm = await npmPackageRegistry(packagePath);
      task.title = npm.packageName;
      // ... 기존 dry-run 로직 동일
    },
  };
}

export function createJsrDryRunPublishTask(packagePath: string): ListrTask<PubmContext> {
  // 동일한 패턴
}
```

#### npm.ts

```typescript
// 현재: static 상수
export const npmPublishTasks: ListrTask<PubmContext> = { ... };

// 변경: factory 함수
export function createNpmPublishTask(packagePath: string): ListrTask<PubmContext> {
  return {
    title: packagePath,
    task: async (ctx, task) => {
      const npm = await npmPackageRegistry(packagePath);
      task.title = npm.packageName;
      // ... OTP 핸들링 등 기존 로직 동일
    },
  };
}
```

#### jsr.ts

```typescript
// 현재: static 상수
export const jsrPublishTasks: ListrTask<PubmContext> = { ... };

// 변경: factory 함수
export function createJsrPublishTask(packagePath: string): ListrTask<PubmContext> {
  return {
    title: packagePath,
    task: async (ctx, task) => {
      const jsr = await jsrPackageRegistry(packagePath);
      task.title = jsr.packageName;
      // ... scope 생성, 토큰 핸들링 등 기존 로직 동일
    },
  };
}
```

### 3. runner.ts taskMap 변경

```typescript
// 현재
const publishTaskMap = {
  npm: () => npmPublishTasks,
  jsr: () => jsrPublishTasks,
  crates: (p) => createCratesPublishTask(p),
};

// 변경: 모두 packagePath 필수
const publishTaskMap = {
  npm: (p: string) => createNpmPublishTask(p),
  jsr: (p: string) => createJsrPublishTask(p),
  crates: (p: string) => createCratesPublishTask(p),
};

// dryRunTaskMap도 동일
const dryRunTaskMap = {
  npm: (p: string) => createNpmDryRunPublishTask(p),
  jsr: (p: string) => createJsrDryRunPublishTask(p),
  crates: (p: string, siblings?: string[]) => createCratesDryRunPublishTask(p, siblings),
};
```

### 4. registry factory 함수 packagePath 필수화

```typescript
// 현재: optional → process.cwd() fallback
export async function npmPackageRegistry(packagePath?: string): Promise<NpmPackageRegistry>
export async function jsrPackageRegistry(packagePath?: string): Promise<JsrPackageRegistry>

// 변경: 필수, process.cwd() fallback 제거
export async function npmPackageRegistry(packagePath: string): Promise<NpmPackageRegistry>
export async function jsrPackageRegistry(packagePath: string): Promise<JsrPackageRegistry>
export async function customPackageRegistry(packagePath: string, registryUrl?: string): Promise<CustomPackageRegistry>
```

### 5. required-missing-information.ts dist-tag 조회 수정

pre-release tag 선택 시 dist-tag를 조회하는 코드를 `ctx.config.packages` 기반으로 변경한다. 현재는 npm/jsr를 무조건 조회하지만, 실제 설정된 registries만 조회하도록 변경하고 `packagePath`를 전달한다.

```typescript
// 현재 (required-missing-information.ts:189-190)
const npm = await npmPackageRegistry();
const jsr = await jsrPackageRegistry();
const distTags = [...new Set(
  (await Promise.all([npm.distTags(), jsr.distTags()])).flat(),
)];

// 변경: ctx.config.packages의 registries만 조회, 첫 번째 패키지 경로 사용
const registryKeys = new Set(
  ctx.config.packages.flatMap((pkg) => pkg.registries ?? []),
);
const firstPkgPath = ctx.config.packages[0]?.path;
const allDistTags: string[] = [];

for (const key of registryKeys) {
  const descriptor = registryCatalog.get(key);
  if (!descriptor) continue;
  try {
    const registry = await descriptor.factory(firstPkgPath);
    allDistTags.push(...(await registry.distTags()));
  } catch {
    // 아직 publish된 적 없는 registry는 무시
  }
}

const distTags = [...new Set(allDistTags)];
```

모노레포에서 패키지별로 dist-tag가 다를 수 있으나, 이 프롬프트는 "어떤 tag로 pre-release를 배포할지" 선택하는 보조 기능이므로 첫 번째 패키지 기준 조회로 충분하다. 패키지별 차이 처리는 별도 이슈로 다룬다.

### 6. installGlobally를 독립 유틸 함수로 분리

`NpmPackageRegistry.installGlobally`는 `this.packageName`이나 manifest를 사용하지 않고 `npm install -g`만 실행한다. 독립 유틸 함수로 분리하여 `NpmPackageRegistry`에 대한 불필요한 의존을 제거한다.

```typescript
// 새 파일: utils/npm-install.ts
import { exec } from "./exec.js";

export async function npmInstallGlobally(packageName: string): Promise<void> {
  await exec("npm", ["install", "-g", packageName], { throwOnError: true });
}
```

```typescript
// registry/jsr.ts checkAvailability 내부 변경
// 현재
const { npmPackageRegistry } = await import("./npm.js");
const npm = await npmPackageRegistry();
await npm.installGlobally("jsr");

// 변경
const { npmInstallGlobally } = await import("../utils/npm-install.js");
await npmInstallGlobally("jsr");
```

`NpmPackageRegistry.installGlobally` 메서드는 삭제한다.

### 7. dead code 삭제

`npmAvailableCheckTasks` (`tasks/npm.ts`)와 `jsrAvailableCheckTasks` (`tasks/jsr.ts`)는 파이프라인에서 사용되지 않는다 (availability check는 `required-conditions-check.ts`에서 `descriptor.factory(packagePath)` → `registry.checkAvailability(task)` 경로로 실행). `packagePath` 필수화 시 컴파일 에러가 발생하므로 삭제한다.

### 8. catalog.ts resolveDisplayName 변경

`process.cwd()`에서 manifest를 읽는 대신 `ctx.packages` 기반으로 변경한다.

```typescript
// 현재 (npm)
resolveDisplayName: async () => {
  const manifest = await NpmPackageRegistry.reader.read(process.cwd());
  return manifest.name ? [manifest.name] : [];
},

// 변경: crates 패턴과 동일
resolveDisplayName: async (ctx) => {
  return ctx.packages
    ?.filter((pkg) => pkg.registries?.includes("npm"))
    .map((pkg) => pkg.name) ?? [];
},

// jsr도 동일하게 .includes("jsr")
```

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `tasks/dry-run-publish.ts` | `npmDryRunPublishTask` → `createNpmDryRunPublishTask(packagePath)`, jsr도 동일 |
| `tasks/npm.ts` | `npmPublishTasks` → `createNpmPublishTask(packagePath)`, `npmAvailableCheckTasks` 삭제 |
| `tasks/jsr.ts` | `jsrPublishTasks` → `createJsrPublishTask(packagePath)`, `jsrAvailableCheckTasks` 삭제 |
| `tasks/runner.ts` | taskMap factory에 packagePath 전달, collect 함수에서 concurrent 분기를 제거하여 모든 레지스트리가 패키지별 서브태스크를 생성 |
| `tasks/required-missing-information.ts` | dist-tag 조회를 `ctx.config.packages` 기반으로 변경, 실제 사용 registries만 조회 |
| `registry/npm.ts` | `npmPackageRegistry(packagePath: string)` 필수화, `installGlobally` 메서드 삭제 |
| `registry/jsr.ts` | `jsrPackageRegistry(packagePath: string)` 필수화, `checkAvailability` 내 `npmInstallGlobally` 유틸 사용 |
| `utils/npm-install.ts` | 신규 파일, `npmInstallGlobally` 유틸 함수 |
| `registry/catalog.ts` | npm/jsr `resolveDisplayName`을 `ctx.packages` 기반으로 변경 |
| `registry/custom-registry.ts` | `customPackageRegistry(packagePath: string)` 필수화 |

## 수정하지 않는 파일

| 파일 | 이유 |
|------|------|
| `tasks/crates.ts` | 이미 올바른 factory 패턴 |
| `tasks/required-conditions-check.ts` | `descriptor.factory(packagePath)` 경유하므로 변경 불필요 |
| `registry/connector` 관련 | 레지스트리 수준 위반 없음 |
| `tasks/prerequisites-check.ts` | 프로젝트 수준, 위반 없음 |

## 영향받는 테스트 파일

| 파일 | 변경 필요 |
|------|----------|
| `tests/unit/tasks/dry-run-publish.test.ts` | factory 함수 시그니처 변경 반영 |
| `tests/unit/tasks/dry-run-already-published.test.ts` | 동일 |
| `tests/unit/tasks/npm.test.ts` | factory 변경 + dead code 삭제 반영 |
| `tests/unit/tasks/jsr.test.ts` | factory 변경 + dead code 삭제 반영 |
| `tests/unit/tasks/npm-already-published.test.ts` | factory 변경 반영 |
| `tests/unit/tasks/jsr-already-published.test.ts` | factory 변경 반영 |
| `tests/unit/tasks/required-missing-information.test.ts` | packagePath 전달 반영 |
| `tests/unit/tasks/runner.test.ts` | taskMap/collect 함수 구조 변경 반영 |
| `tests/unit/tasks/runner-coverage.test.ts` | 동일 |
