# Release Asset Pipeline 설계

## Problem

현재 release asset 처리 로직에 세 가지 근본적 문제가 있다:

1. **경로 하드코딩**: `createGitHubRelease` 내부의 `discoverPlatformBinaries`가 `npm/@pubm/*/bin/` 경로를 하드코딩하여 실제 프로젝트 구조(`packages/pubm/platforms/*/bin/`)와 불일치. 버전만 올라가고 sha256이 PLACEHOLDER로 남는 버그 발생.
2. **관심사 결합**: GitHub Release 생성, 바이너리 탐색, 압축, 업로드, sha256 계산이 `createGitHubRelease` 한 함수에 묶여 있어 확장/테스트 불가.
3. **플러그인 인터페이스 빈약**: `afterRelease` hook만 존재하여 asset 파이프라인 중간 단계 개입 불가. brew 플러그인이 asset name에서 string matching으로 platform을 추론하는 깨지기 쉬운 방식 사용.

## Goals

1. release asset 수집/압축/네이밍/업로드를 독립 모듈로 분리하여 각 단계를 독립적으로 테스트 가능하게 한다.
2. config에서 선언적으로 asset을 지정하되, 자동 감지를 기본으로 하고 모든 동작을 오버라이드 가능하게 한다.
3. asset 파이프라인의 각 단계에 플러그인이 개입할 수 있는 촘촘한 hook 인터페이스를 제공한다.
4. 내장 platform 파싱 테이블로 OS/Arch/ABI/Variant를 자동 추출하여, 소비자(brew 등)가 구조화된 데이터를 받게 한다.
5. CLI 바이너리 외 다양한 유즈케이스(데스크톱 앱, WASM, 네이티브 바인딩 등)를 지원한다.

## Non-Goals

- GitHub Release 외 upload target(S3, R2 등)은 내장하지 않는다 — `uploadAssets` hook으로 플러그인 확장.
- Migration guide는 제공하지 않는다.
- 다국어 문서 번역은 포함하지 않는다 — 영어만 작성.

---

## 1. Config Interface

### 1.1 `releaseAssets` 필드

`pubm.config.ts`의 top-level 필드로 추가한다.

```typescript
/** compress 포맷 유니온 */
type CompressFormat = "tar.gz" | "zip" | "tar.xz" | "tar.zst";

/**
 * compress 옵션 타입.
 * - CompressFormat: 모든 OS에 동일 포맷 적용
 * - false: 압축하지 않음
 * - Record<string, CompressFormat>: OS별 포맷 지정 (예: { windows: "zip", linux: "tar.xz" })
 */
type CompressOption = CompressFormat | false | Record<string, CompressFormat>;

/** releaseAssets 배열의 각 원소 타입 */
type ReleaseAssetEntry = string | ReleaseAssetGroupConfig;

interface ReleaseAssetGroupConfig {
  /** 모노레포: 이 패키지의 GitHub Release에 연결. 생략 시 루트/단일 패키지. */
  packagePath?: string;
  /** asset 파일 목록 */
  files: (string | ReleaseAssetFileConfig)[];
  /** 이 그룹의 기본 압축 포맷 (file-level에서 오버라이드 가능) */
  compress?: CompressOption;
  /** 이 그룹의 기본 name 템플릿 (확장자 제외) */
  name?: string;
}

interface ReleaseAssetFileConfig {
  /** glob 패턴 또는 캡처 변수를 포함한 path 패턴 */
  path: string;
  /** 압축 포맷. false=그대로, 생략=OS-aware 자동 감지 */
  compress?: CompressOption;
  /** 업로드 파일명 템플릿 (확장자 제외) */
  name?: string;
}

/** group-level 기본값과 file-level 설정을 merge한 뒤, OS별로 resolve한 결과 */
interface ResolvedAssetFileConfig {
  /** 원본 path 패턴 */
  path: string;
  /** 결정된 압축 포맷 (OS-aware resolve 후 최종 값) */
  compress: CompressFormat | false;
  /** 결정된 name 템플릿 (확장자 제외) */
  name: string;
}

/** pipeline이 소비하는 정규화된 config */
interface ResolvedReleaseAssetConfig {
  packagePath?: string;
  files: ResolvedAssetFileConfig[];
}

/** packages/core/src/config/types.ts의 PubmConfig에 추가되는 필드 */
interface PubmConfig {
  // ... 기존 필드
  /** 글로벌 압축 포맷 기본값. releaseAssets의 group/file level에서 오버라이드 가능. */
  compress?: CompressOption;
  releaseAssets?: ReleaseAssetEntry[];
}
// ResolvedPubmConfig도 동일하게 compress, releaseAssets 필드를 포함한다.

/**
 * compress 우선순위 (높은 순):
 * 1. file-level compress
 * 2. group-level compress
 * 3. global compress (PubmConfig.compress)
 * 4. OS-aware 자동 감지 (windows → "zip", 나머지 → "tar.gz")
 *
 * 각 레벨에서 CompressOption이 Record<string, CompressFormat>이면,
 * 해당 asset의 파싱된 OS에 맞는 엔트리를 선택한다.
 * 매칭되는 OS 엔트리가 없으면 다음 우선순위로 fallback한다.
 */
```

