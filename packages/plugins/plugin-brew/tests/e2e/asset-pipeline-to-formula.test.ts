import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

vi.mock("../../src/git-identity.js", () => ({
  ensureGitIdentity: vi.fn(),
}));

import { normalizeConfig, resolveAssets, runAssetPipeline } from "@pubm/core";
import { brewTap } from "../../src/brew-tap.js";

const tmpRoot = join(import.meta.dirname, ".tmp-e2e-asset-pipeline");
const originalCwd = process.cwd();

describe("asset pipeline → brew formula E2E", () => {
  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    process.chdir(tmpRoot);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  /**
   * Regression test for the original bug:
   * "chore(brew): update formula to 0.4.0" committed with version bumped
   * but sha256 remained as PLACEHOLDER because discoverPlatformBinaries
   * used a hardcoded path that didn't match the actual project structure.
   *
   * This test verifies the full flow:
   * 1. Platform binaries exist at configurable paths
   * 2. Asset pipeline resolves, compresses, and hashes them
   * 3. Brew plugin receives assets with correct sha256 and platform info
   * 4. Formula is updated with real sha256 values, not PLACEHOLDER
   */
  it("updates formula sha256 from PLACEHOLDER to real hash via asset pipeline", async () => {
    // 1. Set up project structure with platform binaries
    const platforms = [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-arm64-musl",
      "linux-x64",
      "linux-x64-musl",
    ];
    for (const platform of platforms) {
      const binDir = join(tmpRoot, "platforms", platform, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "myapp"), `binary-${platform}`);
    }

    // 2. Create initial formula with PLACEHOLDER sha256 (including musl branches)
    mkdirSync(join(tmpRoot, "Formula"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "Formula/myapp.rb"),
      [
        "class Myapp < Formula",
        '  version "0.3.0"',
        "",
        "  on_macos do",
        "    if Hardware::CPU.arm?",
        '      url "https://github.com/example/myapp/releases/download/v0.3.0/myapp-darwin-arm64.tar.gz"',
        '      sha256 "PLACEHOLDER"',
        "    elsif Hardware::CPU.intel?",
        '      url "https://github.com/example/myapp/releases/download/v0.3.0/myapp-darwin-x64.tar.gz"',
        '      sha256 "PLACEHOLDER"',
        "    end",
        "  end",
        "",
        "  on_linux do",
        "    if Hardware::CPU.arm?",
        "      if OS::Linux.libc_is_musl?",
        '        url "https://github.com/example/myapp/releases/download/v0.3.0/myapp-linux-arm64-musl.tar.gz"',
        '        sha256 "PLACEHOLDER"',
        "      else",
        '        url "https://github.com/example/myapp/releases/download/v0.3.0/myapp-linux-arm64.tar.gz"',
        '        sha256 "PLACEHOLDER"',
        "      end",
        "    elsif Hardware::CPU.intel?",
        "      if OS::Linux.libc_is_musl?",
        '        url "https://github.com/example/myapp/releases/download/v0.3.0/myapp-linux-x64-musl.tar.gz"',
        '        sha256 "PLACEHOLDER"',
        "      else",
        '        url "https://github.com/example/myapp/releases/download/v0.3.0/myapp-linux-x64.tar.gz"',
        '        sha256 "PLACEHOLDER"',
        "      end",
        "    end",
        "  end",
        "end",
        "",
      ].join("\n"),
    );

    // 3. Run asset pipeline with compress: false (compression is unit-tested separately)
    const assetConfig = [
      {
        files: [
          {
            path: "platforms/{platform}/bin/myapp",
            compress: false as const,
            name: "myapp-{platform}",
          },
        ],
      },
    ];
    const normalized = normalizeConfig(assetConfig as any, undefined);
    const resolved = resolveAssets(normalized[0], undefined, tmpRoot);

    // Verify platform was correctly parsed for all assets
    expect(resolved).toHaveLength(6);
    for (const asset of resolved) {
      expect(asset.platform.os).toBeDefined();
      expect(asset.platform.arch).toBeDefined();
    }

    const tempDir = mkdtempSync(join(tmpdir(), "e2e-pipeline-"));
    const prepared = await runAssetPipeline(
      resolved,
      {},
      {
        name: "myapp",
        version: "0.4.0",
        tempDir,
      },
    );

    // Verify all 6 assets were prepared with real sha256
    expect(prepared).toHaveLength(6);
    for (const asset of prepared) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.sha256).not.toBe("PLACEHOLDER");
      expect(asset.platform.os).toBeDefined();
      expect(asset.platform.arch).toBeDefined();
    }

    // 4. Simulate GitHub Release upload result (what createGitHubRelease would return)
    const releaseAssets = prepared.map((a) => ({
      name: a.name,
      url: `https://github.com/example/myapp/releases/download/v0.4.0/${a.name}`,
      sha256: a.sha256,
      platform: a.platform,
    }));

    // 5. Run brew plugin afterRelease hook
    const plugin = brewTap({ formula: "Formula/myapp.rb" });
    await plugin.hooks?.afterRelease?.(
      {} as never,
      {
        packageName: "myapp",
        version: "0.4.0",
        tag: "v0.4.0",
        releaseUrl: "https://github.com/example/myapp/releases/tag/v0.4.0",
        assets: releaseAssets,
      } as never,
    );

    // 6. Verify formula was updated with REAL sha256 values
    const formula = readFileSync(join(tmpRoot, "Formula/myapp.rb"), "utf-8");

    expect(formula).toContain('version "0.4.0"');
    expect(formula).not.toContain("PLACEHOLDER");

    // Verify each platform has a real sha256
    for (const platform of platforms) {
      const asset = releaseAssets.find((a) => a.name === `myapp-${platform}`);
      expect(asset).toBeDefined();
      expect(formula).toContain(`sha256 "${asset!.sha256}"`);
      expect(formula).toContain(
        `url "https://github.com/example/myapp/releases/download/v0.4.0/${asset!.name}"`,
      );
    }

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves OS aliases in {os}-{arch} captures for correct brew matching", async () => {
    // Create binaries with aliased names (win, macos instead of windows, darwin)
    const aliasedPlatforms = [
      { dir: "macos-aarch64", expectedOs: "darwin", expectedArch: "arm64" },
      { dir: "win-x64", expectedOs: "windows", expectedArch: "x64" },
      { dir: "linux-amd64", expectedOs: "linux", expectedArch: "x64" },
    ];

    for (const { dir } of aliasedPlatforms) {
      const binDir = join(tmpRoot, "platforms", dir, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "myapp"), `binary-${dir}`);
    }

    const normalized = normalizeConfig(
      [{ files: ["platforms/{os}-{arch}/bin/myapp"] }] as any,
      undefined,
    );
    const resolved = resolveAssets(normalized[0], undefined, tmpRoot);

    expect(resolved).toHaveLength(3);

    for (const { dir, expectedOs, expectedArch } of aliasedPlatforms) {
      const asset = resolved.find((a) => a.filePath.includes(dir));
      expect(asset, `asset for ${dir}`).toBeDefined();
      expect(asset!.platform.os).toBe(expectedOs);
      expect(asset!.platform.arch).toBe(expectedArch);
    }

    // Verify windows gets zip, others get tar.gz
    const winAsset = resolved.find((a) => a.filePath.includes("win-x64"));
    expect(winAsset!.config.compress).toBe("zip");

    const macAsset = resolved.find((a) => a.filePath.includes("macos-aarch64"));
    expect(macAsset!.config.compress).toBe("tar.gz");
  });
});
