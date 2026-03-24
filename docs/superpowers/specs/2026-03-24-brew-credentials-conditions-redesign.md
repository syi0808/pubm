# Brew Plugin Credentials/Checks Conditions Redesign

## Problem

`brew-tap`과 `brew-core`의 `credentials`/`checks` 반환 조건이 실행 환경에 맞지 않음:

1. **brew-tap**: `!options.repo`이면 credentials가 빈 배열 → ci-prepare에서 토큰 프롬프트가 나오지 않음 (단, `options.repo`가 설정된 경우에도 local 모드에서 불필요한 PAT를 요구)
2. **brew-core**: local 모드에서도 항상 PAT를 요구하지만, `gh` CLI 인증으로 충분
3. 두 플러그인 모두 local 모드에서 git/gh 인증 상태를 사전 검증하지 않아, `afterRelease`에서 인증 실패 시 rollback이 트리거됨

## Key Insight

두 플러그인의 `afterRelease`는 이미 토큰 유무에 따라 분기함:
- 토큰 있음 → `x-access-token` embed URL로 clone, `GH_TOKEN` 환경변수로 gh CLI 실행
- 토큰 없음 → 일반 URL로 clone (기존 git auth 사용), gh CLI 기본 인증 사용

따라서 PAT는 **CI에서만** 필요하고, local에서는 기존 git/gh 인증 상태 검증만 하면 된다.

## Scope

- `brew-tap` credentials/checks 조건 수정
- `brew-core` credentials/checks 조건 수정
- local 모드용 git/gh 인증 상태 체크 추가

## Design

### Credentials 조건

PAT는 CI 모드에서만 반환한다. local에서는 기존 git/gh 인증을 사용하므로 PAT 불필요.

#### brew-tap

```typescript
credentials: (ctx) => {
  // PAT is only needed in CI where interactive git/gh auth is unavailable
  if (!options.repo || ctx.options.mode !== "ci") return [];
  return [
    {
      key: "brew-github-token",
      env: "PUBM_BREW_GITHUB_TOKEN",
      label: "GitHub PAT for Homebrew tap",
      tokenUrl: "https://github.com/settings/tokens/new?scopes=repo",
      tokenUrlLabel: "github.com",
      ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
      required: true,
    },
  ];
},
```

| 시나리오 | 현재 | 변경 후 |
|----------|------|---------|
| `repo` + ci (prepare/publish) | PAT 반환 | PAT 반환 (유지) |
| `repo` + local (전체/publish) | PAT 반환 | 빈 배열 |
| `repo` + local (prepare only) | 빈 배열 | 빈 배열 (유지) |
| `!repo` + any | 빈 배열 | 빈 배열 (유지) |

#### brew-core

```typescript
credentials: (ctx) => {
  // PAT is only needed in CI where interactive gh auth is unavailable
  if (ctx.options.mode !== "ci") return [];
  return [
    {
      key: "brew-github-token",
      env: "PUBM_BREW_GITHUB_TOKEN",
      label: "GitHub PAT for Homebrew (homebrew-core)",
      tokenUrl: "https://github.com/settings/tokens/new?scopes=repo,workflow",
      tokenUrlLabel: "github.com",
      ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
      required: true,
    },
  ];
},
```

### Checks 조건

CI와 local에서 서로 다른 검증을 수행한다.

#### brew-tap

