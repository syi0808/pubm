# 마케팅 전략 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 오픈소스 프로젝트를 시작하는 개발자가 pubm을 첫 번째 배포 도구로 채택하도록 인지도와 발견 가능성을 높인다.

**Architecture:** Phase 1(기반 구축)은 기술적 변경(패키지 메타데이터, 웹사이트 메시지, 문서)을 포함하며 즉시 실행 가능하다. Phase 2(콘텐츠 런치)와 Phase 3(생태계 확장)은 콘텐츠 제작 및 커뮤니티 참여 행동 항목이다.

**Tech Stack:** Astro (website), TypeScript (i18n copy), Markdown (docs/content)

---

## Phase 1: 기반 구축

### Task 1: npm 패키지 키워드 최적화

**목표:** "npm publish", "jsr", "multiple registry", "monorepo release" 등 검색어에서 pubm이 노출되도록 패키지 메타데이터를 보강한다.

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/pubm/package.json`

- [ ] **Step 1: 현재 keywords 확인**

```bash
cat packages/core/package.json | grep -A20 '"keywords"'
cat packages/pubm/package.json | grep -A20 '"keywords"'
```

- [ ] **Step 2: `packages/core/package.json` keywords 업데이트**

`"keywords"` 필드를 다음으로 교체한다:

```json
"keywords": [
  "publish",
  "npm publish",
  "jsr",
  "registry",
  "multiple registry",
  "multi registry",
  "release",
  "monorepo release",
  "version bump",
  "changeset",
  "cli",
  "release automation"
]
```

- [ ] **Step 3: `packages/pubm/package.json` keywords 업데이트**

동일한 keywords를 적용한다. 단, CLI 특화 항목 추가:

```json
"keywords": [
  "publish",
  "npm publish",
  "jsr",
  "registry",
  "multiple registry",
  "multi registry",
  "release",
  "monorepo release",
  "version bump",
  "changeset",
  "cli",
  "release automation",
  "release cli",
  "open source release"
]
```

- [ ] **Step 4: 커밋**

```bash
git add packages/core/package.json packages/pubm/package.json
git commit -m "chore: optimize npm package keywords for discoverability"
```

---

### Task 2: 웹사이트에 "Why pubm?" 랜딩 섹션 추가

**목표:** 새 오픈소스 프로젝트를 시작하는 개발자를 위한 전용 섹션을 추가하여, 기존 도구 대신 pubm을 처음부터 선택해야 하는 이유를 명확히 전달한다.

**Files:**
- Create: `website/src/components/landing/WhyPubm.astro`
- Modify: `website/src/i18n/landing.ts` (타입 + en/ko copy 추가)
- Modify: `website/src/components/landing/LandingPage.astro` (섹션 삽입)

- [ ] **Step 1: 현재 랜딩 페이지 컴포넌트 순서 확인**

```bash
cat website/src/components/landing/LandingPage.astro
```

- [ ] **Step 2: `LandingDictionary` 타입에 `why` 필드 추가**

`website/src/i18n/landing.ts`의 `LandingDictionary` 인터페이스에 추가:

```typescript
why: {
  badge: string;
  title: string;
  description: string;
  items: Array<{ heading: string; body: string }>;
};
```

- [ ] **Step 3: `en.why` copy 추가**

```typescript
why: {
  badge: "Why pubm?",
  title: "The right foundation for new projects",
  description:
    "Most release tools assume you already know what you need. pubm gives new projects a complete, multi-registry setup from day one.",
  items: [
    {
      heading: "No migration later",
      body: "Start with npm only and add jsr or crates.io when you're ready — no workflow changes required.",
    },
    {
      heading: "Not just for JavaScript",
      body: "Shipping a Rust crate alongside an npm package? pubm handles both ecosystems in one pipeline.",
    },
    {
      heading: "Grows with your monorepo",
      body: "One package today, ten tomorrow. pubm's dependency-aware ordering means you never publish in the wrong order.",
    },
  ],
},
```

- [ ] **Step 4: `ko.why` copy 추가**

```typescript
why: {
  badge: "왜 pubm인가?",
  title: "새 프로젝트를 위한 올바른 기반",
  description:
    "대부분의 릴리즈 도구는 이미 무엇이 필요한지 알고 있다고 가정합니다. pubm은 새 프로젝트에 처음부터 완전한 멀티 레지스트리 셋업을 제공합니다.",
  items: [
    {
      heading: "나중에 마이그레이션 없음",
      body: "지금은 npm만으로 시작하고, 준비되면 jsr이나 crates.io를 추가하세요 — 워크플로우 변경이 없습니다.",
    },
    {
      heading: "JavaScript만을 위한 것이 아님",
      body: "npm 패키지와 함께 Rust crate도 배포하나요? pubm은 두 생태계를 하나의 파이프라인에서 처리합니다.",
    },
    {
      heading: "모노레포와 함께 성장",
      body: "오늘은 패키지 1개, 내일은 10개. pubm의 의존성 순서 정렬로 항상 올바른 순서로 배포됩니다.",
    },
  ],
},
```

- [ ] **Step 5: `website/src/components/landing/WhyPubm.astro` 생성**

```astro
---
import type { LandingDictionary } from "../../i18n/landing";

