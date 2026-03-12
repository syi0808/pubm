import { describe, expect, it } from "vitest";
import { collectRegistries } from "../../../src/utils/registries.js";

describe("collectRegistries", () => {
  it("falls back to ctx.registries when packages is undefined", () => {
    const result = collectRegistries({
      registries: ["npm", "jsr"],
    });
    expect(result).toEqual(["npm", "jsr"]);
  });

  it("falls back to ctx.registries when packages is an empty array", () => {
    const result = collectRegistries({
      packages: [],
      registries: ["npm"],
    });
    expect(result).toEqual(["npm"]);
  });

  it("collects registries from all packages", () => {
    const result = collectRegistries({
      packages: [
        { path: "packages/a", registries: ["npm"] },
        { path: "packages/b", registries: ["jsr"] },
      ],
      registries: [],
    });
    expect(result).toEqual(["npm", "jsr"]);
  });

  it("deduplicates registries across packages", () => {
    const result = collectRegistries({
      packages: [
        { path: "packages/a", registries: ["npm", "jsr"] },
        { path: "packages/b", registries: ["npm"] },
        { path: "packages/c", registries: ["jsr"] },
      ],
      registries: [],
    });
    expect(result).toEqual(["npm", "jsr"]);
  });

  it("preserves order of first appearance", () => {
    const result = collectRegistries({
      packages: [
        { path: "packages/a", registries: ["jsr"] },
        { path: "packages/b", registries: ["npm"] },
        { path: "packages/c", registries: ["jsr", "npm"] },
      ],
      registries: [],
    });
    expect(result).toEqual(["jsr", "npm"]);
  });

  it("works with a single package having multiple registries", () => {
    const result = collectRegistries({
      packages: [{ path: "packages/only", registries: ["npm", "jsr"] }],
      registries: [],
    });
    expect(result).toEqual(["npm", "jsr"]);
  });

  it("deduplicates crates registry across multiple packages", () => {
    const result = collectRegistries({
      packages: [
        { path: "crates/foo", registries: ["crates"] },
        { path: "crates/bar", registries: ["crates"] },
      ],
      registries: [],
    });
    expect(result).toEqual(["crates"]);
  });

  it("handles mixed JS and crates packages", () => {
    const result = collectRegistries({
      packages: [
        { path: "packages/web", registries: ["npm", "jsr"] },
        { path: "crates/core", registries: ["crates"] },
        { path: "packages/pubm", registries: ["npm"] },
      ],
      registries: [],
    });
    expect(result).toEqual(["npm", "jsr", "crates"]);
  });
});
