# Preflight Mode Design

## Overview

`pubm --preflight` simulates CI publishing locally by running the full pipeline with `promptEnabled=false` and token-based authentication, replacing the actual publish step with dry-run. Catches authentication, 2FA, packaging, and configuration errors before they fail in CI.

## CLI Interface

```
pubm --preflight                         # interactive token collection + CI simulation
pubm --preflight --registry npm,crates   # specific registries only
pubm --preflight --no-tests              # skip tests during preflight
pubm secrets sync                        # sync stored tokens to GitHub Secrets
pubm secrets sync --registry npm         # sync specific registry token only
```

`--preflight` combines with existing flags (`--no-tests`, `--no-build`, `--registry`, etc).

## Execution Flow

### Phase 1: Token Collection (interactive, runs before pipeline)

1. Resolve target registries from options
2. For each registry, check Db for existing token:
   - **Token exists** -> use it silently (no prompt)
   - **Token missing** -> prompt for input, save to Db
3. Prompt: "Sync tokens to GitHub Secrets?" -> if yes, run `gh secret set` for each token
4. Inject tokens into `process.env`

### Phase 2: CI Simulation (non-interactive pipeline)

Set `ctx.promptEnabled = false`, then run:

| Task | Runs? |
|------|-------|
| Prerequisites check | Yes |
| Required conditions check | Yes |
| Running tests | Yes (unless `--no-tests`) |
| Building the project | Yes (unless `--no-build`) |
| Dry-run publish | Yes (replaces actual publish) |
| Bumping version | Skip |
| Publishing | Skip (replaced by dry-run) |
| Pushing tags | Skip |
| Creating release draft | Skip |

### Token Error Recovery

If dry-run publish fails with an authentication/token error:
1. Prompt user to re-enter the token for the failed registry
2. Update Db with new token
3. Re-inject into `process.env`
4. Retry the dry-run publish

## Token Storage

### Mapping

| Registry | Env Variable | Db Key | GH Secret Name |
|----------|-------------|--------|----------------|
| npm | `NODE_AUTH_TOKEN` | `npm-token` | `NODE_AUTH_TOKEN` |
| jsr | `JSR_TOKEN` | `jsr-token` (existing) | `JSR_TOKEN` |
| crates | `CARGO_REGISTRY_TOKEN` | `cargo-token` | `CARGO_REGISTRY_TOKEN` |

### Storage mechanism

Reuses existing `Db` class (AES-256-CBC encrypted, stored in `.pubm/` directory).

## Dry-Run Implementation

Each registry class gets a `dryRunPublish(manifestDir?: string): Promise<void>` method:

- **npm**: `npm publish --dry-run`
- **jsr**: `jsr publish --dry-run --allow-dirty`
- **crates**: `cargo publish --dry-run [--manifest-path ...]`

Base `Registry` class provides a default no-op implementation.

## `pubm secrets sync` Command

Standalone subcommand that syncs stored tokens (from Db) to GitHub Secrets.

- Uses `gh secret set <NAME> --body <TOKEN>` for each registry token
- Requires `gh` CLI to be installed and authenticated
- If `gh` is not available, shows manual setup instructions
- `--registry` flag filters which tokens to sync

## File Changes

1. `src/types/options.ts` - Add `preflight?: boolean`
2. `src/cli.ts` - Add `--preflight` flag, preflight branch in action handler
3. `src/registry/registry.ts` - Add `dryRunPublish()` method (default no-op)
4. `src/registry/npm.ts` - Implement `dryRunPublish()`
5. `src/registry/jsr.ts` - Implement `dryRunPublish()`
6. `src/registry/crates.ts` - Implement `dryRunPublish()`
7. `src/tasks/dry-run-publish.ts` - Dry-run publish tasks (new file)
8. `src/tasks/preflight.ts` - Token collection + GH Secrets prompt tasks (new file)
9. `src/tasks/runner.ts` - Preflight mode branch (dry-run instead of publish, skip bump/push/release)
10. `src/commands/secrets.ts` - `pubm secrets sync` command (new file)
11. Test files for each change