```typescript
checks: (ctx) => {
  const phases = resolvePhases(ctx.options);
  if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];

  // CI: verify PAT exists
  if (ctx.options.mode === "ci") {
    if (!options.repo) return [];
    return [{
      title: "Checking Homebrew tap token availability",
      phase: "conditions",
      task: async (ctx, task) => {
        const token = ctx.runtime.pluginTokens?.["brew-github-token"];
        if (!token) {
          throw new Error("PUBM_BREW_GITHUB_TOKEN is required for Homebrew tap publishing.");
        }
        task.output = "Homebrew tap token verified";
      },
    }];
  }

  // Local, !repo: no checks needed — afterRelease uses `git push` (existing git auth)
  // and `gh pr create` is only a fallback. Users without gh CLI can still succeed.
  if (!options.repo) return [];

  // Local, repo: verify gh auth + repo access
  const targetRepo = options.repo;
  return [{
    title: "Checking git/gh access for Homebrew tap",
    phase: "conditions",
    task: async (_ctx, task) => {
      const { execFileSync } = await import("node:child_process");

      // Check gh auth status
      try {
        execFileSync("gh", ["auth", "status"], { stdio: "pipe" });
        task.output = "GitHub CLI authenticated";
      } catch {
        throw new Error(
          "GitHub CLI is not authenticated. Run `gh auth login` first."
        );
      }

      // Verify access to the tap repo
      const repoName = /^[^/]+\/[^/]+$/.test(targetRepo)
        ? targetRepo
        : targetRepo.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
      if (repoName) {
        try {
          execFileSync("gh", ["repo", "view", repoName, "--json", "name"], { stdio: "pipe" });
          task.output = `Access to ${repoName} verified`;
        } catch {
          throw new Error(
            `Cannot access tap repository '${targetRepo}'. Check your GitHub permissions.`
          );
        }
      }
    },
  }];
},
```

#### brew-core

```typescript
checks: (ctx) => {
  const phases = resolvePhases(ctx.options);
  if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];

  // CI: verify PAT exists
  if (ctx.options.mode === "ci") {
    return [{
      title: "Checking Homebrew core token availability",
      phase: "conditions",
      task: async (ctx, task) => {
        const token = ctx.runtime.pluginTokens?.["brew-github-token"];
        if (!token) {
          throw new Error("PUBM_BREW_GITHUB_TOKEN is required for homebrew-core publishing.");
        }
        task.output = "Homebrew core token verified";
      },
    }];
  }

  // Local: verify gh auth + homebrew-core access (needed for fork + PR)
  return [{
    title: "Checking GitHub CLI access for homebrew-core",
    phase: "conditions",
    task: async (_ctx, task) => {
      const { execFileSync } = await import("node:child_process");

      try {
        execFileSync("gh", ["auth", "status"], { stdio: "pipe" });
        task.output = "GitHub CLI authenticated";
      } catch {
        throw new Error(
          "GitHub CLI is not authenticated. Run `gh auth login` first."
        );
      }

      try {
        execFileSync("gh", ["repo", "view", "homebrew/homebrew-core", "--json", "name"], { stdio: "pipe" });
        task.output = "Access to homebrew/homebrew-core verified";
      } catch {
        throw new Error(
          "Cannot access homebrew/homebrew-core. Check your GitHub permissions."
        );
      }
    },
  }];
},
```

### afterRelease 변경

변경 없음. 두 플러그인 모두 이미 토큰 유무에 따라 분기하는 구조.

## Decision Matrix

| 환경 | credentials | checks |
|------|------------|--------|
| brew-tap, `repo`, CI | PAT 수집 | PAT 존재 검증 |
| brew-tap, `repo`, local | - | gh auth + repo 접근 검증 |
| brew-tap, `!repo`, CI | - | - (CI 기본 git 인증에 의존) |
| brew-tap, `!repo`, local | - | - (git push만 사용, gh는 fallback이므로 사전 검증 불필요) |
| brew-core, CI | PAT 수집 | PAT 존재 검증 |
| brew-core, local | - | gh auth 검증 + homebrew-core 접근 검증 |

## Files to Modify

1. `packages/plugins/plugin-brew/src/brew-tap.ts` — credentials/checks 조건 변경
2. `packages/plugins/plugin-brew/src/brew-core.ts` — credentials/checks 조건 변경
3. `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts` — 테스트 업데이트
4. `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts` — 테스트 업데이트
