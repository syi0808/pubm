# Ecosystem Descriptor & Changeset Path-Based Identification

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Changeset system, GitHub Release display

## Problem

npm과 jsr이 공존하는 패키지에서 changeset의 식별자로 package name을 쓸 때 어떤 레지스트리의 이름을 기준으로 해야 하는지 모호하다. npm name과 jsr name이 다를 수 있고, jsr-only 패키지도 존재할 수 있다.

또한 현재 changeset은 `release.name`에 package.json의 `name` 필드를 그대로 사용하는데, 이는 레지스트리 종속적이다.

## Solution

### 1. Changeset 식별자를 path 기반으로 전환

Changeset YAML 키를 filesystem path(monorepo root 기준 상대 경로)로 정규화한다. Path는 중복이 불가능한 유일한 식별자다.

**입력은 name과 path 모두 허용:**

```yaml
# name으로 작성 (기존 호환)
---
"@pubm/core": minor
---

# path로 작성
---
"packages/core": minor
---
```

**내부적으로는 항상 path로 정규화:**

파싱 시점에 name → path 변환을 수행한다. `ResolvedPubmConfig.packages`를 참조하여 `pkg.name === key`인 경우 `pkg.path`로 치환한다.

### 2. EcosystemDescriptor

레지스트리별 패키지 이름과 display 로직을 캡슐화하는 추상 클래스. 각 ecosystem 구현체가 자신의 레지스트리 우선순위에 따라 fallback을 처리한다.

```typescript
// packages/core/src/ecosystem/descriptor.ts

export abstract class EcosystemDescriptor {
  constructor(
    /** Canonical identifier — monorepo root 기준 상대 경로 */
    public readonly path: string,
  ) {}

  /** Primary display name (ecosystem별 fallback 로직) */
  abstract get displayName(): string;

  /** Full display label with secondary registry names */
  abstract get displayLabel(): string;
}
```

```typescript
// packages/core/src/ecosystem/js-descriptor.ts

export class JsEcosystemDescriptor extends EcosystemDescriptor {
  constructor(
    path: string,
    public readonly npmName?: string,
    public readonly jsrName?: string,
  ) {
    super(path);
  }

  get displayName(): string {
    return this.npmName ?? this.jsrName ?? this.path;
  }

  get displayLabel(): string {
    if (this.npmName && this.jsrName && this.npmName !== this.jsrName) {
      return `${this.npmName} (${this.jsrName})`;
    }
    return this.displayName;
  }
}
```

```typescript
// packages/core/src/ecosystem/rust-descriptor.ts

export class RustEcosystemDescriptor extends EcosystemDescriptor {
  constructor(
    path: string,
    public readonly cratesName?: string,
  ) {
    super(path);
  }

  get displayName(): string {
    return this.cratesName ?? this.path;
  }

  get displayLabel(): string {
    return this.displayName;
  }
}
```

**Display 결과 예시:**

| Descriptor | 입력 | displayName | displayLabel |
|---|---|---|---|
| `JsEcosystemDescriptor` | npm=`@pubm/core` | `@pubm/core` | `@pubm/core` |
| `JsEcosystemDescriptor` | npm=`@pubm/core`, jsr=`@pubm/core` | `@pubm/core` | `@pubm/core` |
| `JsEcosystemDescriptor` | npm=`@pubm/core`, jsr=`@jsr/pubm-core` | `@pubm/core` | `@pubm/core (@jsr/pubm-core)` |
| `JsEcosystemDescriptor` | jsr=`@jsr/pubm-core` | `@jsr/pubm-core` | `@jsr/pubm-core` |
| `RustEcosystemDescriptor` | crates=`pubm-core` | `pubm-core` | `pubm-core` |
| 어떤 구현체든 | 이름 없음 | `packages/core` | `packages/core` |

### 3. Scope

**변경 대상:**
- Changeset 파싱/쓰기 (`parser.ts`, `writer.ts`)
- Changeset 상태/버전 계산 (`status.ts`, `version.ts`) — Map 키를 path 기반으로
- `calculateVersionBumps` 및 호출자 (`required-missing-information.ts`) — path 기반 Map으로 전환
- Changelog 생성 (`changelog.ts`)
- GitHub Release 출력 (`github-release.ts`, `runner.ts`의 release 관련 부분)

**변경하지 않는 것:**
- Dependency graph (`dependency-graph.ts`, `groups.ts`) — 기존 name 기반 유지
- Registry 클래스 (`packageName` 속성) — 각 레지스트리의 실제 name 필요
- Git tags — 기존 태그 호환성 유지

## Detailed Design

### Release 타입 변경

```typescript
// Before
export interface Release {
  name: string;  // "@pubm/core"
  type: BumpType;
}

// After
export interface Release {
  path: string;  // "packages/core"
  type: BumpType;
}
```

### Changeset 파싱 — name/path 양방향 입력 지원

```typescript
// parser.ts
export function parseChangeset(
  content: string,
  fileName: string,
  resolveKey?: (key: string) => string, // name → path resolver
): Changeset {
  // ... 기존 파싱 로직 ...

  const releases: Release[] = [];
  if (parsed) {
    for (const [key, type] of Object.entries(parsed)) {
      const path = resolveKey ? resolveKey(key) : key;
      releases.push({ path, type: type as BumpType });
    }
  }

  return { id, summary, releases };
}
```

