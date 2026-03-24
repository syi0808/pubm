# Plugin Credentials & Checks Interface Design

## Problem

CI release workflow에서 npm/jsr 퍼블리시는 성공했지만, `@pubm/plugin-brew`의 `afterRelease` 훅에서 외부 tap 레포(syi0808/homebrew-pubm)에 formula를 push하다 403 에러가 발생하여 rollback이 트리거됨.

근본 원인:
- GitHub Actions 기본 `GITHUB_TOKEN`은 현재 레포에만 write 권한이 있고, 외부 레포에는 접근 불가
- 플러그인이 자체 credential을 선언하고 core의 토큰 수집 파이프라인에 통합할 방법이 없음
- 플러그인이 prerequisite/condition check 단계에 커스텀 체크를 추가할 방법이 없음

## Scope

1. **Plugin credential interface** — 플러그인이 `credentials`를 선언적으로 등록하고, core의 `collectTokens` 흐름에 통합
2. **Plugin check interface** — 플러그인이 prerequisite/condition check 단계에 체크 task를 추가
3. **Brew plugin PAT 주입** — brew-tap/brew-core에서 수집된 PAT를 git push/gh pr create에 활용
4. **문서 업데이트** — 플러그인 인터페이스 및 brew 플러그인 관련 문서 반영

Graceful failure(afterRelease 실패 시 throw 대신 경고)는 이번 스코프에서 제외.

## Design

### 1. Plugin Interface Extension

`PubmPlugin`에 `credentials`와 `checks` 필드를 추가한다.

#### Types

```typescript
// packages/core/src/plugin/types.ts

interface PluginTaskContext {
  /** 현재 task에 상태 메시지 표시 */
  output: string;
  /** task 제목 수정 */
  title: string;
  /** enquirer prompt 실행 — task.prompt(ListrEnquirerPromptAdapter)를 래핑 */
  prompt<T = unknown>(options: { type: string; message: string; [key: string]: unknown }): Promise<T>;
}

interface PluginCredential {
  /** SecureStore 저장 키 (e.g. "brew-github-token") */
  key: string;
  /** 환경변수명 (e.g. "PUBM_BREW_GITHUB_TOKEN") */
  env: string;
  /** 프롬프트 표시 라벨 (e.g. "GitHub PAT for Homebrew tap") */
  label: string;
  /** 토큰 발급 안내 URL */
  tokenUrl?: string;
  /** URL 표시 텍스트 */
  tokenUrlLabel?: string;
  /** GitHub Secrets sync 시 사용할 키명 */
  ghSecretName?: string;
  /** false면 수집 실패해도 skip (default: true) */
  required?: boolean;
  /** env 확인 후, keyring 확인 전에 시도할 커스텀 resolver */
  resolve?: () => Promise<string | null>;
  /** 토큰 유효성 검증 */
  validate?: (token: string, task: PluginTaskContext) => Promise<boolean>;
}

interface PluginCheck {
  /** 체크 표시 제목 */
  title: string;
  /** 어느 단계에 삽입할지 */
  phase: "prerequisites" | "conditions";
  /** 체크 로직 */
  task: (ctx: PubmContext, task: PluginTaskContext) => Promise<void>;
}

interface PubmPlugin {
  name: string;
  registries?: PackageRegistry[];
  ecosystems?: Ecosystem[];
  hooks?: PluginHooks;
  commands?: PluginCommand[];
  /** 플러그인이 필요로 하는 credential 선언 */
  credentials?: (ctx: PubmContext) => PluginCredential[];
  /** 플러그인이 추가할 preflight 체크 */
  checks?: (ctx: PubmContext) => PluginCheck[];
}
```

### 2. Core Token Collection Integration

#### 새 함수: `collectPluginCredentials`

`packages/core/src/tasks/preflight.ts`에 추가한다. 기존 `collectTokens`의 prompt/validate/save 패턴을 재사용한다.

```
collectPluginCredentials(plugins, ctx, task) → Record<string, string>
  credentials = pluginRunner.collectCredentials(ctx)
  credentials를 key 기준으로 중복 제거 (first-wins)
  for each credential:
    1. process.env[credential.env] 확인
    2. credential.resolve?.() 호출 (있으면 — keyring보다 우선)
    3. SecureStore.get(credential.key) 확인
    4. 위에서 다 null이고 promptEnabled → prompt 루프 (기존 패턴)
    5. credential.validate?.() 통과 → SecureStore.set()
    6. required=true인데 토큰 없음 → throw
    7. required=false인데 토큰 없음 → skip
```

