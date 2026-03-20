# Onboarding: Interactive Init & Setup-Skills Design

## Context

pubm의 현재 `init` 커맨드는 최소한의 scaffolding만 수행한다 (`pubm.config.ts` + `.pubm/changesets/` 생성, `--changesets` 옵션으로 CI 워크플로우 추가). 사용자 온보딩 경험을 개선하기 위해 인터랙티브 init으로 고도화하고, coding agent skills 설치를 위한 `setup-skills` 커맨드를 추가한다.

## Scope

1. **`pubm init` 리팩토링** — 인터랙티브 프롬프트 기반으로 전면 재작성. `--changesets` 옵션 제거.
2. **`pubm setup-skills` 신규 커맨드** — GitHub에서 coding agent skills를 다운로드하여 각 agent의 네이티브 디렉토리에 설치.
3. **`init` → `setup-skills` 연결** — init 마지막 단계에서 skills 설치 여부를 묻고, yes면 setup-skills 흐름으로 진입.

## Constraints

- 지원 에코시스템: JS (npm/jsr) 및 Rust (crates.io). 패키지 감지 시 `package.json` workspaces, `pnpm-workspace.yaml`, `Cargo.toml` workspace 모두 고려.
- Non-TTY 환경 (CI, piped input)에서 `pubm init` 실행 시 에러와 함께 종료: `"pubm init requires an interactive terminal. Use pubm.config.ts for non-interactive configuration."`
- 기존 `pubm.config.ts`가 있는 프로젝트에서 `pubm init` 재실행 시 경고 + confirm: `"pubm.config.ts already exists. Overwrite?"`. No 선택 시 config 생성만 skip하고 나머지 (changesets, CI, skills) 단계는 계속 진행.
- 기존 `.pubm/changesets/`, `.github/workflows/*.yml` 파일이 이미 존재하면 skip (덮어쓰지 않음). Summary에서 `(already exists, skipped)` 표시.

## Design

### 1. `pubm init` — 인터랙티브 흐름

기존 `init.ts`를 전면 리팩토링한다. `init-changesets.ts`의 유틸리티 함수들은 `init.ts`에 통합하고, `init-changesets.ts`는 삭제한다.

#### 흐름

```
$ pubm init

── Package Detection ──────────────────────────
◆ Detected monorepo (bun workspaces)

? Select packages to publish (all pre-selected)
  ◉ packages/core          (@pubm/core)
  ◉ packages/pubm          (pubm)
  ◉ packages/plugins/plugin-brew
  ◯ packages/pubm/platforms/*

── Basic Configuration ────────────────────────
? Release branch
  ● main (detected from git)
  ○ Other...

? Versioning strategy
  ● independent — Each package versioned separately
  ○ fixed       — All packages share one version

── Release Options ────────────────────────────
? Generate changelog?  Yes
? Changelog format
  ● github — Includes PR/commit links
  ○ default

? Create GitHub Release draft?  Yes

── Workflow Setup ──────────────────────────────
? Enable changesets?  Yes
  → .pubm/changesets/ created
  → .gitignore updated

? Set up CI workflow?  Yes
  → .github/workflows/changeset-check.yml created
  → .github/workflows/release.yml created

── Coding Agent Skills ────────────────────────
? Install coding agent skills?  Yes

? Select coding agents
  ◉ Claude Code
  ◯ Codex CLI
  ◯ Gemini CLI

Downloading skills from GitHub...
  → .claude/skills/pubm/ (2 skills installed)

── Summary ────────────────────────────────────
  Config:     pubm.config.ts (created)
  CI:         2 workflows created
  Changesets: enabled
  Skills:     Claude Code (2 skills)

✓ Ready to publish! Run `pubm` to get started.
```

#### 패키지 감지 규칙

- **모노레포**: `package.json`의 `workspaces` 필드, `pnpm-workspace.yaml`, 또는 `Cargo.toml`의 `[workspace]` 섹션에서 워크스페이스 감지. 감지된 패키지 목록을 모두 pre-selected 상태로 multi-select 표시. 사용자가 선택 해제 가능.
- **싱글 패키지**: `"Is 'my-package' the package to publish?"` confirm만 표시.
- **버저닝 전략**: 모노레포일 때만 표시. 싱글 패키지면 skip.

#### Config 생성 판단