### 1.2 사용 예시

```typescript
// ① 최소 설정 — string = path glob, 나머지 전부 자동
releaseAssets: [
  "platforms/*/bin/pubm",
]

// ② 풀 설정
compress: { windows: "zip" },  // 글로벌 기본값
releaseAssets: [
  {
    packagePath: "packages/pubm",
    files: [
      // string = glob, 자동 (글로벌 → OS-aware fallback)
      "platforms/*/bin/pubm",
      // object = 명시적 설정
      {
        path: "dist/*.dmg",
        compress: false,            // file-level: 압축 안 함
        name: "myapp-{version}-{arch}",
      },
      {
        path: "target/{arch}-{vendor}-{os}/release/myapp",
        compress: { linux: "tar.xz" },  // file-level: linux만 tar.xz, 나머지는 그룹→글로벌→자동
        name: "myapp-{version}-{arch}-{os}",
      },
    ],
    compress: "tar.gz",   // 그룹 기본값 (글로벌 오버라이드, file-level이 다시 오버라이드)
    name: "{name}-{platform}",
  },
]
```

### 1.3 확장자 규칙

name 템플릿에는 확장자를 포함하지 않는다. 확장자는 `compress` 값에서 자동 부여된다:

| `compress` 값 | 결과 확장자 |
|---|---|
| `"tar.gz"` | `.tar.gz` |
| `"zip"` | `.zip` |
| `"tar.xz"` | `.tar.xz` |
| `"tar.zst"` | `.tar.zst` |
| `false` | 원본 파일 확장자 유지 |

### 1.4 자동 감지 규칙

**압축**: 파일 확장자가 알려진 아카이브/패키지 포맷이면 `compress: false`, 아니면 **OS-aware 자동 감지**:
- 알려진 포맷 (압축 불필요):
  - 아카이브: `.tar.gz`, `.tgz`, `.tar.xz`, `.tar.zst`, `.tar.bz2`, `.zip`, `.7z`
  - 패키지: `.dmg`, `.msi`, `.exe`, `.deb`, `.rpm`, `.AppImage`, `.pkg`, `.snap`, `.flatpak`
  - WASM: `.wasm`
- 압축 필요 시 기본값: 자동 파싱된 OS가 `windows`면 `"zip"`, 나머지는 `"tar.gz"`

**Name**: 미지정 시, platform 정보가 감지되면 `{filename}-{platform}`, 아니면 `{filename}` 사용. 압축 시 확장자가 추가된다.

### 1.5 Name 템플릿 변수

| 변수 | 출처 | 예시 |
|---|---|---|
| `{name}` | package.json의 name (scope 제외) | `pubm` |
| `{version}` | 릴리즈 버전 | `0.4.0` |
| `{platform}` | path에서 캡처된 원본 문자열 | `darwin-arm64` |
| `{os}` | platform에서 자동 파싱 | `darwin` |
| `{arch}` | platform에서 자동 파싱 | `arm64` |
| `{vendor}` | platform에서 자동 파싱 (있으면) | `apple`, `unknown` |
| `{abi}` | platform에서 자동 파싱 (있으면) | `gnu`, `musl` |
| `{variant}` | platform에서 자동 파싱 (있으면) | `baseline` |
| `{filename}` | 원본 파일명 (확장자 제외) | `pubm` |

path 패턴에 `{os}`, `{arch}` 등의 캡처 변수를 사용하면 해당 값이 직접 추출된다. 캡처 변수 없이 glob만 사용하면, 경로의 각 세그먼트를 내장 테이블에 대조하여 자동 파싱한다.

