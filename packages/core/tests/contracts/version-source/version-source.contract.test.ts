import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import { handleMultiPackage } from "../../../src/tasks/prompts/independent-mode.js";
import { analyzeAllSources } from "../../../src/tasks/prompts/version-choices.js";
import { mergeRecommendations } from "../../../src/version-source/index.js";
import type { VersionRecommendation } from "../../../src/version-source/types.js";

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock("std-env", () => ({
  isCI: true,
}));

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pubm-version-source-"));
  roots.push(root);
  return root;
}

function writeFixture(root: string, relativePath: string, contents: string) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf-8");
}

function writeChangeset(root: string, fileName: string, contents: string) {
  writeFixture(root, path.join(".pubm", "changesets", fileName), contents);
}

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

function makeContext(
  root: string,
  packages: ResolvedPackageConfig[],
  versionSources: "all" | "changesets" | "commits" = "all",
  versioning: "independent" | "fixed" = "independent",
) {
  return {
    cwd: root,
    config: {
      packages,
      versionSources,
      versioning,
      conventionalCommits: { types: {} },
    },
    runtime: {},
  };
}

function mockGitLog(output: string) {
  mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
    if (args[0] === "tag") return "";
    if (args[0] === "log" && args.includes("--grep=^Version Packages$")) {
      return "";
    }
    if (args[0] === "log" && args.includes("--name-only")) {
      return output;
    }
    return "";
  });
}

function commitLog(...lines: string[]): string {
  return [...lines, ""].join("\n");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGitLog("");
});

describe("version source contracts", () => {
  it("uses changesets only when versionSources is changesets", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
    ];
    writeChangeset(
      root,
      "calm-owl.md",
      '---\n"@scope/core": minor\n---\n\nAdd the contract surface.\n',
    );
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "fix(core): commit-only fix",
        "COMMIT_FILES",
        "packages/core/src/index.ts",
      ),
    );

    const recommendations = await analyzeAllSources(
      makeContext(root, packages, "changesets") as never,
    );

    expect(recommendations).toEqual([
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "changeset",
        entries: [
          {
            summary: "Add the contract surface.",
            id: "calm-owl",
          },
        ],
      },
    ]);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("uses conventional commits only when versionSources is commits", async () => {
    const root = makeRoot();
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
    writeChangeset(
      root,
      "ignored-change.md",
      '---\n"packages/core": major\n---\n\nThis changeset is not selected.\n',
    );
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "feat(core): add core API",
        "COMMIT_FILES",
        "packages/core/src/index.ts",
        "COMMIT_START def5678",
        "fix(cli): repair flag parsing",
        "COMMIT_FILES",
        "packages/cli/src/cli.ts",
        "COMMIT_START fedcba9",
        "docs: update README",
        "COMMIT_FILES",
        "README.md",
      ),
    );

    const recommendations = await analyzeAllSources(
      makeContext(root, packages, "commits") as never,
    );

    expect(recommendations).toEqual([
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "conventional-commit",
        entries: [
          {
            summary: "feat(core): add core API",
            type: "feat",
            hash: "abc1234",
          },
        ],
      },
      {
        packagePath: "packages/cli",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [
          {
            summary: "fix(cli): repair flag parsing",
            type: "fix",
            hash: "def5678",
          },
        ],
      },
    ]);
  });

  it("keeps the first source result when recommendations overlap", () => {
    const changesets: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "changeset",
        entries: [{ summary: "Add API", id: "cs-1" }],
      },
    ];
    const commits: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [{ summary: "fix(core): bug", type: "fix", hash: "abc" }],
      },
      {
        packagePath: "packages/cli",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [{ summary: "fix(cli): bug", type: "fix", hash: "def" }],
      },
    ];

    expect(mergeRecommendations([changesets, commits])).toEqual([
      changesets[0],
      commits[1],
    ]);
  });

  it("maps accepted recommendations differently for independent and fixed versioning", async () => {
    const root = makeRoot();
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
    writeChangeset(
      root,
      "planned-release.md",
      [
        "---",
        '"packages/core": minor',
        '"packages/cli": patch',
        "---",
        "",
        "Release both packages.",
        "",
      ].join("\n"),
    );

    const independentCtx = makeContext(
      root,
      packages,
      "changesets",
      "independent",
    );
    await handleMultiPackage(independentCtx as never, {} as never, packages);

    expect(independentCtx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/core::js", "1.1.0"],
        ["packages/cli::js", "2.0.1"],
      ]),
    });

    const fixedCtx = makeContext(root, packages, "changesets", "fixed");
    await handleMultiPackage(fixedCtx as never, {} as never, packages);

    expect(fixedCtx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "2.0.1",
      packages: new Map([
        ["packages/core::js", "2.0.1"],
        ["packages/cli::js", "2.0.1"],
      ]),
    });
  });

  it("returns no recommendation when changesets and commits have no bump", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
    ];
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "docs(core): clarify usage",
        "COMMIT_FILES",
        "packages/core/README.md",
      ),
    );

    const recommendations = await analyzeAllSources(
      makeContext(root, packages, "all") as never,
    );

    expect(recommendations).toEqual([]);
  });
});
