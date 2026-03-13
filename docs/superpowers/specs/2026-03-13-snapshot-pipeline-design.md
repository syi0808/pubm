# Snapshot Pipeline & Pre-release/Snapshot Removal Design

## Summary

changeset의 pre-release(`pubm changesets pre enter/exit`)와 snapshot(`pubm changesets snapshot`) 기능을 제거하고, `pubm --snapshot [tag]` CLI 옵션으로 전용 snapshot 배포 파이프라인을 제공한다.

## Motivation

- changeset의 pre-release와 snapshot은 배포 파이프라인과 별개의 독립 경로로, 복잡도를 높이고 있음
- 배포 파이프라인에 통합하되, snapshot은 일반 배포와 정책이 크게 달라 별도 파이프라인으로 분리하는 것이 적절

## Design

### 1. 삭제 범위

#### 파일 삭제
- `packages/core/src/prerelease/pre.ts` — pre-release 상태 관리
- `packages/core/src/prerelease/index.ts` — re-export
- `packages/core/src/prerelease/snapshot.ts` — snapshot 버전 생성 (함수는 `utils/snapshot.ts`로 이동)
- `packages/pubm/src/commands/pre.ts` — `pubm changesets pre` CLI 명령
- `packages/pubm/src/commands/snapshot.ts` — `pubm changesets snapshot` CLI 명령
- `packages/core/src/prerelease/` — 디렉토리 자체 삭제

#### 코드 제거
- `packages/pubm/src/commands/changesets.ts` — `registerPreCommand`, `registerSnapshotCommand` import 및 호출 제거
- `packages/pubm/src/commands/version-cmd.ts`:
  - `readPreState` import 및 호출 제거
  - `computePreReleaseVersion()` 함수 제거
  - `updatePreState()` 함수 및 호출 제거
  - `PreState` 타입 import 제거
  - pre-release 분기 조건문 제거
- `packages/core/src/config/types.ts` — `SnapshotConfig` 인터페이스 제거
- `packages/core/src/config/defaults.ts` — `defaultSnapshot` 객체 제거
- `packages/core/src/index.ts` — public API export 정리:
  - `enterPreMode`, `exitPreMode`, `readPreState`, `PreState` export 제거
  - `generateSnapshotVersion`, `SnapshotOptions` export 경로를 `utils/snapshot.js`로 변경

#### 함수 이동
- `prerelease/snapshot.ts`의 `generateSnapshotVersion` → `utils/snapshot.ts`로 이동
- `SnapshotOptions`에서 `useCalculatedVersion` 필드 제거
- `"0.0.0"` fallback 로직 제거 — `baseVersion`은 필수 필드이며 항상 매니페스트 버전 사용

### 2. CLI 변경

#### 새 옵션
```
pubm --snapshot [tag]
```
- `tag` 기본값: `"snapshot"`
- 예: `pubm --snapshot` → `1.2.0-snapshot-20260313T120530`
- 예: `pubm --snapshot beta` → `1.2.0-beta-20260313T120530`

#### 유효성 검사
- `--snapshot`과 `--preflight` 동시 사용 시 에러
- `--snapshot`과 `--ci` 조합은 허용 (CI에서 preview deploy에 유용)

### 3. Snapshot 파이프라인

#### 태스크 체인
1. **Prerequisites check** — 일반 배포와 동일 (branch, remote, working tree)
2. **Required conditions check** — 일반 배포와 동일 (registry ping, login)
3. **Test** — 설정된 test 스크립트 실행
4. **Build** — 설정된 build 스크립트 실행
5. **Snapshot publish**:
   1. 매니페스트에서 현재 버전 읽기 (에코시스템별: package.json, Cargo.toml, jsr.json 등)
   2. `generateSnapshotVersion({ baseVersion, tag, template })` 호출
   3. 매니페스트 파일에 snapshot 버전 쓰기
   4. 각 registry에 publish (dist-tag = snapshot tag)
   5. 매니페스트 파일 원복 (실패 시에도 반드시 원복 — try/finally)
6. **Tag** — git tag 생성 (`v{snapshot-version}`, 예: `v1.2.0-snapshot-20260313T120530`) + push

#### 스킵되는 것들
- 버전 선택 프롬프트 (자동 생성)
- changeset 소비 (파일 삭제, changelog 생성)
- git commit
- git push (tag push만)
- GitHub release

#### 모노레포 동작
- 단일 패키지 프로젝트만 지원 (기존 snapshot 명령과 동일)
- 모노레포에서 사용 시 에러 메시지 출력

### 4. Config 변경

#### Before
```typescript
interface PubmConfig {
  snapshot?: {
    useCalculatedVersion?: boolean;
    prereleaseTemplate?: string;
  };
}
```

#### After
```typescript
interface PubmConfig {
  snapshotTemplate?: string; // 기본값: "{tag}-{timestamp}"
}
```

사용 가능한 템플릿 변수: `{base}`, `{tag}`, `{timestamp}`, `{commit}`

### 5. `generateSnapshotVersion` 변경

```typescript
// utils/snapshot.ts
interface SnapshotOptions {
  tag?: string;        // 기본값: "snapshot"
  baseVersion: string; // 매니페스트에서 읽은 현재 버전 (필수)
  template?: string;   // config의 snapshotTemplate
  commit?: string;     // git SHA (선택)
}
```

- `useCalculatedVersion` 로직 및 `"0.0.0"` fallback 제거
- 항상 매니페스트 버전을 base로 사용

### 6. 문서 변경

#### 수정 대상 (영문 + de, es, fr, zh-cn, ko 번역)

**`website/src/content/docs/guides/changesets.mdx`**
- pre-release mode 섹션 삭제
- snapshot releases 섹션 삭제

**`website/src/content/docs/reference/cli.mdx`**
- `pubm changesets pre enter/exit` 명령 삭제
- `pubm changesets snapshot` 명령 삭제
- `pubm --snapshot [tag]` 옵션 추가

**`website/src/content/docs/reference/config.mdx`**
- `snapshot.useCalculatedVersion`, `snapshot.prereleaseTemplate` 삭제
- `snapshotTemplate` 최상위 필드 추가 (사용 가능한 템플릿 변수 문서화)

번역은 sonnet 4.6 subagent로 처리.