**중복 제거**: 여러 플러그인이 같은 `key`를 선언할 수 있다 (예: brew-tap과 brew-core가 모두 `"brew-github-token"` 사용). `collectCredentials()`에서 `key` 기준 first-wins로 중복을 제거한다. 토큰은 한 번만 수집되고 `pluginTokens`에 저장되므로 양쪽 플러그인 모두 접근 가능.

**Resolution 순서**: env → resolve() → keyring → prompt. 커스텀 resolver는 keyring보다 우선한다. 플러그인이 외부 소스(예: gh cli auth)에서 토큰을 가져오는 경우, 이전에 저장된 값보다 우선해야 하기 때문이다.

**`credentials(ctx)` 호출 시점의 ctx 상태**: preflight 단계에서 호출되므로 `ctx.options` (CLI 옵션: mode, phase 등)와 `ctx.config`는 사용 가능하지만, `ctx.runtime.versionPlan`은 아직 없다. 플러그인은 `ctx.options.mode`, `ctx.options.phase` 등으로 토큰 필요 여부를 판단한다.

#### `ctx.runtime.pluginTokens`에 저장

```typescript
// packages/core/src/context.ts
runtime: {
  // 기존 필드들...
  pluginTokens?: Record<string, string>;  // credential key → token
}
```

수집된 플러그인 토큰은 `ctx.runtime.pluginTokens`에 저장되어, 이후 hook(`afterRelease` 등)에서 접근 가능하다.

#### `runner.ts` 통합 지점

| Flow | 현재 | 변경 |
|------|------|------|
| CI prepare | `collectTokens` → `promptGhSecretsSync` | + `collectPluginCredentials` → `pluginTokens` 저장 → sync 대상에 `ghSecretName` 있는 것 포함 |
| 로컬 | JSR만 `collectTokens` | + `collectPluginCredentials` |
| CI publish | env에서 자동 로드 | + `collectPluginCredentials` 호출 (promptEnabled=false → env/resolve/keyring만 시도, prompt 없음). required인데 없으면 에러 |

**CI publish flow 상세**: CI publish에서는 `promptEnabled`가 false이므로 `collectPluginCredentials`는 prompt를 건너뛴다. env → resolve() → keyring 순서로만 시도하고, required credential이 없으면 에러를 throw한다. 이는 기존 registry token이 CI에서 env 자동 로드되는 패턴과 동일하다.

#### `syncGhSecrets` / `injectTokensToEnv` 통합

기존 `syncGhSecrets`는 `registryCatalog`에서 `ghSecretName`을 조회하므로 플러그인 토큰과 호환되지 않는다. 이를 해결하기 위해:

- `syncGhSecrets`를 일반화하여 `{ secretName: string; token: string }[]` 배열을 받도록 리팩터링한다.
- 호출 시 registry tokens(`registryCatalog`에서 secretName 조회)과 plugin tokens(`PluginCredential.ghSecretName`에서 직접 획득)를 합쳐서 전달한다.

`injectTokensToEnv`도 동일하게 리팩터링:
- 플러그인 토큰은 `PluginCredential.env`를 키로 `process.env`에 주입한다.
- 기존 registry token 주입과 별도의 `injectPluginTokensToEnv(pluginTokens, credentials)` 함수를 추가하거나, 기존 함수를 일반화한다.

#### PluginRunner 메서드 추가

```typescript
// packages/core/src/plugin/runner.ts
collectCredentials(ctx: PubmContext): PluginCredential[] {
  const all = this.plugins.flatMap(p => p.credentials?.(ctx) ?? []);
  // key 기준 중복 제거 (first-wins)
  const seen = new Set<string>();
  return all.filter(c => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });
}

collectChecks(ctx: PubmContext, phase: "prerequisites" | "conditions"): PluginCheck[] {
  return this.plugins.flatMap(p => p.checks?.(ctx) ?? []).filter(c => c.phase === phase);
}
```

### 3. Prerequisite/Condition Check Extension

기존 `prerequisitesCheckTask`와 `requiredConditionsCheckTask`의 task 리스트 끝에 플러그인 checks를 append한다.

