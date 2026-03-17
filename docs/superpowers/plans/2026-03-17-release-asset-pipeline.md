# Release Asset Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `createGitHubRelease` with a modular asset pipeline that supports declarative config, platform auto-parsing, OS-aware compression, and fine-grained plugin hooks.

**Architecture:** The pipeline splits into 7 independent modules under `packages/core/src/assets/` (types, platform-parser, resolver, compressor, namer, hasher, pipeline). Each module has a single responsibility and is independently testable. The existing `createGitHubRelease` is stripped down to only handle GitHub API calls, receiving prepared assets from the pipeline. Plugin hooks intercept at each stage boundary.

**Tech Stack:** TypeScript, Vitest, Bun, node:crypto, node:fs, node:child_process (tar/zip)

**Spec:** `docs/superpowers/specs/2026-03-17-release-asset-pipeline-design.md`

---

## File Map

### New Files (packages/core/src/assets/)

| File | Responsibility |
|---|---|
| `types.ts` | All pipeline type definitions (ParsedPlatform, ResolvedAsset, TransformedAsset, CompressedAsset, PreparedAsset, UploadedAsset, ReleaseAsset, ReleaseContext, config types) |
| `platform-parser.ts` | OS/Arch/ABI/Variant/Vendor tables + parsePlatform() function |
| `resolver.ts` | Glob matching, path capture variables, config normalization → ResolvedAsset[] |
| `compressor.ts` | Archive detection, OS-aware default format, tar.gz/zip/tar.xz/tar.zst compression |
| `namer.ts` | Template variable substitution + extension appending |
| `hasher.ts` | Async SHA-256 computation |
| `pipeline.ts` | Orchestrates all stages with hook interception |
| `index.ts` | Barrel export |

### New Test Files

| File | Tests |
|---|---|
| `packages/core/tests/unit/assets/types.test.ts` | Type guard tests if any |
| `packages/core/tests/unit/assets/platform-parser.test.ts` | All OS/Arch/ABI/Variant parsing |
| `packages/core/tests/unit/assets/resolver.test.ts` | Glob, capture vars, config merge |
| `packages/core/tests/unit/assets/compressor.test.ts` | Format detection, compression |
| `packages/core/tests/unit/assets/namer.test.ts` | Template substitution, extensions |
| `packages/core/tests/unit/assets/hasher.test.ts` | SHA-256 correctness |
| `packages/core/tests/unit/assets/pipeline.test.ts` | Hook orchestration, defaults |

### Modified Files

| File | Change |
|---|---|
| `packages/core/src/config/types.ts` | Add `compress?` and `releaseAssets?` to PubmConfig/ResolvedPubmConfig |
| `packages/core/src/context.ts` | Add `tempDir` to runtime |
| `packages/core/src/plugin/types.ts` | Add AssetPipelineHooks, extend PluginHooks |
| `packages/core/src/plugin/runner.ts` | Add asset pipeline hook collection/execution methods |
| `packages/core/src/tasks/github-release.ts` | Remove discovery/compress/hash, accept PreparedAsset[], update ReleaseAsset/ReleaseContext types |
| `packages/core/src/tasks/runner.ts` | Insert runAssetPipeline before createGitHubRelease |
| `packages/core/src/index.ts` | Export assets module |
| `packages/plugins/plugin-brew/src/types.ts` | Add `assetPlatforms?` |
| `packages/plugins/plugin-brew/src/formula.ts` | Replace mapReleaseAssets with matchAssetToPlatform |
| `packages/plugins/plugin-brew/src/brew-tap.ts` | Use new matching |
| `packages/plugins/plugin-brew/src/brew-core.ts` | Use new matching |

---

## Task 1: Asset Pipeline Types

**Files:**
- Create: `packages/core/src/assets/types.ts`
- Create: `packages/core/tests/unit/assets/platform-parser.test.ts` (just the import test for now)

- [ ] **Step 1: Create types.ts with all type definitions**

```typescript
// packages/core/src/assets/types.ts

export type CompressFormat = "tar.gz" | "zip" | "tar.xz" | "tar.zst";

export type CompressOption =
  | CompressFormat
  | false
  | Record<string, CompressFormat>;

export type ReleaseAssetEntry = string | ReleaseAssetGroupConfig;

export interface ReleaseAssetGroupConfig {
  packagePath?: string;
  files: (string | ReleaseAssetFileConfig)[];
  compress?: CompressOption;
  name?: string;
}

export interface ReleaseAssetFileConfig {
  path: string;
  compress?: CompressOption;
  name?: string;
}

export interface ResolvedAssetFileConfig {
  path: string;
  compress: CompressFormat | false;
  name: string;
}

export interface ResolvedReleaseAssetConfig {
  packagePath?: string;
  files: ResolvedAssetFileConfig[];
}

export interface ParsedPlatform {
  raw: string;
  os?: string;
  arch?: string;
  vendor?: string;
  abi?: string;
  variant?: string;
}

export interface ResolvedAsset {
  filePath: string;
  platform: ParsedPlatform;
  config: ResolvedAssetFileConfig;
}

export interface TransformedAsset extends ResolvedAsset {
  filePath: string;
  extraFiles?: string[];
}

export interface CompressedAsset {
  filePath: string;
  originalPath: string;
  platform: ParsedPlatform;
  compressFormat: CompressFormat | false;
  config: ResolvedAssetFileConfig;
}

export interface PreparedAsset extends CompressedAsset {
  name: string;
  sha256: string;
}

export interface UploadedAsset extends PreparedAsset {
  url: string;
  target: string;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  sha256: string;
  platform: ParsedPlatform;
}

export interface ReleaseContext {
  packageName: string;
  version: string;
  tag: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

export interface AssetPipelineHooks {
  resolveAssets?: (
    resolved: ResolvedAsset[],
    ctx: any,
  ) => Promise<ResolvedAsset[]> | ResolvedAsset[];
  transformAsset?: (
    asset: ResolvedAsset,
    ctx: any,
  ) => Promise<TransformedAsset | TransformedAsset[]> | TransformedAsset | TransformedAsset[];
  compressAsset?: (
    asset: TransformedAsset,
    ctx: any,
  ) => Promise<CompressedAsset> | CompressedAsset;
  nameAsset?: (
    asset: CompressedAsset,
    ctx: any,
  ) => string;
  generateChecksums?: (
    assets: PreparedAsset[],
    ctx: any,
  ) => Promise<PreparedAsset[]> | PreparedAsset[];
  uploadAssets?: (
    assets: PreparedAsset[],
    ctx: any,
  ) => Promise<UploadedAsset[]> | UploadedAsset[];
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd packages/core && bunx tsc --noEmit src/assets/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/assets/types.ts
git commit -m "feat(core): add asset pipeline type definitions"
```

---

## Task 2: Platform Parser

**Files:**
- Create: `packages/core/src/assets/platform-parser.ts`
- Create: `packages/core/tests/unit/assets/platform-parser.test.ts`

- [ ] **Step 1: Write failing tests for platform-parser**

