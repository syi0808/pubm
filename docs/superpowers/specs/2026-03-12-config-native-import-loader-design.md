# Native Import Config Loader Design

## Goal

Load `pubm.config.*` with a native `import()` path first so compiled single-binary builds can resolve project dependencies through Bun's package.json autoloading, while preserving the current bundled fallback for cases native loading cannot handle.

## Approach

`loadConfig()` will become a staged loader:

1. Resolve the config file path.
2. Attempt a native `import()` of the source config file.
3. If native import fails, build the config with Bun and execute the bundled ESM output through a temporary file import.
4. If bundled ESM import fails, rebuild as bundled CJS and execute it inside `node:vm` with an injected CommonJS runtime.

The native path is the preferred path because it preserves the project's real module graph and avoids the bundler resolving optional dependencies too early.

## Components

### Native config import

- Add a helper that imports `pubm.config.*` directly from disk with a cache-busting query string.
- Return `default ?? namespace` to preserve the current config contract.

### Bundled fallback

- Keep the current Bun bundling logic, optional dependency handling, and shim behavior.
- Parameterize the bundler by output format so the same path can produce either ESM or CJS.

### VM fallback

- Only used after native import and bundled ESM import both fail.
- Execute bundled CJS in `node:vm` with `module`, `exports`, `require`, `__filename`, and `__dirname`.
- Treat this as a compatibility escape hatch, not the primary execution model.

## Error handling

- Preserve the original native import error and append fallback failures so the final message shows which stage failed.
- Do not silently swallow all errors; only move to the next stage after capturing context.

## Testing

- Add a real-behavior test proving `loadConfig()` now prefers native import by loading a config that reads real exports from `vitest/config`.
- Add a focused unit test for the VM executor using bundled CJS source, so the limited VM fallback has direct coverage even if the end-to-end path is hard to trigger in source Bun.
