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

**참고:** 이 커밋 메시지는 pubm의 changeset 기반 versioning이 생성하는 고정 포맷이다. Squash merge를 사용하는 경우 커밋 메시지가 변경될 수 있으므로, 이 워크플로우는 merge commit 또는 fast-forward merge 전략과 함께 사용해야 한다.

### 2. `pubm --ci` / `--publish-only` 버전 결정 로직 변경

`--ci`와 `--publish-only` 플래그는 동일한 코드 경로를 공유한다 (`options.publishOnly || options.ci`). 이 변경은 두 모드 모두에 적용된다.

**현재 동작 (`packages/pubm/src/cli.ts` ~L212-244):**
- `git.latestTag()` → `v` prefix strip → 모든 패키지에 동일 버전 적용
- `versionPlan.mode`가 항상 `"single"` 또는 `"fixed"` — independent 모드 미지원

**변경:**
- 각 패키지의 로컬 매니페스트(`package.json`, `jsr.json`, `Cargo.toml`)에서 현재 버전을 읽음
- `resolvedConfig.versioning`을 존중하여 independent 모드 시 `versionPlan.mode = "independent"` 설정
- 더 이상 `git.latestTag()`에 의존하지 않음

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

**Publish 스킵:** 기존 `isVersionPublished` 체크가 각 레지스트리의 publish task에 이미 존재하므로, 이미 퍼블리시된 패키지는 자동으로 스킵된다. versionPlan에 모든 패키지가 포함되어도 실제로는 변경된 패키지만 퍼블리시된다.

### 3. GitHub Release 멱등성 처리

**문제:** versionPlan에 모든 패키지가 포함되므로, independent 모드에서 변경되지 않은 패키지의 GitHub Release를 중복 생성하려고 시도할 수 있다. 해당 태그의 Release가 이미 존재하면 GitHub API가 422를 반환한다.

**해결:** `github-release.ts`의 `createResponse` 처리에서 HTTP 422 (이미 존재) 응답을 감지하고 스킵 처리한다:

```typescript
if (createResponse.status === 422) {
  // Release already exists for this tag — skip
  return;
}
if (!createResponse.ok) {
  const errorBody = await createResponse.text();
  throw new GitHubReleaseError(
    `Failed to create GitHub Release (${createResponse.status}): ${errorBody}`,
  );
}
```

이를 통해:
- 변경되지 않은 패키지의 기존 Release는 스킵
- 부분 실패 후 재실행 시에도 안전 (멱등성)

### 4. 태그 존재 전제 조건

커밋 메시지 기반 트리거에서의 태그 흐름:
1. 로컬: `pubm` → "Version Packages" 커밋 생성 → 패키지별 태그 생성 → `git push --follow-tags` (커밋 + 태그 동시 푸시)
2. CI: main push 트리거 → `pubm --ci` 실행 → 태그는 이미 remote에 존재

태그는 로컬에서 생성되어 커밋과 함께 푸시되므로, CI 실행 시점에 이미 remote에 존재한다. 별도의 태그 생성 로직이 CI 모드에 필요하지 않다.

### 5. publish-setup Skill 업데이트

`plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` 업데이트:

- `--ci` / `--publish-only` 모드 설명에서 "태그에서 버전을 읽는다" → "로컬 매니페스트에서 버전을 읽고, 이미 퍼블리시된 버전은 스킵한다"로 변경
- 모노레포용 CI 템플릿 추가: `on: push: branches: [main]` + `"Version Packages"` 커밋 조건
- 기존 태그 기반 템플릿은 단일 패키지용으로 유지
- `fetch-depth: 0` 요구사항 제거 (더 이상 `git describe --tags`에 의존하지 않음, 단 GitHub Release의 commit log 생성에는 여전히 필요할 수 있으므로 유지 권장)

### 6. Scope

**변경 파일:**
1. `.github/workflows/release.yml` — 트리거 변경
2. `packages/pubm/src/cli.ts` — CI 버전 결정 로직 변경 (`--ci` 및 `--publish-only` 모두)
3. `packages/core/src/tasks/github-release.ts` — 422 멱등성 처리 추가
4. `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` — 문서 업데이트
5. `plugins/pubm-plugin/skills/publish-setup/SKILL.md` — CI 설정 단계 설명 업데이트 (모노레포 케이스)

**변경하지 않는 파일:**
- `packages/core/src/tasks/runner.ts` — CI pipeline 및 GitHub Release 호출 로직은 이미 independent 모드 지원
- 각 레지스트리의 publish task — `isVersionPublished` 체크 이미 존재

### 7. Testing

- 기존 CLI 테스트에서 `--ci` / `--publish-only` 플래그 관련 테스트 업데이트
- independent versioning + `--ci` 조합 테스트 추가
- 매니페스트 기반 버전 읽기 로직 단위 테스트
- GitHub Release 422 스킵 처리 단위 테스트
