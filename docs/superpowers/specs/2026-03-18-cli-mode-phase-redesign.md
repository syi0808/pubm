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
- version bump: manifest 파일에 버전 쓰기 실행 → git commit/tag **skip** → manifest 원본 복원
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
pubm --mode ci --prepare                    # 토큰 수집 + test/build + version bump + tag push + dry-run publish (CI 트리거)
pubm --mode ci --prepare --dry-run          # 토큰 수집 + 검증, version bump/tag push 안 함, dry-run publish
pubm --mode ci --publish                    # CI에서 실제 publish
pubm --mode ci --publish --dry-run          # CI에서 dry-run publish
pubm --mode ci                              # 에러: --prepare 또는 --publish를 명시하세요
```

### Option Mapping

| 현재 옵션 | 새 체계 | 비고 |
|-----------|---------|------|
| `pubm` (기본) | `pubm --mode local` | 기본값이므로 생략 가능 |
| `--preview` | `--dry-run` | **제거 (breaking)** — 동작 변경: 기존 preview는 version bump을 skip했지만 dry-run은 실행 후 rollback |
| `--preflight` | `--mode ci --prepare` | **제거 (breaking)** |
| `--ci` | `--mode ci --publish` | **제거 (breaking)** |
| `--publish-only` | `--mode local --publish` | **제거 (breaking)** |

### Default Values

- `--mode` 미지정 → `local`
- `--mode local` + phase 미지정 → `prepare + publish` (전체 실행)
- `--mode ci` + phase 미지정 → **에러**
- `isCI` (std-env 자동감지)는 `--mode`를 자동 설정하지 않음. mode는 항상 명시적

### Constraints

- `--snapshot`은 `--mode ci`와 함께 사용 불가
- `--prepare`와 `--publish`는 동시 지정 불가 (= 기본 동작이므로 불필요, 에러 처리)

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
| Dry-run publish validation | ❌ | ✅ (토큰/패키지 유효성 검증) |

#### publish phase

| 동작 | local | ci |
|------|-------|----|
| Publish to registries | ✅ (interactive auth) | ✅ (token auth, from latest tag) |
| Post-publish hooks | ✅ | ✅ |
| Release draft | ✅ | ✅ (with asset pipeline) |

`--mode local --publish`는 현재 `package.json`의 버전과 HEAD의 tag를 기반으로 publish 대상을 결정한다 (기존 `--publish-only` 동작과 동일).

#### dry-run modifier

version bump task 내부의 세부 동작:

| 단계 | 정상 실행 | dry-run |
|------|----------|---------|
| manifest에 버전 쓰기 | ✅ | ✅ |
| changeset 소비 | ✅ | ✅ |
| changelog 생성 | ✅ | ✅ |
| git add + commit | ✅ | **skip** |
| git tag | ✅ | **skip** |
| manifest 원본 복원 | ❌ | ✅ (자동 rollback) |

전체 파이프라인 수준:

| 동작 | dry-run 적용 시 |
|------|----------------|
| Prerequisites/conditions check | 실행 |
| Test & Build | 실행 |
| Version bump | 실행 후 rollback (위 표 참조) |
| Git push | **skip** |
| Publish | registry `--dry-run` 플래그로 대체 |
| Dry-run publish (ci prepare) | 실행 (검증 목적) |
| Release draft | **skip** |
| Token collection (ci mode) | 실행 (검증 목적) |

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

export interface Options {
  mode?: ReleaseMode;
  prepare?: boolean;
  publish?: boolean;
  dryRun?: boolean;
  // ...
}
```

