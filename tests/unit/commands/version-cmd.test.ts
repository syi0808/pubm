import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(),
}));

vi.mock("../../../src/changeset/version.js", () => ({
  calculateVersionBumps: vi.fn(),
}));

vi.mock("../../../src/changeset/changelog.js", () => ({
  generateChangelog: vi.fn(),
}));

vi.mock("../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/prerelease/pre.js", () => ({
  readPreState: vi.fn(),
}));

vi.mock("../../../src/utils/package.js", () => ({
  getPackageJson: vi.fn(),
  replaceVersion: vi.fn(),
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
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { generateChangelog } from "../../../src/changeset/changelog.js";
import { readChangesets } from "../../../src/changeset/reader.js";
import { calculateVersionBumps } from "../../../src/changeset/version.js";
import { runVersionCommand } from "../../../src/commands/version-cmd.js";
import { loadConfig } from "../../../src/config/loader.js";
import { readPreState } from "../../../src/prerelease/pre.js";
import { getPackageJson, replaceVersion } from "../../../src/utils/package.js";

const mockedReadChangesets = vi.mocked(readChangesets);
const mockedCalculateVersionBumps = vi.mocked(calculateVersionBumps);
const mockedGenerateChangelog = vi.mocked(generateChangelog);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedReadPreState = vi.mocked(readPreState);
const mockedGetPackageJson = vi.mocked(getPackageJson);
const mockedReplaceVersion = vi.mocked(replaceVersion);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedRmSync = vi.mocked(rmSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockedLoadConfig.mockResolvedValue(null);
  mockedReadPreState.mockReturnValue(null);
  mockedReplaceVersion.mockResolvedValue(["package.json"]);
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
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
    });

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
    mockedGenerateChangelog.mockReturnValue(
      "## 1.1.0\n\n### Minor Changes\n\n- Add new feature\n",
    );
    mockedExistsSync.mockImplementation((p) => {
      const filePath = String(p);
      if (filePath.includes("CHANGELOG.md")) return false;
      if (filePath.includes("add-feature.md")) return true;
      return false;
    });

    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project");

    expect(mockedCalculateVersionBumps).toHaveBeenCalledWith(
      new Map([["my-pkg", "1.0.0"]]),
      "/tmp/project",
    );
    expect(logSpy).toHaveBeenCalledWith("my-pkg: 1.0.0 → 1.1.0 (minor)");
    expect(mockedReplaceVersion).toHaveBeenCalledWith("1.1.0", undefined);
    expect(mockedGenerateChangelog).toHaveBeenCalledWith("1.1.0", [
      { summary: "Add new feature", type: "minor", id: "add-feature" },
    ]);
    // Changelog written
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("CHANGELOG.md"),
      expect.stringContaining("## 1.1.0"),
      "utf-8",
    );
    // Changeset file deleted
    expect(mockedRmSync).toHaveBeenCalledWith(
      expect.stringContaining("add-feature.md"),
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
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
    });

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
    mockedGenerateChangelog.mockReturnValue("## 1.0.1-beta.0\n");

    mockedReadPreState.mockReturnValue({
      mode: "pre",
      tag: "beta",
      packages: {},
    });

    mockedExistsSync.mockImplementation((p) => {
      const filePath = String(p);
      if (filePath.includes("CHANGELOG.md")) return false;
      if (filePath.includes("fix-bug.md")) return true;
      return false;
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
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
    });

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
    mockedGenerateChangelog.mockReturnValue("## 1.0.1-beta.2\n");

    mockedReadPreState.mockReturnValue({
      mode: "pre",
      tag: "beta",
      packages: {
        "my-pkg": { baseVersion: "1.0.1", iteration: 1 },
      },
    });

    mockedExistsSync.mockImplementation((p) => {
      const filePath = String(p);
      if (filePath.includes("CHANGELOG.md")) return false;
      if (filePath.includes("another-fix.md")) return true;
      return false;
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
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "2.0.0",
    });

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
    mockedGenerateChangelog.mockReturnValue("## 2.1.0\n");

    const logSpy = vi.spyOn(console, "log");

    await runVersionCommand("/tmp/project", { dryRun: true });

    expect(logSpy).toHaveBeenCalledWith("[dry-run] Would write version 2.1.0");
    expect(mockedReplaceVersion).not.toHaveBeenCalled();
    expect(mockedRmSync).not.toHaveBeenCalled();
  });

  it("returns early when bumps are empty", async () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "unrelated",
        summary: "Unrelated change",
        releases: [{ name: "other-pkg", type: "patch" as const }],
      },
    ]);
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
    });
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
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
    });

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
    mockedGenerateChangelog.mockReturnValue(
      "## 1.0.1\n\n### Patch Changes\n\n- Fix it\n",
    );

    mockedExistsSync.mockImplementation((p) => {
      const filePath = String(p);
      if (filePath.includes("CHANGELOG.md")) return true;
      if (filePath.includes("fix-it.md")) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      "# Changelog\n\n## 1.0.0\n\n### Patch Changes\n\n- Initial release\n",
    );

    await runVersionCommand("/tmp/project");

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("CHANGELOG.md"),
      expect.stringContaining("## 1.0.1"),
      "utf-8",
    );
    // Should also contain old content
    const writeCall = mockedWriteFileSync.mock.calls.find((call) =>
      String(call[0]).includes("CHANGELOG.md"),
    );
    expect(writeCall).toBeDefined();
    const writtenContent = String(writeCall![1]);
    expect(writtenContent).toContain("## 1.0.0");
    expect(writtenContent).toContain("## 1.0.1");
  });
});
