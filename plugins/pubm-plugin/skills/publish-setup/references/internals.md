# pubm Internals

Behavioral summary of pubm's internal mechanics. Use this to understand how pubm works when diagnosing issues or making setup recommendations.

## Release Pipeline

pubm executes phases in this order:

| Step | Phase | What happens |
|------|-------|-------------|
| Test | prepare | Runs test scripts defined in config or package manifest |
| Build | prepare | Runs build scripts defined in config or package manifest |
| Version | prepare | Bumps versions, writes changelogs, creates commit and tags |
| Dry-Run | prepare | Validates publish would succeed without actually publishing |
| Push | prepare | Pushes commit and tags to remote |
| Publish | publish | Publishes to all configured registries |
| Release | publish | Creates GitHub Releases with assets |

## Phases

### Direct Release vs Split CI Release

| Workflow | Command | What happens |
|---|---|---|
| **Direct Release** | `pubm` | Runs prepare and publish in one command |
| **Split CI Release** | `pubm --phase prepare` then CI `pubm --phase publish` | Uses Prepare for CI publish locally and Publish prepared release in CI |

### Prepare for CI publish vs Publish prepared release

| | Prepare for CI publish | Publish prepared release |
|---|---|---|
| **Command** | `pubm --phase prepare` | `pubm --phase publish` |
| **Does** | validate, collect/sync tokens, test, build, write versions, create tags, push the release commit and tags, dry-run publish | read manifest versions, publish packages, create GitHub Releases |
| **Does not** | publish packages | write versions, create tags, push the release commit or tags |
| **When omitted** | Direct Release runs both phases | Direct Release runs both phases |
| **Split workflow** | Use this phase before CI publish | Use this phase inside CI and non-interactive token execution |

Running without `--phase` executes Direct Release. Use `--phase prepare` or `--phase publish` only for Split CI Release.

### Common CI pattern

1. Run `pubm --phase prepare` locally — validates, collects/syncs tokens, writes versions, creates tags, pushes the release commit and tags, and does not publish packages
2. Tag/commit push triggers CI workflow
3. CI runs `pubm --phase publish` — reads manifest versions, publishes packages, and creates GitHub Releases

## Version Phase

### Commit

All version changes are committed in a single commit with the message **"Version Packages"**, followed by a summary of bumped packages and versions.

### Tags

Tag format depends on versioning mode:

| Mode | Tag format | Example |
|------|-----------|---------|
| Single | `v{version}` | `v1.2.3` |
| Fixed | `v{version}` | `v1.2.3` |
| Independent | `{packageName}@{version}` | `@pubm/core@1.2.3` |

Tags are annotated (`git tag -a`). If a tag already exists, pubm prompts for deletion (local) or errors (CI).

### Changelog

- **Single/Fixed mode:** Single `CHANGELOG.md` at the project root
- **Independent mode:** Per-package `CHANGELOG.md` in each package directory

Changelogs are generated from changesets when changesets are configured.

## Push Phase

### Primary path

```bash
git push --follow-tags
```

Pushes the version commit and all reachable annotated tags in one operation.

### PR fallback

If direct push fails (e.g., protected branch rules), pubm automatically:

1. Creates a branch: `pubm/version-packages-{timestamp}`
2. Pushes the branch with `git push -u origin {branch} --follow-tags`
3. Creates a PR via GitHub API with changelog details
4. Switches back to the base branch

No manual intervention needed — the PR fallback is automatic.

## Ecosystem Detection

pubm detects the ecosystem for each package directory by checking manifest files in priority order:

| Priority | Ecosystem | Detected by | Default registries |
|----------|-----------|-------------|-------------------|
| 1 | Rust | `Cargo.toml` exists | `crates` |
| 2 | JavaScript | `package.json`, `deno.json`, or `deno.jsonc` exists | `npm`, `jsr` |

**First match wins.** Only one ecosystem is detected per directory. If a directory has both `Cargo.toml` and `package.json`, Rust is detected. To override, set `ecosystem: 'js'` (or `'rust'`) explicitly in the package config.

## Workspace Protocol Resolution

During publish, pubm resolves workspace protocol references to concrete versions:

| Protocol | Resolved to |
|----------|------------|
| `workspace:*` | Exact version (e.g., `1.2.3`) |
| `workspace:^` | Caret range (e.g., `^1.2.3`) |
| `workspace:~` | Tilde range (e.g., `~1.2.3`) |

Local manifests are restored to their original `workspace:*` form after publishing.

## Platform Binary Distribution

pubm itself uses a platform-specific binary distribution pattern:

### Architecture

- **Main package** (`pubm`): Contains `cli.cjs` launcher and `postinstall.cjs`
- **Platform packages** (`@pubm/darwin-arm64`, `@pubm/linux-x64`, etc.): Listed as `optionalDependencies`, each contains a compiled binary for one platform
- **12 platform variants**: darwin (arm64, x64, x64-baseline), linux (arm64, arm64-musl, x64, x64-baseline, x64-musl, x64-musl-baseline), windows (arm64, x64, x64-baseline)

### How it works

1. `npm install pubm` installs only the platform package matching the current OS/arch
2. `postinstall.cjs` resolves the correct binary and caches it at `bin/.pubm` for fast startup
3. `cli.cjs` spawns the cached binary, falling back to node_modules lookup if cache is missing
4. On x64, runtime AVX2 detection selects between regular and `-baseline` variants
5. On Linux, musl/glibc detection selects the correct libc variant

### Code signing

macOS binaries require ad-hoc code signing to avoid Gatekeeper SIGKILL:

```bash
codesign --remove-signature <binary>
codesign -s - <binary>
```

**Without signing, macOS kills the binary with SIGKILL, which is silently swallowed as exit code 0 by the Node.js launcher.** This makes the failure invisible — `inspect packages` produces no output with no error message.

## Asset Pipeline

For projects distributing platform binaries via GitHub Releases, pubm provides a 5-stage asset pipeline:

| Stage | Purpose |
|-------|---------|
| Resolve | Match files via glob patterns with `{platform}`, `{os}`, `{arch}` captures |
| Transform | Plugin hook to modify or multiply assets |
| Compress | Auto-select format (tar.gz, zip, tar.xz, tar.zst) based on platform OS |
| Name | Apply naming template: `{filename}-{platform}` default |
| Checksum | Generate SHA256 checksums |

Glob patterns support capture variables: `dist/{platform}/binary` or `dist/{os}/{arch}/binary`. If no explicit captures are used, pubm auto-parses platform info from path segments.

Compression format priority: per-file override > per-group > global config > OS-based auto-detect.
