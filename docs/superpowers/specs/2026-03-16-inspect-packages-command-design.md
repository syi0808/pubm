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

export async function inspectPackages(cwd?: string): Promise<InspectPackagesResult>
```

**내부 구현:**

1. `loadConfig(cwd)`로 사용자 config 파일 로드 (없으면 빈 config)
2. `resolveConfig(rawConfig, cwd)`로 패키지 발견 + 레지스트리 추론
3. `detectWorkspace(cwd)`로 워크스페이스 타입 확인
4. `ResolvedPubmConfig`의 `packages` 배열에서 필요한 필드만 추출하여 `InspectPackagesResult`로 매핑

`ecosystem` 값은 발견된 패키지들의 ecosystem에서 추출한다. 모든 패키지가 동일한 ecosystem이면 그 값을 사용하고, 혼합된 경우는 발견된 ecosystem들을 콤마로 연결한다.

`workspace.type`은 `detectWorkspace()` 결과의 워크스페이스 매니페스트 타입 (pnpm, npm, bun, cargo, deno). 워크스페이스가 없으면 `"single"`.

`workspace.monorepo`는 패키지가 2개 이상이면 `true`.

`path`는 cwd 기준 상대 경로. 싱글 패키지인 경우 `"."`

#### Export 추가: `packages/core/src/index.ts`

```typescript
export { inspectPackages } from './inspect.js'
export type { InspectPackagesResult } from './inspect.js'
```

### 2. CLI — `inspect` 서브커맨드 그룹

#### 새 파일: `packages/cli/src/commands/inspect.ts`

```typescript
export function registerInspectCommand(parent: Command): void
```

- `parent.command("inspect")` — 서브커맨드 그룹 등록
- `inspect.command("packages")` — packages 서브커맨드
  - `--json` 옵션: JSON 출력
  - action에서 `inspectPackages(cwd)`를 호출하고 결과를 포맷팅

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

#### 커맨드 등록: `packages/cli/src/cli.ts`

기존 커맨드 등록 패턴을 따라 `registerInspectCommand(program)` 추가.

### 3. 테스트

#### `packages/core/tests/unit/inspect.test.ts`

- **싱글 패키지 프로젝트**: ecosystem, workspace.type="single", monorepo=false, 패키지 1개 반환 확인
- **모노레포 프로젝트**: workspace.type 올바른지, monorepo=true, 여러 패키지와 각각의 레지스트리 확인
- **config 오버라이드**: pubm.config.ts로 레지스트리를 오버라이드한 경우 최종 결과에 반영되는지 확인

내부 의존성(`loadConfig`, `resolveConfig`, `detectWorkspace`)은 mock하여 단위 테스트로 작성.

## 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `packages/core/src/inspect.ts` | 새 파일 — `inspectPackages()` 함수 |
| `packages/core/src/index.ts` | export 추가 |
| `packages/cli/src/commands/inspect.ts` | 새 파일 — CLI 커맨드 |
| `packages/cli/src/cli.ts` | 커맨드 등록 추가 |
| `packages/core/tests/unit/inspect.test.ts` | 새 파일 — 단위 테스트 |