**`{platform}` 변수 규칙:**
- path에 `{platform}`을 캡처 변수로 사용한 경우: 캡처된 원본 문자열 그대로 (예: `platforms/{platform}/bin/pubm` → `darwin-arm64`)
- path에 `{os}`, `{arch}` 등 개별 캡처 변수를 사용한 경우: `{os}-{arch}` 형태로 조합 (예: `{arch}-{vendor}-{os}` → `darwin-arm64`)
- 캡처 변수 없이 자동 파싱한 경우: 매칭된 os와 arch를 `-`로 조합 (예: `darwin-arm64`)

---

## 2. Platform 자동 파싱

### 2.1 접근 방식

path에서 캡처된 문자열(또는 경로 세그먼트)을 내장 테이블에 대조하여 OS/Arch/ABI/Variant를 자동 추출한다. goreleaser가 Go의 `GOOS`/`GOARCH` 값을 내장하는 것과 동일한 원리.

### 2.2 내장 OS 테이블

| Canonical | Aliases |
|---|---|
| `darwin` | `macos`, `mac`, `osx`, `macosx`, `apple-darwin` |
| `linux` | `lin` |
| `windows` | `win`, `win32`, `win64` |
| `freebsd` | |
| `openbsd` | |
| `netbsd` | |
| `android` | |
| `ios` | |
| `solaris` | `sunos` |
| `illumos` | |
| `aix` | |
| `dragonfly` | `dragonflybsd` |
| `plan9` | |
| `fuchsia` | |
| `haiku` | |
| `redox` | |

### 2.3 내장 Arch 테이블

| Canonical | Aliases |
|---|---|
| `x64` | `x86_64`, `amd64`, `x86-64` |
| `ia32` | `i386`, `i486`, `i586`, `i686`, `x86`, `386` |
| `arm64` | `aarch64`, `armv8`, `aarch_64` |
| `arm` | `armv7`, `armv7l`, `armv6`, `armv6l`, `armhf`, `armel` |
| `ppc64le` | `powerpc64le`, `ppc64el` |
| `ppc64` | `powerpc64` |
| `ppc` | `powerpc` |
| `s390x` | |
| `riscv64` | `riscv64gc` |
| `loong64` | `loongarch64`, `la64` |
| `mips` | `mips32` |
| `mipsel` | `mipsle` |
| `mips64` | |
| `mips64el` | `mips64le` |
| `wasm32` | `wasm` |
| `wasm64` | |
| `universal` | `universal2`, `fat` |

### 2.4 내장 ABI 테이블

| Value | Meaning |
|---|---|
| `gnu` / `glibc` | GNU C Library |
| `musl` | musl libc |
| `msvc` | Microsoft Visual C++ |
| `mingw` / `mingw32` / `mingw-w64` | MinGW |
| `gnueabihf` | ARM hard-float (glibc) |
| `gnueabi` | ARM soft-float (glibc) |
| `musleabihf` | ARM hard-float (musl) |
| `musleabi` | ARM soft-float (musl) |
| `androideabi` | Android ARM EABI |
| `android` | Android (generic) |
| `uclibc` | uClibc (embedded) |
| `bionic` | Android's C library |

### 2.5 내장 Variant 테이블

| Value | Meaning |
|---|---|
| `baseline` | No AVX2 (SSE4.2 only) |
| `v2` | x86-64 microarch level 2 |
| `v3` | x86-64 microarch level 3 (AVX2) |
| `v4` | x86-64 microarch level 4 (AVX-512) |
| `avx2` | Explicit AVX2 requirement |
| `avx512` | Explicit AVX-512 requirement |

### 2.6 내장 Vendor 테이블

파싱 시 vendor로 인식하되, platform 변수에는 포함하지 않고 별도 `{vendor}` 변수로만 접근 가능:

| Value | Meaning |
|---|---|
| `unknown` | Generic (Rust default) |
| `apple` | Apple platforms |
| `pc` | PC/desktop (Windows/Solaris) |
| `none` | Bare metal |

### 2.7 파싱 알고리즘

1. path에 `{os}`, `{arch}` 등 캡처 변수가 있으면 → 해당 위치에서 직접 추출
2. 캡처 변수가 없으면 → 경로 세그먼트를 `/`로 split한 뒤, 각 세그먼트를 다시 `-`로 split하여 토큰 배열 생성. 토큰을 아래 순서로 내장 테이블 매칭:
   - OS 테이블 → 첫 번째 매치를 `os`로
   - Arch 테이블 → 첫 번째 매치를 `arch`로
   - ABI 테이블 → 매치를 `abi`로
   - Variant 테이블 → 매치를 `variant`로
   - Vendor 테이블 → 매치를 `vendor`로
   - 매칭되지 않은 토큰은 무시
