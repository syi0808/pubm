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
    config: {
      path: "platforms/*/bin/pubm",
      compress: "tar.gz",
      name: "{name}-{platform}",
    },
  };

  it("substitutes {name} and {platform}", () => {
    const result = applyNameTemplate(baseAsset, {
      name: "pubm",
      version: "0.4.0",
    });
    expect(result).toBe("pubm-darwin-arm64.tar.gz");
  });

  it("substitutes {version}", () => {
    const asset = {
      ...baseAsset,
      config: { ...baseAsset.config, name: "{name}-{version}-{os}-{arch}" },
    };
    const result = applyNameTemplate(asset, { name: "pubm", version: "0.4.0" });
    expect(result).toBe("pubm-0.4.0-darwin-arm64.tar.gz");
  });

  it("substitutes {vendor} and {abi}", () => {
    const asset: CompressedAsset = {
      ...baseAsset,
      platform: {
        raw: "x86_64-unknown-linux-gnu",
        os: "linux",
        arch: "x64",
        vendor: "unknown",
        abi: "gnu",
      },
      config: {
        ...baseAsset.config,
        name: "{name}-{arch}-{vendor}-{os}-{abi}",
      },
    };
    const result = applyNameTemplate(asset, { name: "pubm", version: "1.0.0" });
    expect(result).toBe("pubm-x64-unknown-linux-gnu.tar.gz");
  });

  it("substitutes {filename}", () => {
    const asset = {
      ...baseAsset,
      config: { ...baseAsset.config, name: "{filename}-{platform}" },
    };
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
    const result = applyNameTemplate(asset, {
      name: "myapp",
      version: "1.0.0",
    });
    expect(result).toBe("myapp-arm64.dmg");
  });

  it("removes undefined template vars with separators", () => {
    const asset = {
      ...baseAsset,
      config: { ...baseAsset.config, name: "{name}-{variant}-{platform}" },
    };
    const result = applyNameTemplate(asset, { name: "pubm", version: "0.4.0" });
    expect(result).toBe("pubm-darwin-arm64.tar.gz");
  });
});
