import { describe, expect, it } from "vitest";
import type { PackageConfig, PubmConfig } from "../../../src/types/config.js";

describe("Config types", () => {
  it("allows PackageConfig with required fields", () => {
    const config: PackageConfig = {
      path: "packages/my-lib",
      registries: ["npm", "jsr"],
    };
    expect(config.path).toBe("packages/my-lib");
    expect(config.registries).toEqual(["npm", "jsr"]);
  });

  it("allows PackageConfig with optional overrides", () => {
    const config: PackageConfig = {
      path: "crates/my-crate",
      registries: ["crates"],
      buildCommand: "cargo build --release",
      testCommand: "cargo test",
    };
    expect(config.buildCommand).toBe("cargo build --release");
    expect(config.testCommand).toBe("cargo test");
  });

  it("allows PubmConfig with packages array", () => {
    const config: PubmConfig = {
      versioning: "independent",
      packages: [{ path: ".", registries: ["npm"] }],
    };
    expect(config.versioning).toBe("independent");
    expect(config.packages).toHaveLength(1);
  });

  it("allows PubmConfig without packages (single-package shorthand)", () => {
    const config: PubmConfig = {
      registries: ["npm", "jsr"],
      branch: "main",
    };
    expect(config.registries).toEqual(["npm", "jsr"]);
    expect(config.packages).toBeUndefined();
  });
});
