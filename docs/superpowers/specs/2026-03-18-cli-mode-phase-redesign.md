# CLI Mode/Phase Redesign

## Problem

The current CLI options (`--preview`, `--preflight`, `--ci`, `--publish-only`) are confusing:

- `--preview`는 "task graph 보기"로 문서화되지만 실제로는 테스트/빌드까지 실행함
- `--preflight`는 "사전검증"처럼 들리지만 실제로는 version bump + git push까지 수행하는 CI 트리거
- `--ci`와 `--preflight`의 관계가 이름만으로는 파악 불가
- `--publish-only`는 독립된 플래그지만 실질적으로 phase 개념
- `runner.ts`에서 `preview`, `preflight`, `ci`, `publishOnly`를 개별 체크하는 분기가 복잡

## Design

### Core Concept: Mode + Phase + Dry-Run

두 개의 릴리즈 전략(mode)과 두 개의 실행 단계(phase), 그리고 검증 플래그(dry-run)로 통합한다.

**Mode** — 릴리즈가 어디서 완료되는가:
- `local` (기본값): 내 머신에서 publish까지 완료. Interactive 인증 (OTP 등)
- `ci`: CI runner에서 publish. 토큰 기반 인증. 2단계로 분리됨

**Phase** — 파이프라인의 어느 부분을 실행하는가:
- `prepare`: prerequisites check → conditions check → 프롬프트 → test → build → version bump → git commit + tag → git push
- `publish`: publish → post-publish hooks → release draft

**Dry-Run** — side-effect 없이 검증:
- version bump 실행 후 자동 rollback
- git push 안 함
- publish는 registry dry-run으로 대체 (`npm publish --dry-run` 등)

### CLI Interface

```bash
# Local mode (기본값)
pubm                                        # = --mode local (prepare + publish)
pubm --dry-run                              # 전체 검증 후 rollback
pubm --mode local --prepare                 # version bump + tag까지
pubm --mode local --publish                 # publish만 (이미 준비된 상태에서)
pubm --mode local --prepare --dry-run       # version bump 검증 후 rollback
pubm --mode local --publish --dry-run       # dry-run publish

# CI mode
pubm --mode ci --prepare                    # 토큰 수집 + test/build + version bump + tag push (CI 트리거)
pubm --mode ci --prepare --dry-run          # 토큰 수집 + 검증, tag push 안 함
pubm --mode ci --publish                    # CI에서 실제 publish
pubm --mode ci --publish --dry-run          # CI에서 dry-run publish
pubm --mode ci                              # 에러: --prepare 또는 --publish를 명시하세요
```

### Option Mapping

| 현재 옵션 | 새 체계 | 비고 |
|-----------|---------|------|
| `pubm` (기본) | `pubm --mode local` | 기본값이므로 생략 가능 |
| `--preview` | `--dry-run` | **제거 (breaking)** |
| `--preflight` | `--mode ci --prepare` | **제거 (breaking)** |
| `--ci` | `--mode ci --publish` | **제거 (breaking)** |
| `--publish-only` | `--mode local --publish` | **제거 (breaking)** |

### Default Values

- `--mode` 미지정 → `local`
- `--mode local` + phase 미지정 → `prepare + publish` (전체 실행)
- `--mode ci` + phase 미지정 → **에러**

### Constraints

- `--snapshot`은 `--mode ci`와 함께 사용 불가
- `--prepare`와 `--publish`는 동시 지정 불가 (= 기본 동작이므로 불필요)

### Mode별 Phase 동작 차이

#### prepare phase

| 동작 | local | ci |
|------|-------|----|
| Prerequisites check | ✅ | ✅ |
| Required conditions check | ✅ | ✅ |
| Interactive prompts (version/tag) | ✅ (TTY) | ❌ (non-interactive) |
| Token collection | JSR만 (필요시) | 모든 레지스트리 (interactive → env 주입) |
| GitHub Secrets sync prompt | ❌ | ✅ |
| Test & Build | ✅ | ✅ |
| Version bump + git commit + tag | ✅ | ✅ |
| Git push (--follow-tags) | ✅ | ✅ (CI 트리거) |

#### publish phase

