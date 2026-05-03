<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo_with_symbol.png" height="150">
</p>


<h1 align="center">pubm</h1>

<p align="center">
<strong>하나의 명령. 모든 레지스트리.</strong><br>
npm, jsr, crates.io, 사설 레지스트리까지 한 번에 배포합니다.<br>
무언가 실패하면 pubm이 버전 변경, 태그, 커밋을 자동으로 되돌립니다.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.zh-cn.md">简体中文</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.es.md">Español</a>
</p>

<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/demo.gif" width="100%">
</p>

## 왜 pubm인가?

대부분의 릴리스 도구는 하나의 레지스트리만 전제합니다. pubm은 프로젝트가 커질 때를 위해 만들어졌습니다.

- **npm + jsr**: 하나의 명령으로 두 JavaScript 레지스트리에 함께 배포
- **JS + Rust**: `package.json`과 `Cargo.toml`을 하나의 파이프라인에서 함께 배포
- **모노레포**: 의존 순서대로 패키지를 배포하므로 수동 순서 조정이 필요 없음
- **자동 롤백**: 어느 레지스트리에서 실패하더라도 버전 변경, 태그, 커밋을 되돌림
- **설정 불필요**: 매니페스트 파일을 읽어 레지스트리를 자동 감지

지금은 npm만으로 시작하고, 다음 달에 jsr을 추가하고, 내년에 모노레포로 옮겨도 됩니다. 릴리스 명령은 계속 `pubm` 그대로입니다.

npm 패키지 하나만 배포한다면 `np`나 `release-it`도 충분합니다. pubm은 프로젝트가 커질 때마다 릴리스 셋업을 다시 짜고 싶지 않을 때 쓰는 도구입니다.

## 동작 방식

### 설정 불필요

pubm은 매니페스트 파일을 읽고 어떤 레지스트리에 배포할지 판단합니다.

| 매니페스트 | 레지스트리 |
|----------|----------|
| `package.json` | npm |
| `jsr.json` | jsr |
| `deno.json` / `deno.jsonc` | jsr |
| `Cargo.toml` | crates.io |

`package.json`과 `jsr.json`이 모두 있으면 한 번의 릴리스에서 둘 다 배포합니다. 별도 설정은 필요 없습니다.

### 자동 롤백

레지스트리에서 패키지를 거부하더라도 pubm이 버전 변경, git 태그, 커밋을 되돌립니다. 반쯤만 배포된 상태도, 수동 정리도 없습니다.

### 사전 점검

브랜치, 워킹 트리, 원격 동기화, 로그인 상태, 배포 권한을 pubm이 **실제 변경 전에** 모두 확인합니다. CI 모드에서는 토큰 검증과 publish dry-run까지 수행해서 실제 배포 전에 문제를 잡아냅니다:

```bash
pubm --phase prepare
```

### 같은 명령, 로컬과 CI 모두

터미널에서는 대화형 프롬프트로, CI에서는 완전 무인으로 동작합니다. 별도 설정도, 외울 플래그도 없습니다.

### 모노레포 기본 지원

pnpm, yarn, npm, bun, deno, Cargo 워크스페이스를 자동 감지합니다. 의존 순서대로 배포하며 independent versioning, fixed versioning, linked groups를 지원합니다.

### 멀티 생태계 지원

JavaScript와 Rust를 같은 파이프라인에서 처리합니다. JS + Rust 혼합 워크스페이스도 바로 동작합니다.

## 빠른 시작

```bash
# npm
npm i -g pubm

# Homebrew
brew tap syi0808/pubm
brew install pubm

# 대화형 설정 마법사 - 패키지 감지, 레지스트리 설정, CI 구성 등
pubm init

# 그냥 pubm을 실행하면 됩니다
pubm

# 선택 사항: 코딩 에이전트 스킬 설치 (Claude Code, Codex, Gemini)
pubm setup-skills
```

이후 흐름은 pubm이 안내합니다.

```
  $ pubm
    │
    ├─ 버전 선택            ── patch, minor, major
    ├─ 사전 점검            ── 브랜치, 워킹 트리, 원격 동기화
    ├─ 레지스트리 검증      ── 인증, 권한, 사용 가능 여부
    ├─ 테스트 & 빌드        ── npm 스크립트 실행
    ├─ 버전 증가            ── 매니페스트 갱신, git 커밋 + 태그 생성
    ├─ 배포                 ── 모든 레지스트리에 동시에 배포
    ├─ 후속 처리            ── 태그 push, GitHub Release 생성
    │
    └─ 실패 시 → 전체 롤백
```

## 문서

- [빠른 시작](https://syi0808.github.io/pubm/ko/guides/quick-start/)
- [설정](https://syi0808.github.io/pubm/ko/guides/configuration/)
- [Changesets](https://syi0808.github.io/pubm/ko/guides/changesets/)
- [모노레포](https://syi0808.github.io/pubm/ko/guides/monorepo/)
- [CI/CD](https://syi0808.github.io/pubm/ko/guides/ci-cd/)
- [CLI 레퍼런스](https://syi0808.github.io/pubm/ko/reference/cli/)
- [플러그인 API](https://syi0808.github.io/pubm/ko/reference/plugins/)

## FAQ

### 레지스트리 토큰은 어떻게 저장되나요?

pubm은 `@napi-rs/keyring`을 통해 OS 네이티브 키체인(macOS Keychain, Windows Credential Manager, Linux Secret Service)에 토큰을 저장합니다. 환경 변수가 항상 우선합니다. 매번 직접 입력하려면 `--no-save-token`을 사용하세요.

## 개인정보 보호

pubm은 텔레메트리, 분석 데이터, 사용 데이터를 수집하지 않습니다.

- **토큰 저장** - 레지스트리 토큰은 OS 키체인(macOS Keychain, Windows Credential Manager, Linux Secret Service)에 저장되며, AES-256-CBC 암호화 폴백이 `~/.pubm/`에 위치합니다
- **네트워크** - pubm은 설정된 레지스트리(npm, jsr, crates.io)와 GitHub Release 생성에만 통신합니다
- **업데이트 확인** - npm 공개 레지스트리에 새 버전을 조회합니다 (로컬 전용, CI에서는 비활성)

---

## 기여

기여는 언제나 환영합니다. 풀 리퀘스트를 보내기 전에 [Contributing Guide](CONTRIBUTING.md)를 읽어주세요.

## 라이선스

이 프로젝트는 Apache License 2.0을 따릅니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
