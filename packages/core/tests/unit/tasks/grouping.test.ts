import { describe, expect, it } from "vitest";
import {
  collectEcosystemRegistryGroups,
  ecosystemLabel,
  registryLabel,
} from "../../../src/tasks/grouping.js";

describe("ecosystemLabel", () => {
  it("returns label from ecosystem catalog", () => {
    expect(ecosystemLabel("js")).toBe("JavaScript ecosystem");
    expect(ecosystemLabel("rust")).toBe("Rust ecosystem");
  });
});

describe("registryLabel", () => {
  it("returns label from registry catalog", () => {
    expect(registryLabel("npm")).toBe("npm");
    expect(registryLabel("jsr")).toBe("jsr");
    expect(registryLabel("crates")).toBe("crates.io");
  });

  it("returns key as-is for unknown registry", () => {
    expect(registryLabel("custom-reg")).toBe("custom-reg");
  });
});

describe("collectEcosystemRegistryGroups", () => {
  it("groups npm and jsr under js ecosystem", () => {
    const groups = collectEcosystemRegistryGroups({
      registries: ["npm", "jsr"],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].ecosystem).toBe("js");
    expect(groups[0].registries).toHaveLength(2);
  });

  it("separates js and rust ecosystems", () => {
    const groups = collectEcosystemRegistryGroups({
      registries: ["npm", "crates"],
    });
    expect(groups).toHaveLength(2);
  });
});
