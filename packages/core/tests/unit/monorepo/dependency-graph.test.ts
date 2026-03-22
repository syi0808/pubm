import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  type PackageNode,
  topologicalSort,
} from "../../../src/monorepo/dependency-graph.js";

describe("buildDependencyGraph", () => {
  it("builds adjacency list from package manifests", () => {
    const packages: PackageNode[] = [
      {
        name: "@scope/core",
        version: "1.0.0",
        path: "/packages/core",
        dependencies: {},
      },
      {
        name: "@scope/utils",
        version: "1.0.0",
        path: "/packages/utils",
        dependencies: { "@scope/core": "^1.0.0" },
      },
      {
        name: "@scope/app",
        version: "1.0.0",
        path: "/packages/app",
        dependencies: {
          "@scope/core": "^1.0.0",
          "@scope/utils": "^1.0.0",
        },
      },
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("@scope/core")).toEqual([]);
    expect(graph.get("@scope/utils")).toEqual(["@scope/core"]);
    expect(graph.get("@scope/app")).toEqual(
      expect.arrayContaining(["@scope/core", "@scope/utils"]),
    );
    expect(graph.get("@scope/app")).toHaveLength(2);
  });

  it("ignores external dependencies", () => {
    const packages: PackageNode[] = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: "/packages/a",
        dependencies: {
          lodash: "^4.0.0",
          react: "^18.0.0",
          "pkg-b": "^1.0.0",
        },
      },
      {
        name: "pkg-b",
        version: "1.0.0",
        path: "/packages/b",
        dependencies: { express: "^4.0.0" },
      },
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("pkg-a")).toEqual(["pkg-b"]);
    expect(graph.get("pkg-b")).toEqual([]);
  });

  it("handles packages with no dependencies", () => {
    const packages: PackageNode[] = [
      {
        name: "standalone-a",
        version: "1.0.0",
        path: "/packages/a",
        dependencies: {},
      },
      {
        name: "standalone-b",
        version: "2.0.0",
        path: "/packages/b",
        dependencies: {},
      },
    ];

    const graph = buildDependencyGraph(packages);

    expect(graph.get("standalone-a")).toEqual([]);
    expect(graph.get("standalone-b")).toEqual([]);
  });
});

describe("topologicalSort", () => {
  it("sorts in dependency order (dependencies first)", () => {
    const graph = new Map<string, string[]>();
    graph.set("@scope/app", ["@scope/utils", "@scope/core"]);
    graph.set("@scope/utils", ["@scope/core"]);
    graph.set("@scope/core", []);

    const sorted = topologicalSort(graph);

    // core must come before utils, utils must come before app
    const coreIdx = sorted.indexOf("@scope/core");
    const utilsIdx = sorted.indexOf("@scope/utils");
    const appIdx = sorted.indexOf("@scope/app");

    expect(coreIdx).toBeLessThan(utilsIdx);
    expect(utilsIdx).toBeLessThan(appIdx);
  });

  it("handles independent packages", () => {
    const graph = new Map<string, string[]>();
    graph.set("pkg-a", []);
    graph.set("pkg-b", []);
    graph.set("pkg-c", []);

    const sorted = topologicalSort(graph);

    expect(sorted).toHaveLength(3);
    expect(sorted).toEqual(expect.arrayContaining(["pkg-a", "pkg-b", "pkg-c"]));
  });

  it("throws on circular dependencies", () => {
    const graph = new Map<string, string[]>();
    graph.set("pkg-a", ["pkg-b"]);
    graph.set("pkg-b", ["pkg-a"]);

    expect(() => topologicalSort(graph)).toThrow(
      "Circular dependency detected",
    );
  });

  it("handles a linear dependency chain", () => {
    const graph = new Map<string, string[]>();
    graph.set("d", ["c"]);
    graph.set("c", ["b"]);
    graph.set("b", ["a"]);
    graph.set("a", []);

    const sorted = topologicalSort(graph);

    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("b"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("c"));
    expect(sorted.indexOf("c")).toBeLessThan(sorted.indexOf("d"));
  });

  it("exercises defensive fallbacks when dep is not a graph key (lines 43, 62-64)", () => {
    // Construct a graph where a dependency references a node that is NOT a
    // top-level key. This exercises the ?? 0 and ?? [] fallbacks that are
    // normally unreachable when the graph is built via buildDependencyGraph.
    const graph = new Map<string, string[]>();
    graph.set("pkg-a", ["pkg-external"]);
    // pkg-external is not a key in the graph

    // sorted will collect pkg-a + pkg-external (2 items) but graph.size is 1,
    // triggering the circular dependency check. However, the defensive
    // fallbacks on lines 43, 62-64 are exercised before the throw.
    expect(() => topologicalSort(graph)).toThrow(
      "Circular dependency detected",
    );
  });

  it("handles a diamond dependency", () => {
    const graph = new Map<string, string[]>();
    graph.set("app", ["left", "right"]);
    graph.set("left", ["base"]);
    graph.set("right", ["base"]);
    graph.set("base", []);

    const sorted = topologicalSort(graph);

    const baseIdx = sorted.indexOf("base");
    const leftIdx = sorted.indexOf("left");
    const rightIdx = sorted.indexOf("right");
    const appIdx = sorted.indexOf("app");

    expect(baseIdx).toBeLessThan(leftIdx);
    expect(baseIdx).toBeLessThan(rightIdx);
    expect(leftIdx).toBeLessThan(appIdx);
    expect(rightIdx).toBeLessThan(appIdx);
  });
});
