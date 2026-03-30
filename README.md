<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo_with_symbol.png" height="150">
</p>


<h1 align="center">pubm</h1>

<p align="center">
<strong>One command. Every registry.</strong><br>
Publish to npm, jsr, crates.io, and private registries in one step.<br>
If anything fails, pubm undoes the version bump, tag, and commit automatically.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.zh-cn.md">简体中文</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.es.md">Español</a>
</p>

<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/demo.gif" width="100%">
</p>

## Why pubm?

Most release tools assume one registry. pubm is built for projects that grow:

- **npm + jsr** - ship to both JavaScript registries in one command
- **JS + Rust** - publish `package.json` and `Cargo.toml` in a single pipeline
- **Monorepos** - publishes packages in dependency order, no manual sequencing
- **Automatic rollback** - if any registry fails, pubm undoes the version bump, tag, and commit (registry unpublish is best-effort - version numbers may be permanently reserved)
- **Zero config** - registries are auto-detected from your manifest files

Start with npm only. Add jsr next month. Move to a monorepo next year. Your release command stays the same: `pubm`.

If you only publish one package to npm, `np` or `release-it` will serve you fine. pubm is for when you don't want to redo your release setup every time your project grows.

## How it works

### Zero config

pubm reads your manifest files and figures out the registries:

| Manifest | Registry |
|----------|----------|
| `package.json` | npm |
| `jsr.json` | jsr |
| `deno.json` / `deno.jsonc` | jsr |
| `Cargo.toml` | crates.io |

Have both `package.json` and `jsr.json`? pubm publishes to both in one release. No config needed.

### Automatic rollback

Registry rejected your package? pubm undoes the version bump, git tag, and commit. Note: registry unpublish is best-effort - npm reserves the version number even after unpublish, so you may need to bump to a new version.

### Preflight checks

Branch, working tree, remote sync, login status, publish permissions - all verified **before** pubm touches anything. In CI mode, pubm validates tokens and runs publish dry-runs to catch issues before the real publish:

```bash
pubm --mode ci --phase prepare
```

### Same command, local and CI

Interactive prompts in your terminal, fully headless in CI. No separate config, no flags to remember.

### Monorepo-native

Detects pnpm, yarn, npm, bun, deno, and Cargo workspaces automatically. Publishes in dependency order. Supports independent versioning, fixed versioning, and linked groups.

### Multi-ecosystem

JavaScript and Rust in the same pipeline. Mixed JS + Rust workspaces work out of the box.

### Multilingual CLI

Prompts, errors, task progress, rollback instructions: all translated into 6 languages.

**English · 한국어 · 简体中文 · Français · Deutsch · Español**

pubm picks up your system locale automatically. You can also set it yourself:

```bash
# CLI flag
pubm --locale ko

# Environment variable
PUBM_LOCALE=fr pubm

# Or set it in pubm.config.ts
export default defineConfig({ locale: "zh-cn" });
```

## Quick Start

```bash
# npm
npm i -g pubm

# Homebrew
brew tap syi0808/pubm
brew install pubm

# Interactive setup wizard - detects packages, configures registries, CI, and more
pubm init

# Just run pubm - that's it
pubm

# Publish a snapshot release with a custom tag (useful for testing pre-releases)
pubm snapshot [tag]

# Optional: install coding agent skills (Claude Code, Codex, Gemini)
pubm setup-skills
```

That's it. pubm walks you through the rest:

```
  $ pubm
    │
    ├─ Pick a version        ── patch, minor, or major
    ├─ Preflight checks      ── branch, working tree, remote sync
    ├─ Registry validation   ── auth, permissions, availability
    ├─ Test & Build          ── runs your npm scripts
    ├─ Version bump          ── updates manifests, creates git commit + tag
    ├─ Publish               ── all registries at once
    ├─ Post-publish          ── pushes tags, creates GitHub Release
    │
    └─ On failure → rolls back everything
```

## Documentation

- [Quick Start](https://syi0808.github.io/pubm/guides/quick-start/)
- [Configuration](https://syi0808.github.io/pubm/guides/configuration/)
- [Changesets](https://syi0808.github.io/pubm/guides/changesets/)
- [Monorepo](https://syi0808.github.io/pubm/guides/monorepo/)
- [CI/CD](https://syi0808.github.io/pubm/guides/ci-cd/)
- [CLI Reference](https://syi0808.github.io/pubm/reference/cli/)
- [Plugins API](https://syi0808.github.io/pubm/reference/plugins/)

## FAQ

### How are registry tokens stored?

pubm stores tokens in your OS native keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via `@napi-rs/keyring`. Environment variables always take priority. Use `--no-save-token` to be prompted each time.

## Privacy

pubm does not collect telemetry, analytics, or usage data.

- **Token storage** - Registry tokens are stored in your OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) with an AES-256-CBC encrypted fallback at `~/.pubm/`
- **Network** - pubm only communicates with registries you configure (npm, jsr, crates.io) and GitHub for release creation
- **Update check** - Queries the npm public registry for newer versions (local only, disabled in CI)

---

## Used By

Projects using pubm for their release workflow:

| Project | Description |
|---------|-------------|
| [cluvo](https://github.com/syi0808/cluvo) | Local-first bug reporting SDK for open-source CLIs and SDKs |

> Using pubm? [Open a PR](https://github.com/syi0808/pubm/pulls) to add your project!

---

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

## Author

**Yein Sung** - [GitHub](https://github.com/syi0808)
