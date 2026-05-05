import { beforeEach, describe, expect, it, vi } from "vitest";
import { readChangesets } from "../../../src/changeset/reader.js";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import type { PubmContext } from "../../../src/context.js";
import {
  findLastReleaseRef,
  getCommitsSinceRef,
} from "../../../src/conventional-commit/git-log.js";
import { analyzeReleaseChanges } from "../../../src/release-analysis/analyze.js";

vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(),
  deleteChangesetFiles: vi.fn(),
}));

vi.mock("../../../src/conventional-commit/git-log.js", () => ({
  findLastReleaseRef: vi.fn(),
  getCommitsSinceRef: vi.fn(),
}));

const mockedReadChangesets = vi.mocked(readChangesets);
const mockedFindLastReleaseRef = vi.mocked(findLastReleaseRef);
const mockedGetCommitsSinceRef = vi.mocked(getCommitsSinceRef);

function makePackage(
  overrides: Partial<ResolvedPackageConfig> & {
    name: string;
    path: string;
    version: string;
  },
): ResolvedPackageConfig {
  return {
    dependencies: [],
    ecosystem: "js",
    registries: ["npm"],
    ...overrides,
  };
}

function makeContext(packages: ResolvedPackageConfig[]): PubmContext {
  return {
    cwd: "/repo",
    config: {
      packages,
      release: {
        changesets: { directory: ".changesets" },
        commits: { format: "conventional", types: {} },
      },
    },
    runtime: {},
  } as PubmContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFindLastReleaseRef.mockReturnValue(undefined);
});

describe("analyzeReleaseChanges", () => {
  it("merges source recommendations and reports unversioned commits", async () => {
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
    ];
    mockedReadChangesets.mockImplementation((_cwd, resolveKey) => {
      expect(resolveKey("@scope/core")).toBe("packages/core::js");
      return [
        {
          id: "steady-owl",
          summary: "Add core API.",
          releases: [{ path: "packages/core", type: "minor" }],
        },
      ];
    });
    mockedGetCommitsSinceRef.mockReturnValue([
      {
        hash: "abc1234",
        message: "fix(cli): repair flag parsing",
        files: ["packages/cli/src/cli.ts"],
      },
      {
        hash: "def5678",
        message: "docs(core): refresh README",
        files: ["packages/core/README.md"],
      },
    ]);

    const analysis = await analyzeReleaseChanges(makeContext(packages));

    expect(mockedReadChangesets).toHaveBeenCalledWith(
      "/repo",
      expect.any(Function),
      ".changesets",
    );
    expect(analysis.recommendations).toEqual([
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "changeset",
        entries: [{ summary: "Add core API.", id: "steady-owl" }],
      },
      {
        packagePath: "packages/cli",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [
          {
            summary: "fix(cli): repair flag parsing",
            type: "fix",
            hash: "abc1234",
          },
        ],
      },
    ]);
    expect(analysis.unversionedChanges).toEqual([
      {
        hash: "def5678",
        summary: "docs(core): refresh README",
        files: ["packages/core/README.md"],
        reason: "ignored-type",
        packagePath: "packages/core",
        type: "docs",
      },
    ]);
  });
});
