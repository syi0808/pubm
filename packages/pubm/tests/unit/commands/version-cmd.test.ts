import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGitInstance = {
  stage: vi.fn(),
  commit: vi.fn(),
};

vi.mock("@pubm/core", () => ({
  readChangesets: vi.fn(),
  deleteChangesetFiles: vi.fn(),
  calculateVersionBumps: vi.fn(),
  generateChangelog: vi.fn(),
  buildChangelogEntries: vi.fn(),
  writeChangelogToFile: vi.fn(),
  loadConfig: vi.fn(),
  discoverCurrentVersions: vi.fn(),
  discoverPackageInfos: vi.fn(),
  replaceVersion: vi.fn(),
  replaceVersionAtPath: vi.fn(),
  resolveGroups: vi.fn(),
  Git: vi.fn(function () {
    return mockGitInstance;
  }),
  applyFixedGroup: vi.fn(),
  applyLinkedGroup: vi.fn(),
}));

import {
  applyFixedGroup,
  buildChangelogEntries,
  calculateVersionBumps,
  deleteChangesetFiles,
  discoverCurrentVersions,
  discoverPackageInfos,
  generateChangelog,
  loadConfig,
  readChangesets,
  replaceVersion,
  replaceVersionAtPath,
  resolveGroups,
  writeChangelogToFile,
} from "@pubm/core";
import { runVersionCommand } from "../../../src/commands/version-cmd.js";

const mockedApplyFixedGroup = vi.mocked(applyFixedGroup);
const mockedReadChangesets = vi.mocked(readChangesets);
const mockedDeleteChangesetFiles = vi.mocked(deleteChangesetFiles);
const mockedCalculateVersionBumps = vi.mocked(calculateVersionBumps);
const mockedGenerateChangelog = vi.mocked(generateChangelog);
const mockedBuildChangelogEntries = vi.mocked(buildChangelogEntries);
const mockedWriteChangelogToFile = vi.mocked(writeChangelogToFile);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedDiscoverCurrentVersions = vi.mocked(discoverCurrentVersions);
const mockedDiscoverPackageInfos = vi.mocked(discoverPackageInfos);
const mockedReplaceVersion = vi.mocked(replaceVersion);
const mockedReplaceVersionAtPath = vi.mocked(replaceVersionAtPath);
const mockedResolveGroups = vi.mocked(resolveGroups);

beforeEach(() => {
  vi.clearAllMocks();
  mockedLoadConfig.mockResolvedValue(null);
  mockedDiscoverCurrentVersions.mockResolvedValue(
    new Map([["my-pkg", "1.0.0"]]),
  );
  mockedDiscoverPackageInfos.mockResolvedValue(null as any);
  mockedReplaceVersion.mockResolvedValue(["package.json"]);
  mockedReplaceVersionAtPath.mockResolvedValue(["package.json"]);
  mockedBuildChangelogEntries.mockReturnValue([]);
  mockedResolveGroups.mockReturnValue([]);
});

