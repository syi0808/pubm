import { describe, expect, it } from "vitest";
import { analyzeCommits } from "../../../src/conventional-commit/commit-analyzer.js";
import type { ConventionalCommit } from "../../../src/conventional-commit/types.js";

function makeCommit(
  overrides: Partial<ConventionalCommit> & { type: string },
): ConventionalCommit {
  return {
    hash: "abc1234",
    breaking: false,
    description: "test",
    footers: new Map(),
    files: [],
    ...overrides,
  };
}

describe("analyzeCommits", () => {
  it("maps feat to minor bump", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "feat",
        scope: "core",
        description: "add login",
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {});
    expect(result.get("packages/core")!.bumpType).toBe("minor");
  });

  it("skips commits that resolve to no package", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "feat",
        description: "update CI",
        files: [".github/workflows/ci.yml"],
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {});
    expect(result.size).toBe(0);
  });

  it("maps fix to patch bump", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "fix",
        scope: "core",
        description: "null check",
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {});
    expect(result.get("packages/core")!.bumpType).toBe("patch");
  });

  it("maps breaking change to major", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "feat",
        scope: "core",
        breaking: true,
        description: "remove API",
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {});
    expect(result.get("packages/core")!.bumpType).toBe("major");
  });

  it("takes highest bump when multiple commits affect same package", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "fix",
        scope: "core",
        description: "fix bug",
      }),
      makeCommit({
        hash: "bbb",
        type: "feat",
        scope: "core",
        description: "add feature",
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {});
    expect(result.get("packages/core")!.bumpType).toBe("minor");
  });

  it("treats breaking ignored-type as major (chore!:)", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "chore",
        scope: "core",
        breaking: true,
        description: "drop node 16",
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {});
    expect(result.get("packages/core")!.bumpType).toBe("major");
  });

  it("ignores chore/docs/test commits by default", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "chore",
        scope: "core",
        description: "update deps",
      }),
      makeCommit({
        hash: "bbb",
        type: "docs",
        scope: "core",
        description: "update readme",
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {});
    expect(result.size).toBe(0);
  });

  it("respects custom type mapping override", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "refactor",
        scope: "core",
        description: "cleanup",
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {
      refactor: "patch",
    });
    expect(result.get("packages/core")!.bumpType).toBe("patch");
  });

  it("collects entries per package", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "feat",
        scope: "core",
        description: "add feature A",
      }),
      makeCommit({
        hash: "bbb",
        type: "fix",
        scope: "core",
        description: "fix bug B",
      }),
    ];
    const result = analyzeCommits(commits, ["packages/core"], {});
    const pkg = result.get("packages/core");
    expect(pkg!.entries).toHaveLength(2);
    expect(pkg!.entries[0]).toEqual({
      summary: "feat(core): add feature A",
      type: "feat",
      hash: "aaa",
    });
    expect(pkg!.entries[1]).toEqual({
      summary: "fix(core): fix bug B",
      type: "fix",
      hash: "bbb",
    });
  });

  it("handles commits without scope using file-based resolution", () => {
    const commits = [
      makeCommit({
        hash: "aaa",
        type: "fix",
        description: "fix path",
        files: ["packages/pubm/src/cli.ts"],
      }),
    ];
    const result = analyzeCommits(
      commits,
      ["packages/core", "packages/pubm"],
      {},
    );
    expect(result.has("packages/pubm")).toBe(true);
    expect(result.has("packages/core")).toBe(false);
  });
});
