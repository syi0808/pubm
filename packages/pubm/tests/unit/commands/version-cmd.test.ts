import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGitInstance = {
  stage: vi.fn(),
  commit: vi.fn(),
};

vi.mock("@pubm/core", () => ({
  createKeyResolver: vi.fn(() => (name: string) => name),
  readChangesets: vi.fn(),
  deleteChangesetFiles: vi.fn(),
  calculateVersionBumps: vi.fn(),
  generateChangelog: vi.fn(),
  buildChangelogEntries: vi.fn(),
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
}));

import type { ResolvedPubmConfig } from "@pubm/core";
import {
  applyFixedGroup,
  buildChangelogEntries,
  calculateVersionBumps,
  deleteChangesetFiles,
  generateChangelog,
  readChangesets,
  resolveGroups,
  ui,
  writeChangelogToFile,
  writeVersionsForEcosystem,
} from "@pubm/core";
import { runVersionCommand } from "../../../src/commands/version-cmd.js";

const mockedApplyFixedGroup = vi.mocked(applyFixedGroup);
const mockedReadChangesets = vi.mocked(readChangesets);
const mockedDeleteChangesetFiles = vi.mocked(deleteChangesetFiles);
const mockedCalculateVersionBumps = vi.mocked(calculateVersionBumps);
const mockedGenerateChangelog = vi.mocked(generateChangelog);
const mockedBuildChangelogEntries = vi.mocked(buildChangelogEntries);
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
  mockedBuildChangelogEntries.mockReturnValue([]);
  mockedResolveGroups.mockReturnValue([]);
});