3. `{platform}` = 캡처 변수 사용 시 캡처된 원본 문자열, 아니면 매칭에 사용된 세그먼트 전체

> **참고**: OS/Arch 별칭은 모두 단일 토큰이다 (하이픈이 포함된 다중 토큰 별칭은 사용하지 않는다). 예를 들어 Rust triple `x86_64-unknown-linux-gnu`는 개별 토큰 `[x86_64, unknown, linux, gnu]`로 분해되어 각각 arch, vendor, os, abi로 매칭된다.

---

## 3. Asset Pipeline 내부 아키텍처

### 3.1 모듈 구조

```
packages/core/src/
  assets/
    index.ts           — barrel export (types, pipeline, platform-parser 등 public API)
    types.ts           — ResolvedAsset, TransformedAsset, CompressedAsset,
                         PreparedAsset, UploadedAsset, ParsedPlatform 타입
    resolver.ts        — config의 releaseAssets를 glob 매칭하여 ResolvedAsset[] 생성
    platform-parser.ts — 내장 OS/Arch/ABI/Variant 테이블, 자동 파싱 로직
    compressor.ts      — 압축 포맷 감지/적용 (tar.gz, zip, tar.xz, tar.zst)
    namer.ts           — name 템플릿 변수 치환 + 확장자 부여
    hasher.ts          — sha256 계산
    pipeline.ts        — 위 모듈 조합 + hook 실행 오케스트레이션
  tasks/
    github-release.ts  — GitHub Release 생성 + PreparedAsset[] 업로드만 담당
                         (discoverPlatformBinaries, compressBinary, sha256 함수 제거)
```

### 3.2 타입 정의

파일: `packages/core/src/assets/types.ts`

```typescript
export interface ParsedPlatform {
  /** 캡처된 원본 문자열 또는 매칭 세그먼트 전체 */
  raw: string;
  os?: string;
  arch?: string;
  vendor?: string;
  abi?: string;
  variant?: string;
}

export interface ResolvedAsset {
  /** 로컬 파일 절대 경로 */
  filePath: string;
  /** 자동 파싱된 플랫폼 정보 */
  platform: ParsedPlatform;
  /** 이 파일에 적용된 config (compress, name 등) */
  config: ResolvedAssetFileConfig;
}

export interface TransformedAsset extends ResolvedAsset {
  /** 변환 후 파일 경로 (변경 가능) */
  filePath: string;
  /** 아카이브에 함께 포함할 추가 파일 경로 */
  extraFiles?: string[];
}

export interface CompressedAsset {
  /** 압축된 파일 경로 (또는 compress: false면 원본) */
  filePath: string;
  /** 원본 파일 경로 */
  originalPath: string;
  /** 플랫폼 정보 */
  platform: ParsedPlatform;
  /** 적용된 압축 포맷 (확장자 결정에 사용) */
  compressFormat: CompressFormat | false;
  /** 이 asset의 resolved config (name 템플릿 등) */
  config: ResolvedAssetFileConfig;
}

export interface PreparedAsset extends CompressedAsset {
  /** 업로드될 파일명 (확장자 포함) */
  name: string;
  /** SHA-256 hex hash */
  sha256: string;
}

export interface UploadedAsset extends PreparedAsset {
  /** 업로드된 URL */
  url: string;
  /** upload target 식별자 */
  target: string;
}

/** 플러그인이 소비하는 최종 asset 정보 */
export interface ReleaseAsset {
  name: string;
  url: string;
  sha256: string;
  platform: ParsedPlatform;
}

export interface ReleaseContext {
  packageName: string;
  version: string;
  tag: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}
```

### 3.3 파이프라인 실행 흐름

파일: `packages/core/src/assets/pipeline.ts`

