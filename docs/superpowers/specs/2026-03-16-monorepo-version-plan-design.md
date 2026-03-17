# Monorepo VersionPlan 통합 설계

## 배경

publish 파이프라인에서 모노레포 independent 모드가 올바르게 동작하지 않는 근본적인 구조 문제가 있다.

**현재 문제:**
- `ctx.runtime.version`(단일)과 `ctx.runtime.versions`(Map) 이중 구조로 인해, 코드 전반에서 어떤 값을 참조해야 할지 불명확
- `isIndependent` 판별이 config가 아닌 버전 값 차이로 판단 — 동일 버전으로 bump 시 fixed 분기로 잘못 진입
- 플러그인(`external-version-sync`, `plugin-brew`)이 `ctx.runtime.version`만 참조 — independent 모드에서 `undefined`
- GitHub release가 단일 release만 생성 — independent 모드에서 패키지별 release 미지원
- git 태그 파싱이 `v` prefix만 처리 — `@pkg@version` 형태 태그 미지원

## 설계

### 1. `VersionPlan` 타입

`ctx.runtime.version`과 `ctx.runtime.versions`를 `ctx.runtime.versionPlan`으로 통합한다.

```ts
// packages/core/src/context.ts

interface SingleVersionPlan {
  mode: "single";
  version: string;
  packageName: string;
}

interface FixedVersionPlan {
  mode: "fixed";
  version: string;
  packages: Map<string, string>; // 모두 같은 버전
}

interface IndependentVersionPlan {
  mode: "independent";
  packages: Map<string, string>; // 각각 다른 버전 가능
}

type VersionPlan = SingleVersionPlan | FixedVersionPlan | IndependentVersionPlan;
```

`runtime` 타입에서 `version?: string`과 `versions?: Map<string, string>`을 제거하고 `versionPlan?: VersionPlan`으로 대체한다.

#### helper

```ts
function resolveVersion(
  plan: VersionPlan,
  picker?: (packages: Map<string, string>) => string
): string
```

- `single`: `.version` 반환
- `fixed`: `.version` 반환
- `independent`: picker가 필수. picker가 없으면 에러를 throw한다. independent 모드에서 어떤 패키지의 버전을 사용할지 명시적으로 지정하지 않으면 잘못된 버전이 조용히 사용될 위험이 있기 때문이다.

```ts
function resolveVersion(
  plan: VersionPlan,
  picker?: (packages: Map<string, string>) => string
): string {
  if (plan.mode === "single") return plan.version;
  if (plan.mode === "fixed") return plan.version;
  // independent
  if (!picker) {
    throw new Error(
      "independent mode requires an explicit version picker. " +
      "Provide a picker function or set the 'version' option."
    );
  }
  return picker(plan.packages);
}
```

#### mode 자동 결정 로직

`VersionPlan` 생성 시점(`required-missing-information.ts`)에서 한 번 결정:

1. `packages` 없음 or 1개 → `single`
2. `packages` 2개+ & `versioning` 명시 → 명시된 값 사용
3. `packages` 2개+ & `versioning` 미설정 → 패키지 현재 버전 비교
   - 모두 같은 버전 → `fixed`
   - 다른 버전 존재 → `independent`

#### `VersionPlan` 생성 경로

현재 `required-missing-information.ts`에 3개의 버전 결정 경로가 있다:

- **`handleSinglePackage()`** (단일 패키지): `ctx.runtime.version = nextVersion` 설정
  → `SingleVersionPlan { mode: "single", version: nextVersion, packageName }` 생성

- **`handleFixedMode()`** (fixed 모노레포): `ctx.runtime.version = nextVersion` + `ctx.runtime.versions = Map(모든 패키지 → nextVersion)` 설정
  → `FixedVersionPlan { mode: "fixed", version: nextVersion, packages: Map }` 생성. `version`은 프롬프트에서 받은 값을 직접 사용.

- **`handleIndependentMode()`** (independent 모노레포): `ctx.runtime.versions = Map(패키지별 버전)` 설정
  → `IndependentVersionPlan { mode: "independent", packages: Map }` 생성

#### CI / CLI 옵션 경로

CI 환경이나 `--version` CLI 옵션으로 버전이 직접 제공되는 경우에도 동일한 `VersionPlan` 구조로 생성한다. mode 결정은 `packages` 수와 `versioning` 설정 기반으로 동일하게 적용된다.

#### Snapshot 경로

