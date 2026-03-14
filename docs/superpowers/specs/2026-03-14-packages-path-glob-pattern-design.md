# Packages Path Glob Pattern Support

## Summary

`pubm.config.ts`의 `packages[].path`에 glob 패턴을 지원하여, 새 패키지 추가 시 config 수정 없이 자동으로 인식되도록 한다.

## Usage Example

```typescript
export default defineConfig({
  packages: [
    { path: "packages/plugins/*", registries: ["npm", "jsr"] },
    { path: "packages/core" },
  ],
});
```

`packages/plugins/*`는 하위 모든 패키지 디렉토리로 확장되며, `registries` 등 옵션은 매칭된 모든 패키지에 동일하게 적용된다.

## Design

### Approach

`resolveConfig()` → `discoverPackages()`의 기존 흐름에서, `configPackages`를 처리하는 지점(discover.ts 169-181줄)에 glob 확장 로직을 추가한다.

### Changes

#### `packages/core/src/monorepo/discover.ts`

`discoverPackages()` 함수에서 `configPackages`를 `DiscoverTarget[]`으로 변환할 때:

1. `isGlobPattern(path)`로 glob 문자 포함 여부 판별 (micromatch `scan()` 활용)
2. glob이면 기존 `resolvePatterns(cwd, [path])`로 디렉토리 확장
3. 확장된 각 디렉토리에 원본 config의 옵션(`registries`, `ecosystem`, `buildCommand`, `testCommand`)을 복제
4. `.map()` → `.flatMap()`으로 변경

```typescript
const targets: DiscoverTarget[] = configPackages.flatMap((pkg) => {
  if (isGlobPattern(pkg.path)) {
    const resolved = resolvePatterns(cwd, [pkg.path]);
    return resolved.map((absPath) => ({
      path: path.relative(cwd, absPath),
      ecosystem: pkg.ecosystem,
      registries: pkg.registries as RegistryType[] | undefined,
    }));
  }
  return {
    path: path.normalize(pkg.path),
    ecosystem: pkg.ecosystem,
    registries: pkg.registries as RegistryType[] | undefined,
  };
});
```

Private 패키지 필터링은 `resolvePackage()` 내부에서 `manifest.private` 체크(139줄)로 이미 처리되므로 추가 작업 불필요.

### What Does NOT Change

- **Types** (`config/types.ts`): `PackageConfig.path`는 `string`이므로 glob 문자열 수용 가능. 변경 없음.
- **Config loading** (`config/loader.ts`): 변경 없음.
- **Config resolution** (`config/defaults.ts`): 변경 없음.
- **Downstream code** (grouping, task runner 등): 확장된 `PackageConfig[]`을 받으므로 변경 없음.

## Test Plan

`packages/core/tests/unit/monorepo/discover.test.ts`에 테스트 추가:

1. **Glob pattern expansion** — `packages/*` 패턴이 하위 패키지들로 확장되는지
2. **Option propagation** — 패턴에 지정한 `registries`, `ecosystem`이 매칭된 모든 패키지에 적용되는지
3. **Private package filtering** — glob 매칭된 `private: true` 패키지가 제외되는지
4. **Mixed glob and explicit paths** — glob과 명시적 경로 혼합 config 정상 동작
5. **No matches** — 매칭 디렉토리가 없을 때 빈 배열 반환
