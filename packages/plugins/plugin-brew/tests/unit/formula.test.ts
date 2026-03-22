import { describe, expect, it } from "vitest";
import {
  generateFormula,
  matchAssetToPlatform,
  releaseAssetsToFormulaAssets,
  updateFormula,
} from "../../src/formula.js";

describe("formula helpers", () => {
  it("generates a formula with class name conversion and placeholders", () => {
    const content = generateFormula({
      name: "my_tool-cli",
      desc: "Example CLI",
      homepage: "https://example.com",
      license: "Apache-2.0",
      version: "1.2.3",
      assets: [
        {
          platform: "darwin-arm64",
          url: "https://example.com/darwin-arm64.tar.gz",
          sha256: "arm64-sha",
        },
        {
          platform: "linux-x64",
          url: "https://example.com/linux-x64.tar.gz",
          sha256: "linux-x64-sha",
        },
      ],
    });

    expect(content).toContain("class MyToolCli < Formula");
    expect(content).toContain('desc "Example CLI"');
    expect(content).toContain('version "1.2.3"');
    expect(content).toContain('url "https://example.com/darwin-arm64.tar.gz"');
    expect(content).toContain('sha256 "arm64-sha"');
    expect(content).toContain('url "PLACEHOLDER"');
    expect(content).toContain('bin.install "my_tool-cli"');
  });

  it("generates a formula with musl branches when musl assets are provided", () => {
    const content = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "1.0.0",
      assets: [
        {
          platform: "darwin-arm64",
          url: "https://example.com/darwin-arm64.tar.gz",
          sha256: "da64",
        },
        {
          platform: "darwin-x64",
          url: "https://example.com/darwin-x64.tar.gz",
          sha256: "dx64",
        },
        {
          platform: "linux-arm64",
          url: "https://example.com/linux-arm64.tar.gz",
          sha256: "la64",
        },
        {
          platform: "linux-arm64-musl",
          url: "https://example.com/linux-arm64-musl.tar.gz",
          sha256: "la64m",
        },
        {
          platform: "linux-x64",
          url: "https://example.com/linux-x64.tar.gz",
          sha256: "lx64",
        },
        {
          platform: "linux-x64-musl",
          url: "https://example.com/linux-x64-musl.tar.gz",
          sha256: "lx64m",
        },
      ],
    });

    expect(content).toContain("libc_is_musl?");
    expect(content).toContain(
      'url "https://example.com/linux-arm64-musl.tar.gz"',
    );
    expect(content).toContain('sha256 "la64m"');
    expect(content).toContain(
      'url "https://example.com/linux-x64-musl.tar.gz"',
    );
    expect(content).toContain('sha256 "lx64m"');
    expect(content).toContain('url "https://example.com/linux-arm64.tar.gz"');
    expect(content).toContain('url "https://example.com/linux-x64.tar.gz"');
  });

  it("generates a formula without musl branches when no musl assets", () => {
    const content = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "1.0.0",
      assets: [
        {
          platform: "linux-arm64",
          url: "https://example.com/linux-arm64.tar.gz",
          sha256: "la64",
        },
        {
          platform: "linux-x64",
          url: "https://example.com/linux-x64.tar.gz",
          sha256: "lx64",
        },
      ],
    });

    expect(content).not.toContain("libc_is_musl?");
  });

  it("updates version and platform-specific url/sha256 pairs", () => {
    const original = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "0.1.0",
      assets: [
        {
          platform: "darwin-arm64",
          url: "https://example.com/old-darwin-arm64.tar.gz",
          sha256: "old-darwin-arm64",
        },
        {
          platform: "darwin-x64",
          url: "https://example.com/old-darwin-x64.tar.gz",
          sha256: "old-darwin-x64",
        },
        {
          platform: "linux-arm64",
          url: "https://example.com/old-linux-arm64.tar.gz",
          sha256: "old-linux-arm64",
        },
        {
          platform: "linux-x64",
          url: "https://example.com/old-linux-x64.tar.gz",
          sha256: "old-linux-x64",
        },
      ],
    });

    const updated = updateFormula(original, "2.0.0", [
      {
        platform: "darwin-arm64",
        url: "https://example.com/new-darwin-arm64.tar.gz",
        sha256: "new-darwin-arm64",
      },
      {
        platform: "linux-x64",
        url: "https://example.com/new-linux-x64.tar.gz",
        sha256: "new-linux-x64",
      },
    ]);

    expect(updated).toContain('version "2.0.0"');
    expect(updated).toContain(
      'url "https://example.com/new-darwin-arm64.tar.gz"',
    );
    expect(updated).toContain('sha256 "new-darwin-arm64"');
    expect(updated).toContain('url "https://example.com/new-linux-x64.tar.gz"');
    expect(updated).toContain('sha256 "new-linux-x64"');
    expect(updated).toContain(
      'url "https://example.com/old-darwin-x64.tar.gz"',
    );
    expect(updated).toContain(
      'url "https://example.com/old-linux-arm64.tar.gz"',
    );
  });

  it("updates musl platform url/sha256 pairs", () => {
    const original = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "0.1.0",
      assets: [
        {
          platform: "darwin-arm64",
          url: "https://example.com/old-darwin-arm64.tar.gz",
          sha256: "old-darwin-arm64",
        },
        {
          platform: "darwin-x64",
          url: "https://example.com/old-darwin-x64.tar.gz",
          sha256: "old-darwin-x64",
        },
        {
          platform: "linux-arm64",
          url: "https://example.com/old-linux-arm64.tar.gz",
          sha256: "old-linux-arm64",
        },
        {
          platform: "linux-arm64-musl",
          url: "https://example.com/old-linux-arm64-musl.tar.gz",
          sha256: "old-linux-arm64-musl",
        },
        {
          platform: "linux-x64",
          url: "https://example.com/old-linux-x64.tar.gz",
          sha256: "old-linux-x64",
        },
        {
          platform: "linux-x64-musl",
          url: "https://example.com/old-linux-x64-musl.tar.gz",
          sha256: "old-linux-x64-musl",
        },
      ],
    });

    const updated = updateFormula(original, "2.0.0", [
      {
        platform: "linux-arm64-musl",
        url: "https://example.com/new-linux-arm64-musl.tar.gz",
        sha256: "new-linux-arm64-musl",
      },
      {
        platform: "linux-x64-musl",
        url: "https://example.com/new-linux-x64-musl.tar.gz",
        sha256: "new-linux-x64-musl",
      },
      {
        platform: "linux-arm64",
        url: "https://example.com/new-linux-arm64.tar.gz",
        sha256: "new-linux-arm64",
      },
      {
        platform: "linux-x64",
        url: "https://example.com/new-linux-x64.tar.gz",
        sha256: "new-linux-x64",
      },
    ]);

    expect(updated).toContain('version "2.0.0"');
    expect(updated).toContain(
      'url "https://example.com/new-linux-arm64-musl.tar.gz"',
    );
    expect(updated).toContain('sha256 "new-linux-arm64-musl"');
    expect(updated).toContain(
      'url "https://example.com/new-linux-x64-musl.tar.gz"',
    );
    expect(updated).toContain('sha256 "new-linux-x64-musl"');
    expect(updated).toContain(
      'url "https://example.com/new-linux-arm64.tar.gz"',
    );
    expect(updated).toContain('sha256 "new-linux-arm64"');
    expect(updated).toContain('url "https://example.com/new-linux-x64.tar.gz"');
    expect(updated).toContain('sha256 "new-linux-x64"');
  });

  it("matchAssetToPlatform returns the asset matching os+arch", () => {
    const assets = [
      {
        name: "pubm-darwin-arm64.tar.gz",
        url: "https://example.com/darwin-arm64.tar.gz",
        sha256: "a",
        platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
      },
      {
        name: "pubm-linux-x64.zip",
        url: "https://example.com/linux-x64.zip",
        sha256: "b",
        platform: { raw: "linux-x64", os: "linux", arch: "x64" },
      },
      {
        name: "pubm-windows-x64.zip",
        url: "https://example.com/windows-x64.zip",
        sha256: "c",
        platform: { raw: "windows-x64", os: "windows", arch: "x64" },
      },
    ];

    const matched = matchAssetToPlatform(assets, "darwin-arm64");
    expect(matched?.sha256).toBe("a");

    const linuxMatched = matchAssetToPlatform(assets, "linux-x64");
    expect(linuxMatched?.sha256).toBe("b");

    const notFound = matchAssetToPlatform(assets, "linux-arm64");
    expect(notFound).toBeUndefined();
  });

  it("matchAssetToPlatform distinguishes musl and baseline variants", () => {
    const assets = [
      {
        name: "pubm-linux-x64.tar.gz",
        url: "https://example.com/linux-x64.tar.gz",
        sha256: "glibc",
        platform: { raw: "linux-x64", os: "linux", arch: "x64" },
      },
      {
        name: "pubm-linux-x64-musl.tar.gz",
        url: "https://example.com/linux-x64-musl.tar.gz",
        sha256: "musl",
        platform: {
          raw: "linux-x64-musl",
          os: "linux",
          arch: "x64",
          abi: "musl",
        },
      },
      {
        name: "pubm-linux-x64-baseline.tar.gz",
        url: "https://example.com/linux-x64-baseline.tar.gz",
        sha256: "baseline",
        platform: {
          raw: "linux-x64-baseline",
          os: "linux",
          arch: "x64",
          variant: "baseline",
        },
      },
      {
        name: "pubm-linux-x64-musl-baseline.tar.gz",
        url: "https://example.com/linux-x64-musl-baseline.tar.gz",
        sha256: "musl-baseline",
        platform: {
          raw: "linux-x64-musl-baseline",
          os: "linux",
          arch: "x64",
          abi: "musl",
          variant: "baseline",
        },
      },
    ];

    expect(matchAssetToPlatform(assets, "linux-x64")?.sha256).toBe("glibc");
    expect(matchAssetToPlatform(assets, "linux-x64-musl")?.sha256).toBe("musl");
    expect(matchAssetToPlatform(assets, "linux-x64-baseline")?.sha256).toBe(
      "baseline",
    );
    expect(
      matchAssetToPlatform(assets, "linux-x64-musl-baseline")?.sha256,
    ).toBe("musl-baseline");
  });

  it("matchAssetToPlatform uses custom matcher when provided", () => {
    const assets = [
      {
        name: "pubm-darwin-arm64.tar.gz",
        url: "https://example.com/darwin-arm64.tar.gz",
        sha256: "a",
        platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
      },
    ];

    const customMatcher = (a: { sha256: string }) => a.sha256 === "a";
    const matched = matchAssetToPlatform(
      assets,
      "darwin-x64",
      customMatcher as never,
    );
    expect(matched?.sha256).toBe("a");
  });

  it("skips unknown platforms during updateFormula", () => {
    const original = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "0.1.0",
      assets: [
        {
          platform: "darwin-arm64",
          url: "https://example.com/old.tar.gz",
          sha256: "old-sha",
        },
      ],
    });

    const updated = updateFormula(original, "2.0.0", [
      {
        platform: "darwin-x64-baseline" as never,
        url: "https://example.com/new.tar.gz",
        sha256: "new-sha",
      },
    ]);

    expect(updated).toContain('version "2.0.0"');
    // The unknown platform asset should be skipped, old urls stay unchanged
    expect(updated).toContain('url "https://example.com/old.tar.gz"');
    expect(updated).not.toContain('url "https://example.com/new.tar.gz"');
  });

  it("generates musl formula with only linux-arm64-musl (x64-musl placeholder)", () => {
    const content = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "1.0.0",
      assets: [
        {
          platform: "linux-arm64-musl",
          url: "https://example.com/linux-arm64-musl.tar.gz",
          sha256: "la64m",
        },
      ],
    });

    expect(content).toContain("libc_is_musl?");
    expect(content).toContain(
      'url "https://example.com/linux-arm64-musl.tar.gz"',
    );
    expect(content).toContain('sha256 "la64m"');
    // x64 musl and non-musl should be PLACEHOLDER
    const lines = content.split("\n");
    const placeholderCount = lines.filter((l) =>
      l.includes('url "PLACEHOLDER"'),
    ).length;
    expect(placeholderCount).toBeGreaterThanOrEqual(3);
  });

  it("generates musl formula with only linux-x64-musl (arm64-musl placeholder)", () => {
    const content = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "1.0.0",
      assets: [
        {
          platform: "linux-x64-musl",
          url: "https://example.com/linux-x64-musl.tar.gz",
          sha256: "lx64m",
        },
      ],
    });

    expect(content).toContain("libc_is_musl?");
    expect(content).toContain(
      'url "https://example.com/linux-x64-musl.tar.gz"',
    );
    expect(content).toContain('sha256 "lx64m"');
    // arm64 musl should be PLACEHOLDER
    const lines = content.split("\n");
    const placeholderCount = lines.filter((l) =>
      l.includes('url "PLACEHOLDER"'),
    ).length;
    expect(placeholderCount).toBeGreaterThanOrEqual(3);
  });

  it("updates non-musl linux assets in formula with musl blocks", () => {
    const original = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "0.1.0",
      assets: [
        {
          platform: "darwin-arm64",
          url: "https://example.com/old-darwin-arm64.tar.gz",
          sha256: "old-darwin-arm64",
        },
        {
          platform: "linux-arm64",
          url: "https://example.com/old-linux-arm64.tar.gz",
          sha256: "old-linux-arm64",
        },
        {
          platform: "linux-arm64-musl",
          url: "https://example.com/old-linux-arm64-musl.tar.gz",
          sha256: "old-linux-arm64-musl",
        },
        {
          platform: "linux-x64",
          url: "https://example.com/old-linux-x64.tar.gz",
          sha256: "old-linux-x64",
        },
        {
          platform: "linux-x64-musl",
          url: "https://example.com/old-linux-x64-musl.tar.gz",
          sha256: "old-linux-x64-musl",
        },
      ],
    });

    // Only update the non-musl linux assets (not musl ones)
    const updated = updateFormula(original, "3.0.0", [
      {
        platform: "linux-arm64",
        url: "https://example.com/new-linux-arm64.tar.gz",
        sha256: "new-linux-arm64",
      },
      {
        platform: "linux-x64",
        url: "https://example.com/new-linux-x64.tar.gz",
        sha256: "new-linux-x64",
      },
    ]);

    expect(updated).toContain('version "3.0.0"');
    // Non-musl linux assets should be updated
    expect(updated).toContain(
      'url "https://example.com/new-linux-arm64.tar.gz"',
    );
    expect(updated).toContain('sha256 "new-linux-arm64"');
    expect(updated).toContain('url "https://example.com/new-linux-x64.tar.gz"');
    expect(updated).toContain('sha256 "new-linux-x64"');
    // Musl assets should remain unchanged
    expect(updated).toContain(
      'url "https://example.com/old-linux-arm64-musl.tar.gz"',
    );
    expect(updated).toContain(
      'url "https://example.com/old-linux-x64-musl.tar.gz"',
    );
  });

  it("releaseAssetsToFormulaAssets maps only recognized platform assets", () => {
    const mapped = releaseAssetsToFormulaAssets([
      {
        name: "pubm-darwin-arm64.tar.gz",
        url: "https://example.com/darwin-arm64.tar.gz",
        sha256: "a",
        platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
      },
      {
        name: "pubm-linux-x64.zip",
        url: "https://example.com/linux-x64.zip",
        sha256: "b",
        platform: { raw: "linux-x64", os: "linux", arch: "x64" },
      },
      {
        name: "pubm-windows-x64.zip",
        url: "https://example.com/windows-x64.zip",
        sha256: "c",
        platform: { raw: "windows-x64", os: "windows", arch: "x64" },
      },
    ]);

    expect(mapped).toEqual([
      {
        platform: "darwin-arm64",
        url: "https://example.com/darwin-arm64.tar.gz",
        sha256: "a",
      },
      {
        platform: "linux-x64",
        url: "https://example.com/linux-x64.zip",
        sha256: "b",
      },
    ]);
  });

  it("releaseAssetsToFormulaAssets maps musl and baseline variants", () => {
    const mapped = releaseAssetsToFormulaAssets([
      {
        name: "pubm-linux-arm64-musl.tar.gz",
        url: "https://example.com/linux-arm64-musl.tar.gz",
        sha256: "musl-arm",
        platform: {
          raw: "linux-arm64-musl",
          os: "linux",
          arch: "arm64",
          abi: "musl",
        },
      },
      {
        name: "pubm-linux-x64-musl.tar.gz",
        url: "https://example.com/linux-x64-musl.tar.gz",
        sha256: "musl-x64",
        platform: {
          raw: "linux-x64-musl",
          os: "linux",
          arch: "x64",
          abi: "musl",
        },
      },
      {
        name: "pubm-linux-x64-baseline.tar.gz",
        url: "https://example.com/linux-x64-baseline.tar.gz",
        sha256: "baseline-x64",
        platform: {
          raw: "linux-x64-baseline",
          os: "linux",
          arch: "x64",
          variant: "baseline",
        },
      },
    ]);

    expect(mapped).toEqual([
      {
        platform: "linux-arm64-musl",
        url: "https://example.com/linux-arm64-musl.tar.gz",
        sha256: "musl-arm",
      },
      {
        platform: "linux-x64-baseline",
        url: "https://example.com/linux-x64-baseline.tar.gz",
        sha256: "baseline-x64",
      },
      {
        platform: "linux-x64-musl",
        url: "https://example.com/linux-x64-musl.tar.gz",
        sha256: "musl-x64",
      },
    ]);
  });

  it("releaseAssetsToFormulaAssets uses custom matchers when provided", () => {
    const assets = [
      {
        name: "pubm-darwin-arm64.tar.gz",
        url: "https://example.com/darwin-arm64.tar.gz",
        sha256: "custom-a",
        platform: { raw: "macos-aarch64", os: "macos", arch: "aarch64" },
      },
    ];

    const mapped = releaseAssetsToFormulaAssets(assets, {
      "darwin-arm64": (a) => a.platform.raw === "macos-aarch64",
    });

    expect(mapped).toEqual([
      {
        platform: "darwin-arm64",
        url: "https://example.com/darwin-arm64.tar.gz",
        sha256: "custom-a",
      },
    ]);
  });
});