| 동작 | local | ci |
|------|-------|----|
| Publish to registries | ✅ (interactive auth) | ✅ (token auth, from latest tag) |
| Post-publish hooks | ✅ | ✅ |
| Release draft | ✅ | ✅ (with asset pipeline) |

#### dry-run modifier

| 동작 | dry-run 적용 시 |
|------|----------------|
| Version bump | 실행 후 **자동 rollback** (manifest 복원) |
| Git commit + tag | **skip** |
| Git push | **skip** |
| Publish | registry `--dry-run` 플래그로 대체 |
| Release draft | **skip** |
| Token collection (ci mode) | 실행 (검증 목적) |
| Test & Build | 실행 |

### Types 변경

```typescript
// 현재
export interface Options {
  preview?: boolean;
  ci?: boolean;
  preflight?: boolean;
  publishOnly?: boolean;
  // ...
}

// 변경 후
export type ReleaseMode = "local" | "ci";
export type ReleasePhase = "prepare" | "publish";

export interface Options {
  mode?: ReleaseMode;
  phase?: ReleasePhase;
  dryRun?: boolean;
  // ...
}
```

### Runner 분기 단순화

현재 `runner.ts`의 분기:
```typescript
// 현재: 4개 플래그를 개별 체크
skip: (ctx) => !!ctx.options.preview || !!ctx.options.preflight
skip: (ctx) => !!ctx.options.preview
if (ctx.options.preflight) { ... }
if (ctx.options.ci) { ... }
if (ctx.options.publishOnly) { ... }
```

변경 후:
```typescript
// mode와 phase로 통합된 분기
const mode = ctx.options.mode ?? "local";
const phases = resolvePhases(ctx.options); // ["prepare"] | ["publish"] | ["prepare", "publish"]
const dryRun = !!ctx.options.dryRun;

// Task skip 조건이 단순해짐
skip: () => !phases.includes("prepare")           // prepare phase tasks
skip: () => !phases.includes("publish") || dryRun // publish tasks (dry-run시 registry dry-run으로 대체)
skip: () => dryRun                                // git push, release draft 등 side-effects
```

### Phase Resolution Logic

```typescript
function resolvePhases(options: Options): ReleasePhase[] {
  const mode = options.mode ?? "local";

  if (mode === "ci" && !options.phase) {
    throw new Error("CI mode requires --prepare or --publish flag.");
  }

  if (options.phase) return [options.phase];

  // local mode without explicit phase → both
  return ["prepare", "publish"];
}
```

### Validation Rules

```typescript
function validateOptions(options: Options): void {
  const mode = options.mode ?? "local";

  // CI mode requires explicit phase
  if (mode === "ci" && !options.phase) {
    throw new Error("CI mode requires --prepare or --publish. Example: pubm --mode ci --prepare");
  }

  // snapshot은 CI mode와 함께 사용 불가
  if (options.snapshot && mode === "ci") {
    throw new Error("Cannot use --snapshot with --mode ci.");
  }
}
```

## Affected Files

### Core changes
- `packages/core/src/types/options.ts` — `ReleaseMode`, `ReleasePhase` 타입 추가, 기존 플래그 제거
- `packages/core/src/tasks/runner.ts` — 분기 로직 전면 재작성
- `packages/core/src/options.ts` — 옵션 resolve 로직 변경

### CLI changes
- `packages/cli/src/cli.ts` — Commander 플래그 재정의, validation 추가

### Test changes
- 기존 `preview`, `preflight`, `ci`, `publishOnly` 관련 테스트 전부 업데이트
- 새로운 mode/phase 조합에 대한 테스트 추가

### Documentation changes
- `website/src/content/docs/reference/cli.mdx` — CLI 레퍼런스 재작성
- `website/src/content/docs/guides/ci-cd.mdx` — CI/CD 가이드 재작성
- `website/src/content/docs/guides/quick-start.mdx` — Quick start 업데이트
- `website/src/content/docs/guides/troubleshooting.mdx` — Troubleshooting 업데이트

### Plugin changes
- `plugins/pubm-plugin/` — pubm plugin skills에서 preflight/preview 참조 업데이트
