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
  it("returns empty array when packages is undefined", () => {
    const groups = collectEcosystemRegistryGroups({});
    expect(groups).toEqual([]);
  });

  it("returns empty array when packages is empty", () => {
    const groups = collectEcosystemRegistryGroups({ packages: [] });
    expect(groups).toEqual([]);
  });

  it("groups npm and jsr under js ecosystem", () => {
    const groups = collectEcosystemRegistryGroups({
      packages: [{ path: "packages/a", registries: ["npm", "jsr"] }],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].ecosystem).toBe("js");
    expect(groups[0].registries).toHaveLength(2);
  });

  it("separates js and rust ecosystems", () => {
    const groups = collectEcosystemRegistryGroups({
      packages: [
        { path: "packages/a", registries: ["npm"] },
        { path: "crates/b", registries: ["crates"] },
      ],
    });
    expect(groups).toHaveLength(2);
  });

  it("collects package paths per registry", () => {
    const groups = collectEcosystemRegistryGroups({
      packages: [
        { path: "packages/a", registries: ["npm"] },
        { path: "packages/b", registries: ["npm", "jsr"] },
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].ecosystem).toBe("js");
    const npmGroup = groups[0].registries.find((r) => r.registry === "npm");
    expect(npmGroup?.packagePaths).toEqual(
      expect.arrayContaining(["packages/a", "packages/b"]),
    );
    const jsrGroup = groups[0].registries.find((r) => r.registry === "jsr");
    expect(jsrGroup?.packagePaths).toEqual(["packages/b"]);
  });

  it("deduplicates registries within a single package", () => {
    const groups = collectEcosystemRegistryGroups({
      packages: [{ path: "packages/a", registries: ["npm", "npm"] }],
    });
    expect(groups[0].registries).toHaveLength(1);
  });
});