describe("runVersionCommand", () => {
  it("logs message and returns when no changesets found", async () => {
    mockedReadChangesets.mockReturnValue([]);
    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project");

    expect(logSpy).toHaveBeenCalledWith("No changesets found.");
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
    mockedDiscoverCurrentVersions.mockResolvedValue(
      new Map([["my-pkg", "1.0.0"]]),
    );

    const bumps = new Map([
      [
        "my-pkg",
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

    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project");

    expect(mockedCalculateVersionBumps).toHaveBeenCalledWith(
      new Map([["my-pkg", "1.0.0"]]),
      "/tmp/project",
    );
    expect(logSpy).toHaveBeenCalledWith("my-pkg: 1.0.0 → 1.1.0 (minor)");
    expect(mockedReplaceVersion).toHaveBeenCalledWith("1.1.0", undefined);
    expect(mockedBuildChangelogEntries).toHaveBeenCalledWith(
      changesets,
      "my-pkg",
    );
    expect(mockedGenerateChangelog).toHaveBeenCalledWith("1.1.0", entries);
    // Changelog written via shared utility
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      "/tmp/project",
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
    mockedDiscoverCurrentVersions.mockResolvedValue(new Map());

    await expect(runVersionCommand("/tmp/project")).rejects.toThrow(
      "No packages found.",
    );
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
    mockedDiscoverCurrentVersions.mockResolvedValue(
      new Map([["my-pkg", "2.0.0"]]),
    );

    const bumps = new Map([
      [
        "my-pkg",
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

    await runVersionCommand("/tmp/project", { dryRun: true });

    expect(logSpy).toHaveBeenCalledWith("[dry-run] Would write version 2.1.0");
    expect(mockedReplaceVersion).not.toHaveBeenCalled();
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
          "my-pkg",
          {
            currentVersion: "1.0.0",
            newVersion: "1.0.1",
            bumpType: "patch" as const,
          },
        ],
      ]),
    );
    mockedGenerateChangelog.mockReturnValue("## 1.0.1\n");
    mockedReplaceVersion.mockRejectedValue(new Error("disk full"));

    await expect(runVersionCommand("/tmp/project")).rejects.toThrow(
      "disk full",
    );

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
    mockedDiscoverCurrentVersions.mockResolvedValue(
      new Map([["my-pkg", "1.0.0"]]),
    );
    mockedCalculateVersionBumps.mockReturnValue(new Map());

    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project");

    expect(logSpy).toHaveBeenCalledWith("No changesets found.");
    expect(mockedReplaceVersion).not.toHaveBeenCalled();
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
    mockedDiscoverCurrentVersions.mockResolvedValue(
      new Map([["my-pkg", "1.0.0"]]),
    );

    const bumps = new Map([
      [
        "my-pkg",
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

    await runVersionCommand("/tmp/project");

    // Changelog written via shared utility
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      "/tmp/project",
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
    mockedDiscoverCurrentVersions.mockResolvedValue(
      new Map([
        ["pkg-a", "1.0.0"],
        ["pkg-b", "1.0.0"],
      ]),
    );
    mockedCalculateVersionBumps.mockReturnValue(
      new Map([
        [
          "pkg-a",
          {
            currentVersion: "1.0.0",
            newVersion: "1.1.0",
            bumpType: "minor" as const,
          },
        ],
      ]),
    );
    mockedLoadConfig.mockResolvedValue({
      fixed: [["pkg-a", "pkg-b"]],
    } as Awaited<ReturnType<typeof loadConfig>>);
    mockedResolveGroups.mockReturnValue([["pkg-a", "pkg-b"]]);
    mockedApplyFixedGroup.mockImplementation((bumpTypes, group) => {
      for (const name of group) {
        bumpTypes.set(name, "minor");
      }
    });
    mockedDiscoverPackageInfos.mockResolvedValue([
      { name: "pkg-a", path: "packages/pkg-a" },
      { name: "pkg-b", path: "packages/pkg-b" },
    ] as Awaited<ReturnType<typeof discoverPackageInfos>>);
    mockedGenerateChangelog.mockReturnValue("## 1.1.0\n");

    await runVersionCommand("/tmp/project");

    expect(mockedResolveGroups).toHaveBeenCalledWith(
      [["pkg-a", "pkg-b"]],
      ["pkg-a", "pkg-b"],
    );
    expect(mockedReplaceVersionAtPath).toHaveBeenCalledWith(
      "1.1.0",
      "/tmp/project/packages/pkg-a",
    );
    expect(mockedReplaceVersionAtPath).toHaveBeenCalledWith(
      "1.1.0",
      "/tmp/project/packages/pkg-b",
    );
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      "/tmp/project/packages/pkg-a",
      "## 1.1.0\n",
    );
    expect(mockedWriteChangelogToFile).toHaveBeenCalledWith(
      "/tmp/project/packages/pkg-b",
      "## 1.1.0\n",
    );
    expect(mockGitInstance.commit).toHaveBeenCalledWith(
      "chore: version pkg-a, pkg-b",
    );
  });
});
