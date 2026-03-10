# Changesets 워크플로우 정비 설계

**Date:** 2026-03-10
**Status:** Draft
**Relation:** Extends [Changesets Integration Design](./2026-03-04-changesets-np-integration-design.md)

---

## 1. 배경

changeset 기능이 구현되어 있지만, 메인테이너가 직접 사용해본 적이 없어 실제 동작 여부와 워크플로우 연결이 불확실한 상태. 이번 작업으로 기능을 검증하고, 누락된 부분을 구현하며, 메인 퍼블리시 플로우에 자연스럽게 연결한다.

## 2. 범위

### In Scope

1. Interactive `pubm changesets add` 구현
2. 메인 퍼블리시 플로우에 changeset 연동 (버전 추천)
3. 친절한 interactive version 프롬프트 (패키지 목록, 의존관계, sync)
4. changeset 소비 → version bump 커밋에 포함
5. CHANGELOG 파싱 + `pubm changesets changelog` 서브커맨드
6. CI에서 CHANGELOG.md 기반 release 내용 생성
7. 동작 검증 + 코드 정리

### Out of Scope

- 모노레포 기능 확장
- 대규모 아키텍처 변경
- 새로운 changeset 기능 (위 범위 외)

## 3. Interactive `pubm changesets add`

현재 `--packages`, `--bump`, `--message` 플래그만 지원하며 interactive 모드는 미구현("coming soon").

### 구현할 플로우

```
$ pubm changesets add

? Select packages to include: (모노레포)
  ◉ @pubm/core (v1.2.0)
  ◯ @pubm/cli (v0.9.1)
  ◯ @pubm/utils (v0.3.0)

? Bump type for @pubm/core:
  ○ patch — Bug fixes, no API changes
  ● minor — New features, backward compatible
  ○ major — Breaking changes

? Summary of changes:
  > Add support for custom changelog templates

✅ Created changeset: brave-ant-a3k2
   .pubm/changesets/brave-ant-a3k2.md
```

단일 패키지의 경우 패키지 선택을 건너뛴다.

## 4. 메인 퍼블리시 플로우에 changeset 연동

`pubm` (interactive, 버전 미지정) 실행 시:

```
패키지 목록 + 현재 버전 표시
  "📦 @pubm/core  v1.2.0"
  "📦 @pubm/cli   v0.9.1"

pending changesets 확인
├─ 있다 → changeset 기반 버전 추천
│   "Changesets suggest:"
│   "  @pubm/core  1.2.0 → 1.3.0 (minor: 2 changesets)"
│   "  @pubm/cli   0.9.1 → 0.9.2 (patch: 1 changeset)"
│   "Accept? (Y/n/customize)"
│   ├─ 수락 → 해당 버전으로 진행
│   └─ customize → 수동 플로우로
│
└─ 없다 → 수동 플로우
```

### CI 모드

CI 환경에서도 pending changeset을 자동 감지한다. changeset이 있으면 자동으로 버전을 결정하고 진행한다.

## 5. Interactive Version 프롬프트

changeset이 없거나 customize를 선택한 경우의 수동 플로우:

```
배포할 패키지가 여러개
├─ 버전 sync 할건지? (옵션에 미지정 시 묻기)
│   ├─ sync → 버전 한번만 묻기 (모든 패키지 동일)
│   └─ no sync → 패키지 각각 버전 묻기
│
배포할 패키지가 한개
└─ 버전 한번만 묻기
```

### 의존관계 기반 추천

패키지별 버전을 묻는 경우, 의존 패키지의 버전이 올라가면 의존하는 패키지도 추천한다:

```
"@pubm/core를 1.2.0 → 1.3.0 (minor)으로 올립니다"
"@pubm/cli는 @pubm/core에 의존하고 있습니다"
"  → @pubm/cli도 버전을 올리시겠습니까? (Y/n)"
"    현재: 0.9.1 → 추천: 0.9.2 (patch)"
```

## 6. Changeset 소비와 Version Bump

Local CLI에서 version bump 시점에 병렬 태스크로 실행:

```
Version Bump (병렬)
├─ changeset 파일 삭제
├─ CHANGELOG.md 생성/업데이트
└─ package.json/jsr.json 버전 업데이트

→ 하나의 version bump 커밋에 전부 포함
```

## 7. CHANGELOG 서브커맨드

### `pubm changesets changelog`

- pending changesets를 기반으로 CHANGELOG 프리뷰 생성
- `--dry-run`: 파일에 쓰지 않고 stdout 출력
- `--version <ver>`: 특정 버전 헤더로 생성

### CHANGELOG 파싱

기존 CHANGELOG.md에서 특정 버전 섹션을 추출하는 기능:

- CI에서 GitHub Release body에 사용
- `## [1.3.0]` 같은 헤더 기준으로 섹션 분리
- 함수로 노출: `parseChangelog(content, version) → string`

## 8. CI 워크플로우 연동

CI에서는 changeset 파일이 아닌 CHANGELOG.md를 기준으로 동작:

```
CI (publish 시점)
1. package.json에서 버전 읽기 (이미 로컬에서 bump됨)
2. CHANGELOG.md에서 해당 버전 섹션 파싱
3. GitHub Release body에 changelog 내용 사용
4. publish
```

changeset 파일은 로컬 version bump 커밋에서 이미 소비되어 CI 시점에는 없다.
만약 CI에서 changeset이 남아있다면 (all-CI 워크플로우), 자동 감지하여 version + publish를 진행한다.
