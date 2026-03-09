<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo.svg" height="150">
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
A publish orchestrator for multi-registry, multi-ecosystem packages.
</p>

<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/demo.gif" width="100%">
</p>

## Why pubm exists

It started with a simple problem: publishing a package to both npm and jsr at the same time. There was no tool that did this well. You either wrote shell scripts chaining multiple publish commands, or you cobbled together plugins on top of a release tool that was never designed for it.

But the real issue is bigger than npm + jsr. The JavaScript ecosystem now has multiple registries. Rust packages live alongside TypeScript ones in the same monorepo. A single "release" might mean publishing to npm, jsr, crates.io, and a private registry — all at once, all atomically, with proper rollback if any of them fails.

Most release tools are built around a different assumption: one package, one registry, one ecosystem. Multi-registry support, if it exists, is bolted on through plugins or post-publish scripts. That works until it doesn't — and when it breaks mid-publish, you're left in a half-released state cleaning up manually.

pubm treats multi-registry publishing as a first-class orchestration problem. Not an afterthought, not a plugin. The core pipeline is designed around the idea that a release is a transaction across multiple targets, and it should either succeed everywhere or roll back cleanly.

## What pubm does differently

### Multi-registry from the ground up

npm, jsr, crates.io, and custom npm-compatible registries are all built into the core. Publishing to multiple registries isn't a special case — it's the default path. They run concurrently where possible, sequentially where dependencies require it.

```bash
pubm patch --registry npm,jsr,https://registry.example.com
```

### Multi-ecosystem

pubm understands both JavaScript and Rust. It reads `package.json` and `Cargo.toml`, handles ecosystem-specific versioning conventions, and manages inter-crate dependencies in Rust monorepos. More ecosystems can be added through plugins.

### Safety that doesn't get in the way

Before publishing anything, pubm validates: branch rules, clean working tree, remote sync, registry availability, login status, and publish permissions. If something is going to fail, it fails before any side effects happen.

If a publish does fail partway through, pubm automatically rolls back git commits, tags, and stashes. You don't end up with a tagged commit that was never actually published.

The `--preflight` flag takes this further — it simulates your entire CI publish pipeline locally, including token validation, without actually publishing. Fix problems before you push.

```bash
pubm --preflight
```

### Interactive when you're there, headless when you're not

pubm detects whether it's running in an interactive terminal or CI. In a terminal, it prompts for version selection and OTP codes. In CI, prompts are disabled automatically and it uses `NODE_AUTH_TOKEN` with provenance publish for npm 2FA.

No flags to remember. No separate CI config. Same command, both environments.

## Quick Start

```bash
npm i -g pubm

# Preview what would happen
pubm patch --preview

# Publish for real
pubm patch
```

## Core Workflow

### Single package

```bash
# Create a changeset describing your changes
pubm add

# Consume changesets, bump version, generate changelog
pubm version

# Publish to configured registries
pubm patch
```

### Monorepo

pubm detects pnpm, yarn, and npm workspaces automatically. Packages are published in dependency order, and version bumps can be coordinated across groups.

```bash
# Same commands — pubm handles workspace discovery
pubm add
pubm version
pubm patch
```

### Pre-releases and snapshots

```bash
# Enter pre-release mode
pubm pre enter beta
pubm version              # → 1.2.0-beta.0, 1.2.0-beta.1, ...
pubm pre exit

# One-off snapshot releases
pubm snapshot              # → 0.0.0-snapshot-20260309T123456
```

## Configuration and Plugins

Configure pubm through `pubm.config.ts`:

```ts
import { defineConfig } from "pubm";

export default defineConfig({
  plugins: [
    {
      name: "my-plugin",
      hooks: {
        beforePublish: async (ctx) => {
          console.log(`Publishing v${ctx.version}...`);
        },
        afterPublish: async (ctx) => {
          await notifySlack(`Released v${ctx.version}`);
        },
        onError: async (ctx, error) => {
          await alertTeam(error);
        },
      },
    },
  ],
});
```

Plugins can hook into any stage of the pipeline (`beforeTest`, `afterBuild`, `beforePublish`, `onRollback`, `onSuccess`, etc.) and can register custom `Registry` and `Ecosystem` implementations for additional language ecosystems.

See `pubm --help` or the [CLI reference](./docs/cli.md) for the full option list.

## Commands

| Command | Purpose |
|---------|---------|
| `pubm init` | Initialize pubm configuration |
| `pubm add` | Create a changeset describing your changes |
| `pubm version` | Consume changesets, bump versions, generate changelog |
| `pubm status` | Show pending changesets and their impact |
| `pubm pre enter/exit <tag>` | Enter or exit pre-release mode |
| `pubm snapshot [tag]` | Create a snapshot release |
| `pubm secrets sync` | Sync registry tokens to GitHub Secrets |
| `pubm update` | Update pubm to the latest version |

---

## FAQ

### How are registry tokens stored?

pubm stores tokens in your OS native keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via `@napi-rs/keyring`. Environment variables always take priority over stored tokens. If the keychain is unavailable, tokens are encrypted with AES-256-CBC as a fallback.

If you prefer not to save tokens, use `--no-save-token` to be prompted each time.

---

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

## Author

**Yein Sung** — [GitHub](https://github.com/syi0808)
