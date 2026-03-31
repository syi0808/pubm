import { describe, expect, it } from "vitest";
import { mergeRecommendations } from "../../../src/version-source/merge.js";
import type { VersionRecommendation } from "../../../src/version-source/types.js";

describe("mergeRecommendations", () => {
  it("returns all when no overlap", () => {
    const changeset: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "changeset",
        entries: [{ summary: "Add API", id: "cs-1" }],
      },
    ];
    const cc: VersionRecommendation[] = [
      {
        packagePath: "plugins/brew",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [
          { summary: "fix(brew): handle empty", type: "fix", hash: "abc" },
        ],
      },
    ];
    const result = mergeRecommendations([changeset, cc]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.packagePath === "packages/core")!.source).toBe(
      "changeset",
    );
    expect(result.find((r) => r.packagePath === "plugins/brew")!.source).toBe(
      "conventional-commit",
    );
  });

  it("changeset wins when both sources have same package", () => {
    const changeset: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "changeset",
        entries: [{ summary: "Add API", id: "cs-1" }],
      },
    ];
    const cc: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [{ summary: "fix(core): bug", type: "fix", hash: "abc" }],
      },
    ];
    const result = mergeRecommendations([changeset, cc]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("changeset");
    expect(result[0].bumpType).toBe("minor");
  });

  it("handles empty source arrays", () => {
    expect(mergeRecommendations([[], []])).toEqual([]);
  });

  it("handles single source", () => {
    const cc: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "conventional-commit",
        entries: [{ summary: "feat: add", type: "feat", hash: "abc" }],
      },
    ];
    expect(mergeRecommendations([cc])).toHaveLength(1);
  });

  it("preserves order: changeset first, then others", () => {
    const changeset: VersionRecommendation[] = [
      {
        packagePath: "packages/pubm",
        bumpType: "patch",
        source: "changeset",
        entries: [{ summary: "Fix flag", id: "cs-2" }],
      },
    ];
    const cc: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "conventional-commit",
        entries: [{ summary: "feat: add", type: "feat", hash: "abc" }],
      },
    ];
    const result = mergeRecommendations([changeset, cc]);
    expect(result[0].source).toBe("changeset");
    expect(result[1].source).toBe("conventional-commit");
  });
});
