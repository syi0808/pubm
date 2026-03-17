import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractCaptureVars,
  normalizeConfig,
  pathPatternToGlob,
  resolveAssets,
} from "../../../src/assets/resolver.js";
import type { ReleaseAssetEntry } from "../../../src/assets/types.js";

describe("normalizeConfig", () => {
  it("normalizes string entry to group with single file", () => {
    const result = normalizeConfig(["platforms/*/bin/pubm"], undefined);
    expect(result).toEqual([
      {
        files: [
          {
            path: "platforms/*/bin/pubm",
            compress: undefined,
            name: undefined,
          },
        ],
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
    expect(result[0].compress).toBe("tar.gz");
    expect(result[0].name).toBe("{name}-{platform}");
  });

  it("normalizes group with object files", () => {
    const entry: ReleaseAssetEntry = {
      files: [{ path: "dist/*.dmg", compress: false, name: "myapp-{arch}" }],
    };
    const result = normalizeConfig([entry], undefined);
    expect(result[0].files[0]).toEqual({
      path: "dist/*.dmg",
      compress: false,
      name: "myapp-{arch}",
    });
  });
});

describe("extractCaptureVars", () => {
  it("extracts {platform} from path", () => {
    const result = extractCaptureVars(
      "platforms/{platform}/bin/pubm",
      "platforms/darwin-arm64/bin/pubm",
    );
    expect(result).toEqual({ platform: "darwin-arm64" });
  });

  it("extracts {os} and {arch}", () => {
    const result = extractCaptureVars(
      "platforms/{os}-{arch}/bin/pubm",
      "platforms/darwin-arm64/bin/pubm",
    );
    expect(result).toEqual({ os: "darwin", arch: "arm64" });
  });

  it("extracts {arch}-{vendor}-{os}-{abi}", () => {
    const result = extractCaptureVars(
      "target/{arch}-{vendor}-{os}-{abi}/release/myapp",
      "target/x86_64-unknown-linux-gnu/release/myapp",
    );
    expect(result).toEqual({
      arch: "x86_64",
      vendor: "unknown",
      os: "linux",
      abi: "gnu",
    });
  });

  it("returns empty for no captures", () => {
    const result = extractCaptureVars(
      "platforms/*/bin/pubm",
      "platforms/darwin-arm64/bin/pubm",
    );
    expect(result).toEqual({});
  });
});

describe("resolveAssets", () => {
  function createPlatformTree(platforms: string[]): string {
    const root = mkdtempSync(join(tmpdir(), "resolver-test-"));
    for (const p of platforms) {
      const binDir = join(root, "platforms", p, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "myapp"), "binary");
    }
    return root;
  }

  it("resolves aliases when using {os}-{arch} captures", () => {
    const root = createPlatformTree(["win-x64", "macos-aarch64"]);
    const group = {
      files: [
        {
          path: "platforms/{os}-{arch}/bin/myapp",
          compress: undefined,
          name: undefined,
        },
      ],
    };

    const assets = resolveAssets(group, undefined, root);

    const winAsset = assets.find((a) => a.filePath.includes("win-x64"));
    expect(winAsset).toBeDefined();
    expect(winAsset!.platform.os).toBe("windows");
    expect(winAsset!.platform.arch).toBe("x64");
    // compress auto-detect: windows → zip
    expect(winAsset!.config.compress).toBe("zip");

    const macAsset = assets.find((a) => a.filePath.includes("macos-aarch64"));
    expect(macAsset).toBeDefined();
    expect(macAsset!.platform.os).toBe("darwin");
    expect(macAsset!.platform.arch).toBe("arm64");
    // compress auto-detect: darwin → tar.gz
    expect(macAsset!.config.compress).toBe("tar.gz");
  });

  it("resolves aliases when using {platform} capture", () => {
    const root = createPlatformTree(["win-x64"]);
    const group = {
      files: [
        {
          path: "platforms/{platform}/bin/myapp",
          compress: undefined,
          name: undefined,
        },
      ],
    };

    const assets = resolveAssets(group, undefined, root);
    expect(assets).toHaveLength(1);
    expect(assets[0].platform.os).toBe("windows");
    expect(assets[0].platform.arch).toBe("x64");
    expect(assets[0].config.compress).toBe("zip");
  });

  it("auto-parses platform from path segments without capture vars", () => {
    const root = createPlatformTree(["darwin-arm64"]);
    const group = {
      files: [
        { path: "platforms/*/bin/myapp", compress: undefined, name: undefined },
      ],
    };

    const assets = resolveAssets(group, undefined, root);
    expect(assets).toHaveLength(1);
    expect(assets[0].platform.os).toBe("darwin");
    expect(assets[0].platform.arch).toBe("arm64");
    expect(assets[0].config.compress).toBe("tar.gz");
  });

  it("applies compress cascade: file > group > global > auto", () => {
    const root = createPlatformTree(["linux-x64"]);

    // global=tar.xz, group=undefined, file=undefined → global wins
    const assets1 = resolveAssets(
      {
        files: [
          {
            path: "platforms/*/bin/myapp",
            compress: undefined,
            name: undefined,
          },
        ],
      },
      "tar.xz",
      root,
    );
    expect(assets1[0].config.compress).toBe("tar.xz");

    // global=tar.xz, group=zip, file=undefined → group wins
    const assets2 = resolveAssets(
      {
        files: [
          {
            path: "platforms/*/bin/myapp",
            compress: undefined,
            name: undefined,
          },
        ],
        compress: "zip",
      },
      "tar.xz",
      root,
    );
    expect(assets2[0].config.compress).toBe("zip");

    // global=tar.xz, group=zip, file=false → file wins
    const assets3 = resolveAssets(
      {
        files: [
          { path: "platforms/*/bin/myapp", compress: false, name: undefined },
        ],
        compress: "zip",
      },
      "tar.xz",
      root,
    );
    expect(assets3[0].config.compress).toBe(false);
  });

  it("sets default name template with platform when detected", () => {
    const root = createPlatformTree(["linux-x64"]);
    const group = {
      files: [
        { path: "platforms/*/bin/myapp", compress: undefined, name: undefined },
      ],
    };

    const assets = resolveAssets(group, undefined, root);
    expect(assets[0].config.name).toBe("{filename}-{platform}");
  });
});

describe("pathPatternToGlob", () => {
  it("replaces {platform} with *", () => {
    expect(pathPatternToGlob("platforms/{platform}/bin/pubm")).toBe(
      "platforms/*/bin/pubm",
    );
  });

  it("replaces {os}-{arch} with *-*", () => {
    expect(pathPatternToGlob("platforms/{os}-{arch}/bin/pubm")).toBe(
      "platforms/*-*/bin/pubm",
    );
  });

  it("passes through plain globs", () => {
    expect(pathPatternToGlob("dist/*.dmg")).toBe("dist/*.dmg");
  });
});