```
prerequisitesCheckTask:
  1. branch 확인 (기존)
  2. remote history (기존)
  3. working tree (기존)
  4. commits since last tag (기존)
  5. ...pluginRunner.collectChecks(ctx, "prerequisites")  ← 추가

requiredConditionsCheckTask:
  1. ping registries (기존)
  2. test/build scripts (기존)
  3. git version (기존)
  4. registry availability (기존)
  5. ...pluginRunner.collectChecks(ctx, "conditions")  ← 추가
```

`ctx.runtime.pluginRunner`를 통해 접근하므로 함수 시그니처 변경 불필요.

플러그인의 `PluginCheck.task`에 전달되는 listr2 TaskWrapper는 `PluginTaskContext`로 래핑한다:

```typescript
// core 내부 — listr2 task를 PluginTaskContext로 변환
function wrapTaskContext(listrTask: ListrTaskWrapper): PluginTaskContext {
  return {
    get output() { return listrTask.output as string; },
    set output(v: string) { listrTask.output = v; },
    get title() { return listrTask.title; },
    set title(v: string) { listrTask.title = v; },
    prompt: (options) => listrTask.prompt(ListrEnquirerPromptAdapter).run(options),
  };
}
```

이 래퍼를 통해 플러그인은 listr2에 직접 의존하지 않는다.

### 4. Brew Plugin PAT Usage

수집된 PAT(`ctx.runtime.pluginTokens["brew-github-token"]`)를 기존 git/gh 플로우에 주입한다.

#### brew-tap (외부 tap 레포, `options.repo`)

- `git clone` URL에 PAT 삽입 (기존 `resolveGitHubToken()` 대신 `pluginTokens` 사용)
- `git push` 실패 시 branch push에도 동일 PAT 적용 (이미 clone URL에 포함)
- `gh pr create` 실행 시 `{ env: { ...process.env, GH_TOKEN: token } }` 전달

#### brew-tap (같은 레포, `!options.repo`)

- 변경 없음. 기존 GitHub token으로 충분.

#### brew-core

- `git clone` URL에 PAT 삽입 (현재 토큰 없이 clone하는 버그 수정)
- `gh repo fork`, `gh api user`, `gh pr create` 실행 시 `GH_TOKEN` 환경변수로 PAT 전달

#### Credential 선언

```typescript
// brew-tap
credentials: (ctx) => {
  if (!options.repo) return [];  // 같은 레포면 불필요
  const phases = resolvePhases(ctx.options);
  if (!phases.publish && ctx.options.mode !== "ci") return [];
  return [{
    key: "brew-github-token",
    env: "PUBM_BREW_GITHUB_TOKEN",
    label: "GitHub PAT for Homebrew tap",
    tokenUrl: "https://github.com/settings/tokens/new?scopes=repo",
    tokenUrlLabel: "github.com",
    ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
    required: true,
  }];
}

// brew-core — 동일한 key를 사용. 둘 다 등록되면 collectCredentials()에서 first-wins로 중복 제거됨.
credentials: (ctx) => {
  const phases = resolvePhases(ctx.options);
  if (!phases.publish && ctx.options.mode !== "ci") return [];
  return [{
    key: "brew-github-token",
    env: "PUBM_BREW_GITHUB_TOKEN",
    label: "GitHub PAT for Homebrew (homebrew-core)",
    tokenUrl: "https://github.com/settings/tokens/new?scopes=repo,workflow",
    tokenUrlLabel: "github.com",
    ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
    required: true,
  }];
}
```

> brew-tap과 brew-core가 동일한 `key: "brew-github-token"`을 사용한다. 두 플러그인이 동시에 등록되면 `collectCredentials()`의 first-wins 중복 제거에 의해 한 번만 수집된다. 토큰은 `ctx.runtime.pluginTokens["brew-github-token"]`에 저장되므로 양쪽 모두 접근 가능.

#### Check 선언

```typescript
// brew-tap (외부 레포)
checks: (ctx) => {
  if (!options.repo) return [];
  return [{
    title: "Checking Homebrew tap token availability",
    phase: "conditions",
    task: async (ctx, task) => {
      const token = ctx.runtime.pluginTokens?.["brew-github-token"];
      if (!token) {
        throw new Error("PUBM_BREW_GITHUB_TOKEN is required for Homebrew tap publishing");
      }
      task.output = "Homebrew tap token verified";
    },
  }];
}
```

### 5. Documentation Updates

#### Plugin interface 관련

