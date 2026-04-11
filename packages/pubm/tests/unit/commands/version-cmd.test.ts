import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGitInstance,
  mockChangesetSourceAnalyze,
  mockChangesetSourceConsume,
  mockConventionalCommitSourceAnalyze,
  mockConventionalCommitSourceConsume,
  mockMergeRecommendations,
  mockChangesetChangelogWriterFormatEntries,
  mockConventionalCommitChangelogWriterFormatEntries,
  mockRenderChangelog,
} = vi.hoisted(() => {
  return {
    mockGitInstance: {
      stage: vi.fn(),
      commit: vi.fn(),
    },
    mockChangesetSourceAnalyze: vi.fn(async () => []),
    mockChangesetSourceConsume: vi.fn(async () => {}),
    mockConventionalCommitSourceAnalyze: vi.fn(async () => []),
    mockConventionalCommitSourceConsume: vi.fn(async () => {}),
    mockMergeRecommendations: vi.fn(() => []),
    mockChangesetChangelogWriterFormatEntries: vi.fn(() => []),
    mockConventionalCommitChangelogWriterFormatEntries: vi.fn(() => []),
    mockRenderChangelog: vi.fn(() => "## mock-version\n"),
  };
});

vi.mock("@pubm/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pubm/core")>();
  return {
    ...actual,
    createKeyResolver: vi.fn(() => (name: string) => name),
    ChangesetSource: vi.fn(function () {
      return {
        analyze: mockChangesetSourceAnalyze,
        consume: mockChangesetSourceConsume,
      };
    }),
    ConventionalCommitSource: vi.fn(function () {
      return {
        analyze: mockConventionalCommitSourceAnalyze,
        consume: mockConventionalCommitSourceConsume,
      };
    }),
    mergeRecommendations: mockMergeRecommendations,
    ChangesetChangelogWriter: vi.fn(function () {
      return { formatEntries: mockChangesetChangelogWriterFormatEntries };
    }),
    ConventionalCommitChangelogWriter: vi.fn(function () {
      return {
        formatEntries: mockConventionalCommitChangelogWriterFormatEntries,
      };
    }),
    renderChangelog: mockRenderChangelog,
    writeChangelogToFile: vi.fn(),
    writeVersionsForEcosystem: vi.fn(),
    ecosystemCatalog: {
      get: vi.fn(() => ({
        ecosystemClass: vi.fn().mockImplementation(function () {
          return { packageName: vi.fn(), writeVersion: vi.fn() };
        }),
      })),
    },
    resolveGroups: vi.fn(),
    Git: vi.fn(function () {
      return mockGitInstance;
    }),
    applyFixedGroup: vi.fn(),
    applyLinkedGroup: vi.fn(),
    ui: {
      success: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      hint: vi.fn(),
      labels: { DRY_RUN: "[dry-run]" },
    },
  };
});

import type { ResolvedPubmConfig } from "@pubm/core";
import {
  applyFixedGroup,
  ChangesetSource,
  ConventionalCommitSource,
  resolveGroups,
  ui,
  writeChangelogToFile,
  writeVersionsForEcosystem,
} from "@pubm/core";
import { runVersionCommand } from "../../../src/commands/version-cmd.js";

const mockedApplyFixedGroup = vi.mocked(applyFixedGroup);
const mockedWriteChangelogToFile = vi.mocked(writeChangelogToFile);
const mockedWriteVersionsForEcosystem = vi.mocked(writeVersionsForEcosystem);
const mockedResolveGroups = vi.mocked(resolveGroups);

function makeConfig(
  overrides: Partial<ResolvedPubmConfig> = {},
): ResolvedPubmConfig {
  return {
    plugins: [],
    packages: [
      { name: "my-pkg", version: "1.0.0", path: ".", ecosystem: "js" },
    ],
    ...overrides,
  } as ResolvedPubmConfig;
}

const defaultConfig = makeConfig();