```typescript
export async function runAssetPipeline(
  config: ResolvedReleaseAssetConfig,
  hooks: AssetPipelineHooks,
  ctx: PubmContext,
): Promise<PreparedAsset[]> {
  // 1. Resolve — glob 매칭, ResolvedAsset[] 생성
  //    이 단계에서 CompressOption (OS별 매핑)이 각 asset의 파싱된 OS를 기반으로
  //    최종 CompressFormat | false 값으로 resolve된다.
  let resolved = resolveAssets(config, ctx);
  if (hooks.resolveAssets) {
    resolved = await hooks.resolveAssets(resolved, ctx);
  }

  // 2. Transform — 개별 asset 변환 (사이닝, strip, 추가 파일 등)
  let transformed: TransformedAsset[] = [];
  for (const asset of resolved) {
    const result = hooks.transformAsset
      ? await hooks.transformAsset(asset, ctx)
      : asset;
    transformed.push(...(Array.isArray(result) ? result : [result]));
  }

  // 3. Compress — 압축 포맷 감지/적용
  const compressed = await Promise.all(
    transformed.map((a) =>
      hooks.compressAsset ? hooks.compressAsset(a, ctx) : defaultCompress(a),
    ),
  );

  // 4. Name — 템플릿 치환 + 확장자 부여
  // 5. Hash — sha256 계산 (async — 대용량 파일 대비)
  let prepared: PreparedAsset[] = await Promise.all(
    compressed.map(async (a) => ({
      ...a,
      name: hooks.nameAsset ? hooks.nameAsset(a, ctx) : defaultName(a),
      sha256: await computeSha256(a.filePath),
    })),
  );

  // 6. Checksums — 체크섬 파일을 추가 asset으로 생성
  if (hooks.generateChecksums) {
    prepared = await hooks.generateChecksums(prepared, ctx);
  }

  return prepared;
}
```

### 3.4 runner.ts 호출부 변경

```typescript
// 변경 전
const result = await createGitHubRelease(ctx, { packageName, version, tag, changelogBody });

// 변경 후
const preparedAssets = await runAssetPipeline(assetConfig, hooks, ctx);
const result = await createGitHubRelease(ctx, {
  packageName, version, tag, changelogBody,
  assets: preparedAssets,  // 준비된 asset을 전달
});

if (result) {
  // 추가 upload target (플러그인)
  if (hooks.uploadAssets) {
    const additional = await hooks.uploadAssets(preparedAssets, ctx);
    result.assets.push(
      ...additional.map((a) => ({
        name: a.name,
        url: a.url,
        sha256: a.sha256,
        platform: a.platform,
      })),
    );
  }
  await ctx.runtime.pluginRunner.runAfterReleaseHook(ctx, result);
}
```

### 3.5 github-release.ts 변경

`createGitHubRelease`에서 제거할 것:
- `discoverPlatformBinaries` 함수
- `compressBinary` 함수
- `sha256` 함수 (로컬)
- 바이너리 탐색/압축/해싱 로직 (lines 211-265)

추가할 것:
- `assets: PreparedAsset[]` 파라미터 — 이미 준비된 asset을 받아서 업로드만 수행
- 업로드 루프에서 `PreparedAsset.name`을 파일명으로, `PreparedAsset.filePath`를 읽어서 업로드
- `UploadedAsset[]` 반환 시 `target: "github"` 설정

---

## 4. Plugin Interface

### 4.1 Asset Pipeline Hooks

파일: `packages/core/src/plugin/types.ts`에 추가

```typescript
export interface AssetPipelineHooks {
  /** glob 결과를 변환/필터/추가 */
  resolveAssets?: (
    resolved: ResolvedAsset[],
    ctx: PubmContext,
  ) => Promise<ResolvedAsset[]> | ResolvedAsset[];

  /** 개별 asset을 압축 전에 변환. 1개 → N개 반환 가능 */
  transformAsset?: (
    asset: ResolvedAsset,
    ctx: PubmContext,
  ) => Promise<TransformedAsset | TransformedAsset[]>
    | TransformedAsset
    | TransformedAsset[];

  /** 기본 압축 로직 대체 */
  compressAsset?: (
    asset: TransformedAsset,
    ctx: PubmContext,
  ) => Promise<CompressedAsset> | CompressedAsset;

  /** 템플릿으로 불가능한 동적 네이밍 */
  nameAsset?: (
    asset: CompressedAsset,
    ctx: PubmContext,
  ) => string;

  /** 체크섬 파일을 추가 asset으로 생성 */
  generateChecksums?: (
    assets: PreparedAsset[],
    ctx: PubmContext,
  ) => Promise<PreparedAsset[]> | PreparedAsset[];

  /** 추가 upload target (GitHub Release는 내장) */
  uploadAssets?: (
    assets: PreparedAsset[],
    ctx: PubmContext,
  ) => Promise<UploadedAsset[]> | UploadedAsset[];
}
```

### 4.2 PluginHooks 확장