| 파일 | 변경 내용 |
|------|----------|
| `website/src/content/docs/reference/plugins.mdx` (+ 6 locales) | `credentials`, `checks`, `PluginCredential`, `PluginCheck`, `PluginTaskContext` 타입 문서화 |
| `website/src/content/docs/reference/sdk.mdx` (+ 6 locales) | `PubmPlugin` 타입 변경 반영 |
| `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md` | 플러그인 API 레퍼런스에 새 필드 추가 |

#### Brew plugin 관련

| 파일 | 변경 내용 |
|------|----------|
| `website/src/content/docs/reference/official-plugins.mdx` (+ 6 locales) | brew 플러그인 PAT 설정 안내, `PUBM_BREW_GITHUB_TOKEN` 환경변수, GitHub Secrets sync 설명 |
| `website/src/content/docs/guides/ci-cd.mdx` (+ 6 locales) | CI에서 brew 플러그인 사용 시 PAT 설정 방법 |
| `README.md` | 플러그인 설정 예시에 credentials 반영 (해당되면) |

번역: `en`이 source of truth. `fr`, `es`, `de`, `zh-cn`, `ko` 6개 locale 동일 반영.

## Files to Change

### Core (packages/core)

| File | Action |
|------|--------|
| `src/plugin/types.ts` | `PluginTaskContext`, `PluginCredential`, `PluginCheck` 타입 추가, `PubmPlugin`에 `credentials`, `checks` 필드 추가 |
| `src/plugin/runner.ts` | `collectCredentials()`, `collectChecks()` 메서드 추가 |
| `src/context.ts` | `runtime.pluginTokens` 필드 추가 |
| `src/tasks/preflight.ts` | `collectPluginCredentials()` 함수 추가 |
| `src/tasks/runner.ts` | 3개 flow에 `collectPluginCredentials` 호출 통합, `pluginTokens` 저장, `injectPluginTokensToEnv` 호출 |
| `src/utils/gh-secrets-sync-state.ts` 또는 `src/tasks/preflight.ts` | `syncGhSecrets` 일반화 (registry + plugin tokens 통합) |
| `src/tasks/prerequisites-check.ts` | 플러그인 checks append |
| `src/tasks/required-conditions-check.ts` | 플러그인 checks append |
| `src/index.ts` | 새 타입 export |

### Brew Plugin (packages/plugins/plugin-brew)

| File | Action |
|------|--------|
| `src/brew-tap.ts` | `credentials`, `checks` 추가, `afterRelease`에서 `pluginTokens` 사용, `resolveGitHubToken()` 제거 |
| `src/brew-core.ts` | `credentials`, `checks` 추가, `afterRelease`에서 `pluginTokens` 사용, clone URL에 토큰 삽입, gh 명령에 `GH_TOKEN` 전달 |

### Documentation

| File | Action |
|------|--------|
| `website/src/content/docs/reference/plugins.mdx` (+ 6 locales) | 새 타입 문서화 |
| `website/src/content/docs/reference/sdk.mdx` (+ 6 locales) | PubmPlugin 타입 변경 |
| `website/src/content/docs/reference/official-plugins.mdx` (+ 6 locales) | brew PAT 설정 안내 |
| `website/src/content/docs/guides/ci-cd.mdx` (+ 6 locales) | CI brew PAT 설정 |
| `plugins/pubm-plugin/skills/create-plugin/references/plugin-api.md` | 플러그인 API 레퍼런스 |
| `README.md` | 필요 시 업데이트 |

### Tests

| File | Action |
|------|--------|
| `packages/core/tests/unit/plugin/runner.test.ts` | `collectCredentials()` (중복 제거 포함), `collectChecks()` 테스트 |
| `packages/core/tests/unit/tasks/preflight.test.ts` | `collectPluginCredentials()` 테스트 (env/resolve/keyring/prompt 각 경로, required/optional, CI flow) |
| `packages/core/tests/unit/tasks/prerequisites-check.test.ts` | 플러그인 checks 통합 테스트 |
| `packages/core/tests/unit/tasks/required-conditions-check.test.ts` | 플러그인 checks 통합 테스트 |
| `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts` | credential 선언 테스트, PAT 주입 (clone URL, GH_TOKEN) 테스트 |
| `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts` | credential 선언 테스트, PAT 주입 (clone URL, GH_TOKEN, gh fork) 테스트 |
