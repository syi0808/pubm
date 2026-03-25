# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

pubm is a CLI tool for publishing packages to multiple registries (npm, jsr, and private registries) simultaneously. It supports interactive prompts (TTY) and CI environments, with automatic rollback on failure.

This repository is a monorepo managed with Turborepo and Bun workspaces.

## Repository Layout

```
packages/
  core/                            — @pubm/core: Core SDK (ecosystem, registry, changeset, monorepo, plugin, config, tasks, validate, prerelease, git, utils)
  pubm/                            — pubm: CLI using Commander, depends on @pubm/core
    platforms/                     — Cross-platform binaries
  plugins/
    plugin-brew/                   — @pubm/plugin-brew: Homebrew formula publishing
    plugin-external-version-sync/  — @pubm/plugin-external-version-sync: Syncs version to external files
plugins/
  pubm-plugin/                     — Claude Code plugin (skills for publish, setup, version-sync, etc.)
website/                           — Astro-based documentation site
docs/                              — Planning documents and strategy docs
Formula/                           — Homebrew formula
patches/                           — Dependency patches (listr2)
```

## Commands

Run from the repo root (Turborepo fans out to all packages):

```bash
bun run build          # Build all packages (via turbo)
bun run check          # Lint and format check (via turbo)
bun run format         # Auto-fix lint and formatting issues (biome check --write)
bun run typecheck      # TypeScript type checking (via turbo)
bun run test           # Run all tests (via turbo)
bun run coverage       # Run tests with coverage (via turbo)
bun run dev:site       # Start Astro documentation dev server
bun run build:site     # Build static documentation site
bun run release        # Release with preflight checks
bun run release:ci     # Release in CI environment
bun run changesets:add # Add changesets (via pubm)
```

Run a single test file (within a package):
```bash
cd packages/core && bun vitest --run tests/unit/utils/rollback.test.ts
```

Tests live in `tests/unit/` and `tests/e2e/` within each package. Coverage thresholds are strict (95% lines/functions/statements, 90% branches). Tests run in `forks` pool with 30s timeout.

## Architecture

> See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation including diagrams, design patterns, and module organization.
>
> ARCHITECTURE.md is large. Do NOT read the entire file. Instead, use a **subagent(haiku)** to read and summarize only the relevant section. Example:
> ```
> Agent(model: "haiku", prompt: "Read ARCHITECTURE.md and summarize the Registry Abstraction section. Focus on ...")
> ```

## Pre-commit Checklist

Before committing, always run these checks in order and fix any failures:

1. `bun run format` — auto-fix lint and formatting issues
2. `bun run typecheck` — ensure no type errors
3. `bun run test` — ensure all tests pass
4. `bun run coverage` — ensure coverage thresholds are not decreased

Only commit after all four pass.

## Coverage Maintenance

Coverage thresholds are enforced per-package in `vitest.config.mts`. **Never lower thresholds.**

- Every new source file must have a corresponding test file in `tests/unit/`
- New code must not decrease coverage — run `bun run coverage` before committing
- Use `/* istanbul ignore next */` sparingly — only for genuinely untestable code (compile-time constants, exhaustiveness guards). Always include a reason comment
- When modifying a file below threshold, add tests to bring it up

## Changeset Workflow

After completing a bug fix or feature addition, create a changeset to document the change:

```bash
bun run changesets:add --packages <package-path> --bump <patch|minor|major> --message "description of the change"
```

- `patch` — bug fixes, minor corrections
- `minor` — new features, non-breaking additions
- `major` — breaking changes

Changesets are required for any user-facing change. Do not commit without adding a changeset when applicable.

### Changeset rules

- **Identifier**: Use the package's filesystem path (e.g., `packages/core`), not the registry name. Package names are also accepted and auto-resolved to paths.
- **Message**: Write in English, from the user's perspective. Describe what changed, not how it was implemented internally.
- **Scope**: Only document user-facing changes. Internal refactors without behavioral impact do not need a changeset.

## Documentation Maintenance

The following documentation must be kept in sync with code changes. When modifying features, CLI commands, configuration options, or plugin APIs, update all affected documents.

### Website Documentation (`website/src/content/docs/`)

English (`docs/`) is the source of truth. Translations must be updated in parallel.

**Guides:**
- `guides/quick-start.mdx` — Getting started guide
- `guides/configuration.mdx` — Configuration options reference
- `guides/changesets.mdx` — Changeset workflow
- `guides/monorepo.mdx` — Monorepo support
- `guides/ci-cd.mdx` — CI/CD integration
- `guides/coding-agents.mdx` — AI coding agent usage
- `guides/troubleshooting.mdx` — Common issues and solutions
- `guides/asset-pipeline-hooks.mdx` — Asset pipeline hooks
- `guides/release-assets.mdx` — Release asset management

**Reference:**
- `reference/cli.mdx` — CLI command reference
- `reference/sdk.mdx` — Programmatic SDK API
- `reference/plugins.mdx` — Plugin authoring guide
- `reference/official-plugins.mdx` — Official plugins documentation
- `reference/platform-detection.mdx` — Platform detection behavior

**Supported languages:** `en` (default), `fr`, `es`, `de`, `zh-cn`, `ko`

### Claude Code Plugin Skills (`plugins/pubm-plugin/skills/`)

- `publish-setup/SKILL.md` — Publish setup wizard skill
  - `references/config-examples.md`, `references/ci-templates.md` — Config and CI examples
  - `references/registry-npm.md`, `references/registry-jsr.md`, `references/registry-crates.md` — Registry-specific references
- `create-plugin/SKILL.md` — Plugin creation wizard skill
  - `references/plugin-api.md` — Plugin API reference

### Documentation Update Rules

- **New CLI command or option** → update `reference/cli.mdx` and `README.md`
- **New configuration option** → update `guides/configuration.mdx` and relevant guide pages
- **New plugin or plugin API change** → update `reference/plugins.mdx`, `reference/official-plugins.mdx`, and `create-plugin/references/plugin-api.md`
- **Registry behavior change** → update relevant `registry-*.md` reference files and `guides/quick-start.mdx`
- **Translation** → all 6 language directories must have the same set of files; when adding a new page, add it to all locales

## Code Style

- **Module system**: ESM (`"type": "module"`)
- **TypeScript**: Strict mode, target ES2020, bundler module resolution
- **Path handling**: Always use `node:path` (`join`, `resolve`, `relative`, `dirname`, etc.) for path construction — never concatenate strings with `/`. When a path will appear in config files, user-facing output, or test assertions (not direct filesystem operations), normalize to forward slashes with `.replace(/\\/g, "/")`. In tests, build expected paths with `path.join()` rather than hardcoding separators.
