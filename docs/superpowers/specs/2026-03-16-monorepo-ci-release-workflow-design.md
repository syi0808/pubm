# Monorepo CI Release Workflow Design

## Problem

pubm 모노레포에서 independent versioning 사용 시, 패키지별 태그(`@pubm/core@0.4.0`, `pubm@0.4.0`)가 생성된다. 현재 release workflow는 `v*` 태그에만 트리거되므로 workflow가 실행되지 않는다.

추가로, `pubm --ci`의 버전 결정 로직이 `latestTag()` → strip `v` → 모든 패키지에 동일 버전 적용하는 구조라 independent versioning과 호환되지 않는다.

## Design

### 1. Workflow 트리거 변경

**Before:**
```yaml
on:
  push:
    tags:
      - 'v*'
```

**After:**
```yaml
on:
  push:
    branches:
      - main
```

`"Version Packages"` 커밋 메시지를 조건으로 사용하여 릴리스 커밋일 때만 실행:

```yaml
jobs:
  release:
    if: startsWith(github.event.head_commit.message, 'Version Packages')
```

### 2. `pubm --ci` 버전 결정 로직 변경

**현재 동작 (`packages/pubm/src/cli.ts` ~L212-244):**
- `git.latestTag()` → `v` prefix strip → 모든 패키지에 동일 버전 적용
- `versionPlan.mode`가 항상 `"single"` 또는 `"fixed"` — independent 모드 미지원

**변경:**
- 각 패키지의 로컬 매니페스트(`package.json`, `jsr.json`, `Cargo.toml`)에서 현재 버전을 읽음
- 레지스트리에 해당 버전이 이미 퍼블리시되었는지 확인 (기존 `isVersionPublished` 활용)
- 퍼블리시되지 않은 패키지만 퍼블리시 대상으로 선정
- `resolvedConfig.versioning`을 존중하여 independent 모드 시 `versionPlan.mode = "independent"` 설정

**변경 후 로직 (`options.publishOnly || options.ci` 분기):**

```typescript
// 각 패키지의 로컬 매니페스트에서 버전 읽기
const packages = new Map(
  resolvedConfig.packages.map((p) => [p.name, p.version])
);

if (resolvedConfig.packages.length <= 1) {
  const [name, version] = [...packages][0];
  ctx.runtime.version = version;
  ctx.runtime.versionPlan = {
    mode: "single",
    version,
    packageName: name,
  };
} else if (resolvedConfig.versioning === "independent") {
  ctx.runtime.version = [...packages.values()][0]; // fallback
  ctx.runtime.versions = packages;
  ctx.runtime.versionPlan = {
    mode: "independent",
    packages,
  };
} else {
  // fixed mode
  const version = [...packages.values()][0];
  ctx.runtime.version = version;
  ctx.runtime.versionPlan = {
    mode: "fixed",
    version,
    packages,
  };
}
```

기존 `isVersionPublished` 체크가 각 레지스트리의 publish task에 이미 존재하므로, 이미 퍼블리시된 패키지는 자동으로 스킵된다. 별도의 필터링 로직이 불필요하다.

### 3. GitHub Release 생성

현재 CI 모드의 GitHub Release 생성 로직(`runner.ts` ~L610-735)은 이미 independent 모드를 지원한다:
- `plan.mode === "independent"` → 패키지별 태그(`${pkgName}@${pkgVersion}`)로 GitHub Release 생성
- `plan.mode === "fixed"` 또는 `"single"` → `v${version}` 태그로 단일 GitHub Release 생성

변경 불필요.

### 4. publish-setup Skill 업데이트

`plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` 업데이트:

- `--ci` 모드 설명에서 "태그에서 버전을 읽는다" → "로컬 매니페스트에서 버전을 읽고 레지스트리와 비교한다"로 변경
- 모노레포용 CI 템플릿 추가: `on: push: branches: [main]` + `"Version Packages"` 커밋 조건
- 기존 태그 기반 템플릿은 단일 패키지용으로 유지

### 5. Scope

**변경 파일:**
1. `.github/workflows/release.yml` — 트리거 변경
2. `packages/pubm/src/cli.ts` — CI 버전 결정 로직 변경
3. `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` — 문서 업데이트
4. `plugins/pubm-plugin/skills/publish-setup/SKILL.md` — CI 설정 단계 설명 업데이트 (모노레포 케이스)

**변경하지 않는 파일:**
- `packages/core/src/tasks/runner.ts` — CI pipeline 및 GitHub Release 로직은 이미 independent 모드 지원
- 각 레지스트리의 publish task — `isVersionPublished` 체크 이미 존재

### 6. Testing

- 기존 CLI 테스트에서 `--ci` 플래그 관련 테스트 업데이트
- independent versioning + `--ci` 조합 테스트 추가
- 매니페스트 기반 버전 읽기 로직 단위 테스트
