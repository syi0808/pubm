import path from "node:path";
import { describe, expect, it } from "vitest";
import * as loader from "../../../src/config/loader.js";
import { loadConfig } from "../../../src/config/loader.js";
import { defineConfig } from "../../../src/config/types.js";

describe("defineConfig", () => {
  it("returns the config as-is (identity function)", () => {
    const config = defineConfig({
      registries: ["npm"],
      branch: "main",
    });
    expect(config).toEqual({ registries: ["npm"], branch: "main" });
  });
});

describe("loadConfig", () => {
  it("returns null when no config file exists", async () => {
    const result = await loadConfig(
      path.resolve(__dirname, "../../fixtures/basic"),
    );
    expect(result).toBeNull();
  });

  it("loads pubm.config.ts when it exists", async () => {
    const result = await loadConfig(
      path.resolve(__dirname, "../../fixtures/with-config"),
    );
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error("Expected config to load");
    }
    expect(result.versioning).toBe("independent");
    expect(result.packages).toHaveLength(2);
    expect(result.packages?.[0]?.path).toBe("packages/my-lib");
  });

  it("loads bundled configs that import defineConfig", async () => {
    const result = await loadConfig(
      path.resolve(__dirname, "../../fixtures/with-config-define-config"),
    );
    expect(result).toEqual({
      versioning: "fixed",
      branch: "release",
      registries: ["npm"],
    });
  });

  it("supports import.meta in bundled configs", async () => {
    const result = await loadConfig(
      path.resolve(__dirname, "../../fixtures/with-config-import-meta"),
    );
    expect(result).not.toBeNull();
    if (!result?.contents) {
      throw new Error("Expected config contents to load");
    }
    expect(result.branch).toBe("with-config-import-meta");
    expect(new URL(result.contents).pathname).toContain(
      "/with-config-import-meta/pubm.config.ts",
    );
  });

  it("loads configs with optional dynamic imports in transitive dependencies", async () => {
    const result = await loadConfig(
      path.resolve(
        __dirname,
        "../../fixtures/with-config-optional-dynamic-import",
      ),
    );
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error("Expected config to load");
    }
    expect(result.branch).toBe("vitest");
    expect(result.registries).toEqual(["npm"]);
  });

  it("prefers native import for real third-party config helpers", async () => {
    const result = await loadConfig(
      path.resolve(__dirname, "../../fixtures/with-config-native-third-party"),
    );
    expect(result).not.toBeNull();
    if (!result?.contents) {
      throw new Error("Expected config contents to load");
    }

    expect(JSON.parse(result.contents)).toContain("**/node_modules/**");
  });

  it("can execute bundled CommonJS config output in vm", async () => {
    const executeBundledConfigInVm = (loader as Record<string, unknown>)
      .executeBundledConfigInVm;

    expect(typeof executeBundledConfigInVm).toBe("function");

    const result = await (
      executeBundledConfigInVm as (
        source: string,
        configPath: string,
      ) => Promise<unknown>
    )(
      'module.exports = { default: { branch: "vm", registries: ["npm"] } };',
      path.resolve(__dirname, "../../fixtures/with-config/pubm.config.ts"),
    );

    expect(result).toEqual({
      branch: "vm",
      registries: ["npm"],
    });
  });
});