describe("runVersionCommand", () => {
  it("logs message and returns when no changesets found", async () => {
    mockedReadChangesets.mockReturnValue([]);

    await runVersionCommand("/tmp/project", defaultConfig);

    expect(ui.info).toHaveBeenCalledWith("No changesets found.");
    expect(mockedCalculateVersionBumps).not.toHaveBeenCalled();
  });

  it("reads changesets and calculates version bumps", async () => {
    const changesets = [
      {
        id: "add-feature",
        summary: "Add new feature",
        releases: [{ name: "my-pkg", type: "minor" as const }],
      },
    ];
    mockedReadChangesets.mockReturnValue(changesets);

    const bumps = new Map([
      [
        ".",
        {
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          bumpType: "minor" as const,
        },
      ],
    ]);
    mockedCalculateVersionBumps.mockReturnValue(bumps);
    const entries = [
      { summary: "Add new feature", type: "minor" as const, id: "add-feature" },
    ];
    mockedBuildChangelogEntries.mockReturnValue(entries);
    mockedGenerateChangelog.mockReturnValue(
      "## 1.1.0\n\n### Minor Changes\n\n- Add new feature\n",
    );

    await runVersionCommand("/tmp/project", defaultConfig);

    expect(mockedCalculateVersionBumps).toHaveBeenCalledWith(
      new Map([[".", "1.0.0"]]),
      "/tmp/project",
      expect.any(Function),
    );
    expect(mockedWriteVersionsForEcosystem).toHaveBeenCalledWith(
      expect.any(Array),
      new Map([[".", "1.1.0"]]),
      undefined,
    );
    expect(mockedBuildChangelogEntries).toHaveBeenCalledWith(changesets, ".");
    expect(mockedGenerateChangelog).toHaveBeenCalledWith("1.1.0", entries);
    // Changelog written via shared utility
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      path.resolve("/tmp/project", "."),
      "## 1.1.0\n\n### Minor Changes\n\n- Add new feature\n",
    );
    // Changeset files deleted via shared utility
    expect(mockedDeleteChangesetFiles).toHaveBeenCalledWith(
      "/tmp/project",
      changesets,
    );
  });

  it("throws when changesets exist but no packages are discoverable", async () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "broken-workspace",
        summary: "Broken workspace",
        releases: [{ name: "my-pkg", type: "patch" as const }],
      },
    ]);
    const emptyPkgConfig = makeConfig({ packages: [] });

    await expect(
      runVersionCommand("/tmp/project", emptyPkgConfig),
    ).rejects.toThrow("No packages found.");
    expect(mockedCalculateVersionBumps).not.toHaveBeenCalled();
  });

  it("does not write files in dry-run mode", async () => {
    const changesets = [
      {
        id: "new-feat",
        summary: "New feature",
        releases: [{ name: "my-pkg", type: "minor" as const }],
      },
    ];
    mockedReadChangesets.mockReturnValue(changesets);

    const config200 = makeConfig({
      packages: [
        { name: "my-pkg", version: "2.0.0", path: ".", ecosystem: "js" },
      ] as any,
    });

    const bumps = new Map([
      [
        ".",
        {
          currentVersion: "2.0.0",
          newVersion: "2.1.0",
          bumpType: "minor" as const,
        },
      ],
    ]);
    mockedCalculateVersionBumps.mockReturnValue(bumps);
    mockedBuildChangelogEntries.mockReturnValue([
      { summary: "New feature", type: "minor" as const, id: "new-feat" },
    ]);
    mockedGenerateChangelog.mockReturnValue("## 2.1.0\n");

    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project", config200, { dryRun: true });

    expect(logSpy).toHaveBeenCalledWith("[dry-run] Would write version 2.1.0");
    logSpy.mockRestore();
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
    expect(mockedDeleteChangesetFiles).not.toHaveBeenCalled();
  });

  it("does not consume changesets when writing the new version fails", async () => {
    const changesets = [
      {
        id: "patch-release",
        summary: "Patch release",
        releases: [{ name: "my-pkg", type: "patch" as const }],
      },
    ];
    mockedReadChangesets.mockReturnValue(changesets);
    mockedCalculateVersionBumps.mockReturnValue(
      new Map([
        [
          ".",
          {
            currentVersion: "1.0.0",
            newVersion: "1.0.1",
            bumpType: "patch" as const,
          },
        ],
      ]),
    );
    mockedGenerateChangelog.mockReturnValue("## 1.0.1\n");
    mockedWriteVersionsForEcosystem.mockRejectedValue(new Error("disk full"));

    await expect(
      runVersionCommand("/tmp/project", defaultConfig),
    ).rejects.toThrow("disk full");

    expect(mockedWriteChangelogToFile).not.toHaveBeenCalled();
    expect(mockedDeleteChangesetFiles).not.toHaveBeenCalled();
    expect(mockGitInstance.stage).not.toHaveBeenCalled();
    expect(mockGitInstance.commit).not.toHaveBeenCalled();
  });

  it("returns early when bumps are empty", async () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "unrelated",
        summary: "Unrelated change",
        releases: [{ name: "other-pkg", type: "patch" as const }],
      },
    ]);
    mockedCalculateVersionBumps.mockReturnValue(new Map());

    await runVersionCommand("/tmp/project", defaultConfig);

    expect(ui.info).toHaveBeenCalledWith("No changesets found.");
    expect(mockedWriteVersionsForEcosystem).not.toHaveBeenCalled();
  });

  it("prepends to existing CHANGELOG.md", async () => {
    const changesets = [
      {
        id: "fix-it",
        summary: "Fix it",
        releases: [{ name: "my-pkg", type: "patch" as const }],
      },
    ];
    mockedReadChangesets.mockReturnValue(changesets);

    const bumps = new Map([
      [
        ".",
        {
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          bumpType: "patch" as const,
        },
      ],
    ]);
    mockedCalculateVersionBumps.mockReturnValue(bumps);
    const entries = [
      { summary: "Fix it", type: "patch" as const, id: "fix-it" },
    ];
    mockedBuildChangelogEntries.mockReturnValue(entries);
    mockedGenerateChangelog.mockReturnValue(
      "## 1.0.1\n\n### Patch Changes\n\n- Fix it\n",
    );

    await runVersionCommand("/tmp/project", defaultConfig);

    // Changelog written via shared utility
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      path.resolve("/tmp/project", "."),
      "## 1.0.1\n\n### Patch Changes\n\n- Fix it\n",
    );
    // Changeset files deleted via shared utility
    expect(mockedDeleteChangesetFiles).toHaveBeenCalledWith(
      "/tmp/project",
      changesets,
    );
  });

  it("applies fixed groups and writes package-local versions for monorepos", async () => {
    const changesets = [
      {
        id: "coordinated-release",
        summary: "Coordinate workspace release",
        releases: [{ name: "pkg-a", type: "minor" as const }],
      },
    ];
    mockedReadChangesets.mockReturnValue(changesets);
    mockedCalculateVersionBumps.mockReturnValue(
      new Map([
        [
          "packages/pkg-a",
          {
            currentVersion: "1.0.0",
            newVersion: "1.1.0",
            bumpType: "minor" as const,
          },
        ],
      ]),
    );
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
      // The implementation passes path-keyed bumpTypes and name-based groups.
      // Simulate applyFixedGroup by translating group names to paths and setting minor.
      const nameToPaths: Record<string, string> = {
        "pkg-a": "packages/pkg-a",
        "pkg-b": "packages/pkg-b",
      };
      for (const name of group) {
        const p = nameToPaths[name] ?? name;
        bumpTypes.set(p, "minor");
      }
    });
    mockedGenerateChangelog.mockReturnValue("## 1.1.0\n");

    await runVersionCommand("/tmp/project", fixedConfig);

    expect(mockedResolveGroups).toHaveBeenCalledWith(
      [["pkg-a", "pkg-b"]],
      ["pkg-a", "pkg-b"],
    );
    expect(mockedWriteVersionsForEcosystem).toHaveBeenCalledWith(
      expect.any(Array),
      new Map([
        ["packages/pkg-a", "1.1.0"],
        ["packages/pkg-b", "1.1.0"],
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
});