```typescript
// packages/core/tests/unit/assets/platform-parser.test.ts
import { describe, expect, it } from "vitest";
import { parsePlatform } from "../../../src/assets/platform-parser.js";

describe("parsePlatform", () => {
  describe("auto-parsing from tokens", () => {
    it("parses darwin-arm64", () => {
      const result = parsePlatform("darwin-arm64");
      expect(result).toEqual({
        raw: "darwin-arm64",
        os: "darwin",
        arch: "arm64",
      });
    });

    it("parses linux-x64", () => {
      const result = parsePlatform("linux-x64");
      expect(result).toEqual({
        raw: "linux-x64",
        os: "linux",
        arch: "x64",
      });
    });

    it("parses windows-x64", () => {
      const result = parsePlatform("windows-x64");
      expect(result).toEqual({
        raw: "windows-x64",
        os: "windows",
        arch: "x64",
      });
    });

    it("parses Rust triple x86_64-unknown-linux-gnu", () => {
      const result = parsePlatform("x86_64-unknown-linux-gnu");
      expect(result).toEqual({
        raw: "x86_64-unknown-linux-gnu",
        os: "linux",
        arch: "x64",
        vendor: "unknown",
        abi: "gnu",
      });
    });

    it("parses aarch64-apple-darwin", () => {
      const result = parsePlatform("aarch64-apple-darwin");
      expect(result).toEqual({
        raw: "aarch64-apple-darwin",
        os: "darwin",
        arch: "arm64",
        vendor: "apple",
      });
    });

    it("parses x86_64-pc-windows-msvc", () => {
      const result = parsePlatform("x86_64-pc-windows-msvc");
      expect(result).toEqual({
        raw: "x86_64-pc-windows-msvc",
        os: "windows",
        arch: "x64",
        vendor: "pc",
        abi: "msvc",
      });
    });

    it("parses linux-x64-baseline-musl", () => {
      const result = parsePlatform("linux-x64-baseline-musl");
      expect(result).toEqual({
        raw: "linux-x64-baseline-musl",
        os: "linux",
        arch: "x64",
        variant: "baseline",
        abi: "musl",
      });
    });
  });

  describe("OS aliases", () => {
    it("resolves macos to darwin", () => {
      expect(parsePlatform("macos-arm64").os).toBe("darwin");
    });

    it("resolves win to windows", () => {
      expect(parsePlatform("win-x64").os).toBe("windows");
    });

    it("resolves win32 to windows", () => {
      expect(parsePlatform("win32-x64").os).toBe("windows");
    });
  });

  describe("Arch aliases", () => {
    it("resolves x86_64 to x64", () => {
      expect(parsePlatform("linux-x86_64").arch).toBe("x64");
    });

    it("resolves amd64 to x64", () => {
      expect(parsePlatform("linux-amd64").arch).toBe("x64");
    });

    it("resolves aarch64 to arm64", () => {
      expect(parsePlatform("linux-aarch64").arch).toBe("arm64");
    });

    it("resolves i686 to ia32", () => {
      expect(parsePlatform("linux-i686").arch).toBe("ia32");
    });
  });

  describe("ABI detection", () => {
    it("detects musl", () => {
      expect(parsePlatform("linux-x64-musl").abi).toBe("musl");
    });

    it("detects gnu", () => {
      expect(parsePlatform("linux-x64-gnu").abi).toBe("gnu");
    });

    it("detects gnueabihf", () => {
      expect(parsePlatform("linux-arm-gnueabihf").abi).toBe("gnueabihf");
    });

    it("detects msvc", () => {
      expect(parsePlatform("windows-x64-msvc").abi).toBe("msvc");
    });
  });

  describe("Variant detection", () => {
    it("detects baseline", () => {
      expect(parsePlatform("linux-x64-baseline").variant).toBe("baseline");
    });

    it("detects v3", () => {
      expect(parsePlatform("linux-x64-v3").variant).toBe("v3");
    });
  });

  describe("unknown tokens", () => {
    it("ignores unknown tokens", () => {
      const result = parsePlatform("foobar-linux-x64-baz");
      expect(result.os).toBe("linux");
      expect(result.arch).toBe("x64");
    });

    it("returns empty fields when nothing matches", () => {
      const result = parsePlatform("foobar-baz");
      expect(result).toEqual({ raw: "foobar-baz" });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/assets/platform-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement platform-parser.ts**

```typescript
// packages/core/src/assets/platform-parser.ts
import type { ParsedPlatform } from "./types.js";

const OS_MAP: Record<string, string> = {
  darwin: "darwin", macos: "darwin", mac: "darwin", osx: "darwin", macosx: "darwin",
  linux: "linux", lin: "linux",
  windows: "windows", win: "windows", win32: "windows", win64: "windows",
  freebsd: "freebsd", openbsd: "openbsd", netbsd: "netbsd",
  android: "android", ios: "ios",
  solaris: "solaris", sunos: "solaris",
  illumos: "illumos", aix: "aix",
  dragonfly: "dragonfly", dragonflybsd: "dragonfly",
  plan9: "plan9", fuchsia: "fuchsia", haiku: "haiku", redox: "redox",
};

const ARCH_MAP: Record<string, string> = {
  x64: "x64", x86_64: "x64", amd64: "x64", "x86-64": "x64",
  ia32: "ia32", i386: "ia32", i486: "ia32", i586: "ia32", i686: "ia32", x86: "ia32", "386": "ia32",
  arm64: "arm64", aarch64: "arm64", armv8: "arm64", aarch_64: "arm64",
  arm: "arm", armv7: "arm", armv7l: "arm", armv6: "arm", armv6l: "arm", armhf: "arm", armel: "arm",
  ppc64le: "ppc64le", powerpc64le: "ppc64le", ppc64el: "ppc64le",
  ppc64: "ppc64", powerpc64: "ppc64",
  ppc: "ppc", powerpc: "ppc",
  s390x: "s390x",
  riscv64: "riscv64", riscv64gc: "riscv64",
  loong64: "loong64", loongarch64: "loong64", la64: "loong64",
  mips: "mips", mips32: "mips",
  mipsel: "mipsel", mipsle: "mipsel",
  mips64: "mips64",
  mips64el: "mips64el", mips64le: "mips64el",
  wasm32: "wasm32", wasm: "wasm32",
  wasm64: "wasm64",
  universal: "universal", universal2: "universal", fat: "universal",
};

const ABI_SET = new Set([
  "gnu", "glibc", "musl", "msvc",
  "mingw", "mingw32", "mingw-w64",
  "gnueabihf", "gnueabi", "musleabihf", "musleabi",
  "androideabi", "android",
  "uclibc", "bionic",
]);

const VARIANT_SET = new Set([
  "baseline", "v2", "v3", "v4", "avx2", "avx512",
]);

const VENDOR_SET = new Set([
  "unknown", "apple", "pc", "none",
]);

