import path from "node:path";
import { describe, expect, it } from "vitest";
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
    expect(result!.versioning).toBe("independent");
    expect(result!.packages).toHaveLength(2);
    expect(result!.packages![0].path).toBe("packages/my-lib");
  });

  it("loads config with mixed JS and Rust packages", async () => {
    const result = await loadConfig(
      path.resolve(__dirname, "../../fixtures/mixed-js-rust"),
    );

    expect(result).not.toBeNull();
    expect(result!.versioning).toBe("independent");
    expect(result!.packages).toHaveLength(3);
    expect(result!.packages![0]).toEqual({
      path: ".",
      registries: ["npm", "jsr"],
    });
    expect(result!.packages![1]).toEqual({
      path: "rust/crates/my-crate",
      registries: ["crates"],
    });
    expect(result!.packages![2]).toEqual({
      path: "rust/crates/my-crate-cli",
      registries: ["crates"],
    });
  });
});
