import { describe, expect, it } from "vitest";
import { defaultOptions, resolveOptions } from "../../src/options.js";
import type { Options } from "../../src/types/options.js";

describe("defaultOptions", () => {
  it("should have the expected default values", () => {
    expect(defaultOptions).toStrictEqual({
      testScript: "test",
      buildScript: "build",
      branch: "main",
      tag: "latest",
      registries: ["npm", "jsr"],
    });
  });

  it("should not include a version property", () => {
    expect(defaultOptions).not.toHaveProperty("version");
  });
});

describe("resolveOptions", () => {
  it("should return an object containing default values when no overrides are given", () => {
    const result = resolveOptions({ version: "1.0.0" });

    expect(result.version).toBe("1.0.0");
    expect(result.testScript).toBe("test");
    expect(result.buildScript).toBe("build");
    expect(result.branch).toBe("main");
    expect(result.tag).toBe("latest");
    expect(result.registries).toStrictEqual(["npm", "jsr"]);
  });

  it("should preserve the version from user options", () => {
    const result = resolveOptions({ version: "2.5.0" });

    expect(result.version).toBe("2.5.0");
  });

  it("should allow user options to override defaults", () => {
    const result = resolveOptions({
      version: "1.0.0",
      testScript: "my-test",
      buildScript: "my-build",
      branch: "develop",
      tag: "beta",
      registries: ["npm"],
    });

    expect(result.testScript).toBe("my-test");
    expect(result.buildScript).toBe("my-build");
    expect(result.branch).toBe("develop");
    expect(result.tag).toBe("beta");
    expect(result.registries).toStrictEqual(["npm"]);
  });

  it("should ignore undefined user options and use defaults instead", () => {
    const result = resolveOptions({
      version: "1.0.0",
      testScript: undefined,
      registries: undefined,
    } as Options);

    expect(result.testScript).toBe("test");
    expect(result.registries).toStrictEqual(["npm", "jsr"]);
  });

  it("should preserve user options that are not in defaultOptions", () => {
    const result = resolveOptions({
      version: "1.0.0",
      preview: true,
      anyBranch: true,
      skipTests: true,
      skipBuild: true,
      contents: "dist",
    });

    // These are not overwritten because they are not in defaultOptions.
    expect(result.preview).toBe(true);
    expect(result.anyBranch).toBe(true);
    expect(result.skipTests).toBe(true);
    expect(result.skipBuild).toBe(true);
    expect(result.contents).toBe("dist");
  });

  it("should retain version even though defaults are spread last", () => {
    // version is not in defaultOptions, so it survives the spread bug.
    const result = resolveOptions({ version: "3.0.0-rc.1" });

    expect(result.version).toBe("3.0.0-rc.1");
  });

  it("should return an object with all required ResolvedOptions fields", () => {
    const result = resolveOptions({ version: "1.0.0" });

    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("testScript");
    expect(result).toHaveProperty("buildScript");
    expect(result).toHaveProperty("branch");
    expect(result).toHaveProperty("tag");
    expect(result).toHaveProperty("registries");
  });
});