export function parsePlatform(input: string): ParsedPlatform {
  const tokens = input.split("-");
  const result: ParsedPlatform = { raw: input };

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (!result.os && OS_MAP[lower]) {
      result.os = OS_MAP[lower];
    } else if (!result.arch && ARCH_MAP[lower]) {
      result.arch = ARCH_MAP[lower];
    } else if (!result.abi && ABI_SET.has(lower)) {
      result.abi = lower === "glibc" ? "gnu" : lower;
    } else if (!result.variant && VARIANT_SET.has(lower)) {
      result.variant = lower;
    } else if (!result.vendor && VENDOR_SET.has(lower)) {
      result.vendor = lower;
    }
  }

  // Clean up: remove undefined fields
  if (result.os === undefined) delete result.os;
  if (result.arch === undefined) delete result.arch;
  if (result.vendor === undefined) delete result.vendor;
  if (result.abi === undefined) delete result.abi;
  if (result.variant === undefined) delete result.variant;

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/assets/platform-parser.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assets/platform-parser.ts packages/core/tests/unit/assets/platform-parser.test.ts
git commit -m "feat(core): add platform parser with OS/Arch/ABI/Variant tables"
```

---

## Task 3: Hasher

**Files:**
- Create: `packages/core/src/assets/hasher.ts`
- Create: `packages/core/tests/unit/assets/hasher.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/tests/unit/assets/hasher.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSha256 } from "../../../src/assets/hasher.js";

