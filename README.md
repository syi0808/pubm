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
- **Monorepo aware** (Soon) – detects workspaces (pnpm/yarn/npm) and publishes each package in the correct order.
- **Smart 2FA handling** – OTP prompt when interactive, provenance publish when headless.
- **Rigid safety guards** – branch & work‑tree checks, remote divergence, registry ping, login & permission validation.
- **Preview & rollback** – inspect the full task‑graph with `--preview`; automatic rollback on failure.
- **Pluggable pipeline** – customise steps via `pubm.config.(c)js`.

---

## 🆚 pubm vs. np

| Capability | **pubm** | **np** |
|------------|---------|-------|
| **Multi‑registry** (npm *and* jsr) | ✅ Built‑in | ❌ npm‑only |
| **Workspaces / monorepo** | ✅ Road‑map & design | ❌ Not supported |
| **Interactive‑first, CI‑friendly (prompts auto‑off in CI/non‑TTY)** | ✅ Prompts auto‑disabled when `stdin` ≠ TTY or CI env detected | ⚠️ Local interactive focus |
| **Plugin architecture** | ✅ `Registry` & task plugins | ❌ |
| **2FA in CI** | ✅ Provenance publish with `NODE_AUTH_TOKEN` | ❌ Error if 2FA enforced |
| **Windows & Bun support** | 🕓 Planned | ✅ |

<sub>See [`np`](https://github.com/sindresorhus/np) for the original local‑only flow.</sub>

---

## ⚡ Quick Start

```bash
npm i -g pubm

pubm patch --preview
```

---

## 🔑 Core CLI Options

| Flag | Purpose |
|------|---------|
| `-p, --preview` | Dry‑run: show tasks, no side‑effects |
| `--registry <list>` | Comma‑separated targets, e.g. `npm,jsr,https://registry.example.com` |
| `--branch <name>` / `--any-branch` | Release branch guard control |
| `--no-pre-check` / `--no-condition-check` | Skip guard stages |

👉 **Full option list:** see `pubm --help` or the [CLI reference](./docs/cli.md).

---

## 🛠 Workflow Overview

1. **Prerequisite checks** – branch, work‑tree, commits, existing tag.
2. **Required condition checks** – registry ping, login & permission, engine versions.
3. **Test & build** *(optional)*
4. **Version bump & tag** (SemVer)
5. **Concurrent publish** – npm (OTP/provenance), jsr, plugins.
6. **Git push & GitHub release draft**

---

## FAQ

### Why does jsr only ask for tokens?

The only way to access jsr’s certified environment is through a direct API request with a token.

### How is the jsr token stored? Is it secure?

The jsr token is encrypted and stored using various layers of information. As long as you have control over the local machine where pubm was run, it is highly unlikely the token can be compromised.

If you prefer not to save tokens, you can use the `--no-save-token` option, which will request the token each time.