`prepare`와 `publish`를 독립 boolean으로 모델링하여 Commander의 플래그 처리와 자연스럽게 매핑한다.

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
skip: () => !phases.includes("prepare")              // prepare phase tasks
skip: () => !phases.includes("publish") || dryRun    // real publish (dry-run시 registry dry-run task로 대체)
skip: () => dryRun                                   // git push, release draft 등 side-effects
skip: () => mode !== "ci" || !phases.includes("prepare") // ci prepare 전용 (dry-run publish validation)
```

### Phase Resolution Logic

```typescript
function resolvePhases(options: Options): ReleasePhase[] {
  const mode = options.mode ?? "local";

  if (options.prepare && options.publish) {
    throw new Error("Cannot specify both --prepare and --publish. Omit both to run the full pipeline.");
  }

  if (mode === "ci" && !options.prepare && !options.publish) {
    throw new Error("CI mode requires --prepare or --publish. Example: pubm --mode ci --prepare");
  }

  if (options.prepare) return ["prepare"];
  if (options.publish) return ["publish"];

  // local mode without explicit phase → both
  return ["prepare", "publish"];
}
```

### Validation Rules

```typescript
function validateOptions(options: Options): void {
  const mode = options.mode ?? "local";

  // CI mode requires explicit phase
  if (mode === "ci" && !options.prepare && !options.publish) {
    throw new Error("CI mode requires --prepare or --publish. Example: pubm --mode ci --prepare");
  }

  // --prepare and --publish are mutually exclusive
  if (options.prepare && options.publish) {
    throw new Error("Cannot specify both --prepare and --publish. Omit both to run the full pipeline.");
  }

  // snapshot은 CI mode와 함께 사용 불가
  if (options.snapshot && mode === "ci") {
    throw new Error("Cannot use --snapshot with --mode ci.");
  }
}
```

## Affected Files

### Core changes
- `packages/core/src/types/options.ts` — `ReleaseMode` 타입 추가, `prepare`/`publish`/`dryRun` boolean 추가, 기존 플래그 제거
- `packages/core/src/tasks/runner.ts` — 분기 로직 전면 재작성
- `packages/core/src/options.ts` — 옵션 resolve 로직 변경

### CLI changes
- `packages/pubm/src/cli.ts` — Commander 플래그 재정의, validation 추가

### Test changes
- `packages/core/tests/unit/tasks/runner.test.ts` — runner 옵션 테스트 전면 업데이트
- `packages/core/tests/unit/tasks/runner-coverage.test.ts` — runner coverage 테스트 업데이트
- `packages/pubm/tests/unit/cli.test.ts` — CLI 옵션 파싱 테스트 업데이트
- `packages/pubm/tests/unit/utils/binary-runner.test.ts` — binary runner 테스트 업데이트
- `packages/pubm/tests/e2e/ci-mode.test.ts` — CI 모드 e2e 테스트 업데이트
- `packages/pubm/tests/e2e/cross-registry-name.test.ts` — cross-registry e2e 테스트 업데이트
- `packages/pubm/tests/e2e/error-handling.test.ts` — error handling e2e 테스트 업데이트
- `packages/pubm/tests/e2e/help.test.ts` — help 텍스트 테스트 업데이트
- 새로운 mode/phase 조합에 대한 테스트 추가

### Website documentation (English)
- `website/src/content/docs/reference/cli.mdx` — CLI 레퍼런스 재작성 (플래그 테이블, execution modes 섹션)
- `website/src/content/docs/reference/sdk.mdx` — SDK API 문서에서 `preview`/`preflight`/`ci`/`publishOnly` 옵션 업데이트
- `website/src/content/docs/reference/plugins.mdx` — 플러그인 API context 업데이트
- `website/src/content/docs/reference/official-plugins.mdx` — 공식 플러그인 문서 업데이트
- `website/src/content/docs/guides/ci-cd.mdx` — CI/CD 가이드 재작성 (워크플로우 예시 포함)
- `website/src/content/docs/guides/quick-start.mdx` — Quick start에서 preflight 참조 업데이트
- `website/src/content/docs/guides/troubleshooting.mdx` — Troubleshooting에서 preview/preflight 참조 업데이트
- `website/src/content/docs/guides/configuration.mdx` — preview 참조 업데이트
- `website/src/content/docs/guides/coding-agents.mdx` — publish-preview skill 참조 업데이트

### Website documentation (Localized)
- 영어 문서만 수정. 번역본(ko, zh-cn, fr, de, es)은 이번 범위에서 제외

### Plugin changes
- `plugins/pubm-plugin/skills/publish-setup/SKILL.md` — `--ci`, `--publish-only` 참조 업데이트
- `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` — CI 템플릿 예시 전면 재작성
- `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md` — 플러그인 API context 업데이트
- `plugins/pubm-plugin/INSTALLATION.md` — preview/preflight 참조 업데이트
- `plugins/pubm-plugin/PLUGIN_INSTALLATION.md` — preview/preflight 참조 업데이트

### Other
- `README.md` — `--preflight` 참조 업데이트
- `package.json` — scripts에서 `--ci`, `--preflight` 플래그 업데이트
- `.github/workflows/release.yml` — `pubm --ci` → `pubm --mode ci --publish` 변경