사용자가 선택한 모든 값을 default와 비교하여, 모든 값이 default와 동일하면 `pubm.config.ts`를 생성하지 않는다.

비교 대상은 **인터랙티브 프롬프트에서 설정 가능한 필드만**이다. 프롬프트에서 다루지 않는 필드 (access, saveToken, rollbackStrategy, tag 등)는 비교에서 제외하며, 런타임 default에 위임한다.

```typescript
// 프롬프트에서 설정 가능한 필드만 비교
const DEFAULTS = {
  versioning: "independent",
  branch: "main",           // git에서 감지된 기본 브랜치
  changelog: true,
  changelogFormat: "default",
  releaseDraft: true,
}
```

프롬프트 결과 → config 필드 매핑:
- "Generate changelog? No" → `changelog: false` (default `true`와 다르므로 config에 포함)
- "Generate changelog? Yes" + "Format: github" → `changelogFormat: "github"` (default `"default"`와 다르므로 포함)
- "Generate changelog? Yes" + "Format: default" → 둘 다 default이므로 생략

규칙:
- 하나라도 다른 필드가 있으면 → 차이나는 필드만 포함한 `pubm.config.ts` 생성
- 모노레포에서 packages 지정이 필요하면 → packages 필드는 항상 포함
- 싱글 패키지 + 모든 default → config 파일 미생성, "Using default configuration" 메시지 표시

생성 예시 (모노레포, changelog format만 다른 경우):

```typescript
import { defineConfig } from "@pubm/core";

export default defineConfig({
  packages: [
    { path: "packages/core" },
    { path: "packages/pubm" },
  ],
  changelogFormat: "github",
});
```

#### CI 워크플로우 생성

| Changesets | CI | 생성 파일 |
|-----------|-----|----------|
| Yes | Yes | `changeset-check.yml` + `release.yml` |
| Yes | No  | 없음 (changeset-check도 CI이므로 CI=Yes일 때만 생성) |
| No  | Yes | `release.yml` |
| No  | No  | 없음 |

CI "Yes" 선택 시에만 워크플로우 파일을 생성한다. Changesets "Yes"이면서 CI "Yes"이면 `changeset-check.yml`도 함께 생성.

- `changeset-check.yml`: PR에서 changeset 파일 존재 여부를 검사하는 기존 `generateChangesetCheckWorkflow()` 로직 재사용. `.gitignore` 업데이트도 기존 `updateGitignoreForChangesets()` 로직을 그대로 보존.
- `release.yml`: 패키지 매니저 및 프로젝트 타입에 따라 적절한 CI 워크플로우 생성. 기존 `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`의 템플릿을 기반으로 한다.

**release.yml 생성 로직:**

트리거 전략은 프로젝트 타입에 따라 자동 결정:
- **싱글 패키지**: tag 기반 (`on: push: tags: ['v*']`)
- **모노레포**: commit 기반 (`on: push: branches: [main]`, `if: startsWith(github.event.head_commit.message, 'Version Packages')`)

패키지 매니저 감지 (lockfile 기반):
- `bun.lock` → bun setup (oven-sh/setup-bun + actions/setup-node)
- `pnpm-lock.yaml` → pnpm setup (pnpm/action-setup + actions/setup-node)
- `yarn.lock` → yarn setup (actions/setup-node with cache: yarn)
- `package-lock.json` / fallback → npm setup (actions/setup-node)
- `Cargo.lock` (JS 없음) → Rust setup (dtolnay/rust-toolchain + brew install pubm)

모노레포의 경우에도 `--phase publish`를 사용한다. 버저닝은 changesets 워크플로우에서 이미 처리되므로, CI에서는 publish만 수행.

생성 예시 (bun + 싱글 패키지):

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build

      - name: Publish and release
        run: bunx pubm --mode ci --phase publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
```

### 2. `pubm setup-skills` — Agent Skills 설치

독립 실행 가능한 커맨드. `init`의 마지막 단계에서도 내부적으로 호출된다.

#### 흐름

```
$ pubm setup-skills

? Select coding agents (multi-select)
  ◉ Claude Code
  ◯ Codex CLI
  ◯ Gemini CLI

Downloading skills from syi0808/pubm...