```typescript
export interface PluginHooks {
  // 기존 hooks 유지
  beforeTest?: HookFn;
  afterTest?: HookFn;
  beforeBuild?: HookFn;
  afterBuild?: HookFn;
  beforeVersion?: HookFn;
  afterVersion?: HookFn;
  beforePublish?: HookFn;
  afterPublish?: HookFn;
  beforePush?: HookFn;
  afterPush?: HookFn;
  afterRelease?: AfterReleaseHookFn;
  onError?: ErrorHookFn;
  onRollback?: HookFn;
  onSuccess?: HookFn;

  // 새로 추가 — asset pipeline hooks
  resolveAssets?: AssetPipelineHooks["resolveAssets"];
  transformAsset?: AssetPipelineHooks["transformAsset"];
  compressAsset?: AssetPipelineHooks["compressAsset"];
  nameAsset?: AssetPipelineHooks["nameAsset"];
  generateChecksums?: AssetPipelineHooks["generateChecksums"];
  uploadAssets?: AssetPipelineHooks["uploadAssets"];
}
```

### 4.3 Hook 실행 순서

```
Config (releaseAssets)
  → glob 매칭 → ResolvedAsset[]
  → [resolveAssets hook] → ResolvedAsset[] (필터/추가)
  → [transformAsset hook] per asset → TransformedAsset[] (사이닝, strip 등)
  → [compressAsset hook] or 내장 압축 → CompressedAsset[]
  → [nameAsset hook] or 내장 템플릿 → 파일명 결정
  → sha256 계산 → PreparedAsset[]
  → [generateChecksums hook] → PreparedAsset[] (체크섬 파일 추가)
  → GitHub Release 업로드 (내장) → UploadedAsset[]
  → [uploadAssets hook] → UploadedAsset[] (추가 target)
  → ReleaseContext 조립
  → [afterRelease hook] (brew 등 소비)
```

### 4.4 플러그인 예제: 코드 사이닝

```typescript
const codeSignPlugin: PubmPlugin = {
  name: "code-sign",
  hooks: {
    transformAsset: async (asset, ctx) => {
      if (asset.platform.os === "darwin") {
        await exec("codesign", ["--sign", identity, asset.filePath]);
      }
      return asset;
    },
  },
};
```

### 4.5 플러그인 예제: SHA256SUMS.txt 생성

```typescript
const checksumsPlugin: PubmPlugin = {
  name: "checksums",
  hooks: {
    generateChecksums: async (assets, ctx) => {
      const lines = assets.map((a) => `${a.sha256}  ${a.name}`).join("\n");
      const checksumPath = join(ctx.tempDir, "SHA256SUMS.txt");
      writeFileSync(checksumPath, lines);
      return [
        ...assets,
        {
          filePath: checksumPath,
          originalPath: checksumPath,
          name: "SHA256SUMS.txt",
          sha256: await computeSha256(checksumPath),
          platform: { raw: "" },
          compressFormat: false,
          config: { path: "", compress: false, name: "SHA256SUMS.txt" },
        },
      ];
    },
  },
};
```

### 4.6 다중 플러그인 Hook 합성 규칙

여러 플러그인이 같은 asset pipeline hook을 등록한 경우, 플러그인 등록 순서대로 체이닝된다:

- **배열 입출력 hooks** (`resolveAssets`, `generateChecksums`): 이전 플러그인의 출력이 다음 플러그인의 입력이 된다 (체이닝).
- **`uploadAssets` hook**: 각 플러그인이 독립적으로 호출되고, 모든 플러그인의 결과가 concat된다 (누적). 각 플러그인은 동일한 `PreparedAsset[]`을 입력으로 받는다.
- **개별 asset hooks** (`transformAsset`, `compressAsset`, `nameAsset`): 이전 플러그인의 출력이 다음 플러그인의 입력이 된다. `transformAsset`이 배열을 반환하면 각 원소에 대해 다음 플러그인이 호출된다.
- 어떤 플러그인에서든 에러가 발생하면 체인이 중단되고 `onError` hook으로 전파된다.

---

## 4.7 Temp 파일 관리

- `compressor`가 생성한 압축 파일은 `os.tmpdir()`의 `pubm-assets-{timestamp}/` 디렉토리에 저장된다.
- `pipeline.ts`의 `runAssetPipeline`이 `PreparedAsset[]`을 반환한 후, **호출자(runner.ts)가** 업로드 완료 시점에 temp 디렉토리를 `rmSync`으로 정리한다.
- 플러그인이 `generateChecksums` 등에서 생성한 temp 파일도 같은 디렉토리에 저장하도록 `ctx.runtime.tempDir`로 경로를 제공한다. `PubmContext.runtime`에 `tempDir: string` 필드를 추가한다.

