import { describe, expect, it } from "vitest";
import type { PackageConfig } from "../../../src/config/types.js";
import { defineConfig } from "../../../src/config/types.js";

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const config = defineConfig({
      branch: "main",
      packages: [{ path: ".", registries: ["npm"] }],
    });
    expect(config).toEqual({
      branch: "main",
      packages: [{ path: ".", registries: ["npm"] }],
    });
  });

  it("accepts empty config", () => {
    const config = defineConfig({});
    expect(config).toEqual({});
  });

  it("accepts full config with all fields", () => {
    const config = defineConfig({
      versioning: "independent",
      branch: "main",
      packages: [
        { path: ".", registries: ["npm", "jsr"] },
        {
          path: "packages/core",
          registries: ["npm"],
          buildCommand: "build",
          testCommand: "test",
        },
      ],
      changelog: true,
      changelogFormat: "github",
      commit: false,
      access: "public",
      fixed: [["@myorg/core", "@myorg/utils"]],
      linked: [["@myorg/react-*"]],
      updateInternalDependencies: "patch",
      ignore: ["@myorg/internal"],
      validate: {
        cleanInstall: true,
        entryPoints: true,
        extraneousFiles: true,
      },
      snapshotTemplate: "{tag}-{timestamp}",
      tag: "latest",
      contents: ".",
      saveToken: true,
      releaseDraft: true,
      releaseNotes: true,
      rollbackStrategy: "individual",
    });
    expect(config.versioning).toBe("independent");
    expect(config.fixed).toHaveLength(1);
  });

  it("does not type legacy createPr as a supported config field", () => {
    // @ts-expect-error createPr was removed in favor of GitHub release PR workflows.
    const config = defineConfig({ createPr: true });
    expect(config).toEqual({ createPr: true });
  });

  it("PackageConfig accepts ecosystem field", () => {
    const config: PackageConfig = {
      path: "packages/core",
      registries: ["npm"],
      ecosystem: "js",
    };
    expect(config.ecosystem).toBe("js");
  });

  it("PackageConfig accepts rust ecosystem", () => {
    const config: PackageConfig = {
      path: "crates/parser",
      registries: ["crates"],
      ecosystem: "rust",
    };
    expect(config.ecosystem).toBe("rust");
  });
});
