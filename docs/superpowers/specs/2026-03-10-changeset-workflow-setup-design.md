# Changeset Workflow Setup Design

**Date:** 2026-03-10
**Status:** Approved

---

## Overview

pubm의 `init` 커맨드에 `--changesets` 플래그를 추가하여, changeset 워크플로우에 필요한 파일들을 자동 생성한다. publish-setup 스킬은 초반 질문에서 changesets 사용 여부를 묻고, CLI 커맨드를 실행하는 역할만 담당한다.

## 1. publish-setup 스킬 수정

### 질문 통합 (Step 3: Ask setup scope)

기존에 흩어진 "할 건지" 질문들을 생태계 감지 + 설치 확인 후 한번에 묻는다:

```
Step 1: Detect Ecosystem
Step 2: Check pubm installed
Step 3: Ask setup scope           ← 통합 질문
  - Which registries? (npm, jsr, crates, private)
  - Set up CI/CD?
  - Use changesets workflow?
  - Use external version sync?
Step 4~: 응답에 따라 각 설정 실행
```

### Changeset 설정 단계

changesets workflow를 선택한 경우, CI 설정 이후에 실행:

```
Run: pubm init --changesets
→ 결과 확인 및 요약 표시
```

스킬은 질문 → CLI 실행 → 결과 안내만 담당. 실제 파일 생성은 전부 CLI가 처리한다.

## 2. CLI: `pubm init --changesets`

기존 `pubm init` 커맨드에 `--changesets` 플래그를 추가한다. `--changesets`는 additive — 기본 init(디렉토리 + config 생성)을 실행한 뒤, 추가로 changeset 관련 파일을 생성한다.

### 2.1 `.pubm/changesets/` 디렉토리

이미 기존 `init`에서 생성하고 있음. `--changesets` 없이도 생성되므로 변경 불필요.

### 2.2 `.gitignore` 처리

changeset 파일은 git에 커밋되어야 하므로, `.pubm/` 전체를 ignore하면 안 된다. `.gitignore`에 다음과 같이 설정:

```
.pubm/*
!.pubm/changesets/
```

이렇게 하면 `.pubm/` 내 암호화된 토큰 등은 무시하면서, changesets 디렉토리만 추적된다. 기존에 `.pubm/`으로 gitignore되어 있으면 위 패턴으로 교체한다.

### 2.3 `.github/workflows/changeset-check.yml`

PR에서 changeset 파일 포함 여부를 감지하는 GitHub Actions 워크플로우. 기본 브랜치명은 생성 시점에 `git symbolic-ref refs/remotes/origin/HEAD` 또는 fallback으로 `main`을 사용하여 동적으로 결정한다.

```yaml
name: Changeset Check

on:
  pull_request:
    branches: [main]  # 생성 시 감지된 기본 브랜치로 치환
    types: [opened, synchronize, reopened, labeled, unlabeled]

permissions:
  contents: read
  pull-requests: write

jobs:
  changeset-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Check for changesets
        id: check
        run: |
          BASE_REF="${{ github.event.pull_request.base.ref }}"
          if [[ "${{ contains(github.event.pull_request.labels.*.name, 'no-changeset') }}" == "true" ]]; then
            echo "skipped=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          CHANGESETS=$(git diff --name-only "origin/${BASE_REF}...HEAD" -- '.pubm/changesets/*.md')
          if [ -z "$CHANGESETS" ]; then
            echo "found=false" >> "$GITHUB_OUTPUT"
          else
            echo "found=true" >> "$GITHUB_OUTPUT"
            echo "$CHANGESETS" > /tmp/changesets.txt
          fi

      - name: Update PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const marker = '<!-- changeset-check -->';
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c => c.body.includes(marker));

            let body;
            const skipped = '${{ steps.check.outputs.skipped }}' === 'true';
            const found = '${{ steps.check.outputs.found }}' === 'true';

            if (skipped) {
              body = `${marker}\n### ⚠️ Changeset check skipped\n\n\`no-changeset\` label detected. This PR will not require a changeset.`;
            } else if (found) {
              const fs = require('fs');
              const files = fs.readFileSync('/tmp/changesets.txt', 'utf8').trim();
              body = `${marker}\n### ✅ Changeset detected\n\n\`\`\`\n${files}\n\`\`\``;
            } else {
              body = `${marker}\n### ❌ No changeset found\n\nThis PR requires a changeset. Run \`pubm changesets add\` and commit the generated file.\n\nIf this change doesn't need a changeset (docs, CI config, etc.), add the \`no-changeset\` label.`;
            }

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }

      - name: Fail if no changeset
        if: steps.check.outputs.skipped != 'true' && steps.check.outputs.found != 'true'
        run: exit 1