interface Props {
  copy: LandingDictionary;
}

const { copy } = Astro.props;
const { why } = copy;
---

<section class="why-section">
  <span class="badge">{why.badge}</span>
  <h2>{why.title}</h2>
  <p class="description">{why.description}</p>
  <ul class="why-items">
    {why.items.map((item) => (
      <li>
        <strong>{item.heading}</strong>
        <span>{item.body}</span>
      </li>
    ))}
  </ul>
</section>

<style>
  .why-section {
    max-width: 860px;
    margin: 0 auto;
    padding: 4rem 2rem;
    text-align: center;
  }
  .badge {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 1rem;
    opacity: 0.6;
  }
  h2 { font-size: 2rem; margin-bottom: 1rem; }
  .description { opacity: 0.7; max-width: 600px; margin: 0 auto 2.5rem; }
  .why-items {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.5rem;
    text-align: left;
  }
  .why-items li {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 1.25rem;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
  }
  strong { font-size: 1rem; }
  span { opacity: 0.65; font-size: 0.9rem; line-height: 1.5; }
</style>
```

- [ ] **Step 6: `LandingPage.astro`에 `WhyPubm` 섹션 삽입**

`FeatureCards` 다음에 추가한다:

```astro
import WhyPubm from "./WhyPubm.astro";
```

그리고 `<FeatureCards copy={copy} />` 다음에:

```astro
<WhyPubm copy={copy} />
```

- [ ] **Step 7: `install` 섹션 description도 새 프로젝트 메시지로 업데이트**

`en.install.description`:
```typescript
description:
  "Start fresh or drop into an existing project. pubm wires npm, jsr, and private registries from day one — no migration needed later.",
```

`ko.install.description`:
```typescript
description:
  "새 프로젝트든 기존 프로젝트든 바로 시작하세요. pubm은 처음부터 npm, jsr, private registry를 모두 지원합니다.",
```

- [ ] **Step 8: 웹사이트 빌드 확인**

```bash
bun run build:site
```

Expected: 빌드 에러 없음

- [ ] **Step 9: 커밋**

```bash
git add website/src/components/landing/WhyPubm.astro website/src/i18n/landing.ts website/src/components/landing/LandingPage.astro
git commit -m "feat(website): add 'Why pubm?' landing section targeting new open source projects"
```

---

### Task 3: 웹사이트 features 섹션에 "새 프로젝트" 카드 추가

**목표:** FeatureCards에 "Start right" 관련 항목을 추가해 새 프로젝트 진입 시점의 가치를 명시한다.

**Files:**
- Modify: `website/src/i18n/landing.ts`

- [ ] **Step 1: 현재 `en.features.items` 배열 확인**

```bash
grep -n "features" website/src/i18n/landing.ts | head -5
```

- [ ] **Step 2: `en.features.items` 배열 끝에 항목 추가**

```typescript
{
  title: "Set up once, scale forever",
  description:
    "Start a new project with pubm and never revisit your release setup. Add registries, packages, or ecosystems without changing your workflow.",
},
```

- [ ] **Step 3: `ko.features.items` 동일 항목 추가**

```typescript
{
  title: "한 번 설정, 영구적으로 확장",
  description:
    "pubm으로 새 프로젝트를 시작하면 릴리즈 설정을 다시 손볼 필요가 없습니다. 레지스트리, 패키지, 생태계를 추가해도 워크플로우는 그대로입니다.",
},
```

- [ ] **Step 4: 웹사이트 빌드 확인**

```bash
bun run build:site
```

Expected: 빌드 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add website/src/i18n/landing.ts
git commit -m "feat(website): add 'set up once, scale forever' feature card"
```