## 4.8 에러 처리 전략

- asset 업로드는 **all-or-nothing**: 하나라도 실패하면 전체 중단하고 에러를 throw한다.
- 이미 업로드된 asset은 GitHub Release에 남는다 (GitHub API에 개별 asset 삭제 기능이 있지만, 부분 상태로 남기는 것이 재시도에 더 유리).
- `uploadAssets` hook (추가 target)에서 실패 시에도 동일하게 중단. 플러그인이 자체적으로 retry하려면 hook 내부에서 처리.

## 4.9 Config 검증

검증을 두 단계로 나눈다:

**구조 검증 (config 로드 시점):**
- 잘못된 `compress` 값 → 에러
- name 템플릿의 알 수 없는 변수 (예: `{versoin}`) → 경고
- `packagePath`가 실제 존재하는 패키지 경로인지 확인 → 에러

**런타임 검증 (빌드 후, 업로드 전):**
- glob 패턴이 0개 파일을 매칭하면 → 에러 (빌드 완료 후이므로 파일이 있어야 함)

---

## 5. Brew 플러그인 변경

### 5.1 기존 방식 → 새 방식

| | 기존 | 변경 후 |
|---|---|---|
| platform 추론 | `asset.name.includes("darwin-arm64")` string matching | `asset.platform.os === "darwin" && asset.platform.arch === "arm64"` |
| 매핑 함수 | `mapReleaseAssets()` — 파일명 기반 | `matchAssetToPlatform()` — `ParsedPlatform` 객체 기반 |
| 커스텀 매핑 | 불가 | `assetPlatforms` 옵션으로 오버라이드 |

### 5.2 Config 변경

```typescript
brewTap({
  formula: "Formula/pubm.rb",
  // 기본: platform.os + platform.arch로 매핑 (생략 가능)
  // 커스텀: predicate 함수로 오버라이드
  assetPlatforms: {
    "darwin-arm64": (asset) =>
      asset.platform.os === "darwin" && asset.platform.arch === "arm64",
    "linux-x64": (asset) =>
      asset.platform.os === "linux" && asset.platform.arch === "x64",
  },
})
```

### 5.3 파일별 변경

| 파일 | 변경 |
|---|---|
| `formula.ts` | `mapReleaseAssets()` 제거. `matchAssetToPlatform()` 추가 — `ReleaseAsset.platform` 기반 매칭 |
| `formula.ts` | `FormulaAsset` 타입 유지, 생성 방식만 변경 |
| `brew-tap.ts` | `afterRelease` hook에서 `mapReleaseAssets()` → `matchAssetToPlatform()` 사용 |
| `brew-core.ts` | 동일 |
| `types.ts` | `BrewTapOptions`, `BrewCoreOptions`에 `assetPlatforms?` 필드 추가 |

### 5.4 기본 매칭 로직

```typescript
const FORMULA_PLATFORMS = {
  "darwin-arm64": { os: "darwin", arch: "arm64" },
  "darwin-x64": { os: "darwin", arch: "x64" },
  "linux-arm64": { os: "linux", arch: "arm64" },
  "linux-x64": { os: "linux", arch: "x64" },
} as const;

function matchAssetToPlatform(
  assets: ReleaseAsset[],
  formulaPlatform: keyof typeof FORMULA_PLATFORMS,
  customMatcher?: (asset: ReleaseAsset) => boolean,
): ReleaseAsset | undefined {
  if (customMatcher) return assets.find(customMatcher);
  const { os, arch } = FORMULA_PLATFORMS[formulaPlatform];
  return assets.find(
    (a) => a.platform.os === os && a.platform.arch === arch,
  );
}
```

---

## 6. 기존 코드 변경 범위

