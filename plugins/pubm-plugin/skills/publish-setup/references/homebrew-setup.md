# Homebrew Setup Reference

## Overview

pubm distributes pre-built native binaries through Homebrew. This is the recommended install path for **Rust-only projects** or any environment without Node.js.

For JS/TS projects, installing pubm as a devDependency (`npm install -D pubm`) is usually better because it pins the version in the lockfile and runs via `npx`, `bunx`, or `pnpm exec`.

## Installing pubm via Homebrew

```bash
brew tap syi0808/tap
brew install pubm
```

This installs the `pubm` binary globally. Verify it with:

```bash
pubm --version
```

## Homebrew in CI (Rust projects)

For Rust-only projects that use pubm in CI, the `@pubm/plugin-brew` plugin must already be configured and releasing binaries. The Homebrew tap (`syi0808/tap`) must contain a formula for pubm.

### CI setup block

```yaml
      - uses: dtolnay/rust-toolchain@stable

      - name: Install pubm via Homebrew
        run: |
          brew tap syi0808/tap
          brew install pubm
```

**Note:** GitHub Actions `ubuntu-latest` runners already have Homebrew. macOS runners do too. No extra setup is needed.

### When to use Homebrew vs npm in CI

| Project type | Install method | Why |
|---|---|---|
| JS/TS only | `npm install -D pubm` (devDependency) | Version pinned, no extra setup |
| Rust only | `brew install pubm` | No Node.js needed |
| JS + Rust (multi-ecosystem) | `npm install -D pubm` (devDependency) | Node.js is already required for JS packages |

## Setting up Homebrew distribution for your own project

If the user wants to distribute a CLI tool through Homebrew, they need the `@pubm/plugin-brew` plugin. See `references/official-plugins.md` for details.

### Prerequisites

1. The project must produce **platform binary assets** that are uploaded to GitHub Releases.
   - Configure `releaseAssets` in `pubm.config.ts` to specify which files to upload.
   - Or use the `compress` option to compress and upload binaries automatically.

2. The formula file must exist in the repository or in a tap repository.
   - Run `pubm brew init` to scaffold a formula from package metadata.

### brewTap (custom tap, recommended)

Maintains a formula in a dedicated Homebrew tap repository (e.g., `user/homebrew-tap`).

```typescript
import { defineConfig } from 'pubm'
import { brewTap } from '@pubm/plugin-brew'

export default defineConfig({
  plugins: [
    brewTap({
      formula: 'Formula/my-tool.rb',
      repo: 'https://github.com/user/homebrew-tap',
    }),
  ],
})
```

After release, the plugin:
1. Clones the tap repo
2. Updates the formula with new version, URLs, and SHA256 checksums
3. Commits and pushes the change

Users install with:
```bash
brew tap user/tap
brew install my-tool
```

### brewCore (homebrew-core)

Opens a PR to the official `homebrew/homebrew-core` repository. Use this when your tool is popular enough for the main Homebrew repository.

```typescript
import { defineConfig } from 'pubm'
import { brewCore } from '@pubm/plugin-brew'

export default defineConfig({
  plugins: [
    brewCore({
      formula: 'Formula/my-tool.rb',
    }),
  ],
})
```

After release, the plugin:
1. Forks `homebrew/homebrew-core` (if not already forked)
2. Updates the formula in the fork
3. Opens a PR to `homebrew/homebrew-core`

**Requires:** `gh` CLI authenticated with a GitHub account.

### Formula structure

pubm generates formulae with platform-specific asset URLs:

```ruby
class MyTool < Formula
  desc "Description from package.json"
  homepage "https://github.com/user/my-tool"
  version "1.0.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/.../my-tool-darwin-arm64.tar.gz"
      sha256 "..."
    elsif Hardware::CPU.intel?
      url "https://github.com/.../my-tool-darwin-x64.tar.gz"
      sha256 "..."
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/.../my-tool-linux-arm64.tar.gz"
      sha256 "..."
    elsif Hardware::CPU.intel?
      url "https://github.com/.../my-tool-linux-x64.tar.gz"
      sha256 "..."
    end
  end

  def install
    bin.install "my-tool"
  end

  test do
    system "#{bin}/my-tool", "--version"
  end
end
```

### Platform matching

The plugin matches release assets to formula platforms using structured `ParsedPlatform` data. Default mappings:

| Formula entry | Matches |
|---|---|
| `darwin-arm64` | `os === "darwin" && arch === "arm64"` |
| `darwin-x64` | `os === "darwin" && arch === "x64"` |
| `linux-arm64` | `os === "linux" && arch === "arm64"` |
| `linux-x64` | `os === "linux" && arch === "x64"` |

Override with `assetPlatforms` for custom matching, such as musl-only Linux builds:

```typescript
brewTap({
  formula: 'Formula/my-tool.rb',
  assetPlatforms: {
    'linux-x64': (asset) =>
      asset.platform.os === 'linux' &&
      asset.platform.arch === 'x64' &&
      asset.platform.abi === 'musl',
  },
})
```

### CI secrets for Homebrew plugins

| Secret | When needed | Description |
|---|---|---|
| `GITHUB_TOKEN` | Always | Used to push formula changes and create PRs |

The `GITHUB_TOKEN` provided by GitHub Actions (`secrets.GITHUB_TOKEN`) is enough for `brewTap`. For `brewCore`, the token needs permission to fork repos and create PRs, so a personal access token may be needed.