snapshot 파이프라인(`runner.ts:385-533`)은 이미 단일 패키지만 지원한다(다중 패키지 시 에러 throw). 따라서 snapshot에서는 항상 `SingleVersionPlan`을 생성한다.

```ts
ctx.runtime.versionPlan = {
  mode: "single",
  version: snapshotVersion,
  packageName: ctx.config.packages[0].name,
};
```

### 2. Git 태그 로직

#### 새 메서드 추가 (`git.ts`)

```ts
// 패키지별 태그 필터링
async tagsByPackage(packageName: string): Promise<string[]> {
  // git tag -l "@pubm/core@*" → ["@pubm/core@0.3.0", "@pubm/core@0.4.0"]
  const raw = await this.git(["tag", "-l", `${packageName}@*`]);
  return raw.trim().split("\n").filter(Boolean);
}

// 패키지의 최신 태그 (semver 정렬)
async latestTagForPackage(packageName: string): Promise<string | null> {
  const tags = await this.tagsByPackage(packageName);
  if (tags.length === 0) return null;
  const sorted = tags.sort((a, b) => {
    const va = a.slice(packageName.length + 1); // "@pubm/core@0.4.0" → "0.4.0"
    const vb = b.slice(packageName.length + 1);
    return semver.compare(va, vb);
  });
  return sorted[sorted.length - 1] ?? null;
}
```

#### `previousTag()` 확장

현재 `previousTag()`는 `strip = (t) => t.replace(/^v/, "")` 로 `v` prefix만 제거한다. 패키지 prefix도 처리하도록 확장한다:

```ts
function extractVersion(tag: string): string {
  // "@pubm/core@0.4.0" → "0.4.0"
  // "pubm@0.4.0" → "0.4.0"
  // "v0.4.0" → "0.4.0"
  const atIndex = tag.lastIndexOf("@");
  if (atIndex > 0) return tag.slice(atIndex + 1);
  return tag.replace(/^v/, "");
}

function extractPrefix(tag: string): string {
  // "@pubm/core@0.4.0" → "@pubm/core"
  // "v0.4.0" → "v"
  const atIndex = tag.lastIndexOf("@");
  if (atIndex > 0) return tag.slice(0, atIndex);
  return tag.startsWith("v") ? "v" : "";
}
```

`previousTag(tag)`는 같은 prefix를 가진 태그들만 필터링한 뒤, semver 정렬로 이전 버전을 찾는다:

```ts
async previousTag(tag: string): Promise<string | null> {
  const prefix = extractPrefix(tag);
  const allTags = await this.tags();
  const samePrefixTags = allTags.filter(t => extractPrefix(t) === prefix);
  const sorted = samePrefixTags.sort((a, b) =>
    semver.compare(extractVersion(a), extractVersion(b))
  );
  const idx = sorted.indexOf(tag);
  return idx > 0 ? sorted[idx - 1] ?? null : null;
}
```

기존 `tags()` 메서드의 `semver.compareIdentifiers` 정렬도 `extractVersion` 기반으로 변경한다.

#### 태그 생성 (`runner.ts`)

| mode | 태그 형식 |
|------|----------|
| `single` | `v0.4.0` |
| `fixed` | `v0.4.0` |
| `independent` | `@pubm/core@0.4.0`, `pubm@0.4.0`, ... |

#### 태그 존재 확인 (`prerequisites-check.ts`)

현재 "Checking git tag existence" 태스크(155-178줄)는 `ctx.runtime.version`을 사용하며, 이는 `required-missing-information` 이후에 설정된다. runner.ts의 실행 순서를 보면 prerequisites → required-missing-information 순서로 실행되므로, 태그 존재 확인 시점에서는 아직 versionPlan이 없다.

**해결:** 태그 존재 확인을 prerequisites에서 제거하고, version bump 태스크(`runner.ts` "Bumping version" 단계) 시작 시점으로 이동한다. versionPlan이 확정된 후에 태그 검사를 수행한다.

- `single`/`fixed`: `v${plan.version}` 1개 확인
- `independent`: `${pkgName}@${pkgVersion}` 패키지 수만큼 확인

#### 하위 호환: 혼합 태그

기존 `v*` 태그가 있는 레포에서 independent 모드로 전환 시, `v*` 태그와 `@pkg@version` 태그가 혼재할 수 있다. `previousTag()`는 prefix 기반 필터링이므로 자연스럽게 분리된다. `latestTag()`(describe 기반)는 가장 최근 커밋의 태그를 반환하므로, mode에 따라 적절한 메서드를 호출하도록 한다:
- `single`/`fixed`: 기존 `latestTag()` 사용
- `independent`: `latestTagForPackage(pkgName)` 사용

