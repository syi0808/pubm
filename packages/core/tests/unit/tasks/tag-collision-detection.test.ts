import { describe, expect, it } from "vitest";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import { detectTagNameCollisions } from "../../../src/tasks/required-conditions-check.js";

describe("detectTagNameCollisions", () => {
  it("returns empty array when no collisions", () => {
    const packages = [
      {
        name: "pkg-a",
        path: "packages/a",
        ecosystem: "js",
        registries: ["npm"],
      },
      {
        name: "pkg-b",
        path: "crates/b",
        ecosystem: "rust",
        registries: ["crates"],
      },
    ] as ResolvedPackageConfig[];
    expect(detectTagNameCollisions(packages)).toEqual([]);
  });

  it("detects collision when same name in different ecosystems", () => {
    const packages = [
      {
        name: "my-tool",
        path: "js",
        ecosystem: "js",
        registries: ["npm"],
      },
      {
        name: "my-tool",
        path: "crates/cli",
        ecosystem: "rust",
        registries: ["crates"],
      },
    ] as ResolvedPackageConfig[];
    const collisions = detectTagNameCollisions(packages);
    expect(collisions).toEqual(["my-tool"]);
  });

  it("does not flag same name within same ecosystem", () => {
    const packages = [
      {
        name: "my-tool",
        path: "packages/a",
        ecosystem: "js",
        registries: ["npm"],
      },
      {
        name: "my-tool",
        path: "packages/b",
        ecosystem: "js",
        registries: ["jsr"],
      },
    ] as ResolvedPackageConfig[];
    expect(detectTagNameCollisions(packages)).toEqual([]);
  });

  it("detects multiple collisions", () => {
    const packages = [
      {
        name: "tool-a",
        path: "js/a",
        ecosystem: "js",
        registries: ["npm"],
      },
      {
        name: "tool-a",
        path: "rust/a",
        ecosystem: "rust",
        registries: ["crates"],
      },
      {
        name: "tool-b",
        path: "js/b",
        ecosystem: "js",
        registries: ["npm"],
      },
      {
        name: "tool-b",
        path: "rust/b",
        ecosystem: "rust",
        registries: ["crates"],
      },
    ] as ResolvedPackageConfig[];
    const collisions = detectTagNameCollisions(packages);
    expect(collisions).toHaveLength(2);
    expect(collisions).toContain("tool-a");
    expect(collisions).toContain("tool-b");
  });
});