```

**동작:**

| 상태 | PR 코멘트 | Check 결과 |
|---|---|---|
| changeset 있음 | ✅ Changeset detected + 파일 목록 | pass |
| changeset 없음 | ❌ No changeset found + 안내 메시지 | fail |
| `no-changeset` label | ⚠️ Changeset check skipped | pass |

**설계 포인트:**
- `github.event.pull_request.base.ref`를 사용하여 기본 브랜치를 동적으로 참조 (main/master 등 하드코딩 방지)
- `<!-- changeset-check -->` HTML 마커로 코멘트를 매번 업데이트 (스팸 방지)
- `no-changeset` label로 docs-only 등 changeset 불필요한 PR 스킵
- 외부 action 최소 의존 (actions/checkout, actions/github-script만 사용)

### 2.4 CLAUDE.md에 Changesets Workflow 섹션 추가

기존 CLAUDE.md가 있으면 끝에 추가, 없으면 새로 생성. `## Changesets Workflow` 헤더가 이미 존재하면 스킵 (멱등성 보장):

```markdown
## Changesets Workflow

This project uses pubm changesets to track changes and automate versioning.

### Rules
- Every PR that changes runtime code must include a changeset file
- Add a changeset: `pubm changesets add`
- PRs with `no-changeset` label skip the changeset check (use for docs, CI config, etc.)

### Workflow
1. Make changes on a feature branch
2. Run `pubm changesets add` — select packages, bump type, and summary
3. Commit the generated `.pubm/changesets/<id>.md` file with your PR
4. On merge, changesets accumulate on main
5. When releasing, `pubm` consumes pending changesets to determine versions and generate CHANGELOG

### Bump Type Guide
- **patch**: Bug fixes, internal refactors with no API changes
- **minor**: New features, backward-compatible additions
- **major**: Breaking changes, removed/renamed public APIs

### Review Checklist
- [ ] Changeset file included (or `no-changeset` label applied)
- [ ] Bump type matches the scope of changes
- [ ] Summary is clear and user-facing
```

## 3. 변경 범위

| 파일 | 변경 |
|---|---|
| `src/commands/init.ts` | `--changesets` 플래그 추가, workflow + CLAUDE.md + gitignore 생성 로직 |
| `plugins/pubm-plugin/skills/publish-setup/SKILL.md` | Step 3 질문 통합 + changeset 단계 추가 |
| `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` | changeset-check 워크플로우 설명 추가 |
| `tests/unit/commands/init.test.ts` (신규) | `--changesets` 플래그 파싱, 파일 생성/스킵/멱등성 테스트 |

## 4. CLI 동작 상세

```
$ pubm init --changesets

✅ Created .pubm/changesets/
✅ Updated .gitignore (changeset files tracked)
✅ Created .github/workflows/changeset-check.yml
✅ Updated CLAUDE.md with changesets workflow guide

Changeset workflow is ready!
- Add changesets: pubm changesets add
- PRs without changesets will fail the changeset-check CI
- Use 'no-changeset' label to skip for non-code changes
```

**멱등성:** 이미 파일이 존재하면 스킵하고, 부분적으로만 설정된 경우 누락분만 생성한다. CLAUDE.md는 `## Changesets Workflow` 헤더 존재 여부로 판단한다.
