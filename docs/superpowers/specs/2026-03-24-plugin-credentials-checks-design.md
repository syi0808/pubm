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
  /** enquirer prompt 실행 */
  prompt: ListrEnquirerPromptAdapter;
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
  /** env/keyring 확인 전에 시도할 커스텀 resolver */
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
  for each plugin.credentials(ctx):
    1. process.env[credential.env] 확인
    2. SecureStore.get(credential.key) 확인
    3. credential.resolve?.() 호출 (있으면)
    4. 위에서 다 null이고 promptEnabled → prompt 루프 (기존 패턴)
    5. credential.validate?.() 통과 → SecureStore.set()
    6. required=true인데 토큰 없음 → throw
    7. required=false인데 토큰 없음 → skip
```

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
| CI publish | env에서 자동 로드 | + 플러그인 credentials의 env도 로드, required인데 없으면 에러 |

`promptGhSecretsSync`는 기존 registry tokens + 플러그인 credentials 중 `ghSecretName`이 지정된 것들을 합산하여 sync한다.

#### PluginRunner 메서드 추가

```typescript
// packages/core/src/plugin/runner.ts
collectCredentials(ctx: PubmContext): PluginCredential[] {
  return this.plugins.flatMap(p => p.credentials?.(ctx) ?? []);
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

플러그인의 `PluginCheck.task`에 전달되는 listr2 TaskWrapper는 `PluginTaskContext`로 래핑하여 플러그인이 listr2에 직접 의존하지 않도록 한다.

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
  const needsToken = /* publish phase이거나 ci mode */;
  if (!needsToken) return [];
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

// brew-core
credentials: (ctx) => {
  const needsToken = /* publish phase이거나 ci mode */;
  if (!needsToken) return [];
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
| `src/tasks/runner.ts` | 3개 flow에 `collectPluginCredentials` 호출 통합, `pluginTokens` 저장 |
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
| `packages/core/tests/unit/plugin/runner.test.ts` | `collectCredentials()`, `collectChecks()` 테스트 |
| `packages/core/tests/unit/tasks/preflight.test.ts` | `collectPluginCredentials()` 테스트 |
| `packages/core/tests/unit/tasks/prerequisites-check.test.ts` | 플러그인 checks 통합 테스트 |
| `packages/core/tests/unit/tasks/required-conditions-check.test.ts` | 플러그인 checks 통합 테스트 |