Installing for Claude Code...
  → .claude/skills/pubm/publish-setup/SKILL.md
  → .claude/skills/pubm/publish-setup/references/ (7 files)
  → .claude/skills/pubm/create-plugin/SKILL.md
  → .claude/skills/pubm/create-plugin/references/ (1 file)

✓ 2 skills installed to .claude/skills/pubm/
```

#### 설치 소스

GitHub REST API로 `syi0808/pubm` 레포의 `plugins/pubm-plugin/skills/` 디렉토리 내용을 다운로드한다. 최신 릴리스 태그를 기준으로 다운로드하여 안정성을 보장한다.

1. `GET /repos/syi0808/pubm/releases/latest` — 최신 릴리스 태그 조회 (예: `v1.2.3`)
2. `GET /repos/syi0808/pubm/git/trees/{tag}?recursive=1` — 해당 태그의 skills 디렉토리 트리 조회
3. 각 파일을 raw content URL로 다운로드 (`https://raw.githubusercontent.com/syi0808/pubm/{tag}/plugins/pubm-plugin/skills/...`)
4. Fallback: 릴리스가 없으면 `main` 브랜치에서 다운로드

#### Agent별 설치 경로

| Agent | 설치 경로 |
|-------|----------|
| Claude Code | `.claude/skills/pubm/` |
| Codex CLI | `.agents/skills/pubm/` |
| Gemini CLI | `.gemini/skills/pubm/` |

#### SKILL.md 변환

Agent Skills 오픈 스탠다드를 Claude Code, Codex CLI, Gemini CLI 모두 지원하므로, SKILL.md 내용은 변환 없이 그대로 복사한다. YAML frontmatter (`name`, `description`) + Markdown body 형식이 공통이다.

#### 에러 처리

- GitHub API 접근 실패 → 에러 메시지 + 수동 설치 안내 URL 표시
- 이미 설치된 skills → 덮어쓰기 (idempotent, 최신 버전으로 업데이트)

### 3. 코드 구조

#### 파일 변경

```
packages/pubm/src/commands/
  init.ts              — 전면 리팩토링 (인터랙티브 init + changesets 로직 통합)
  init-changesets.ts   — 삭제 (init.ts에 통합)
  setup-skills.ts      — 신규 (skills 다운로드/설치 + CLI 커맨드 등록)
```

#### init.ts 내부 구조

각 단계를 독립 함수로 분리하여 테스트 가능하게 한다.

```typescript
// 패키지 감지
async function detectPackages(cwd: string): Promise<PackageDetectionResult>
async function promptPackages(detected: PackageDetectionResult): Promise<string[]>

// 기본 설정
async function promptBranch(cwd: string): Promise<string>
async function promptVersioning(): Promise<"independent" | "fixed">

// 릴리스 옵션
async function promptChangelog(): Promise<{ enabled: boolean; format: string }>
async function promptGithubRelease(): Promise<boolean>

// 워크플로우
async function promptChangesets(): Promise<boolean>
async function promptCI(): Promise<boolean>

// Agent skills (setup-skills 모듈 호출)
async function promptSkills(): Promise<Agent[] | null>

// Config 생성 판단
function shouldCreateConfig(result: InitResult, defaults: PubmConfig): boolean
function buildConfigContent(result: InitResult): string
```

#### setup-skills.ts 내부 구조

```typescript
type Agent = "claude-code" | "codex" | "gemini"

// GitHub에서 skills 파일 트리 조회
async function fetchSkillsTree(repo: string, branch: string): Promise<SkillFile[]>

// 각 agent별 설치 경로 결정
function getInstallPath(agent: Agent, cwd: string): string

// 다운로드 + 설치
async function downloadAndInstall(files: SkillFile[], installPath: string): Promise<void>

// 인터랙티브 흐름 (프롬프트 + 설치)
export async function runSetupSkills(cwd: string): Promise<void>

// CLI 커맨드 등록
export function registerSetupSkillsCommand(parent: Command): void
```

#### 의존성

- **프롬프트**: 기존 Enquirer 사용 (추가 의존성 없음)
- **GitHub API**: 내장 `fetch` 사용 (추가 의존성 없음)
- **파일 시스템**: `node:fs/promises` 또는 Bun fs API

#### CLI 등록 변경 (cli.ts)

```typescript
// 기존
registerInitCommand(program);

// 변경
registerInitCommand(program);
registerSetupSkillsCommand(program);
```
