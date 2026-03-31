import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/conventional-commit/git-log.js", () => ({
  findLastReleaseRef: vi.fn(),
  getCommitsSinceRef: vi.fn(),
}));

vi.mock("../../../src/conventional-commit/parser.js", () => ({
  parseConventionalCommit: vi.fn(),
}));

import {
  findLastReleaseRef,
  getCommitsSinceRef,
} from "../../../src/conventional-commit/git-log.js";
import { parseConventionalCommit } from "../../../src/conventional-commit/parser.js";
import { ConventionalCommitSource } from "../../../src/version-source/conventional-commit-source.js";
import type { VersionSourceContext } from "../../../src/version-source/types.js";

const mockedFindLastReleaseRef = vi.mocked(findLastReleaseRef);
const mockedGetCommitsSinceRef = vi.mocked(getCommitsSinceRef);
const mockedParseCC = vi.mocked(parseConventionalCommit);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConventionalCommitSource", () => {
  const context: VersionSourceContext = {
    cwd: "/repo",
    packages: new Map([
      ["packages/core", "1.0.0"],
      ["packages/pubm", "2.0.0"],
    ]),
  };

  it("has name 'conventional-commit'", () => {
    expect(new ConventionalCommitSource().name).toBe("conventional-commit");
  });

  it("analyzes commits and returns recommendations", async () => {
    mockedFindLastReleaseRef.mockReturnValue("v1.0.0");
    mockedGetCommitsSinceRef.mockReturnValue([
      {
        hash: "abc1234",
        message: "feat(core): add feature",
        files: ["packages/core/src/index.ts"],
      },
    ]);
    mockedParseCC.mockReturnValue({
      hash: "abc1234",
      type: "feat",
      scope: "core",
      breaking: false,
      description: "add feature",
      footers: new Map(),
      files: ["packages/core/src/index.ts"],
    });

    const source = new ConventionalCommitSource();
    const results = await source.analyze(context);

    expect(results).toEqual([
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "conventional-commit",
        entries: [
          { summary: "feat(core): add feature", type: "feat", hash: "abc1234" },
        ],
      },
    ]);
  });

  it("returns empty when no conventional commits found", async () => {
    mockedFindLastReleaseRef.mockReturnValue("v1.0.0");
    mockedGetCommitsSinceRef.mockReturnValue([
      { hash: "abc1234", message: "update readme", files: [] },
    ]);
    mockedParseCC.mockReturnValue(null);

    const source = new ConventionalCommitSource();
    const results = await source.analyze(context);
    expect(results).toEqual([]);
  });

  it("respects custom type overrides", async () => {
    mockedFindLastReleaseRef.mockReturnValue("v1.0.0");
    mockedGetCommitsSinceRef.mockReturnValue([
      {
        hash: "abc1234",
        message: "refactor(core): cleanup",
        files: ["packages/core/src/index.ts"],
      },
    ]);
    mockedParseCC.mockReturnValue({
      hash: "abc1234",
      type: "refactor",
      scope: "core",
      breaking: false,
      description: "cleanup",
      footers: new Map(),
      files: ["packages/core/src/index.ts"],
    });

    const source = new ConventionalCommitSource({ refactor: "patch" });
    const results = await source.analyze(context);
    expect(results).toHaveLength(1);
    expect(results[0].bumpType).toBe("patch");
  });

  it("consume is a no-op", async () => {
    const source = new ConventionalCommitSource();
    await source.consume!([]);
  });
});
