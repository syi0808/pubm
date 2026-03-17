import { describe, expect, it } from "vitest";
import {
  extractCaptureVars,
  normalizeConfig,
  pathPatternToGlob,
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