---

### Task 4: GitHub README에 "Why pubm?" 섹션 추가

**목표:** GitHub 저장소를 방문하는 개발자가 pubm을 선택해야 하는 이유를 즉시 파악할 수 있도록 README 상단 근처에 간결한 "Why pubm?" 섹션을 추가한다.

**Files:**
- Modify: `README.md` (루트) 또는 pubm CLI 패키지 README

- [ ] **Step 1: 현재 README 위치 및 내용 확인**

```bash
ls README.md packages/pubm/README.md 2>/dev/null
head -60 README.md 2>/dev/null || head -60 packages/pubm/README.md
```

- [ ] **Step 2: 설치 섹션 앞에 "Why pubm?" 섹션 삽입**

기존 설치 가이드 바로 앞에 아래 내용을 추가한다:

```markdown
## Why pubm?

Most release tools assume a single registry. pubm is built for projects that publish to more than one:

- **npm + jsr** — ship to both JavaScript registries in one command
- **Monorepos** — publishes packages in dependency order, no manual sequencing
- **Any ecosystem** — npm, jsr, crates.io, and private registries from the same workflow
- **Start right** — set up once when you create the project, never revisit the release config

If you only ever publish to npm and have one package, `np` or `release-it` will serve you fine.
If you publish to multiple registries, manage a monorepo, or want to grow without changing your setup, pubm is the better foundation.
```

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs: add 'Why pubm?' section to README"
```

---

### Task 5: INSTALLATION.md Codex 사용자 기준 명확화

**목표:** `plugins/pubm-plugin/INSTALLATION.md`가 Claude Code가 아닌 Codex 및 marketplace 미지원 에이전트를 위한 문서임을 명확히 한다.

**Files:**
- Modify: `plugins/pubm-plugin/INSTALLATION.md`

- [ ] **Step 1: 현재 내용 확인**

```bash
cat plugins/pubm-plugin/INSTALLATION.md
```

- [ ] **Step 2: 파일 상단에 대상 명확화 섹션 추가**

파일 맨 위(제목 바로 아래)에 다음을 삽입한다:

```markdown
> **Note:** This file is for coding agents that do **not** support a plugin marketplace (e.g., Codex, custom agents). If you use **Claude Code**, install the pubm plugin directly from the Claude Code marketplace instead.
```

- [ ] **Step 3: 커밋**

```bash
git add plugins/pubm-plugin/INSTALLATION.md
git commit -m "docs(plugin): clarify INSTALLATION.md targets Codex and non-marketplace agents"
```

---

### Task 5: Claude Code marketplace 등재 확인 및 설명 최적화

**목표:** Claude Code marketplace의 pubm plugin 설명이 새 오픈소스 프로젝트 타겟 메시지와 일치하는지 확인하고 필요 시 업데이트한다.

**Files:**
- Modify: `plugins/pubm-plugin/.claude-plugin/plugin.json` (또는 marketplace 설명 파일)

- [ ] **Step 1: 현재 plugin.json 확인**

```bash
cat plugins/pubm-plugin/.claude-plugin/plugin.json
```

- [ ] **Step 2: description 필드 검토 및 업데이트**

description에 "new open source projects"라는 표현이 없으면 아래 문구로 교체한다:

```
Automates pubm setup for new open source projects — configures registries, CI, and changesets with a single skill invocation.
```

변경 여부와 관계없이 Step 3을 실행한다.

- [ ] **Step 3: 커밋 (파일이 없으면 Anthropic marketplace 관리 페이지에서 직접 수정 후 메모만 남김)**

```bash
# plugin.json이 존재하는 경우
git add plugins/pubm-plugin/.claude-plugin/plugin.json
git commit -m "docs(plugin): update marketplace description for new project targeting"

# 파일이 없거나 marketplace가 외부 시스템에서 관리되는 경우:
# marketplace 관리 페이지에서 description을 직접 수정한 뒤,
# 이 Task는 완료 처리하고 다음 Task로 진행한다.
```

---

## Phase 2: 콘텐츠 런치 (행동 항목)

이 Phase는 코드 변경이 없으며, 콘텐츠 제작 및 커뮤니티 참여 행동 항목이다.

### Task 6: 핵심 아티클 5편 작성 및 발행

아래 우선순위 순으로 작성하며 Dev.to + Zenn 동시 발행한다.

- [ ] **아티클 1: "새 npm 패키지 배포 완벽 가이드 (+ jsr 동시 배포)"**
  - 문제 정의: npm publish만으로는 jsr 사용자를 놓친다
  - 솔루션: pubm으로 두 레지스트리를 동시 배포하는 방법
  - 마무리: `pubm init` → `pubm` 2단계 데모
  - 발행: Dev.to 태그 `#npm #javascript #opensource #tutorial`

