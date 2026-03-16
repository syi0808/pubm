# TUI Improvement Design

## Problem

1. **배경색/글자색 충돌**: `ERROR`, `WARNING` 뱃지가 `color.bgRed()`/`color.bgYellow()`만 사용하고 글자색을 지정하지 않아, 터미널 테마에 따라 안 보이는 경우 발생
2. **Notes 가독성 부족**: 이모지 + 평문 들여쓰기만으로 구분되어, 노트 유형을 한눈에 파악하기 어려움
3. **CLI 출력 비일관성**: 서브커맨드들이 `console.log()` 평문으로 제각각 출력하며, 색상/포맷/에러 처리가 통일되지 않음

## Solution

중앙 테마 시스템 (`ui.ts`) 도입. chalk을 추가 의존성으로 사용하며, publish 파이프라인과 CLI 서브커맨드 양쪽이 공유하는 단일 출력 모듈을 만든다.

## Design

### 1. Theme & Color System

#### Badges (심각도 높은 것만 배경색)

| Label | Style | Usage |
|-------|-------|-------|
| `ERROR` | `chalk.bgRed.white.bold(" ERROR ")` | 에러 메시지 |
| `ROLLBACK` | `chalk.bgRed.white.bold(" ROLLBACK ")` | 롤백 상태 |

#### Labels (색상 글자만)

| Label | Style | Usage |
|-------|-------|-------|
| `WARNING` | `chalk.yellow.bold("WARNING")` | 경고 메시지 |
| `NOTE` | `chalk.blue.bold("NOTE")` | 일반 노트 |
| `INFO` | `chalk.cyan("INFO")` | 정보성 메시지 |
| `SUCCESS` | `chalk.green.bold("SUCCESS")` | 성공 메시지 |
| `HINT` | `chalk.magenta("HINT")` | 힌트/제안 |
| `DRY-RUN` | `chalk.gray.bold("[dry-run]")` | dry-run 모드 표시 |

#### General Color Conventions

- `dim` — 부차 정보 (버전, 경로)
- `bold` — 패키지명, 주요 텍스트
- `cyan` — URL/링크
- `blueBright` — 버전 요약

#### Notes Emoji + Label Mapping

- `💡 Hint:` — 의존성 범프 제안 등 (magenta)
- `📦 Suggest:` — changeset 추천 (blue)
- `⚠ Warning:` — 이미 퍼블리시됨 등 (yellow)

### 2. Output Functions

`ui.ts`에서 제공하는 기본 출력 함수들:

```ts
ui.success(message)   // ✓ message (green)
ui.info(message)      // INFO message (cyan)
ui.warn(message)      // WARNING message (yellow)
ui.error(message)     // [ERROR] message (bgRed badge)
ui.hint(message)      // 💡 Hint: message (magenta)
ui.debug(message)     // DEBUG=pubm 일 때만 출력
```

**Output Channel Rules:**
- **stderr**: `error()`, `warn()`, `debug()`
- **stdout**: `success()`, `info()`, `hint()`
- `NO_COLOR` 환경변수 및 `--no-color` 플래그 지원 (chalk 자동 처리)

### 3. Module Structure

```
packages/core/src/utils/ui.ts    — theme + output functions (chalk)
packages/core/src/utils/cli.ts   — 삭제 (warningBadge, link() → ui.ts로 이동)
packages/core/src/index.ts       — ui module export 추가
```

**`ui.ts` 내부 구조:**
- Theme constants (badges, labels, colors)
- Output functions (`success`, `info`, `warn`, `error`, `hint`, `debug`)
- `link()` function (cli.ts에서 이동)
- `formatNote()` — emoji + label combination

**Dependencies:**
- `chalk` — 새로 추가 (CLI 출력용)
- `listr2.color` — publish 파이프라인 내부에서는 기존대로 유지

### 4. Migration Scope

#### Publish Pipeline (packages/core) — 변경

| File | Change |
|------|--------|
| `error.ts` | `color.bgRed` → theme badge 사용 |
| `utils/cli.ts` | 파일 삭제, `warningBadge`/`link()` → `ui.ts`로 이동 |
| `utils/rollback.ts` | `color.yellow`/`color.red`/`color.green` → theme 색상 통일 |
| `tasks/runner.ts` | 성공 메시지 색상 통일 |
| `tasks/required-missing-information.ts` | Notes → `💡 Hint:`, `📦 Suggest:` 패턴 |

#### CLI Subcommands (packages/cli) — 변경

| File | Change |
|------|--------|
| 모든 서브커맨드 | `console.log()`/`console.error()` → `ui.*()` 함수 |
| `version-cmd.ts` | `[dry-run]` → theme `DRY-RUN` 라벨 |

#### 변경하지 않는 것

| File | Reason |
|------|--------|
| listr2 task title/output 내 `listr2.color` | listr2 렌더러 호환성 유지 |
| `splash.ts` | 별도 로고 렌더링, 독립 유지 |
| `listr-ci-renderer.ts` | 별도 CI 포맷 체계 |
| `update.ts` progress | stderr 직접 write 방식 유지 |