### Key Resolver

Config의 packages 목록을 기반으로 name ↔ path 변환:

```typescript
// changeset/resolve.ts
export function createKeyResolver(
  packages: ResolvedPackageConfig[],
): (key: string) => string {
  const nameToPath = new Map(packages.map((p) => [p.name, p.path]));
  const validPaths = new Set(packages.map((p) => p.path));

  return (key: string): string => {
    // key가 이미 유효한 path인 경우
    if (validPaths.has(key)) return key;

    // key가 name인 경우 path로 변환
    const resolved = nameToPath.get(key);
    if (resolved) return resolved;

    // 매칭 실패 — key를 그대로 반환 (에러 처리는 상위에서)
    return key;
  };
}
```

### Changeset 쓰기 — path로 기록

```typescript
// writer.ts
export function generateChangesetContent(
  releases: Release[],
  summary: string,
): string {
  let content = "---\n";
  if (releases.length > 0) {
    const yamlObj: Record<string, string> = {};
    for (const release of releases) {
      yamlObj[release.path] = release.type;  // path를 키로 사용
    }
    content += stringifyYaml(yamlObj);
  }
  content += "---\n";
  if (summary) content += `\n${summary}\n`;
  return content;
}
```

### EcosystemDescriptor 생성

각 Ecosystem 구현체가 자신의 descriptor를 생성하는 책임을 가진다.

```typescript
// ecosystem/ecosystem.ts (기존 추상 클래스에 추가)
abstract class Ecosystem {
  // ... 기존 메서드 ...
  abstract createDescriptor(): Promise<EcosystemDescriptor>;
}
```

```typescript
// ecosystem/js.ts
async createDescriptor(): Promise<EcosystemDescriptor> {
  const npmReader = NpmPackageRegistry.reader;
  const jsrReader = JsrPackageRegistry.reader;

  const npmName = await npmReader.exists(this.packagePath)
    ? (await npmReader.read(this.packagePath)).name
    : undefined;

  const jsrName = await jsrReader.exists(this.packagePath)
    ? (await jsrReader.read(this.packagePath)).name
    : undefined;

  return new JsEcosystemDescriptor(this.packagePath, npmName, jsrName);
}
```

```typescript
// ecosystem/rust.ts
async createDescriptor(): Promise<EcosystemDescriptor> {
  const reader = CratesPackageRegistry.reader;

  const cratesName = await reader.exists(this.packagePath)
    ? (await reader.read(this.packagePath)).name
    : undefined;

  return new RustEcosystemDescriptor(this.packagePath, cratesName);
}
```

### Changelog에서 Descriptor 사용

```typescript
// changelog.ts
export function buildChangelogEntries(
  changesets: Changeset[],
  packagePath: string,  // name 대신 path
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      if (release.path === packagePath) {
        entries.push({ summary: changeset.summary, type: release.type, id: changeset.id });
      }
    }
  }
  return entries;
}
```

### GitHub Release에서 Descriptor 사용

```typescript
// ReleaseContext.packageName 대신 descriptor 활용
const descriptor = descriptors.get(packagePath);
const releaseName = descriptor?.displayLabel ?? packagePath;
```

## Affected Files

| File | Change |
|---|---|
| `changeset/parser.ts` | `Release.name` → `Release.path`, `resolveKey` 파라미터 추가 |
| `changeset/writer.ts` | `release.name` → `release.path` |
| `changeset/version.ts` | `release.name` → `release.path`, Map 키 path 기반 |
| `changeset/status.ts` | `release.name` → `release.path`, Map 키 path 기반 |
| `changeset/changelog.ts` | `packageName` 파라미터 → `packagePath` |
| `changeset/resolve.ts` | 신규 — `createKeyResolver` |
| `tasks/required-missing-information.ts` | `currentVersions` Map 키를 `pkg.path`로, `bumps.get()`/`status.packages.get()` 조회를 path 기반으로 |
| `ecosystem/descriptor.ts` | 신규 — `EcosystemDescriptor` 추상 클래스 |
| `ecosystem/js-descriptor.ts` | 신규 — `JsEcosystemDescriptor` (npm/jsr fallback) |
| `ecosystem/rust-descriptor.ts` | 신규 — `RustEcosystemDescriptor` (crates fallback) |
| `ecosystem/ecosystem.ts` | `createDescriptor()` 추상 메서드 추가 |
| `ecosystem/js.ts` | `createDescriptor()` 구현 |
| `ecosystem/rust.ts` | `createDescriptor()` 구현 |
| `tasks/runner.ts` | GitHub Release 부분에서 descriptor 사용 |
| `tasks/github-release.ts` | `packageName` → descriptor.displayLabel |
| `assets/types.ts` | `ReleaseContext.packageName` → descriptor 기반 |
| `pubm/src/commands/add.ts` | CLI에서 name/path 양방향 입력 지원 |

## Migration

기존 changeset 파일(name 기반)은 `resolveKey`를 통해 자동 변환되므로 별도 마이그레이션 불필요. 새로 생성되는 changeset만 path 기반으로 기록된다.

## Testing

- name 입력 → path 정규화 검증
- path 입력 → 그대로 유지 검증
- jsr-only 패키지의 display name fallback 검증
- npm + jsr 이름 다른 경우 displayLabel 포맷 검증
- 기존 name 기반 changeset 파일의 하위 호환성 검증
