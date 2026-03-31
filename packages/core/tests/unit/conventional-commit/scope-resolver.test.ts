import { describe, expect, it } from "vitest";
import { resolveCommitPackages } from "../../../src/conventional-commit/scope-resolver.js";
import type { ConventionalCommit } from "../../../src/conventional-commit/types.js";

function makeCommit(
  overrides: Partial<ConventionalCommit>,
): ConventionalCommit {
  return {
    hash: "abc1234",
    type: "feat",
    breaking: false,
    description: "test",
    footers: new Map(),
    files: [],
    ...overrides,
  };
}

const packagePaths = ["packages/core", "packages/pubm", "plugins/brew"];

describe("resolveCommitPackages", () => {
  it("resolves by scope matching package directory name", () => {
    const commit = makeCommit({ scope: "core" });
    const result = resolveCommitPackages(commit, packagePaths);
    expect(result).toEqual(["packages/core"]);
  });

  it("resolves by scope matching last segment", () => {
    const commit = makeCommit({ scope: "brew" });
    const result = resolveCommitPackages(commit, packagePaths);
    expect(result).toEqual(["plugins/brew"]);
  });

  it("falls back to file path when scope does not match", () => {
    const commit = makeCommit({
      scope: "unknown",
      files: ["packages/pubm/src/cli.ts"],
    });
    const result = resolveCommitPackages(commit, packagePaths);
    expect(result).toEqual(["packages/pubm"]);
  });

  it("resolves by file path when no scope", () => {
    const commit = makeCommit({
      files: ["packages/core/src/index.ts"],
    });
    const result = resolveCommitPackages(commit, packagePaths);
    expect(result).toEqual(["packages/core"]);
  });

  it("returns multiple packages for multi-package file changes", () => {
    const commit = makeCommit({
      files: ["packages/core/src/utils.ts", "packages/pubm/src/cli.ts"],
    });
    const result = resolveCommitPackages(commit, packagePaths);
    expect(result).toEqual(["packages/core", "packages/pubm"]);
  });

  it("returns empty array when no package matches", () => {
    const commit = makeCommit({
      files: ["README.md", ".github/workflows/ci.yml"],
    });
    const result = resolveCommitPackages(commit, packagePaths);
    expect(result).toEqual([]);
  });

  it("matches root package '.' to any file", () => {
    const commit = makeCommit({
      files: ["src/index.ts"],
    });
    const result = resolveCommitPackages(commit, ["."]);
    expect(result).toEqual(["."]);
  });

  it("deduplicates packages", () => {
    const commit = makeCommit({
      scope: "core",
      files: ["packages/core/src/a.ts", "packages/core/src/b.ts"],
    });
    const result = resolveCommitPackages(commit, packagePaths);
    expect(result).toEqual(["packages/core"]);
  });
});
