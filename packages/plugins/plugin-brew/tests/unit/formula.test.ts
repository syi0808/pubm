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
