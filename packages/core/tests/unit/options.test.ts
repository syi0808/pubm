import { describe, expect, it } from "vitest";
import { defaultOptions, resolveOptions } from "../../src/options.js";
import type { Options, RegistryType } from "../../src/types/options.js";

describe("defaultOptions", () => {
  it("should have the expected default values", () => {
    expect(defaultOptions).toStrictEqual({
      testScript: "test",
      buildScript: "build",
      branch: "main",
      tag: "latest",
    });
  });

  it("should not include a version property", () => {
    expect(defaultOptions).not.toHaveProperty("version");
  });
});

describe("resolveOptions", () => {
  it("should return an object containing default values when no overrides are given", () => {
    const result = resolveOptions({});

    expect(result.testScript).toBe("test");
    expect(result.buildScript).toBe("build");
    expect(result.branch).toBe("main");
    expect(result.tag).toBe("latest");
  });

  it("should allow user options to override defaults", () => {
    const result = resolveOptions({
      testScript: "my-test",
      buildScript: "my-build",
      branch: "develop",
      tag: "beta",
    });

    expect(result.testScript).toBe("my-test");
    expect(result.buildScript).toBe("my-build");
    expect(result.branch).toBe("develop");
    expect(result.tag).toBe("beta");
  });

  it("should ignore undefined user options and use defaults instead", () => {
    const result = resolveOptions({
      testScript: undefined,
    } as Options);

    expect(result.testScript).toBe("test");
  });

  it("should preserve user options that are not in defaultOptions", () => {
    const result = resolveOptions({
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

  it("should pass through packages from config", () => {
    const packages = [
      { path: ".", registries: ["npm", "jsr"] as RegistryType[] },
      {
        path: "rust/crates/my-crate",
        registries: ["crates"] as RegistryType[],
      },
    ];

    const result = resolveOptions({
      packages,
    });

    expect(result.packages).toStrictEqual(packages);
  });

  it("should return an object with all required ResolvedOptions fields", () => {
    const result = resolveOptions({});

    expect(result).toHaveProperty("testScript");
    expect(result).toHaveProperty("buildScript");
    expect(result).toHaveProperty("branch");
    expect(result).toHaveProperty("tag");
  });
});