### 3. 커밋 메시지

| mode | 커밋 메시지 |
|------|------------|
| `single` | `v0.4.0` |
| `fixed` | `v0.4.0` |
| `independent` | 아래 참조 |

기존 코드(`runner.ts:895-899`)에서는 `@pubm/core@0.4.0, pubm@0.4.0` 형식의 단일행 커밋 메시지를 사용했으나, changesets 컨벤션에 맞춰 다음과 같은 다중행 형식으로 변경한다:

independent 모드 커밋 메시지:
```
Version Packages

- @pubm/core: 0.4.0
- pubm: 0.4.0
- @pubm/plugin-brew: 0.4.0
```

### 4. GitHub Release

#### `createGitHubRelease` 리팩터링

현재 `createGitHubRelease(ctx, changelogBody?)` 함수는 내부에서 `git.latestTag()`로 태그를 찾고, 단일 release를 생성한다. 이를 태그를 외부에서 받도록 시그니처를 변경한다:

```ts
async function createGitHubRelease(
  ctx: PubmContext,
  options: {
    packageName: string;
    version: string;
    tag: string;
    changelogBody?: string;
  }
): Promise<ReleaseContext>
```

호출 측(`runner.ts`)에서 mode에 따라 호출 방식을 결정:

**single/fixed:**
```ts
const tag = `v${plan.version}`;
const changelogBody = readSingleChangelog(plan.version);
const result = await createGitHubRelease(ctx, {
  packageName: ctx.config.packages[0].name,
  version: plan.version,
  tag,
  changelogBody,
});
await pluginRunner.runAfterReleaseHook(ctx, result);
```

**independent:**
```ts
for (const [pkgName, pkgVersion] of plan.packages) {
  const tag = `${pkgName}@${pkgVersion}`;
  const previousTag = await git.previousTag(tag)
    ?? await git.firstCommit(); // 첫 릴리스인 경우 첫 커밋부터
  const changelogBody = readPackageChangelog(pkgName, pkgVersion);

  const result = await createGitHubRelease(ctx, {
    packageName: pkgName,
    version: pkgVersion,
    tag,
    changelogBody,
  });
  // 패키지별로 afterRelease 훅 호출
  await pluginRunner.runAfterReleaseHook(ctx, result);
}
```

`createGitHubRelease` 내부에서는:
- `previousTag`를 전달받은 `tag` 기반으로 계산
- `prerelease` 판단을 `options.version` 기반으로 수행
- release 이름을 `options.tag` 그대로 사용

#### release draft 경로 (`runner.ts:1042-1093`)

release draft(브라우저 열기) 경로도 동일하게 처리:
- `single`/`fixed`: 기존대로 1개 draft URL 열기
- `independent`: 패키지별 draft URL 생성. 단, 브라우저를 여러 개 여는 것은 비현실적이므로 첫 번째 패키지의 draft만 열고, 나머지는 URL을 출력한다.

#### `ReleaseContext` 확장

```ts
interface ReleaseContext {
  packageName: string; // 추가
  version: string;
  tag: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}
```

`ctx.runtime.releaseContext`는 제거한다. 현재 `releaseContext`는 `afterRelease` 훅 전달과 skip 조건에만 사용되며, independent 모드에서는 패키지별 반복 내에서 로컬 변수로 처리한다. `runtime` 타입에서 `releaseContext?: ReleaseContext` 필드를 삭제한다.

### 5. 플러그인 변경

#### `external-version-sync`

version 콜백 옵션 추가:

```ts
externalVersionSync({
  targets: [...],
  version: (packages) => packages.get("packages/core") ?? "",
})
```

콜백 시그니처: `(packages: Map<string, string>) => string`

afterVersion 훅에서의 버전 해석:
```ts
afterVersion: async (ctx) => {
  const plan = ctx.runtime.versionPlan!;
  let version: string;

  if (plan.mode === "independent") {
    if (options.version) {
      version = options.version(plan.packages);
    } else {
      throw new Error(
        "external-version-sync: 'version' callback is required in independent mode. " +
        "Provide a version picker, e.g. version: (pkgs) => pkgs.get('@pubm/core') ?? ''"
      );
    }
  } else {
    version = plan.version;
  }

  for (const target of options.targets) {
    syncVersionInFile(filePath, version, target);
  }
}
```

