import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(),
  deleteChangesetFiles: vi.fn(),
}));

vi.mock("../../../src/changeset/version.js", () => ({
  calculateVersionBumps: vi.fn(),
}));

vi.mock("../../../src/changeset/changelog.js", () => ({
  generateChangelog: vi.fn(),
  buildChangelogEntries: vi.fn(),
  writeChangelogToFile: vi.fn(),
}));

vi.mock("../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/prerelease/pre.js", () => ({
  readPreState: vi.fn(),
}));

vi.mock("../../../src/changeset/packages.js", () => ({
  discoverCurrentVersions: vi.fn(),
  discoverPackageInfos: vi.fn(),
}));

vi.mock("../../../src/utils/package.js", () => ({
  replaceVersion: vi.fn(),
  replaceVersionAtPath: vi.fn(),
}));

const mockGitInstance = {
  stage: vi.fn(),
  commit: vi.fn(),
};
vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(() => mockGitInstance),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
  };
});

import { writeFileSync } from "node:fs";
import {
  buildChangelogEntries,
  generateChangelog,
  writeChangelogToFile,
} from "../../../src/changeset/changelog.js";
import {
  discoverCurrentVersions,
  discoverPackageInfos,
} from "../../../src/changeset/packages.js";
import {
  deleteChangesetFiles,
  readChangesets,
} from "../../../src/changeset/reader.js";
import { calculateVersionBumps } from "../../../src/changeset/version.js";
import { runVersionCommand } from "../../../src/commands/version-cmd.js";
import { loadConfig } from "../../../src/config/loader.js";
import { readPreState } from "../../../src/prerelease/pre.js";
import { replaceVersion } from "../../../src/utils/package.js";

const mockedReadChangesets = vi.mocked(readChangesets);
const mockedDeleteChangesetFiles = vi.mocked(deleteChangesetFiles);
const mockedCalculateVersionBumps = vi.mocked(calculateVersionBumps);
const mockedGenerateChangelog = vi.mocked(generateChangelog);
const mockedBuildChangelogEntries = vi.mocked(buildChangelogEntries);
const mockedWriteChangelogToFile = vi.mocked(writeChangelogToFile);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedReadPreState = vi.mocked(readPreState);
const mockedDiscoverCurrentVersions = vi.mocked(discoverCurrentVersions);
const mockedDiscoverPackageInfos = vi.mocked(discoverPackageInfos);
const mockedReplaceVersion = vi.mocked(replaceVersion);
const mockedWriteFileSync = vi.mocked(writeFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockedLoadConfig.mockResolvedValue(null);
  mockedReadPreState.mockReturnValue(null);
  mockedDiscoverCurrentVersions.mockResolvedValue(
    new Map([["my-pkg", "1.0.0"]]),
  );
  mockedDiscoverPackageInfos.mockResolvedValue(null as any);
  mockedReplaceVersion.mockResolvedValue(["package.json"]);
  mockedBuildChangelogEntries.mockReturnValue([]);
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

  it("handles pre-release state correctly", async () => {
    const changesets = [
      {
        id: "fix-bug",
        summary: "Fix a bug",
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
    mockedBuildChangelogEntries.mockReturnValue([
      { summary: "Fix a bug", type: "patch" as const, id: "fix-bug" },
    ]);
    mockedGenerateChangelog.mockReturnValue("## 1.0.1-beta.0\n");

    mockedReadPreState.mockReturnValue({
      mode: "pre",
      tag: "beta",
      packages: {},
    });

    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project");

    // Should use pre-release version
    expect(logSpy).toHaveBeenCalledWith("my-pkg: 1.0.0 → 1.0.1-beta.0 (patch)");
    expect(mockedReplaceVersion).toHaveBeenCalledWith(
      "1.0.1-beta.0",
      undefined,
    );

    // Should update pre.json
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("pre.json"),
      expect.stringContaining('"baseVersion": "1.0.1"'),
      "utf-8",
    );
  });

  it("increments pre-release iteration for same base version", async () => {
    const changesets = [
      {
        id: "another-fix",
        summary: "Another fix",
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
    mockedBuildChangelogEntries.mockReturnValue([
      { summary: "Another fix", type: "patch" as const, id: "another-fix" },
    ]);
    mockedGenerateChangelog.mockReturnValue("## 1.0.1-beta.2\n");

    mockedReadPreState.mockReturnValue({
      mode: "pre",
      tag: "beta",
      packages: {
        "my-pkg": { baseVersion: "1.0.1", iteration: 1 },
      },
    });

    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project");

    expect(logSpy).toHaveBeenCalledWith("my-pkg: 1.0.0 → 1.0.1-beta.2 (patch)");
    expect(mockedReplaceVersion).toHaveBeenCalledWith(
      "1.0.1-beta.2",
      undefined,
    );
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
});
