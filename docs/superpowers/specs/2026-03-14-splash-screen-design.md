# Splash Screen Design

## Overview

pubm CLI의 퍼블리시 파이프라인 실행 시(`pubm` 또는 `pubm <version>`) ASCII 아트 로고와 초기화 스피너를 표시하는 스플래시 화면을 추가한다. CI 환경에서는 생략한다.

## Trigger Condition

- `pubm` 또는 `pubm <version>` 커맨드 실행 시에만 표시
- 서브커맨드(`pubm init`, `pubm changesets` 등)에서는 표시하지 않음
- CI 환경(`isCI === true`)에서는 전체 스플래시 생략

## Screen Layout

```
              _
 _ __  _   _ | |__   _ __ ___
| '_ \| | | || '_ \ | '_ ` _ \
| |_) | |_| || |_) || | | | | |
| .__/ \__,_||_.__/ |_| |_| |_|
|_|
                         v1.2.3

 ⠋ Checking for updates...
```

초기화 완료 후:

```
              _
 _ __  _   _ | |__   _ __ ___
| '_ \| | | || '_ \ | '_ ` _ \
| |_) | |_| || |_) || | | | | |
| .__/ \__,_||_.__/ |_| |_| |_|
|_|
                         v1.2.3

 ✓ Ready

 [listr2 파이프라인 시작]
```

업데이트 있을 때:

```
              _
 _ __  _   _ | |__   _ __ ___
| '_ \| | | || '_ \ | '_ ` _ \
| |_) | |_| || |_) || | | | | |
| .__/ \__,_||_.__/ |_| |_| |_|
|_|
                         v1.2.3

 ✓ Update available: 1.2.3 → 1.3.0 (npm i -g pubm)

 [listr2 파이프라인 시작]
```

## Styling

- ASCII 아트 로고: `color.dim()` (listr2)
- 버전 텍스트: `color.bold()`
- 스피너 완료 체크마크(`✓`): `color.green()` 또는 기본 색상
- 업데이트 알림: 새 버전 부분 강조

## Module Structure

### New file: `packages/core/src/utils/splash.ts`

- `LOGO` — ASCII 아트 문자열 상수 (figlet Standard 폰트, 하드코딩)
- `showSplash(version: string): void` — 로고 + 버전을 stderr에 출력
- `withSplashSpinner<T>(task: () => Promise<T>): Promise<T>` — 스피너 애니메이션과 함께 비동기 작업 실행, 완료 시 결과 텍스트 표시 후 결과 반환

### Modified: `packages/core/src/utils/notify-new-version.ts`

기존 `notifyNewVersion()` 함수를 분리:

- `checkNewVersion(): Promise<string | undefined>` — 업데이트 체크만 수행, 배너 문자열 반환
- `notifyNewVersion()` — 기존 함수 유지 (하위 호환)

### Modified: `packages/pubm/src/cli.ts`

action 핸들러 변경:

```ts
// Before
console.clear();
if (!isCI) {
  await notifyNewVersion();
}

// After
console.clear();
if (!isCI) {
  showSplash(PUBM_VERSION);
  const banner = await withSplashSpinner(() => checkNewVersion());
  if (banner) console.error(banner);
}
```

## Spinner Implementation

- **프레임**: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (braille dots)
- **간격**: 80ms
- **출력 대상**: `process.stderr` (stdout 파이프라인 오염 방지)
- **라인 제어**: `\r` (캐리지 리턴) + `\x1b[K` (라인 클리어)로 같은 줄 덮어쓰기
- **완료 표시**:
  - 업데이트 있음: `✓ Update available: X.X.X → Y.Y.Y (npm i -g pubm)`
  - 업데이트 없음: `✓ Ready`
- **에러 처리**: 업데이트 체크 실패 시 조용히 무시, `✓ Ready` 표시

## Dependencies

추가 패키지 없음. 기존 `listr2`의 `color` 유틸리티와 표준 터미널 이스케이프 시퀀스만 사용.

## Exports

`packages/core/src/index.ts`에서 새 함수들을 export:

- `showSplash`
- `withSplashSpinner`
- `checkNewVersion`
