# Dependency-Ordered Version Prompt

## Summary

버전 선택 프롬프트에서 패키지 목록의 순서를 의존성 기반 토폴로지컬 정렬로 변경하고, 수동 플로우에서 changeset 추천 정보를 노트 및 선택지 마킹으로 표시한다.

## Changes

### 1. 의존성 순서 정렬

**위치:** `handleMultiPackage()` (required-missing-information.ts)

- 현재 `handleIndependentMode()` 내부에서만 빌드되는 dependency graph를 `handleMultiPackage()` 레벨로 올린다.
- `topologicalSort()`로 정렬된 `packageInfos`를 이후 모든 함수에 전달한다.
- 적용 범위: `renderPackageVersionSummary()`, `promptChangesetRecommendations()`, `handleFixedMode()`, `handleIndependentMode()` 모두 정렬된 순서 사용.

### 2. 수동 플로우에 changeset 노트 표시

**조건:** changeset이 있는 상태에서 수동 플로우 진입 시 (Customize 선택 또는 changeset 없이 직접 진입)

- `handleManualMultiPackage()`에 `bumps` 파라미터 추가.
- `renderPackageVersionSummary()`의 `notes`에 changeset 정보 표시.
  - 예: `📦 3 changesets suggest minor -> 1.1.0`
- `handleFixedMode()`, `handleIndependentMode()` 모두 해당.

### 3. 버전 선택지에 changeset 추천 마킹

**위치:** `promptVersion()`

- changeset bump 정보를 optional 파라미터로 전달.
- 해당 릴리즈 타입의 선택지에 `← recommended by changesets` 표시 추가.

## Affected Functions

| Function | Change |
|---|---|
| `handleMultiPackage()` | dependency graph 빌드, packageInfos 정렬, bumps를 수동 플로우에 전달 |
| `handleManualMultiPackage()` | `bumps` 파라미터 추가, 하위 함수에 전달 |
| `handleFixedMode()` | changeset 노트 표시 |
| `handleIndependentMode()` | 외부 그래프 수신, changeset 노트 + 선택지 마킹 |
| `promptVersion()` | optional bump 파라미터, 선택지 마킹 |
| `promptChangesetRecommendations()` | 정렬된 bumps 순서 반영 |

## File

- `packages/core/src/tasks/required-missing-information.ts`
