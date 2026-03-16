# Inspect Packages Command Design

## Context

publish-setup 스킬에서 `pubm inspect packages`를 사용하여 프로젝트의 감지된 패키지와 레지스트리 정보를 사용자에게 보여주지만, 이 커맨드가 아직 구현되어 있지 않다.

`inspect`는 서브커맨드 그룹으로 설계하여 향후 `inspect tokens`, `inspect config` 등으로 확장할 수 있게 하되, 현재는 `packages` 서브커맨드만 구현한다.

## Scope

- `pubm inspect packages` 커맨드 구현
- Core에 `inspectPackages()` 함수 추가 (프로그래매틱 API)
- 기본 출력은 사람이 읽기 좋은 텍스트, `--json` 옵션으로 JSON 출력 지원
- 출력 정보: 에코시스템, 워크스페이스 타입/모노레포 여부, 패키지 목록 (이름, 버전, 경로, 타겟 레지스트리)
- config 오버라이드가 있으면 최종 결과만 표시 (출처 구분 없음)

## Design

### 1. Core — `inspectPackages()` 함수

#### 새 파일: `packages/core/src/inspect.ts`

```typescript
export interface InspectPackagesResult {
  ecosystem: string
  workspace: {
    type: string
    monorepo: boolean
  }
  packages: Array<{
    name: string
    version: string
    path: string
    registries: string[]
  }>
}

export function inspectPackages(config: ResolvedPubmConfig, cwd: string): InspectPackagesResult
```

**시그니처 설계 근거:** CLI는 이미 부트스트랩 시점에 `loadConfig()` → `resolveConfig()`를 실행하여 `resolvedConfig`를 모듈 수준에서 보관한다. 다른 커맨드들도 이 pre-resolved config를 받아 사용하는 패턴이므로, `inspectPackages()`도 `ResolvedPubmConfig`를 인자로 받는다. config 로딩을 내부에서 중복 수행하지 않는다.

**내부 구현:**

1. `config.packages` 배열에서 필요한 필드(name, version, path, registries)를 추출
2. `detectWorkspace(cwd)`로 워크스페이스 타입 확인
3. `InspectPackagesResult`로 매핑

**ecosystem 추론:**
`config.packages`의 각 패키지에서 `ecosystem` 필드가 optional이므로, registries 기반으로 추론한다:
- registries에 `npm` 또는 `jsr`가 포함 → `"javascript"`
- registries에 `crates`가 포함 → `"rust"`
- 모든 패키지가 동일한 ecosystem이면 그 값을, 혼합이면 콤마로 연결 (예: `"javascript, rust"`)

**workspace.type:**
`detectWorkspace(cwd)`는 `WorkspaceInfo[]`를 반환한다. 첫 번째 요소의 `type`을 사용한다. 빈 배열이면 `"single"`.

**workspace.monorepo:**
`detectWorkspace()` 결과가 비어있지 않으면 `true` (워크스페이스 정의가 존재하는지로 판단). 이렇게 하면 워크스페이스에 패키지가 1개만 있어도 모노레포로 표시된다.

**path:** cwd 기준 상대 경로. 싱글 패키지인 경우 `"."`.

**registries:** `RegistryType`을 그대로 string으로 출력. custom registry는 URL 형태로 표시된다 (예: `"https://registry.example.com"`).

#### Export 추가: `packages/core/src/index.ts`

```typescript
export { inspectPackages } from './inspect.js'
export type { InspectPackagesResult } from './inspect.js'
```

### 2. CLI — `inspect` 서브커맨드 그룹

#### 새 파일: `packages/pubm/src/commands/inspect.ts`

```typescript
export function registerInspectCommand(
  parent: Command,
  getConfig: () => ResolvedPubmConfig,
): void
```

- `parent.command("inspect")` — 서브커맨드 그룹 등록
- `inspect.command("packages")` — packages 서브커맨드
  - `--json` 옵션: JSON 출력
  - action에서 `inspectPackages(getConfig(), cwd)`를 호출하고 결과를 포맷팅

**에러 처리:**
- config 해석 실패 시 CLI 부트스트랩에서 이미 처리되므로 inspect에서 별도 처리 불필요
- `config.discoveryEmpty`가 `true`인 경우 (발행 가능한 패키지가 없음): 텍스트 모드에서 `"No publishable packages found."` 메시지 출력, JSON 모드에서 빈 packages 배열 반환
- 텍스트 출력 중 오류 시 `consoleError()` + `process.exitCode = 1` (기존 커맨드 패턴)

#### 텍스트 출력 포맷

```
Ecosystem: javascript
Workspace: pnpm (monorepo)

Packages:
  @pubm/core (1.0.0) → npm, jsr
  pubm (1.0.0) → npm
```

싱글 패키지인 경우:

```
Ecosystem: javascript
Workspace: single

Packages:
  my-package (1.0.0) → npm
```

custom registry가 있는 경우:

```
Packages:
  my-package (1.0.0) → npm, https://registry.example.com
```

#### JSON 출력 포맷 (`--json`)

```json
{
  "ecosystem": "javascript",
  "workspace": {
    "type": "pnpm",
    "monorepo": true
  },
  "packages": [
    {
      "name": "@pubm/core",
      "version": "1.0.0",
      "path": "packages/core",
      "registries": ["npm", "jsr"]
    }
  ]
}
```

#### 커맨드 등록: `packages/pubm/src/cli.ts`

기존 커맨드 등록 패턴을 따라 `registerInspectCommand(program, () => resolvedConfig)` 추가.

### 3. 테스트

#### `packages/core/tests/unit/inspect.test.ts`

- **싱글 패키지 프로젝트**: ecosystem="javascript", workspace.type="single", monorepo=false, 패키지 1개 반환 확인
- **모노레포 프로젝트**: workspace.type 올바른지, monorepo=true, 여러 패키지와 각각의 레지스트리 확인
- **config 오버라이드**: config의 레지스트리 설정이 최종 결과에 반영되는지 확인
- **패키지 없음**: discoveryEmpty=true인 경우 빈 packages 배열 반환
- **ecosystem 추론**: npm/jsr → javascript, crates → rust, 혼합 → 콤마 연결

`detectWorkspace`는 mock하여 단위 테스트로 작성. `ResolvedPubmConfig`는 테스트 픽스처로 직접 구성.

## 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `packages/core/src/inspect.ts` | 새 파일 — `inspectPackages()` 함수 |
| `packages/core/src/index.ts` | export 추가 |
| `packages/pubm/src/commands/inspect.ts` | 새 파일 — CLI 커맨드 |
| `packages/pubm/src/cli.ts` | 커맨드 등록 추가 |
| `packages/core/tests/unit/inspect.test.ts` | 새 파일 — 단위 테스트 |