- `single`/`fixed` 모드: `plan.version` 자동 사용 (콜백 불필요)
- `independent` 모드: 콜백 필수. 없으면 명확한 에러 메시지와 함께 실패

#### `plugin-brew`

`packageName` 옵션 추가:

```ts
brewTap({
  formula: "Formula/pubm.rb",
  packageName: "pubm", // 이 패키지의 release에만 반응
})
```

afterRelease 훅에서 필터링:
```ts
afterRelease: async (ctx, releaseCtx) => {
  if (options.packageName && releaseCtx.packageName !== options.packageName) {
    return; // skip
  }
  // 기존 로직 (releaseCtx.version, releaseCtx.assets 사용)
}
```

- `packageName` 미설정 시 모든 release에 반응 (단일 패키지 호환)
- `brew-core.ts`도 동일하게 `packageName` 필터링 추가
- `BrewTapOptions`, `BrewCoreOptions` 타입에 `packageName?: string` 추가

### 6. Config 변경

```ts
// pubm.config.ts (루트)
export default defineConfig({
  versioning: "independent",
  packages: [...],
  plugins: [
    brewTap({
      formula: "Formula/pubm.rb",
      packageName: "pubm",
    }),
    externalVersionSync({
      targets: [
        { file: "website/src/i18n/landing.ts", pattern: /v\d+\.\d+\.\d+/ },
        { file: "plugins/pubm-plugin/.claude-plugin/plugin.json", jsonPath: "version" },
        { file: ".claude-plugin/marketplace.json", jsonPath: "metadata.version" },
        { file: ".claude-plugin/marketplace.json", jsonPath: "plugins.0.version" },
      ],
      version: (packages) => packages.get("packages/core") ?? "",
    }),
  ],
});
```

## 변경 파일 목록

### Core

| 파일 | 변경 |
|------|------|
| `context.ts` | `VersionPlan` 타입 정의, `runtime` 타입 변경 (`version`/`versions` 제거 → `versionPlan`), `resolveVersion` helper export |
| `tasks/runner.ts` | `isIndependent` 제거 → `versionPlan.mode` 분기, 커밋 메시지, 태그 생성, GitHub release 패키지별 호출, `afterRelease` 패키지별 호출, 태그 존재 확인 이동, release draft 분기, `releaseContext` 처리 변경 |
| `tasks/required-missing-information.ts` | `VersionPlan` 생성 (3개 경로 모두 변환: handleSinglePackage, handleFixedMode, handleIndependentMode), CI/CLI 옵션 경로도 대응 |
| `tasks/prerequisites-check.ts` | 태그 존재 확인 태스크 제거 (runner.ts로 이동) |
| `tasks/github-release.ts` | 시그니처 변경 (`tag`, `packageName`, `version`을 옵션으로 받음), `ReleaseContext.packageName` 추가, 내부 `latestTag()` 호출 제거, `prerelease` 판단을 전달받은 version 기반으로 변경 |
| `tasks/npm.ts` | `ctx.runtime.version` → `versionPlan` 기반 버전 접근 |
| `tasks/jsr.ts` | 동일 |
| `tasks/crates.ts` | 동일 |
| `tasks/dry-run-publish.ts` | 동일 |
| `git.ts` | `tagsByPackage()`, `latestTagForPackage()` 추가, `previousTag()` prefix 기반 필터링으로 확장, `extractVersion()`/`extractPrefix()` 헬퍼 추가, `tags()` 정렬 로직 수정 |

### 플러그인

| 파일 | 변경 |
|------|------|
| `plugin-external-version-sync/index.ts` | version 콜백 기반 버전 해석, independent 모드에서 콜백 미설정 시 에러 |
| `plugin-external-version-sync/types.ts` | `version?: (packages: Map<string, string>) => string` 콜백 타입 추가 |
| `plugin-brew/brew-tap.ts` | `packageName` 필터링 |
| `plugin-brew/brew-core.ts` | `packageName` 필터링 |
| `plugin-brew/types.ts` | `packageName?: string` 옵션 타입 추가 |

### Config

| 파일 | 변경 |
|------|------|
| `pubm.config.ts` | 플러그인 옵션 업데이트 (`version` 콜백, `packageName`) |

### 테스트

`ctx.runtime.version`/`versions` mock을 사용하는 모든 테스트를 `versionPlan`으로 업데이트.
