<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo_with_symbol.png" height="150">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pubm">
    <img src="https://img.shields.io/npm/v/pubm" alt="npm version" />
  </a>
  <a href="https://jsr.io/@pubm/pubm">
    <img src="https://jsr.io/badges/@pubm/pubm/score" alt="jsr version" />
  </a>
</p>

<h1 align="center">pubm</h1>

<p align="center">
<strong>One command. Every registry.</strong><br>
Publish to npm, jsr, crates.io, and private registries in a single step.<br>
If anything fails, pubm rolls everything back automatically.
</p>

<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/demo.gif" width="100%">
</p>

## Why pubm exists

Publishing a package to multiple registries shouldn't require shell scripts or plugins bolted onto tools designed for one registry. pubm treats multi-registry publishing as a single transaction — it either succeeds everywhere or rolls back cleanly.

## Publish without fear

### One workflow, every registry

npm, jsr, crates.io, and private registries from a single command. Registries are **auto-inferred** from your manifest files — no configuration needed:

| Manifest | Registry |
|----------|----------|
| `package.json` | npm |
| `jsr.json` | jsr |
| `Cargo.toml` | crates.io |

Have both `package.json` and `jsr.json`? pubm publishes to both in one release.

### Automatic rollback

If any registry rejects your package, pubm undoes the version bump, git tag, and commit. Your repo returns to its previous state. No more half-published packages or manual cleanup.

### Catch problems before publishing

Branch guards, clean working tree, remote sync, registry availability, login status, and publish permissions — all verified **before** any side effects happen. The `--preflight` flag goes further: simulate your entire CI publish pipeline locally, including token validation, without actually publishing.

```bash
pubm --preflight
```

### Works locally and in CI

Interactive prompts at the terminal, fully headless in CI. Same command, same guarantees. No flags to remember, no separate CI config.

### Monorepo-native

Detects pnpm, yarn, npm, bun, deno, and Cargo workspaces automatically. Publishes in dependency order. Supports independent and fixed versioning, fixed groups, and linked groups.

### Multi-ecosystem

Understands both JavaScript and Rust. Reads `package.json`, `jsr.json`, and `Cargo.toml`. Mixed JS + Rust workspaces work out of the box.

## Quick Start

```bash
npm i -g pubm

# Initialize
pubm init

# Just run pubm — that's it
pubm
```

No version argument needed. pubm launches an **interactive pipeline** that walks you through everything:

```
  $ pubm
    │
    ├─ Pick your version     ── patch, minor, or major
    ├─ Preflight checks      ── branch, working tree, remote sync
    ├─ Registry validation   ── auth, permissions, availability
    ├─ Test & Build          ── runs your npm scripts
    ├─ Version bump          ── updates manifests, creates git commit + tag
    ├─ Publish               ── all registries concurrently
    ├─ Post-publish          ── pushes tags, creates GitHub release draft
    │
    └─ On failure → automatic rollback of all changes
```

One command does everything. No separate steps, no scripts to chain.

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

---

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

## Author

**Yein Sung** — [GitHub](https://github.com/syi0808)
