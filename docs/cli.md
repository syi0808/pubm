# `pubm` – Complete CLI Reference

> Run `pubm --help` at any time to see these flags in your terminal.

---

## Positional argument

| Argument | Description |
|----------|-------------|
| `<version>` | **SemVer** bump or explicit version. One of:<br/>`patch` · `minor` · `major` · `prepatch` · `preminor` · `premajor` · `prerelease` · `1.2.3`.<br/>If omitted, pubm prompts for the next version (interactive) or errors on CI. |

---

## Common flags

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `-p, --preview` | — | `false` | Dry‑run. Resolve and display the task graph without side‑effects. |
| `--registry <list>` | — | `npm,jsr` | Comma‑separated list of target registries. Each entry can be `npm`, `jsr`, or a custom registry URL. |
| `-b, --branch <name>` | — | `main` | Branch name that must match `HEAD` for a release. |
| `-a, --any-branch` | — | `false` | Disable branch guard. Useful for hot‑fixes. |
| `-t, --tag <name>` | — | `latest` | Dist‑tag for the npm publish (`next`, `beta`, …). |
| `-c, --contents <path>` | — | — | Publish a sub‑directory instead of repository root (e.g. `dist`). |
| `--registry <...registries>` | — | `npm,jsr` | Comma‑separated list (e.g. `npm,jsr,https://registry.mycorp.com`). |

---

## Pipeline control

| Flag | Effect |
|------|--------|
| `--no-pre-check` | Skip *Prerequisite* guard stage. **Dangerous** – use only in controlled pipelines. |
| `--no-condition-check` | Skip *Required‑condition* guard stage (registry ping, login checks). |
| `--no-tests` | Disable test script before publish. |
| `--no-build` | Disable build script before publish. |
| `--no-publish` | Run every step **except** the actual publish (useful for validation). |
| `--no-release-draft` | Do not create a GitHub release draft. |
| `--publish-only` | Skip everything except the publish step (assumes current commit is already tagged). |
| `--preflight` | Simulate CI publish locally: collect tokens, run full pipeline with dry‑run publish. |

---

## Scripts & tokens

| Flag | Default | Description |
|------|---------|-------------|
| `--test-script <name>` | `test` | Name of the npm script that runs tests (skipped with `--no-tests`). |
| `--build-script <name>` | `build` | Name of the npm script that builds artifacts (skipped with `--no-build`). |
| `--no-save-token` | `false` | Do **not** persist jsr tokens on disk; you will be prompted each run. |

### Environment variables

| Variable | Purpose |
|----------|---------|
| `NODE_AUTH_TOKEN` | npm auth (automation) token for CI. |
| `JSR_TOKEN` | jsr auth token. |
| `CARGO_REGISTRY_TOKEN` | crates.io auth token. |

---

## Prompt behaviour

pubm is **interactive‑first**. Prompts are automatically disabled when either:

* the process runs on a recognised CI platform (`std-env.isCI`), or
* `stdin` is not a TTY.

In non‑interactive mode you must supply the necessary tokens/flags via env‑vars or CLI options.

---

## Subcommands

### `pubm secrets sync`

Syncs stored tokens to GitHub Secrets via the `gh` CLI. Tokens are stored in the OS keychain via `@napi-rs/keyring` when available, with the encrypted Db store used as a fallback.

```bash
pubm secrets sync [--registry <...registries>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--registry <list>` | `npm,jsr,crates` | Filter to specific registries. |

Requires `gh` CLI installed and authenticated (`gh auth login`).

---

## Preflight mode

`pubm --preflight` validates that your CI publish pipeline will succeed, **without** creating any version bumps or tags.

### Pipeline

1. **Collect tokens** – loads stored tokens from the OS keychain first, falls back to the encrypted Db store, prompts only for missing ones, saves new tokens.
2. **Sync to GitHub Secrets** *(optional prompt)* – calls `gh secret set` for each token.
3. **Switch to CI simulation** – sets `promptEnabled=false` to simulate non‑interactive CI.
4. **Run full pipeline** – prerequisites, conditions, tests, build.
5. **Dry‑run publish** – `npm publish --dry-run`, `jsr publish --dry-run`, `cargo publish --dry-run` for each configured registry.

If a token auth error is detected during dry‑run, pubm re‑prompts for the token, saves it, and retries once.

---

## Examples

```bash
# 1. Dry‑run the patch release for all registries
pubm patch --preview

# 2. Publish only to npm with a beta tag, skip tests
pubm minor --registry npm --tag beta --no-tests

# 3. CI pipeline: publish already‑tagged commit
export NODE_AUTH_TOKEN="$NPM_AUTOMATION_TOKEN"
export JSR_TOKEN="$JSR_TOKEN"
pubm --publish-only --registry npm,jsr

# 4. Validate CI setup locally (preflight)
pubm --preflight

# 5. Sync stored tokens to GitHub Secrets
pubm secrets sync
pubm secrets sync --registry npm
```

---
