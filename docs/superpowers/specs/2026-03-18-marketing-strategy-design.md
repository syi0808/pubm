# pubm 마케팅 전략

**날짜:** 2026-03-18
**전략:** 콘텐츠 퍼스트 (A) + 코딩 에이전트 사용자 공략 (C)

---

## 목표

- **사용자 수 확대** — npm 다운로드 수, GitHub star 증가
- **인지도 구축** — 멀티 레지스트리 배포 = pubm 연상
- **생태계 구축** — 기여자, 플러그인 개발자 확보

---

## 포지셔닝

### 핵심 메시지

> **"새 오픈소스 프로젝트의 기본 배포 도구"**

기존 생태계 전환이 아닌, **처음 오픈소스를 시작하는 개발자**를 공략한다. "어떤 배포 도구를 쓸까?" 고민하는 시점에 pubm이 첫 번째 선택지가 되는 것이 목표다.

- ❌ "np/release-it 대신 pubm으로 갈아타세요"
- ✅ "새 프로젝트 시작할 때 pubm으로 배포 셋업하세요"

### 타겟별 메시지

| 타겟 | 핵심 메시지 |
|------|------------|
| 새 오픈소스 시작하는 개발자 | "처음부터 npm + jsr 동시 배포, 설정 5분" |
| 모노레포 새로 구성하는 팀 | "패키지 늘어나도 배포 방식 바꿀 필요 없음" |
| Claude Code 사용자 | "marketplace에서 pubm plugin 설치 후 배포 셋업 자동 완성" |
| Codex 사용자 | "INSTALLATION.md 한 줄로 pubm plugin 세팅, 배포 자동화" |

---

## 전략 A — 콘텐츠 퍼스트

### 목표

"오픈소스 배포 셋업" 검색 시 pubm이 노출되는 것

### 핵심 콘텐츠 주제 (우선순위 순)

1. **"새 npm 패키지 배포 완벽 가이드 (+ jsr 동시 배포)"** — 검색량 높은 주제, pubm 자연스럽게 소개
2. **"모노레포 첫 릴리즈 셋업하는 법"** — Turborepo/Nx 사용자 유입
3. **"npm과 jsr 동시 배포해야 하는 이유"** — 문제 인식 → 솔루션 연결
4. **"오픈소스 첫 릴리즈 체크리스트"** — pubm init을 체크리스트 항목으로 포함

### 배포 채널

| 채널 | 용도 | 빈도 |
|------|------|------|
| Dev.to / Zenn | 주요 아티클 발행 | 월 1-2회 |
| Reddit r/javascript, r/rust, r/opensource | 아티클 공유 + 참여 | 주 1회 |
| Hacker News (Show HN) | 큰 업데이트/런치 시 | 분기 1회 |
| GitHub README | 검색 진입점 강화 | 상시 최신화 |

---

## 전략 C — 코딩 에이전트 사용자 공략

### 목표

Claude Code, Codex 사용자가 "배포 자동화" 설정 시 pubm을 먼저 찾는 것

### 핵심 콘텐츠

1. **"Claude Code로 오픈소스 배포 자동화하기"** — pubm plugin의 `publish-setup` 스킬 시연
2. **"Codex로 pubm 배포 셋업하기"** — INSTALLATION.md 기반 Codex 워크플로우 가이드
3. **Claude Code/Codex 커뮤니티에 실제 워크플로우 공유** — 데모 GIF/영상 포함
4. **Anthropic Claude Code marketplace 등재 상태 확인 및 설명 최적화**

---

## 실행 로드맵

### Phase 1 — 기반 구축 (1-2개월)

**목표:** 발견되기 좋은 상태 만들기

- [ ] GitHub README 개선 — "왜 pubm인가" 섹션 추가, 경쟁 도구와 차별점 1줄 요약
- [ ] npm 패키지 페이지 키워드 최적화 — description, keywords 정비
- [ ] 웹사이트에 "Why pubm?" 랜딩 섹션 추가 (새 프로젝트 타겟 메시지)
- [ ] pubm plugin INSTALLATION.md를 Codex 사용자 기준으로 다듬기
- [ ] Claude Code marketplace 등재 상태 확인 및 설명 최적화

### Phase 2 — 콘텐츠 런치 (2-4개월)

**목표:** 검색 유입 시작, 첫 번째 커뮤니티 반응 확인

- [ ] 핵심 아티클 3편 작성 (Dev.to + Zenn 동시 발행)
  - "새 npm 패키지 배포 완벽 가이드"
  - "npm + jsr 동시 배포하는 법"
  - "Claude Code로 오픈소스 배포 자동화"
- [ ] Reddit r/javascript, r/opensource에 공유
- [ ] Hacker News Show HN 첫 등록

### Phase 3 — 생태계 확장 (4개월~)

**목표:** GitHub star 증가, 플러그인/기여자 유입

- [ ] "pubm으로 배포 셋업하기" GIF 데모 제작
- [ ] 인기 오픈소스 스타터킷(create-turbo 등)에 pubm 언급 PR/이슈 시도
- [ ] 커뮤니티 기여 가이드 작성, 첫 외부 플러그인 기여 유도

---

## 성공 지표

| 지표 | Phase 1 목표 | Phase 3 목표 |
|------|-------------|-------------|
| npm 주간 다운로드 | 현재 파악 | 2배 |
| GitHub Stars | 현재 파악 | +500 |
| 인바운드 이슈/PR | 산발적 | 월 5건+ |