describe("computeSha256", () => {
  it("computes correct sha256 for known content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hasher-test-"));
    const file = join(dir, "test.txt");
    writeFileSync(file, "hello world");

    const hash = await computeSha256(file);
    // sha256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hash).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("computes different hash for different content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hasher-test-"));
    const f1 = join(dir, "a.txt");
    const f2 = join(dir, "b.txt");
    writeFileSync(f1, "aaa");
    writeFileSync(f2, "bbb");

    const h1 = await computeSha256(f1);
    const h2 = await computeSha256(f2);
    expect(h1).not.toBe(h2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/assets/hasher.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement hasher.ts**

```typescript
// packages/core/src/assets/hasher.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function computeSha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/assets/hasher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assets/hasher.ts packages/core/tests/unit/assets/hasher.test.ts
git commit -m "feat(core): add async SHA-256 hasher"
```

---

## Task 4: Namer

**Files:**
- Create: `packages/core/src/assets/namer.ts`
- Create: `packages/core/tests/unit/assets/namer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/tests/unit/assets/namer.test.ts
import { describe, expect, it } from "vitest";
import { applyNameTemplate, getExtension } from "../../../src/assets/namer.js";
import type { CompressedAsset } from "../../../src/assets/types.js";

describe("getExtension", () => {
  it("returns .tar.gz for tar.gz format", () => {
    expect(getExtension("tar.gz")).toBe(".tar.gz");
  });

  it("returns .zip for zip format", () => {
    expect(getExtension("zip")).toBe(".zip");
  });

  it("returns .tar.xz for tar.xz format", () => {
    expect(getExtension("tar.xz")).toBe(".tar.xz");
  });

  it("returns .tar.zst for tar.zst format", () => {
    expect(getExtension("tar.zst")).toBe(".tar.zst");
  });

  it("returns empty string for false", () => {
    expect(getExtension(false)).toBe("");
  });
});

describe("applyNameTemplate", () => {
  const baseAsset: CompressedAsset = {
    filePath: "/tmp/compressed/pubm.tar.gz",
    originalPath: "/project/platforms/darwin-arm64/bin/pubm",
    platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
    compressFormat: "tar.gz",
    config: { path: "platforms/*/bin/pubm", compress: "tar.gz", name: "{name}-{platform}" },
  };

  it("substitutes {name} and {platform}", () => {
    const result = applyNameTemplate(baseAsset, { name: "pubm", version: "0.4.0" });
    expect(result).toBe("pubm-darwin-arm64.tar.gz");
  });

  it("substitutes {version}", () => {
    const asset = { ...baseAsset, config: { ...baseAsset.config, name: "{name}-{version}-{os}-{arch}" } };
    const result = applyNameTemplate(asset, { name: "pubm", version: "0.4.0" });
    expect(result).toBe("pubm-0.4.0-darwin-arm64.tar.gz");
  });

  it("substitutes {vendor} and {abi}", () => {
    const asset: CompressedAsset = {
      ...baseAsset,
      platform: { raw: "x86_64-unknown-linux-gnu", os: "linux", arch: "x64", vendor: "unknown", abi: "gnu" },
      config: { ...baseAsset.config, name: "{name}-{arch}-{vendor}-{os}-{abi}" },
    };
    const result = applyNameTemplate(asset, { name: "pubm", version: "1.0.0" });
    expect(result).toBe("pubm-x64-unknown-linux-gnu.tar.gz");
  });

  it("substitutes {filename}", () => {
    const asset = { ...baseAsset, config: { ...baseAsset.config, name: "{filename}-{platform}" } };
    const result = applyNameTemplate(asset, { name: "pubm", version: "0.4.0" });
    expect(result).toBe("pubm-darwin-arm64.tar.gz");
  });

  it("uses original extension for compress: false", () => {
    const asset: CompressedAsset = {
      ...baseAsset,
      originalPath: "/project/dist/myapp.dmg",
      compressFormat: false,
      config: { ...baseAsset.config, compress: false, name: "myapp-{arch}" },
    };
    const result = applyNameTemplate(asset, { name: "myapp", version: "1.0.0" });
    expect(result).toBe("myapp-arm64.dmg");
  });

  it("default name includes platform when detected", () => {
    const asset = { ...baseAsset, config: { ...baseAsset.config, name: "{filename}-{platform}" } };
    const result = applyNameTemplate(asset, { name: "pubm", version: "0.4.0" });
    expect(result).toBe("pubm-darwin-arm64.tar.gz");
  });

  it("removes undefined template vars", () => {
    const asset = { ...baseAsset, config: { ...baseAsset.config, name: "{name}-{variant}-{platform}" } };
    const result = applyNameTemplate(asset, { name: "pubm", version: "0.4.0" });
    // {variant} is undefined, should be removed along with preceding separator
    expect(result).toBe("pubm-darwin-arm64.tar.gz");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/assets/namer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement namer.ts**

```typescript
// packages/core/src/assets/namer.ts
import { extname, basename } from "node:path";
import type { CompressFormat, CompressedAsset } from "./types.js";

export function getExtension(format: CompressFormat | false): string {
  if (format === false) return "";
  return `.${format}`;
}

export function applyNameTemplate(
  asset: CompressedAsset,
  context: { name: string; version: string },
): string {
  const { platform, compressFormat, originalPath, config } = asset;
  const template = config.name;

  const originalExt = extname(originalPath);
  const filename = basename(originalPath, originalExt);

  const vars: Record<string, string | undefined> = {
    name: context.name,
    version: context.version,
    platform: platform.raw || undefined,
    os: platform.os,
    arch: platform.arch,
    vendor: platform.vendor,
    abi: platform.abi,
    variant: platform.variant,
    filename,
  };

  let result = template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    return vars[key] ?? "";
  });

  // Clean up empty segments: remove double separators left by undefined vars
  result = result.replace(/[-_]{2,}/g, (m) => m[0]);
  result = result.replace(/^[-_]+|[-_]+$/g, "");

  // Append extension
  if (compressFormat !== false) {
    result += getExtension(compressFormat);
  } else {
    result += originalExt;
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/assets/namer.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assets/namer.ts packages/core/tests/unit/assets/namer.test.ts
git commit -m "feat(core): add asset name template engine"
```

---

## Task 5: Compressor

**Files:**
- Create: `packages/core/src/assets/compressor.ts`
- Create: `packages/core/tests/unit/assets/compressor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/tests/unit/assets/compressor.test.ts
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isKnownArchive,
  resolveCompressFormat,
  compressFile,
} from "../../../src/assets/compressor.js";

describe("isKnownArchive", () => {
  it("detects .tar.gz", () => expect(isKnownArchive("foo.tar.gz")).toBe(true));
  it("detects .zip", () => expect(isKnownArchive("foo.zip")).toBe(true));
  it("detects .dmg", () => expect(isKnownArchive("foo.dmg")).toBe(true));
  it("detects .msi", () => expect(isKnownArchive("foo.msi")).toBe(true));
  it("detects .deb", () => expect(isKnownArchive("foo.deb")).toBe(true));
  it("detects .wasm", () => expect(isKnownArchive("foo.wasm")).toBe(true));
  it("detects .exe", () => expect(isKnownArchive("foo.exe")).toBe(true));
  it("returns false for raw binary", () => expect(isKnownArchive("pubm")).toBe(false));
  it("returns false for .ts", () => expect(isKnownArchive("foo.ts")).toBe(false));
});

describe("resolveCompressFormat", () => {
  it("returns false for known archive file", () => {
    expect(resolveCompressFormat("foo.dmg", undefined, undefined)).toBe(false);
  });

  it("returns tar.gz for linux raw file (auto)", () => {
    expect(resolveCompressFormat("pubm", "linux", undefined)).toBe("tar.gz");
  });

  it("returns zip for windows raw file (auto)", () => {
    expect(resolveCompressFormat("pubm", "windows", undefined)).toBe("zip");
  });

  it("returns tar.gz for darwin raw file (auto)", () => {
    expect(resolveCompressFormat("pubm", "darwin", undefined)).toBe("tar.gz");
  });

  it("returns explicit format string", () => {
    expect(resolveCompressFormat("pubm", "linux", "zip")).toBe("zip");
  });

  it("returns false for explicit false", () => {
    expect(resolveCompressFormat("pubm", "linux", false)).toBe(false);
  });

  it("resolves OS-specific map", () => {
    const opt = { windows: "zip" as const, linux: "tar.xz" as const };
    expect(resolveCompressFormat("pubm", "linux", opt)).toBe("tar.xz");
    expect(resolveCompressFormat("pubm", "windows", opt)).toBe("zip");
  });

  it("falls back to auto when OS not in map", () => {
    const opt = { windows: "zip" as const };
    expect(resolveCompressFormat("pubm", "darwin", opt)).toBe("tar.gz");
  });
});

describe("compressFile", () => {
  it("creates tar.gz archive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compress-test-"));
    const srcFile = join(dir, "testbin");
    writeFileSync(srcFile, "binary content");
    const outDir = mkdtempSync(join(tmpdir(), "compress-out-"));

    const result = await compressFile(srcFile, outDir, "tar.gz");
    expect(result).toMatch(/\.tar\.gz$/);
    expect(existsSync(result)).toBe(true);
  });

  it("creates zip archive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compress-test-"));
    const srcFile = join(dir, "testbin");
    writeFileSync(srcFile, "binary content");
    const outDir = mkdtempSync(join(tmpdir(), "compress-out-"));

    const result = await compressFile(srcFile, outDir, "zip");
    expect(result).toMatch(/\.zip$/);
    expect(existsSync(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/assets/compressor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement compressor.ts**

```typescript
// packages/core/src/assets/compressor.ts
import { basename, extname, join } from "node:path";
import type { CompressFormat, CompressOption } from "./types.js";
import { exec } from "../utils/exec.js";

const KNOWN_ARCHIVE_EXTENSIONS = new Set([
  ".tar.gz", ".tgz", ".tar.xz", ".tar.zst", ".tar.bz2", ".zip", ".7z",
  ".dmg", ".msi", ".exe", ".deb", ".rpm", ".appimage", ".pkg", ".snap", ".flatpak",
  ".wasm",
]);

export function isKnownArchive(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of KNOWN_ARCHIVE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export function resolveCompressFormat(
  filePath: string,
  os: string | undefined,
  option: CompressOption | undefined,
): CompressFormat | false {
  // Explicit option takes precedence
  if (option === false) return false;
  if (typeof option === "string") return option;

  // OS-specific map
  if (option && typeof option === "object" && os && os in option) {
    return option[os];
  }

  // Auto-detect: known archive → skip
  if (isKnownArchive(filePath)) return false;

  // Auto-detect: OS-aware default
  if (os === "windows") return "zip";
  return "tar.gz";
}

export async function compressFile(
  filePath: string,
  outDir: string,
  format: CompressFormat,
  extraFiles?: string[],
): Promise<string> {
  const file = basename(filePath);
  const dir = join(filePath, "..");
  const archiveName = `${basename(filePath, extname(filePath))}.${format}`;
  const archivePath = join(outDir, archiveName);

  const allFiles = [file, ...(extraFiles?.map((f) => basename(f)) ?? [])];

  switch (format) {
    case "tar.gz":
      await exec("tar", ["-czf", archivePath, "-C", dir, ...allFiles], { throwOnError: true });
      break;
    case "tar.xz":
      await exec("tar", ["-cJf", archivePath, "-C", dir, ...allFiles], { throwOnError: true });
      break;
    case "tar.zst":
      await exec("tar", ["--zstd", "-cf", archivePath, "-C", dir, ...allFiles], { throwOnError: true });
      break;
    case "zip":
      await exec("zip", ["-j", archivePath, filePath, ...(extraFiles ?? [])], { throwOnError: true });
      break;
  }

  return archivePath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/assets/compressor.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assets/compressor.ts packages/core/tests/unit/assets/compressor.test.ts
git commit -m "feat(core): add asset compressor with OS-aware format detection"
```

---

## Task 6: Resolver

**Files:**
- Create: `packages/core/src/assets/resolver.ts`
- Create: `packages/core/tests/unit/assets/resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Tests should cover:
- Normalizing string config to ReleaseAssetGroupConfig
- Normalizing string file entries to ReleaseAssetFileConfig
- Merging compress cascade: file > group > global > auto
- Extracting capture variables from path patterns (`{platform}`, `{os}`, `{arch}`)
- Glob matching (mock fs)
- Generating default name template (`{filename}-{platform}` when platform detected, `{filename}` otherwise)

```typescript
// packages/core/tests/unit/assets/resolver.test.ts
import { describe, expect, it } from "vitest";
import {
  normalizeConfig,
  extractCaptureVars,
  pathPatternToGlob,
} from "../../../src/assets/resolver.js";
import type { CompressOption, ReleaseAssetEntry } from "../../../src/assets/types.js";

describe("normalizeConfig", () => {
  it("normalizes string entry to group with single file", () => {
    const result = normalizeConfig(["platforms/*/bin/pubm"], undefined);
    expect(result).toEqual([
      {
        files: [{ path: "platforms/*/bin/pubm", compress: undefined, name: undefined }],
      },
    ]);
  });

  it("normalizes group with string files", () => {
    const entry: ReleaseAssetEntry = {
      packagePath: "packages/pubm",
      files: ["platforms/*/bin/pubm"],
      compress: "tar.gz",
      name: "{name}-{platform}",
    };
    const result = normalizeConfig([entry], undefined);
    expect(result[0].packagePath).toBe("packages/pubm");
    expect(result[0].files[0]).toEqual({
      path: "platforms/*/bin/pubm",
      compress: undefined,
      name: undefined,
    });
  });
});

describe("extractCaptureVars", () => {
  it("extracts {platform} from path", () => {
    const result = extractCaptureVars("platforms/{platform}/bin/pubm", "platforms/darwin-arm64/bin/pubm");
    expect(result).toEqual({ platform: "darwin-arm64" });
  });

  it("extracts {os} and {arch}", () => {
    const result = extractCaptureVars("platforms/{os}-{arch}/bin/pubm", "platforms/darwin-arm64/bin/pubm");
    expect(result).toEqual({ os: "darwin", arch: "arm64" });
  });

  it("extracts {arch}-{vendor}-{os}-{abi}", () => {
    const result = extractCaptureVars(
      "target/{arch}-{vendor}-{os}-{abi}/release/myapp",
      "target/x86_64-unknown-linux-gnu/release/myapp",
    );
    expect(result).toEqual({ arch: "x86_64", vendor: "unknown", os: "linux", abi: "gnu" });
  });

  it("returns empty for no captures", () => {
    const result = extractCaptureVars("platforms/*/bin/pubm", "platforms/darwin-arm64/bin/pubm");
    expect(result).toEqual({});
  });
});

describe("pathPatternToGlob", () => {
  it("replaces {platform} with *", () => {
    expect(pathPatternToGlob("platforms/{platform}/bin/pubm")).toBe("platforms/*/bin/pubm");
  });

  it("replaces {os}-{arch} with *", () => {
    expect(pathPatternToGlob("platforms/{os}-{arch}/bin/pubm")).toBe("platforms/*-*/bin/pubm");
  });

  it("passes through plain globs", () => {
    expect(pathPatternToGlob("dist/*.dmg")).toBe("dist/*.dmg");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/assets/resolver.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement resolver.ts**

This module handles:
1. `normalizeConfig()` — convert `ReleaseAssetEntry[]` + global compress to normalized internal format
2. `pathPatternToGlob()` — convert `{var}` capture patterns to `*` globs
3. `extractCaptureVars()` — given a pattern and actual path, extract named variables
4. `resolveAssets()` — the main function: glob match + platform parse + compress resolve → `ResolvedAsset[]`

```typescript
// packages/core/src/assets/resolver.ts
import { Glob } from "bun";
import { resolve, relative, basename, extname } from "node:path";
import type {
  CompressOption,
  ReleaseAssetEntry,
  ReleaseAssetFileConfig,
  ReleaseAssetGroupConfig,
  ResolvedAsset,
  ResolvedAssetFileConfig,
  ResolvedReleaseAssetConfig,
} from "./types.js";
import { parsePlatform } from "./platform-parser.js";
import { resolveCompressFormat } from "./compressor.js";

interface NormalizedGroup {
  packagePath?: string;
  files: { path: string; compress?: CompressOption; name?: string }[];
  compress?: CompressOption;
  name?: string;
}

export function normalizeConfig(
  entries: ReleaseAssetEntry[],
  globalCompress: CompressOption | undefined,
): NormalizedGroup[] {
  return entries.map((entry) => {
    if (typeof entry === "string") {
      return {
        files: [{ path: entry, compress: undefined, name: undefined }],
      };
    }
    return {
      packagePath: entry.packagePath,
      compress: entry.compress,
      name: entry.name,
      files: entry.files.map((f) => {
        if (typeof f === "string") {
          return { path: f, compress: undefined, name: undefined };
        }
        return { path: f.path, compress: f.compress, name: f.name };
      }),
    };
  });
}

export function pathPatternToGlob(pattern: string): string {
  return pattern.replace(/\{[^}]+\}/g, "*");
}

export function extractCaptureVars(
  pattern: string,
  actualPath: string,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const captureNames: string[] = [];

  // Build a regex from the pattern.
  // For captures separated by -, use [^/-]+ (single token).
  // For {platform} (which may span hyphens), use [^/]+.
  const regexStr = pattern.replace(/\{(\w+)\}/g, (_m, name: string) => {
    captureNames.push(name);
    return name === "platform" ? "([^/]+)" : "([^/-]+)";
  });

  if (captureNames.length === 0) return vars;

  const match = actualPath.match(new RegExp(`^${regexStr}$`));
  if (match) {
    for (let i = 0; i < captureNames.length; i++) {
      vars[captureNames[i]] = match[i + 1];
    }
  }

  return vars;
}

export function resolveAssets(
  config: NormalizedGroup,
  globalCompress: CompressOption | undefined,
  cwd: string,
): ResolvedAsset[] {
  const results: ResolvedAsset[] = [];

  for (const file of config.files) {
    const globPattern = pathPatternToGlob(file.path);
    const baseDir = resolve(cwd, config.packagePath ?? "");
    const glob = new Glob(globPattern);
    const matches = [...glob.scanSync({ cwd: baseDir, absolute: true })];

    for (const matchPath of matches) {
      const relPath = relative(resolve(cwd, config.packagePath ?? ""), matchPath);

      // Extract capture variables or auto-parse platform
      const capturedVars = extractCaptureVars(file.path, relPath);
      let platform;
      if (Object.keys(capturedVars).length > 0) {
        if (capturedVars.platform) {
          platform = parsePlatform(capturedVars.platform);
        } else {
          // Individual captures: build platform from them
          platform = {
            raw: [capturedVars.os, capturedVars.arch].filter(Boolean).join("-"),
            ...capturedVars,
          };
        }
      } else {
        // Auto-parse from path segments
        const segments = relPath.split("/");
        for (const seg of segments) {
          const parsed = parsePlatform(seg);
          if (parsed.os || parsed.arch) {
            platform = parsed;
            break;
          }
        }
        if (!platform) {
          platform = { raw: "" };
        }
      }

      // Resolve compress: file > group > global > auto
      const compress = resolveCompressFormat(
        matchPath,
        platform.os,
        file.compress ?? config.compress ?? globalCompress,
      );

      // Resolve name template
      const defaultName = platform.os || platform.arch
        ? "{filename}-{platform}"
        : "{filename}";
      const nameTemplate = file.name ?? config.name ?? defaultName;

      results.push({
        filePath: matchPath,
        platform,
        config: {
          path: file.path,
          compress,
          name: nameTemplate,
        },
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/assets/resolver.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assets/resolver.ts packages/core/tests/unit/assets/resolver.test.ts
git commit -m "feat(core): add asset resolver with glob matching and capture variables"
```

---

## Task 7: Pipeline Orchestrator

**Files:**
- Create: `packages/core/src/assets/pipeline.ts`
- Create: `packages/core/tests/unit/assets/pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

Test the pipeline orchestration: hook execution order, default behavior without hooks, hook transformations.

```typescript
// packages/core/tests/unit/assets/pipeline.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAssetPipeline } from "../../../src/assets/pipeline.js";
import type {
  ResolvedAsset,
  CompressedAsset,
  PreparedAsset,
  AssetPipelineHooks,
} from "../../../src/assets/types.js";

// Helpers to create real files for the pipeline
function createTempBinary(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
  const file = join(dir, name);
  writeFileSync(file, "fake binary content");
  return file;
}

describe("runAssetPipeline", () => {
  it("runs with no hooks — uses defaults", async () => {
    const filePath = createTempBinary("pubm");
    const resolved: ResolvedAsset[] = [
      {
        filePath,
        platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
        config: { path: "platforms/*/bin/pubm", compress: "tar.gz", name: "{filename}-{platform}" },
      },
    ];

    const hooks: AssetPipelineHooks = {};
    const result = await runAssetPipeline(resolved, hooks, {
      name: "pubm",
      version: "0.4.0",
      tempDir: mkdtempSync(join(tmpdir(), "pipeline-temp-")),
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("pubm-darwin-arm64.tar.gz");
    expect(result[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result[0].compressFormat).toBe("tar.gz");
  });

  it("calls resolveAssets hook", async () => {
    const filePath = createTempBinary("pubm");
    const resolved: ResolvedAsset[] = [
      {
        filePath,
        platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
        config: { path: "test", compress: false, name: "{filename}" },
      },
    ];

    const resolveHook = vi.fn((assets: ResolvedAsset[]) => {
      // Filter: remove all assets (simulate filtering)
      return [];
    });

    const result = await runAssetPipeline(resolved, { resolveAssets: resolveHook }, {
      name: "test",
      version: "1.0.0",
      tempDir: mkdtempSync(join(tmpdir(), "pipeline-temp-")),
    });

    expect(resolveHook).toHaveBeenCalledOnce();
    expect(result).toHaveLength(0);
  });

  it("calls nameAsset hook", async () => {
    const filePath = createTempBinary("pubm");
    const resolved: ResolvedAsset[] = [
      {
        filePath,
        platform: { raw: "linux-x64", os: "linux", arch: "x64" },
        config: { path: "test", compress: false, name: "{filename}" },
      },
    ];

    const result = await runAssetPipeline(
      resolved,
      { nameAsset: () => "custom-name.bin" },
      { name: "test", version: "1.0.0", tempDir: mkdtempSync(join(tmpdir(), "pipeline-temp-")) },
    );

    expect(result[0].name).toBe("custom-name.bin");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/assets/pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement pipeline.ts**

```typescript
// packages/core/src/assets/pipeline.ts
import type {
  AssetPipelineHooks,
  CompressedAsset,
  PreparedAsset,
  ResolvedAsset,
  TransformedAsset,
} from "./types.js";
import { compressFile } from "./compressor.js";
import { applyNameTemplate } from "./namer.js";
import { computeSha256 } from "./hasher.js";

export interface PipelineContext {
  /** Package name (scope removed) */
  name: string;
  /** Release version */
  version: string;
  /** Temp directory for compressed archives */
  tempDir: string;
  /** Full PubmContext — passed through to plugin hooks */
  pubmContext?: unknown;
}

export async function runAssetPipeline(
  resolved: ResolvedAsset[],
  hooks: AssetPipelineHooks,
  ctx: PipelineContext,
): Promise<PreparedAsset[]> {
  // Plugin hooks receive the full PubmContext if available, else the pipeline context
  const hookCtx = ctx.pubmContext ?? ctx;

  // 1. Resolve hook
  let assets = resolved;
  if (hooks.resolveAssets) {
    assets = await hooks.resolveAssets(assets, hookCtx as any);
  }

  // 2. Transform
  let transformed: TransformedAsset[] = [];
  for (const asset of assets) {
    if (hooks.transformAsset) {
      const result = await hooks.transformAsset(asset, hookCtx as any);
      transformed.push(...(Array.isArray(result) ? result : [result]));
    } else {
      transformed.push(asset);
    }
  }

  // 3. Compress
  const compressed: CompressedAsset[] = [];
  for (const asset of transformed) {
    if (hooks.compressAsset) {
      compressed.push(await hooks.compressAsset(asset, hookCtx as any));
    } else {
      compressed.push(await defaultCompress(asset, ctx.tempDir));
    }
  }

  // 4. Name + 5. Hash
  let prepared: PreparedAsset[] = await Promise.all(
    compressed.map(async (a) => ({
      ...a,
      name: hooks.nameAsset
        ? hooks.nameAsset(a, hookCtx as any)
        : applyNameTemplate(a, ctx),
      sha256: await computeSha256(a.filePath),
    })),
  );

  // 6. Checksums
  if (hooks.generateChecksums) {
    prepared = await hooks.generateChecksums(prepared, hookCtx as any);
  }

  return prepared;
}

async function defaultCompress(
  asset: TransformedAsset,
  tempDir: string,
): Promise<CompressedAsset> {
  const { config, filePath, platform } = asset;

  if (config.compress === false) {
    return {
      filePath,
      originalPath: filePath,
      platform,
      compressFormat: false,
      config,
    };
  }

  const archivePath = await compressFile(
    filePath,
    tempDir,
    config.compress,
    asset.extraFiles,
  );

  return {
    filePath: archivePath,
    originalPath: filePath,
    platform,
    compressFormat: config.compress,
    config,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/assets/pipeline.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assets/pipeline.ts packages/core/tests/unit/assets/pipeline.test.ts
git commit -m "feat(core): add asset pipeline orchestrator with hook support"
```

---

## Task 8: Barrel Export + Config Types

**Files:**
- Create: `packages/core/src/assets/index.ts`
- Modify: `packages/core/src/config/types.ts`
- Modify: `packages/core/src/context.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// packages/core/src/assets/index.ts
export type {
  CompressFormat,
  CompressOption,
  CompressedAsset,
  ParsedPlatform,
  PreparedAsset,
  ReleaseAsset,
  ReleaseAssetEntry,
  ReleaseAssetFileConfig,
  ReleaseAssetGroupConfig,
  ReleaseContext,
  ResolvedAsset,
  ResolvedAssetFileConfig,
  ResolvedReleaseAssetConfig,
  TransformedAsset,
  UploadedAsset,
} from "./types.js";
export { parsePlatform } from "./platform-parser.js";
export { runAssetPipeline } from "./pipeline.js";
export type { PipelineContext } from "./pipeline.js";
```

- [ ] **Step 2: Add releaseAssets and compress to PubmConfig**

In `packages/core/src/config/types.ts`, add after the existing fields in PubmConfig (around line 50):

```typescript
import type { CompressOption, ReleaseAssetEntry } from "../assets/types.js";
// Add to PubmConfig interface:
  compress?: CompressOption;
  releaseAssets?: ReleaseAssetEntry[];
```

- [ ] **Step 3: Add tempDir to PubmContext.runtime**

In `packages/core/src/context.ts`, add `tempDir?: string;` to the runtime object (around line 70).

- [ ] **Step 4: Update core index.ts exports**

In `packages/core/src/index.ts`, replace the existing `ReleaseAsset, ReleaseContext` export from `github-release.js` with the new asset types:

```typescript
// Replace line 115:
// export type { ReleaseAsset, ReleaseContext } from "./tasks/github-release.js";
// With:
export type {
  CompressFormat,
  CompressOption,
  CompressedAsset,
  ParsedPlatform,
  PreparedAsset,
  ReleaseAsset,
  ReleaseAssetEntry,
  ReleaseAssetFileConfig,
  ReleaseAssetGroupConfig,
  ReleaseContext,
  ResolvedAsset,
  ResolvedAssetFileConfig,
  TransformedAsset,
  UploadedAsset,
} from "./assets/index.js";
export { parsePlatform, runAssetPipeline } from "./assets/index.js";
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd packages/core && bun run typecheck`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/assets/index.ts packages/core/src/config/types.ts packages/core/src/context.ts packages/core/src/index.ts
git commit -m "feat(core): wire up asset pipeline types and exports"
```

---

## Task 9: Plugin Interface Extension

**Files:**
- Modify: `packages/core/src/plugin/types.ts`
- Modify: `packages/core/src/plugin/runner.ts`

- [ ] **Step 1: Add AssetPipelineHooks to plugin types**

In `packages/core/src/plugin/types.ts`:

Add import at top:
```typescript
import type {
  CompressedAsset,
  PreparedAsset,
  ReleaseContext,
  ResolvedAsset,
  TransformedAsset,
  UploadedAsset,
} from "../assets/types.js";
```

Add the `AssetPipelineHooks` interface after the existing hook types. Add the 6 new hooks to `PluginHooks`. Update `AfterReleaseHookFn` to use the new `ReleaseContext` from `../assets/types.js` (remove the import from `../tasks/github-release.js`).

Export `AssetPipelineHooks` type.

- [ ] **Step 2: Add hook collection methods to PluginRunner**

In `packages/core/src/plugin/runner.ts`, add a method to collect asset pipeline hooks from all plugins:

```typescript
collectAssetHooks(): AssetPipelineHooks {
  const collected: AssetPipelineHooks = {};

  // For chaining hooks (resolveAssets, generateChecksums)
  const resolveChain = this.plugins
    .map((p) => p.hooks?.resolveAssets)
    .filter(Boolean);
  if (resolveChain.length > 0) {
    collected.resolveAssets = async (assets, ctx) => {
      let result = assets;
      for (const hook of resolveChain) {
        result = await hook!(result, ctx);
      }
      return result;
    };
  }

  // Similar for other hooks...
  // (transformAsset, compressAsset, nameAsset chain; generateChecksums chains; uploadAssets concats)

  return collected;
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd packages/core && bun run typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/plugin/types.ts packages/core/src/plugin/runner.ts
git commit -m "feat(core): add asset pipeline hooks to plugin interface"
```

---

## Task 10: Refactor github-release.ts

**Files:**
- Modify: `packages/core/src/tasks/github-release.ts`
- Modify: `packages/core/tests/unit/tasks/github-release.test.ts`

- [ ] **Step 1: Remove old functions from github-release.ts**

Remove these functions:
- `discoverPlatformBinaries` (lines 58-83)
- `sha256` (lines 88-91)
- `compressBinary` (lines 96-110)

Remove the old `ReleaseAsset` and `ReleaseContext` interfaces (lines 13-25) — they now come from `assets/types.ts`.

Update `createGitHubRelease` to accept `assets: PreparedAsset[]` parameter and only handle GitHub API release creation + upload of provided assets. Keep the release notes, tag creation, and upload logic. Remove the binary discovery block (lines 211-265).

- [ ] **Step 2: Update the function signature**

```typescript
import type { PreparedAsset, ReleaseContext, ReleaseAsset } from "../assets/types.js";

export async function createGitHubRelease(
  _ctx: PubmContext,
  options: {
    packageName: string;
    version: string;
    tag: string;
    changelogBody?: string;
    assets: PreparedAsset[];
  },
): Promise<ReleaseContext | null> {
  // ... existing release creation logic (lines 146-209) ...

  // Replace binary discovery + upload block with:
  const releaseAssets: ReleaseAsset[] = [];

  for (const asset of options.assets) {
    const archiveContent = readFileSync(asset.filePath);

    const uploadResponse = await fetch(
      `${uploadUrl}?name=${encodeURIComponent(asset.name)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/octet-stream",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: archiveContent,
      },
    );

    if (!uploadResponse.ok) {
      const errorBody = await uploadResponse.text();
      throw new GitHubReleaseError(
        `Failed to upload asset ${asset.name} (${uploadResponse.status}): ${errorBody}`,
      );
    }

    const uploaded = (await uploadResponse.json()) as { browser_download_url: string };
    releaseAssets.push({
      name: asset.name,
      url: uploaded.browser_download_url,
      sha256: asset.sha256,
      platform: asset.platform,
    });
  }

  return {
    packageName: options.packageName,
    version: options.version,
    tag: options.tag,
    releaseUrl,
    assets: releaseAssets,
  };
}
```

- [ ] **Step 3: Update existing tests**

Update `packages/core/tests/unit/tasks/github-release.test.ts` to pass `assets: []` or `assets: [mockPreparedAsset]` to `createGitHubRelease`. Remove tests for `discoverPlatformBinaries`, `sha256`, `compressBinary` (these are now covered by asset module tests).

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/github-release.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/github-release.ts packages/core/tests/unit/tasks/github-release.test.ts
git commit -m "refactor(core): strip github-release to upload-only, accept PreparedAsset[]"
```

---

## Task 11: Wire Pipeline into Runner

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`
- Modify: `packages/core/tests/unit/tasks/runner-coverage.test.ts`

- [ ] **Step 1: Import pipeline and hook collection**

Add imports at top of `runner.ts`:
```typescript
import { runAssetPipeline } from "../assets/pipeline.js";
import { normalizeConfig, resolveAssets } from "../assets/resolver.js";
```

- [ ] **Step 2: Update both createGitHubRelease call sites**

At both call sites (around lines 643 and 710), insert the asset pipeline before `createGitHubRelease`:

```typescript
// Collect hooks from plugins
const assetHooks = ctx.runtime.pluginRunner.collectAssetHooks();

// Run asset pipeline
const assetConfig = ctx.config.releaseAssets ?? [];
const normalizedGroups = normalizeConfig(assetConfig, ctx.config.compress);
// Filter for this package's assets
const relevantGroup = normalizedGroups.find(
  (g) => !g.packagePath || g.packagePath === packagePath,
) ?? { files: [] };

const tempDir = join(tmpdir(), `pubm-assets-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
ctx.runtime.tempDir = tempDir;

const resolvedAssets = resolveAssets(relevantGroup, ctx.config.compress, ctx.cwd);
const preparedAssets = await runAssetPipeline(resolvedAssets, assetHooks, {
  name: packageName,
  version,
  tempDir,
  pubmContext: ctx,  // Full PubmContext for plugin hooks
});

const result = await createGitHubRelease(ctx, {
  packageName,
  version,
  tag,
  changelogBody,
  assets: preparedAssets,
});

if (result) {
  // Additional upload targets (plugin hooks)
  if (assetHooks.uploadAssets) {
    const additional = await assetHooks.uploadAssets(preparedAssets, ctx);
    result.assets.push(
      ...additional.map((a) => ({
        name: a.name,
        url: a.url,
        sha256: a.sha256,
        platform: a.platform,
      })),
    );
  }

  task.output = `Release created: ${result.releaseUrl}`;
  await ctx.runtime.pluginRunner.runAfterReleaseHook(ctx, result);
}

// Cleanup temp
rmSync(tempDir, { recursive: true, force: true });
```

- [ ] **Step 3: Update runner tests**

Update `runner-coverage.test.ts` mocks: mock `../assets/pipeline.js` and `../assets/resolver.js`. The `createGitHubRelease` mock should now expect the `assets` parameter.

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner-coverage.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `cd packages/core && bun run test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tasks/runner.ts packages/core/tests/unit/tasks/runner-coverage.test.ts
git commit -m "feat(core): wire asset pipeline into publish runner"
```

---

## Task 12: Brew Plugin Migration

**Files:**
- Modify: `packages/plugins/plugin-brew/src/types.ts`
- Modify: `packages/plugins/plugin-brew/src/formula.ts`
- Modify: `packages/plugins/plugin-brew/src/brew-tap.ts`
- Modify: `packages/plugins/plugin-brew/src/brew-core.ts`
- Modify: `packages/plugins/plugin-brew/tests/unit/formula.test.ts`
- Modify: `packages/plugins/plugin-brew/tests/unit/brew-tap.test.ts`
- Modify: `packages/plugins/plugin-brew/tests/unit/brew-core.test.ts`

- [ ] **Step 1: Add assetPlatforms to types.ts**

```typescript
// packages/plugins/plugin-brew/src/types.ts
import type { ReleaseAsset } from "@pubm/core";

export type AssetPlatformMatcher = (asset: ReleaseAsset) => boolean;

export interface BrewTapOptions {
  formula: string;
  repo?: string;
  packageName?: string;
  assetPlatforms?: Record<string, AssetPlatformMatcher>;
}

export interface BrewCoreOptions {
  formula: string;
  packageName?: string;
  assetPlatforms?: Record<string, AssetPlatformMatcher>;
}
```

- [ ] **Step 2: Replace mapReleaseAssets with matchAssetToPlatform in formula.ts**

Remove `mapReleaseAssets()` function. Add:

```typescript
import type { ReleaseAsset } from "@pubm/core";
import type { AssetPlatformMatcher } from "./types.js";

const FORMULA_PLATFORMS = {
  "darwin-arm64": { os: "darwin", arch: "arm64" },
  "darwin-x64": { os: "darwin", arch: "x64" },
  "linux-arm64": { os: "linux", arch: "arm64" },
  "linux-x64": { os: "linux", arch: "x64" },
} as const;

export type FormulaPlatformKey = keyof typeof FORMULA_PLATFORMS;

export function matchAssetToPlatform(
  assets: ReleaseAsset[],
  formulaPlatform: FormulaPlatformKey,
  customMatcher?: AssetPlatformMatcher,
): ReleaseAsset | undefined {
  if (customMatcher) return assets.find(customMatcher);
  const { os, arch } = FORMULA_PLATFORMS[formulaPlatform];
  return assets.find(
    (a) => a.platform.os === os && a.platform.arch === arch,
  );
}
```

Update `updateFormula()` and `generateFormula()` to use `ReleaseAsset` with platform object instead of `FormulaAsset`.

- [ ] **Step 3: Update brew-tap.ts and brew-core.ts**

Replace `mapReleaseAssets(releaseCtx.assets)` calls with `matchAssetToPlatform()` calls. Pass `options.assetPlatforms?.[platform]` as the custom matcher.

- [ ] **Step 4: Update tests**

Update formula.test.ts, brew-tap.test.ts, brew-core.test.ts to use `ReleaseAsset` with `platform: { raw, os, arch }` instead of the old `{ name, url, sha256 }` shape.

- [ ] **Step 5: Run brew plugin tests**

Run: `cd packages/plugins/plugin-brew && bun run test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/plugins/plugin-brew/
git commit -m "refactor(plugin-brew): use ParsedPlatform for asset matching"
```

---

## Task 13: Full Integration Verification

- [ ] **Step 1: Run all tests**

Run: `bun run test`
Expected: All packages pass

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Run format check**

Run: `bun run format`
Expected: Clean or auto-fixed

- [ ] **Step 4: Run coverage**

Run: `bun run coverage`
Expected: Coverage thresholds met (95% lines/functions/statements, 90% branches)

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint/format issues from asset pipeline integration"
```

---

## Task 14: Website Documentation

**Files:**
- Modify: `website/src/content/docs/guides/configuration.mdx`
- Modify: `website/src/content/docs/guides/ci-cd.mdx`
- Modify: `website/src/content/docs/reference/sdk.mdx`
- Modify: `website/src/content/docs/reference/plugins.mdx`
- Modify: `website/src/content/docs/reference/official-plugins.mdx`
- Create: `website/src/content/docs/guides/release-assets.mdx`
- Create: `website/src/content/docs/reference/platform-detection.mdx`
- Create: `website/src/content/docs/guides/asset-pipeline-hooks.mdx`

- [ ] **Step 1: Create guides/release-assets.mdx**

Concept guide covering:
- What are release assets and why you need them
- Basic config: string glob for simple cases
- Full config: object with packagePath, files, compress, name
- OS-aware compression defaults
- Name template variables
- Use case examples: CLI binaries, desktop apps (.dmg, .msi), WASM

- [ ] **Step 2: Create reference/platform-detection.mdx**

Reference doc covering:
- Full OS table (canonical + aliases)
- Full Arch table (canonical + aliases)
- Full ABI table
- Full Variant table
- Vendor table
- Auto-parsing algorithm
- Path capture variables (`{platform}`, `{os}`, `{arch}`, etc.)

- [ ] **Step 3: Create guides/asset-pipeline-hooks.mdx**

Plugin developer guide covering:
- Pipeline stages diagram
- Each hook: when it fires, input/output types, use cases
- Examples: code signing, checksums, S3 upload
- Multi-plugin composition rules

- [ ] **Step 4: Update guides/configuration.mdx**

Add `releaseAssets` config section with examples.

- [ ] **Step 5: Update guides/ci-cd.mdx**

Add GitHub Release asset handling in CI, `GITHUB_TOKEN` requirement.

- [ ] **Step 6: Update reference/sdk.mdx**

Add asset pipeline types: `ReleaseContext`, `ReleaseAsset`, `ParsedPlatform`, `PreparedAsset`, etc.

- [ ] **Step 7: Update reference/plugins.mdx**

Document all 6 new asset pipeline hooks in the hooks reference section.

- [ ] **Step 8: Update reference/official-plugins.mdx**

Update brew plugin section: `assetPlatforms` option, new matching behavior.

- [ ] **Step 9: Build docs to verify**

Run: `bun run build:site`
Expected: Build succeeds, no broken links

- [ ] **Step 10: Commit**

```bash
git add website/
git commit -m "docs: add release assets guide, platform detection reference, and pipeline hooks guide"
```