| 파일 | 변경 내용 |
|---|---|
| **신규** `packages/core/src/assets/types.ts` | 파이프라인 타입 정의 |
| **신규** `packages/core/src/assets/resolver.ts` | glob 매칭, `ResolvedAsset[]` 생성 |
| **신규** `packages/core/src/assets/platform-parser.ts` | 내장 테이블, 자동 파싱 |
| **신규** `packages/core/src/assets/compressor.ts` | 압축 포맷 감지/적용 |
| **신규** `packages/core/src/assets/namer.ts` | name 템플릿 변수 치환 |
| **신규** `packages/core/src/assets/hasher.ts` | sha256 계산 |
| **신규** `packages/core/src/assets/pipeline.ts` | 파이프라인 오케스트레이션 |
| `packages/core/src/tasks/github-release.ts` | 바이너리 탐색/압축/해싱 제거, `PreparedAsset[]` 받아서 업로드만 |
| `packages/core/src/tasks/runner.ts` | `runAssetPipeline` → `createGitHubRelease` 순서로 호출 변경 |
| `packages/core/src/plugin/types.ts` | `AssetPipelineHooks` 추가, `PluginHooks` 확장 |
| `packages/core/src/plugin/runner.ts` | asset pipeline hook 실행 로직 추가 |
| `packages/core/src/config/types.ts` | `PubmConfig`, `ResolvedPubmConfig`에 `releaseAssets` 필드 추가 |
| `packages/core/src/context.ts` | `PubmContext.runtime`에 `tempDir` 필드 추가 |
| `packages/core/src/index.ts` | `assets/` 모듈 export |
| `packages/plugins/plugin-brew/src/formula.ts` | `mapReleaseAssets` 제거, `matchAssetToPlatform` 추가 |
| `packages/plugins/plugin-brew/src/brew-tap.ts` | platform 객체 기반 매칭으로 변경 |
| `packages/plugins/plugin-brew/src/brew-core.ts` | 동일 |
| `packages/plugins/plugin-brew/src/types.ts` | `assetPlatforms` 옵션 추가 |

---

## 7. Website Docs 계획

### 7.1 기존 문서 수정

| 파일 | 수정 내용 |
|---|---|
| `reference/sdk.mdx` | `ReleaseContext`, `ReleaseAsset`, `ParsedPlatform` 타입 정의 추가. `PreparedAsset`, `TransformedAsset` 등 파이프라인 타입 문서화 |
| `reference/plugins.mdx` | `afterRelease` hook 설명 확장. asset pipeline hooks 6종 (`resolveAssets`, `transformAsset`, `compressAsset`, `nameAsset`, `generateChecksums`, `uploadAssets`) 전체 문서화 |
| `reference/official-plugins.mdx` | brew 플러그인 섹션 — `assetPlatforms` 옵션 설명 추가, sha256/url 처리 방식을 새 구조 기반으로 갱신 |
| `guides/configuration.mdx` | `releaseAssets` config 필드 설명 추가 — string/object 형태, `files`, `compress`, `name`, `packagePath` |
| `guides/ci-cd.mdx` | GitHub Release asset 처리 관련 내용 추가 — CI에서 `releaseAssets` 설정, `GITHUB_TOKEN` 요구 사항 |

### 7.2 신규 문서

| 파일 | 내용 |
|---|---|
| `guides/release-assets.mdx` | 개념 가이드 — 왜 release assets인지, 기본 사용법, 유즈케이스별 예제 (CLI 바이너리, 데스크톱 앱, WASM, 네이티브 바인딩 등) |
| `reference/platform-detection.mdx` | 내장 OS/Arch/ABI/Variant 테이블 전체 목록, 자동 파싱 로직, path 캡처 변수 설명 |
| `guides/asset-pipeline-hooks.mdx` | 플러그인 개발자용 — 각 hook의 타이밍, 입출력 타입, 예제 (코드 사이닝, checksums.txt 생성, S3 업로드 등) |

### 7.3 영어만 작성

다국어 번역은 포함하지 않는다. `website/src/content/docs/` (영어 기본) 경로에만 작성.

---

## 8. 테스트 계획

각 모듈별 unit test:

| 모듈 | 테스트 항목 |
|---|---|
| `resolver` | glob 매칭, string/object config 정규화, packagePath 연결 |
| `platform-parser` | 모든 OS/Arch/ABI/Variant 테이블 매칭, 캡처 변수 추출, 알 수 없는 토큰 무시 |
| `compressor` | 자동 감지 (아카이브 → skip, raw → tar.gz), 포맷별 압축, compress: false |
| `namer` | 템플릿 변수 치환, 확장자 자동 부여, 미지정 시 기본값 |
| `hasher` | sha256 계산 정확성 |
| `pipeline` | hook 실행 순서, hook 미지정 시 기본 동작, hook에서 asset 추가/제거 |
| `github-release` | PreparedAsset 업로드, 에러 처리 (기존 테스트 리팩터링) |
| brew plugin | `matchAssetToPlatform` 기본 매칭, 커스텀 predicate, formula 업데이트 |
