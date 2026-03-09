# Build & Distribution Overhaul — Design Document

**Date:** 2026-03-10

**Goal:** Unify build, release, and distribution pipeline. Single `bun run build` for SDK + platform binaries. Automated GitHub Release with changelog. Homebrew distribution via plugin.

---

## 1. Build (build.ts)

`bun run build` produces:
- **SDK**: `src/index.ts` → `dist/` (ESM + CJS + types)
- **Platform binaries**: `src/cli.ts` → `npm/@pubm-{platform}/bin/pubm` (5 targets)
- Each platform directory gets auto-generated `package.json` with `os`/`cpu` fields

No more `--compile` flag or `releases/` directory.

## 2. CLI Wrapper (bin/cli.js)

Static file checked into git (not build output). Node.js CJS script:
1. Check `PUBM_BIN_PATH` env override
2. Detect platform + arch
3. Walk up `node_modules` to find `@pubm/{platform}/bin/pubm`
4. Spawn binary with inherited stdio

## 3. Postinstall (postinstall.js)

Verifies platform binary exists after `npm install`. Exits cleanly (exit 0) if not found — doesn't block installation.

## 4. Package Distribution

**package.json changes:**
- `bin`: `{ "pubm": "./bin/cli.js" }`
- `files`: `["bin/", "dist/", "postinstall.js"]`
- `workspaces`: `["npm/@pubm/*"]` — pubm monorepo feature publishes platform packages
- `postinstall`: `"node ./postinstall.js"`
- Remove `build:compile`, update `release`/`ci:release` scripts

**optionalDependencies** (existing): `@pubm/darwin-arm64`, `@pubm/darwin-x64`, etc.

## 5. CLI Flags

- `--preflight` (local): prerequisites → prompts → test/build → version bump → publish → push tags. No GitHub Release.
- `--ci`: build → publish (npm/jsr + platform packages) → GitHub Release (with assets + changelog) → `afterRelease` plugin hook.

Replaces `--publish-only`.

## 6. GitHub Release Task

Extends existing release draft logic:
- Creates full release (not draft)
- Compresses platform binaries as `.tar.gz` assets
- Generates release notes using `.github/release.yml` changelog categories
- Passes release context (URL, version, asset URLs) to `afterRelease` hook

**.github/release.yml** (changelog categories):
```yaml
changelog:
  categories:
    - title: "🚀 Features"
      labels: [feat, feature, enhancement]
    - title: "🐛 Bug Fixes"
      labels: [fix, bug, bugfix]
    - title: "📦 Build & CI"
      labels: [build, ci, chore]
    - title: "📖 Documentation"
      labels: [docs, documentation]
    - title: "🔧 Other Changes"
      labels: ["*"]
```

## 7. CI Release Workflow

Single job in `release.yml`:
```
v* tag push → bun install → bun run build → bun src/cli.ts --ci
```

`--ci` handles everything: npm publish, GitHub Release, afterRelease plugins.

## 8. Plugin System Extensions

### 8a. afterRelease Hook

New plugin hook called after GitHub Release is created:

```ts
interface AfterReleaseContext {
  version: string;
  tag: string;
  releaseUrl: string;
  assets: { name: string; url: string; sha256: string }[];
}

interface PubmPlugin {
  hooks?: {
    afterRelease?: (ctx: AfterReleaseContext) => Promise<void>;
  };
}
```

### 8b. Plugin Commands (Subcommand Registration)

Plugins can register CLI subcommands:

```ts
interface PluginCommand {
  name: string;
  description: string;
  subcommands?: {
    name: string;
    description: string;
    options?: { name: string; description: string; required?: boolean }[];
    action: (args: Record<string, unknown>) => Promise<void>;
  }[];
}

interface PubmPlugin {
  commands?: PluginCommand[];
}
```

CLI loads plugins at startup, registers commands with CAC dynamically.

## 9. @pubm/plugin-brew

**Two export functions:**

```ts
import { brewTap, brewCore } from "@pubm/plugin-brew";

// Tap distribution (same repo or separate)
brewTap({
  formula: "Formula/pubm.rb",
  // repo: "syi0808/homebrew-pubm",  // optional: separate tap repo
})

// homebrew-core PR
brewCore({
  formula: "pubm",
})
```

**brewTap — afterRelease:**
1. Fetch GitHub Release asset URLs + compute SHA256
2. Update Formula `.rb` file (version, url, sha256 per platform)
3. Same repo: git commit + push to main
4. Separate repo: clone → update → commit + push (or PR)

**brewCore — afterRelease:**
1. Fetch GitHub Release asset URLs + compute SHA256
2. Update formula in homebrew-core fork
3. Create PR to homebrew-core

**brew init subcommand:**
```bash
pubm brew init          # Generate Formula template for tap
pubm brew init --core   # Generate homebrew-core formula
```

Generates platform-aware formula template with `on_macos`/`on_linux` blocks.

## 10. Formula Template (pubm's own)

```ruby
class Pubm < Formula
  desc "Publish manager for multiple registries"
  homepage "https://github.com/syi0808/pubm"
  version "0.2.12"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/v#{version}/pubm-darwin-arm64.tar.gz"
      sha256 "..."
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/v#{version}/pubm-darwin-x64.tar.gz"
      sha256 "..."
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/syi0808/pubm/releases/download/v#{version}/pubm-linux-arm64.tar.gz"
      sha256 "..."
    elsif Hardware::CPU.intel?
      url "https://github.com/syi0808/pubm/releases/download/v#{version}/pubm-linux-x64.tar.gz"
      sha256 "..."
    end
  end

  def install
    bin.install "pubm"
  end

  test do
    system "#{bin}/pubm", "--version"
  end
end
```
