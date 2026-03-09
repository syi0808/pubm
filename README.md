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

<h1 align="center">
pubm
</h1>

<p align="center">
<strong>One‑command publishing for workspaces to *multiple* registries (npm · jsr · private).</strong><br/>
Safe by default, CI‑friendly by design, and extensible through plugins.
<p>

<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/demo.gif" width="100%">
</p>

## ✨ Features at a Glance

- **Atomic multi‑registry publish** – npm & jsr run concurrently; plug‑in more registries with a few lines of code.
- **Monorepo aware** – detects workspaces (pnpm/yarn/npm) and publishes each package in the correct dependency order.
- **Changeset workflow** – version management through changesets with changelog generation.
- **Multi-ecosystem** – supports JavaScript (npm/jsr) and Rust (crates.io), extensible via plugins.
- **Smart 2FA handling** – OTP prompt when interactive, provenance publish when headless.
- **Rigid safety guards** – branch & work‑tree checks, remote divergence, registry ping, login & permission validation.
- **Preview & rollback** – inspect the full task‑graph with `--preview`; automatic rollback on failure.
- **Pluggable pipeline** – customise steps via `pubm.config.(c)js`.

---

## 🆚 pubm vs. np

| Capability | **pubm** | **np** |
|------------|---------|-------|
| **Multi‑registry** (npm *and* jsr) | ✅ Built‑in | ❌ npm‑only |
| **Workspaces / monorepo** | ✅ Full support | ❌ Not supported |
| **Interactive‑first, CI‑friendly (prompts auto‑off in CI/non‑TTY)** | ✅ Prompts auto‑disabled when `stdin` ≠ TTY or CI env detected | ⚠️ Local interactive focus |
| **Plugin architecture** | ✅ `Registry` & task plugins | ❌ |
| **2FA in CI** | ✅ Provenance publish with `NODE_AUTH_TOKEN` | ❌ Error if 2FA enforced |
| **Windows & Bun support** | ✅ Supported | ✅ |

<sub>See [`np`](https://github.com/sindresorhus/np) for the original local‑only flow.</sub>

---

## ⚡ Quick Start

```bash
npm i -g pubm

pubm patch --preview
```

> **Publishing to jsr?** Install the jsr CLI as a devDependency in your project:
> ```bash
> pnpm add -D jsr  # or npm i -D jsr / yarn add -D jsr
> ```

---

## 🔑 Core CLI Options

| Flag | Purpose |
|------|---------|
| `-p, --preview` | Dry‑run: show tasks, no side‑effects |
| `--preflight` | Simulate CI publish locally (token‑based auth + dry‑run) |
| `--registry <list>` | Comma‑separated targets, e.g. `npm,jsr,https://registry.example.com` |
| `--branch <name>` / `--any-branch` | Release branch guard control |
| `--no-pre-check` / `--no-condition-check` | Skip guard stages |

👉 **Full option list:** see `pubm --help` or the [CLI reference](./docs/cli.md).

---

## 📦 Subcommands

| Command | Purpose |
|---------|---------|
| `pubm init` | Initialize pubm configuration (`.pubm/` and `pubm.config.ts`) |
| `pubm add` | Create a changeset describing your changes |
| `pubm version` | Consume changesets, bump versions, and generate changelog |
| `pubm status` | Show pending changesets and their impact |
| `pubm pre enter/exit <tag>` | Enter or exit pre-release mode (e.g., `beta`, `rc`) |
| `pubm snapshot [tag]` | Create a snapshot release without git tags |
| `pubm migrate` | Migrate from `.changeset/` to `.pubm/` format |
| `pubm update` | Auto-update pubm to the latest version |
| `pubm secrets sync` | Sync registry tokens to GitHub Secrets via `gh` |

---

## 🔌 Plugin System

Extend pubm with custom registries, ecosystems, and lifecycle hooks via `pubm.config.ts`:

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

### Available Hooks

| Hook | Trigger |
|------|---------|
| `beforeTest` / `afterTest` | Around test execution |
| `beforeBuild` / `afterBuild` | Around build execution |
| `beforeVersion` / `afterVersion` | Around version bump |
| `beforePublish` / `afterPublish` | Around registry publish |
| `beforePush` / `afterPush` | Around git push |
| `onError` | When any step fails |
| `onRollback` | During automatic rollback |
| `onSuccess` | After successful publish |

Plugins can also register custom `Registry` and `Ecosystem` implementations for additional language ecosystems.

---

## 📝 Changeset Workflow

pubm uses changesets to manage version bumps and changelogs:

```bash
# 1. Create a changeset when making changes
pubm add

# 2. Review pending changesets
pubm status

# 3. Consume changesets and bump versions
pubm version

# 4. Publish to registries
pubm patch  # or minor, major
```

### Pre-release Mode

```bash
pubm pre enter beta    # Enter pre-release mode
pubm version           # Generates 1.2.0-beta.0, 1.2.0-beta.1, etc.
pubm pre exit          # Exit pre-release mode
```

### Snapshot Releases

```bash
pubm snapshot                          # 0.0.0-snapshot-20260309T123456
pubm snapshot canary                   # 0.0.0-canary-20260309T123456
pubm snapshot --snapshot-id abc1234    # 0.0.0-snapshot-abc1234
```

---

## 🌐 Supported Registries

| Registry | Ecosystem | Auth |
|----------|-----------|------|
| **npm** | JavaScript/TypeScript | OTP or `NODE_AUTH_TOKEN` |
| **jsr** | JavaScript/TypeScript | Encrypted token storage |
| **crates.io** | Rust | `CARGO_REGISTRY_TOKEN` |
| **Custom npm** | JavaScript/TypeScript | Via `--registry https://...` |
| **Plugin registries** | Any | Via plugin configuration |

---

## 🛠 Workflow Overview

1. **Prerequisite checks** – branch, work‑tree, commits, existing tag.
2. **Required condition checks** – registry ping, login & permission, engine versions.
3. **Test & build** *(optional)*
4. **Version bump & tag** (SemVer)
5. **Concurrent publish** – npm (OTP/provenance), jsr, crates.io, plugins.
6. **Git push & GitHub release draft**

### Preflight Mode

Validate that your CI publish pipeline will work **before** pushing:

```bash
pubm --preflight
```

Preflight collects registry tokens interactively, then runs the entire pipeline with `promptEnabled=false` (simulating CI). Publish steps are replaced with dry‑run. If a token is invalid, it re‑prompts and retries.

After validation, pubm offers to sync tokens to GitHub Secrets via `gh secret set`. You can also sync manually:

```bash
pubm secrets sync
```

---

## FAQ

### Why does jsr only ask for tokens?

The only way to access jsr’s certified environment is through a direct API request with a token.

### How is the jsr token stored? Is it secure?

The jsr token is encrypted and stored using various layers of information. As long as you have control over the local machine where pubm was run, it is highly unlikely the token can be compromised.

If you prefer not to save tokens, you can use the `--no-save-token` option, which will request the token each time.

---

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

## Author

**Yein Sung** — [GitHub](https://github.com/syi0808)
