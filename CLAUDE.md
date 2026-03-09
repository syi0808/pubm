# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

pubm is a CLI tool for publishing packages to multiple registries (npm, jsr, and private registries) simultaneously. It supports interactive prompts (TTY) and CI environments, with automatic rollback on failure.

## Commands

```bash
bun run build          # Build SDK (dist/) + cross-compiled platform binaries (npm/)
bun run check          # Lint and format check with Biome
bun run format         # Auto-fix lint and formatting issues
bun run typecheck      # TypeScript type checking (tsc --noEmit)
bun run test           # Run tests with Vitest
bun run coverage       # Run tests with coverage report
```

Run a single test file:
```bash
bun vitest --run tests/unit/utils/rollback.test.ts
```

Tests live in `tests/unit/` and `tests/e2e/`. Coverage thresholds are strict (95% lines/functions/statements, 90% branches). Tests run in `forks` pool with 30s timeout.

## Architecture

### Core Flow (`src/tasks/runner.ts`)

The publish pipeline runs as an ordered task chain using listr2:

1. **Prerequisites check** — validates branch, remote status, working tree
2. **Required conditions check** — pings registries, validates login/permissions
3. **Version/tag prompts** — interactive prompts (skipped in CI/non-TTY)
4. **Test & Build** — runs configured npm scripts
5. **Version bump** — updates package.json/jsr.json, creates git commit + tag
6. **Publish** — publishes concurrently to all configured registries
7. **Post-publish** — pushes tags, creates GitHub release draft
8. **Rollback on failure** — auto-reverses git operations if publish fails

A shared `Ctx` context object flows through all tasks.

### Ecosystem Abstraction (`src/ecosystem/`)

`Ecosystem` is the abstract base class for language-specific behavior. Implementations:
- `JsEcosystem` — JavaScript/TypeScript packages (npm, jsr registries)
- `RustEcosystem` — Rust crates (crates.io registry)

Auto-detection picks the ecosystem from registry config or manifest files (package.json, Cargo.toml).

### Registry Abstraction (`src/registry/`)

`Registry` is the abstract base class. Concrete implementations:
- `NpmRegistry` — npm CLI wrapper, OTP support, provenance in CI
- `JsrRegistry` — JSR API integration, encrypted token storage via `Db` class

### Key Modules

- `src/cli.ts` — CLI entry point using CAC framework
- `src/index.ts` — Programmatic API export
- `src/options.ts` — Resolves CLI flags into normalized options
- `src/git.ts` — Git operations wrapper (branch, tag, commit, push)
- `src/commands/` — Subcommands: `add`, `init`, `migrate`, `pre`, `secrets`, `snapshot`, `status`, `update`, `version-cmd`
- `src/changeset/` — Changeset management (parsing, reading, writing, versioning, changelog generation)
- `src/monorepo/` — Workspace discovery, dependency graph, package grouping
- `src/validate/` — Pre-publish validation (entry points, extraneous files)
- `src/prerelease/` — Pre-release and snapshot version handling
- `src/utils/db.ts` — AES-256-CBC encrypted token storage in `~/.pubm/`
- `src/utils/exec.ts` — Bun.spawn wrapper for running shell commands
- `src/utils/open-url.ts` — Cross-platform URL opener
- `src/utils/spawn-interactive.ts` — Interactive process spawning (TTY passthrough)
- `src/utils/rollback.ts` — Tracks and reverses git operations on failure
- `src/utils/package.ts` — Reads/caches package.json and jsr.json, version replacement

### Build Configuration

`build.ts` uses Bun's bundler API to produce:
- Library: `src/index.ts` → `dist/` (ESM + CJS + types)
- CLI: Cross-compiled single binaries for all platforms → `npm/@pubm-*/bin/`
- `bin/cli.js` is a static wrapper that delegates to the platform-specific binary (not a build output)

`listr2` is bundled to avoid dependency issues. Note: `listr2` has a patch applied (`patches/listr2.patch`).

## Pre-commit Checklist

Before committing, always run these checks in order and fix any failures:

1. `bun run format` — auto-fix lint and formatting issues
2. `bun run typecheck` — ensure no type errors
3. `bun run test` — ensure all tests pass

Only commit after all three pass.

## Code Style

- **Formatter/Linter**: Biome with recommended rules
- **Indentation**: 2 spaces, single quotes
- **Package manager**: bun
- **Module system**: ESM (`"type": "module"`)
- **TypeScript**: Strict mode, target ES2020, bundler module resolution