beforeEach(() => {
  vi.clearAllMocks();
  mockedWriteVersionsForEcosystem.mockResolvedValue([]);
  mockedResolveGroups.mockReturnValue([]);
  mockMergeRecommendations.mockReturnValue([]);
  mockChangesetSourceAnalyze.mockResolvedValue([]);
  mockConventionalCommitSourceAnalyze.mockResolvedValue([]);
  mockChangesetChangelogWriterFormatEntries.mockReturnValue([]);
  mockConventionalCommitChangelogWriterFormatEntries.mockReturnValue([]);
  mockRenderChangelog.mockReturnValue("## mock-version\n");
});

describe("runVersionCommand", () => {
  it("logs message and returns when no recommendations found", async () => {
    mockMergeRecommendations.mockReturnValue([]);

    await runVersionCommand("/tmp/project", defaultConfig);

    expect(ui.info).toHaveBeenCalledWith("No changesets found.");
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
  });

  it("analyzes sources and writes versions based on recommendations", async () => {
    mockMergeRecommendations.mockReturnValue([
      {
        packagePath: ".",
        bumpType: "minor" as const,
        source: "changeset" as const,
        entries: [{ summary: "Add new feature" }],
      },
    ]);
    mockChangesetChangelogWriterFormatEntries.mockReturnValue([
      { title: "Minor Changes", items: ["Add new feature"] },
    ]);
    mockRenderChangelog.mockReturnValue(
      "## 1.1.0\n\n### Minor Changes\n\n- Add new feature\n",
    );

    await runVersionCommand("/tmp/project", defaultConfig);

    expect(mockedWriteVersionsForEcosystem).toHaveBeenCalledWith(
      expect.any(Array),
      new Map([[".::js", "1.1.0"]]),
      undefined,
    );
    expect(mockChangesetChangelogWriterFormatEntries).toHaveBeenCalledWith([
      { summary: "Add new feature" },
    ]);
    expect(mockRenderChangelog).toHaveBeenCalledWith(
      "1.1.0",
      expect.any(Array),
    );
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      path.resolve("/tmp/project", "."),
      "## 1.1.0\n\n### Minor Changes\n\n- Add new feature\n",
    );
    expect(mockChangesetSourceConsume).toHaveBeenCalled();
  });

  it("throws when no packages are discoverable", async () => {
    const emptyPkgConfig = makeConfig({ packages: [] });

    await expect(
      runVersionCommand("/tmp/project", emptyPkgConfig),
    ).rejects.toThrow("No packages found.");
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
  });

  it("does not write files in dry-run mode", async () => {
    const config200 = makeConfig({
      packages: [
        { name: "my-pkg", version: "2.0.0", path: ".", ecosystem: "js" },
      ] as any,
    });

    mockMergeRecommendations.mockReturnValue([
      {
        packagePath: ".",
        bumpType: "minor" as const,
        source: "changeset" as const,
        entries: [{ summary: "New feature" }],
      },
    ]);
    mockRenderChangelog.mockReturnValue("## 2.1.0\n");

    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project", config200, { dryRun: true });

    expect(logSpy).toHaveBeenCalledWith("[dry-run] Would write version 2.1.0");
    logSpy.mockRestore();
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
    expect(mockChangesetSourceConsume).not.toHaveBeenCalled();
  });

  it("does not consume sources when writing the new version fails", async () => {
    mockMergeRecommendations.mockReturnValue([
      {
        packagePath: ".",
        bumpType: "patch" as const,
        source: "changeset" as const,
        entries: [],
      },
    ]);
    mockRenderChangelog.mockReturnValue("## 1.0.1\n");
    mockedWriteVersionsForEcosystem.mockRejectedValue(new Error("disk full"));

    await expect(
      runVersionCommand("/tmp/project", defaultConfig),
    ).rejects.toThrow("disk full");

    expect(mockedWriteChangelogToFile).not.toHaveBeenCalled();
    expect(mockChangesetSourceConsume).not.toHaveBeenCalled();
    expect(mockGitInstance.stage).not.toHaveBeenCalled();
    expect(mockGitInstance.commit).not.toHaveBeenCalled();
  });

  it("returns early when bumps are empty (no matching packages in recommendations)", async () => {
    // Recommendation for a package not in config
    mockMergeRecommendations.mockReturnValue([
      {
        packagePath: "other-pkg",
        bumpType: "patch" as const,
        source: "changeset" as const,
        entries: [],
      },
    ]);

    await runVersionCommand("/tmp/project", defaultConfig);

    expect(ui.info).toHaveBeenCalledWith("No changesets found.");
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
  });

  it("writes changelog to package directory", async () => {
    mockMergeRecommendations.mockReturnValue([
      {
        packagePath: ".",
        bumpType: "patch" as const,
        source: "changeset" as const,
        entries: [{ summary: "Fix it" }],
      },
    ]);
    mockChangesetChangelogWriterFormatEntries.mockReturnValue([
      { title: "Patch Changes", items: ["Fix it"] },
    ]);
    mockRenderChangelog.mockReturnValue(
      "## 1.0.1\n\n### Patch Changes\n\n- Fix it\n",
    );

    await runVersionCommand("/tmp/project", defaultConfig);

    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      path.resolve("/tmp/project", "."),
      "## 1.0.1\n\n### Patch Changes\n\n- Fix it\n",
    );
    expect(mockChangesetSourceConsume).toHaveBeenCalled();
  });

  it("applies fixed groups and writes package-local versions for monorepos", async () => {
    mockMergeRecommendations.mockReturnValue([
      {
        packagePath: "packages/pkg-a",
        bumpType: "minor" as const,
        source: "changeset" as const,
        entries: [{ summary: "Coordinate workspace release" }],
      },
    ]);
    mockRenderChangelog.mockReturnValue("## 1.1.0\n");

    const fixedConfig = makeConfig({
      fixed: [["pkg-a", "pkg-b"]],
      packages: [
        {
          name: "pkg-a",
          version: "1.0.0",
          path: "packages/pkg-a",
          ecosystem: "js",
        },
        {
          name: "pkg-b",
          version: "1.0.0",
          path: "packages/pkg-b",
          ecosystem: "js",
        },
      ] as any,
    });
    mockedResolveGroups.mockReturnValue([["pkg-a", "pkg-b"]]);
    mockedApplyFixedGroup.mockImplementation((bumpTypes, group) => {
      // Simulate applyFixedGroup by setting minor for both packages (name-keyed)
      for (const name of group) {
        bumpTypes.set(name, "minor");
      }
    });

    await runVersionCommand("/tmp/project", fixedConfig);

    expect(mockedResolveGroups).toHaveBeenCalledWith(
      [["pkg-a", "pkg-b"]],
      ["pkg-a", "pkg-b"],
    );
    expect(mockedWriteVersionsForEcosystem).toHaveBeenCalledWith(
      expect.any(Array),
      new Map([
        ["packages/pkg-a::js", "1.1.0"],
        ["packages/pkg-b::js", "1.1.0"],
      ]),
      undefined,
    );
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      path.resolve("/tmp/project", "packages/pkg-a"),
      "## 1.1.0\n",
    );
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      path.resolve("/tmp/project", "packages/pkg-b"),
      "## 1.1.0\n",
    );
    expect(mockGitInstance.commit).toHaveBeenCalledWith(
      "Version Packages\n\n- pkg-a: 1.1.0\n- pkg-b: 1.1.0",
    );
  });

  it("only creates ChangesetSource when versionSources is 'changesets'", async () => {
    const config = makeConfig({
      versionSources: "changesets",
    } as any);
    mockMergeRecommendations.mockReturnValue([]);

    await runVersionCommand("/tmp/project", config);

    expect(ChangesetSource).toHaveBeenCalled();
    expect(ConventionalCommitSource).not.toHaveBeenCalled();
  });

  it("only creates ConventionalCommitSource when versionSources is 'commits'", async () => {
    const config = makeConfig({
      versionSources: "commits",
    } as any);
    mockMergeRecommendations.mockReturnValue([]);

    await runVersionCommand("/tmp/project", config);

    expect(ChangesetSource).not.toHaveBeenCalled();
    expect(ConventionalCommitSource).toHaveBeenCalled();
  });
});