- [ ] **아티클 2: "모노레포 첫 릴리즈 셋업하는 법"**
  - Turborepo/Nx 기반 모노레포에서 첫 배포 설정의 복잡성 설명
  - pubm으로 의존성 순서 자동 정렬 + 한 번에 배포하는 방법
  - 마무리: 10개 패키지 모노레포에서 `pubm` 한 번으로 배포하는 데모
  - 발행: Dev.to 태그 `#monorepo #npm #turborepo #tutorial`

- [ ] **아티클 3: "npm과 jsr을 동시에 배포해야 하는 이유"**
  - jsr의 부상과 TypeScript 친화성 설명
  - npm 단독 배포의 한계
  - pubm으로 해결하는 방법
  - 발행: Dev.to + Zenn (일본어 개발자 유입)

- [ ] **아티클 4: "오픈소스 첫 릴리즈 체크리스트"**
  - 브랜치 정리, 버전 결정, 레지스트리 인증, 태그 생성, Changelog 등
  - 체크리스트 각 항목을 pubm이 자동화하는 방식으로 연결
  - 발행: Dev.to 태그 `#opensource #beginners #npm #checklist`

- [ ] **아티클 5: "Claude Code / Codex로 오픈소스 배포 자동화하기"**
  - Claude Code: marketplace에서 pubm plugin 설치 → `publish-setup` 스킬 실행
  - Codex: INSTALLATION.md로 bundle 설치 → 동일한 스킬 실행
  - 자동화 결과 시연
  - 발행: Dev.to 태그 `#claudecode #codex #ai #opensource #automation`

- [ ] **Reddit 공유**
  - r/javascript: 아티클 1, 2, 3 공유
  - r/rust: 아티클 3 공유 (crates.io + npm 동시 배포 관점)
  - r/opensource: 아티클 4 공유
  - r/ClaudeAI 또는 관련 커뮤니티: 아티클 5 공유

- [ ] **Hacker News Show HN 등록**
  - 타이밍: 다음 major 기능 릴리즈 시점에 맞춰
  - 제목: "Show HN: pubm – publish to npm, jsr, and crates.io in one command"

---

## Phase 3: 생태계 확장 (행동 항목)

### Task 7: GIF 데모 제작

- [ ] **`pubm` 실행 데모 GIF 제작**
  - 도구: `vhs` (charmbracelet/vhs) 또는 `asciinema`
  - 시나리오: `pubm init` → config 생성 → `pubm patch` → npm+jsr 동시 배포 → 성공 메시지
  - 저장 위치: `website/public/demo.gif`
  - README 및 웹사이트 Hero에 삽입

- [ ] **Claude Code `publish-setup` 스킬 데모 GIF 제작**
  - 시나리오: Claude Code에서 pubm plugin 설치 → `publish-setup` 실행 → 배포 완료
  - Dev.to 아티클 3에 삽입

### Task 8: 오픈소스 스타터킷 노출

- [ ] **create-turbo 이슈/PR 확인**
  - 배포 도구 관련 이슈가 있는지 검색
  - 있으면 pubm을 자연스럽게 언급하는 댓글 작성

- [ ] **Awesome 목록 등재**
  - `awesome-npm`, `awesome-opensource-tools` 등에 PR 제출
  - 포맷: `[pubm](https://github.com/...) - Publish to npm, jsr, and crates.io in one command`

### Task 9: 기여자 유입 기반 마련

- [ ] **CONTRIBUTING.md 작성** (없다면 생성)
  - 첫 기여 이슈 레이블 (`good first issue`) 추가
  - 플러그인 개발 가이드 링크

- [ ] **GitHub Discussions 활성화**
  - "Show and tell" 카테고리: 사용 사례 공유 유도
  - "Ideas" 카테고리: 커뮤니티 피드백 수집

---

## 성공 지표 추적

- [ ] npm 주간 다운로드 현재값 기록 (`npm info pubm`)
- [ ] GitHub Stars 현재값 기록
- [ ] Phase 2 완료 후 수치 비교
- [ ] Phase 3 완료 후 수치 비교 (목표: stars +500, 다운로드 2배)
