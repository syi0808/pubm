# Bun Migration Design

## Goal

Migrate pubm from Node.js/pnpm/tsup to Bun for single binary distribution while maintaining the npm library package.

## Deliverables

- CLI: single binary per platform via `bun build --compile`
- Library: ESM/CJS npm package (SDK only, no CLI)
- Distribution: GitHub Releases (binaries) + npm (SDK + platform binary packages)

## Design

### 1. Package Manager (pnpm -> bun)

- Remove `pnpm-lock.yaml`, generate `bun.lockb`
- Update `packageManager` field in `package.json`
- Replace `pnpm` references in scripts with `bun`
- Migrate `pnpm.patchedDependencies` to bun's patch mechanism (`patches/` auto-recognized)
- Update CI workflows: pnpm setup -> bun setup

### 2. Build System (tsup -> bun build)

**Library** (`src/index.ts`):
- `bun build src/index.ts` for ESM/CJS bundles
- `tsc --declaration --emitDeclarationOnly` for `.d.ts` (bun build does not support dts)

**CLI** (`src/cli.ts`):
- `bun build --compile src/cli.ts --target=<platform>` per platform
- No `bin/cli.js` output; CLI is always the compiled binary

**Bundle listr2** into the output (currently `noExternal: ["listr2"]` in tsup).

Remove `tsup` from devDependencies.

### 3. Process Spawning (tinyexec/cross-spawn -> Bun.spawn)

Create a thin wrapper around `Bun.spawn()` that mirrors tinyexec's interface (stdout/stderr capture, throwOnError).

- `tinyexec` -> wrapper using `Bun.spawn()`
- `cross-spawn` (npm login TTY) -> `Bun.spawn()` with `stdin: "inherit"`
- `@npmcli/promise-spawn` (URL opening) -> platform-specific `Bun.spawn(["open"|"xdg-open"|"start", url])`

Remove all three from dependencies.

### 4. Keyring Removal

- Remove `@napi-rs/keyring` dependency
- Use `Db` class (AES-256-CBC encrypted file storage) exclusively
- Keyring support may be revisited as a separate bun-native package later

### 5. Single Binary Build & Distribution

**Targets**:
- `bun-linux-x64`, `bun-linux-arm64`
- `bun-darwin-x64`, `bun-darwin-arm64`
- `bun-windows-x64`

**GitHub Releases**:
- CI builds platform binaries on tag push
- Upload to GitHub Release

**npm distribution** (esbuild/turbo pattern):
- `pubm`: SDK only (library, ESM/CJS + types)
- `@pubm/darwin-arm64`, `@pubm/linux-x64`, etc.: platform binary packages as optional dependencies
- `pubm`의 `bin` field는 platform package가 설치한 바이너리를 가리킴
- CLI = 항상 단일 바이너리, Node.js fallback 없음

### 6. Testing

- Vitest retained, runs on Bun
- Existing test suite validates each migration step
- listr2 kept as-is; replace only if Bun compatibility issues arise

## Migration Order

1. pnpm -> bun (package manager)
2. tsup -> bun build (build system)
3. tinyexec/cross-spawn/@npmcli/promise-spawn -> Bun.spawn()
4. @napi-rs/keyring -> Db class only
5. `bun build --compile` + binary distribution setup

Each step is independently testable and rollbackable.
