# Workspace Protocol Resolution Design

## Problem

pubm은 `npm publish`를 사용하여 npm 레지스트리에 배포하지만, `workspace:*` 프로토콜은 bun/pnpm/yarn 전용이다. npm은 이 프로토콜을 이해하지 못하므로, 배포된 package.json에 `workspace:*`가 그대로 남는다.

## Solution

publish 직전에 `workspace:` 프로토콜을 실제 버전으로 치환하고, publish 후 복원한다.

## Workspace Protocol Resolution Rules

pnpm/yarn/bun 공통 스펙을 따른다. sibling 패키지의 실제 버전이 `1.5.0`일 때:

| Input | Output | Description |
|-------|--------|-------------|
| `workspace:*` | `1.5.0` | 현재 버전 그대로 |
| `workspace:^` | `^1.5.0` | caret + 현재 버전 |
| `workspace:~` | `~1.5.0` | tilde + 현재 버전 |
| `workspace:^1.2.0` | `^1.2.0` | 접두사만 제거 |
| `workspace:~1.2.0` | `~1.2.0` | 접두사만 제거 |
| `workspace:1.2.0` | `1.2.0` | 접두사만 제거 |

핵심 구분: `workspace:^`는 **동적** (sibling의 현재 버전 사용), `workspace:^1.0.0`는 **정적** (접두사만 제거).

`file:` 프로토콜은 처리하지 않는다. 어떤 패키지 매니저도 publish 시 `file:`을 자동 치환하지 않는다.

## Architecture

### Publish Flow

```
version bump + commit + tag
  → beforePublish hooks
  → resolveWorkspaceProtocols()   // 모든 대상 패키지의 package.json 치환
  → concurrent publish tasks
  → restoreWorkspaceProtocols()   // 복원 (finally로 보장)
  → afterPublish hooks
```

치환/복원을 Publishing 상위 task에서 한 번에 처리한다. 개별 publish task에서 하면 concurrent 실행 시 race condition이 발생하기 때문이다.

복원은 afterPublish hooks 전에 완료된다. afterPublish hooks는 원본(workspace:*) 상태의 package.json을 본다.

dry-run (`--preflight`) 모드에서도 동일하게 적용한다. `npm publish --dry-run`도 `workspace:*`를 이해하지 못하기 때문이다.

### Workspace Version Map 구축

`ctx.config.packages`가 아닌 **cwd 기반 모노레포 탐색**으로 전체 워크스페이스 패키지의 `name → version` 맵을 구축한다.

이유: `workspace:*`가 참조하는 패키지가 pubm 배포 대상이 아닐 수 있다.

```typescript
// 모노레포 내 모든 워크스페이스 패키지의 name → version 맵
function collectWorkspaceVersions(cwd: string): Map<string, string>
```

기존 `detectWorkspace()` + `resolvePatterns()`를 재사용하여 워크스페이스 패키지 경로를 탐색하고, 각 package.json에서 name과 version만 읽는다. `discoverPackages()`는 ecosystem 감지, private 필터링 등 불필요한 작업이 포함되어 있으므로 재사용하지 않는다.

**단일 패키지(비모노레포) 케이스**: `detectWorkspace()`가 빈 배열을 반환하면 workspace protocol resolution을 스킵한다. 워크스페이스가 없으면 `workspace:` 프로토콜 자체가 유효하지 않다.

### 스캔 대상 필드

- `dependencies`
- `devDependencies`
- `optionalDependencies`
- `peerDependencies`

`devDependencies`는 소비자가 설치하지 않지만, 배포된 package.json에 필드 자체는 포함된다. pnpm/yarn/bun 모두 devDependencies의 workspace 프로토콜도 치환한다.

`bundledDependencies`는 대상 외 — 패키지 이름 배열이지 버전 스펙이 아니다.

### 치환 함수

```typescript
function resolveWorkspaceProtocol(spec: string, version: string): string
```

- `workspace:*` → `{version}`
- `workspace:^` → `^{version}`
- `workspace:~` → `~{version}`
- `workspace:{anything}` → `{anything}` (접두사만 제거)

### 에러 처리

- **워크스페이스 맵에 없는 패키지 참조**: `workspace:*` 또는 `workspace:^` 등 동적 치환이 필요한데 sibling 버전을 찾을 수 없으면 에러를 throw한다. pnpm과 동일한 동작.
- **정적 치환** (`workspace:^1.0.0`): sibling 버전 조회가 불필요하므로 맵에 없어도 접두사만 제거한다.
- **매니페스트 읽기 실패**: `collectWorkspaceVersions()`에서 package.json이 없거나 name/version이 누락된 디렉토리는 무시한다 (워크스페이스 패턴이 빈 디렉토리를 매칭할 수 있음).

### 복원 전략

수정 전 원본 package.json 내용을 메모리에 보관하고, publish 후 원본으로 덮어쓴다. `git checkout`이 아닌 직접 복원 — version bump된 상태를 유지해야 하기 때문이다.

### 구현 위치

- `packages/core/src/monorepo/resolve-workspace.ts` — `resolveWorkspaceProtocol()`, `collectWorkspaceVersions()`
- `packages/core/src/monorepo/discover.ts` — `resolvePatterns()`를 export로 변경
- `packages/core/src/tasks/runner.ts` — Publishing task에서 치환/복원 호출

### 대상 매니페스트

- `package.json` (npm)

jsr.json은 대상 외 — import map 형식을 사용하며 `workspace:` 프로토콜이 적용되지 않는다.

## Scope

- workspace protocol resolution + 복원 메커니즘
- 추후 API-first 전환 시 `prepareManifest()` 확장 포인트로 활용 가능
