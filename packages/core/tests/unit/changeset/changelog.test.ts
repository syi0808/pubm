import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildChangelogEntries,
  deduplicateEntries,
  generateChangelog,
  writeChangelogToFile,
} from "../../../src/changeset/changelog.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateChangelog", () => {
  it("generates changelog with minor and patch sections", () => {
    const result = generateChangelog("1.2.0", [
      { summary: "Added new API method.", type: "minor", id: "change-1" },
      { summary: "Fixed a typo.", type: "patch", id: "change-2" },
      { summary: "Improved performance.", type: "patch", id: "change-3" },
    ]);

    expect(result).toBe(
      [
        "## 1.2.0",
        "",
        "### Minor Changes",
        "",
        "- Added new API method.",
        "",
        "### Patch Changes",
        "",
        "- Fixed a typo.",
        "- Improved performance.",
        "",
      ].join("\n"),
    );
  });

  it("generates changelog with major section", () => {
    const result = generateChangelog("2.0.0", [
      { summary: "Removed deprecated API.", type: "major", id: "change-1" },
      { summary: "Added replacement API.", type: "minor", id: "change-2" },
    ]);

    expect(result).toContain("### Major Changes");
    expect(result).toContain("- Removed deprecated API.");
    expect(result).toContain("### Minor Changes");
    expect(result).toContain("- Added replacement API.");
  });

  it("includes dependency updates", () => {
    const result = generateChangelog(
      "1.1.0",
      [{ summary: "New feature.", type: "minor", id: "change-1" }],
      [
        { name: "lodash", version: "4.18.0" },
        { name: "react", version: "18.3.0" },
      ],
    );

    expect(result).toContain("### Dependency Updates");
    expect(result).toContain("- Updated `lodash` to 4.18.0");
    expect(result).toContain("- Updated `react` to 18.3.0");
  });

  it("returns heading even with no entries", () => {
    const result = generateChangelog("1.0.0", []);

    expect(result).toBe("## 1.0.0\n");
  });

  it("builds changelog entries only for the target package", () => {
    expect(
      buildChangelogEntries(
        [
          {
            id: "alpha",
            summary: "Ship feature",
            releases: [
              { path: "pkg-a", type: "minor" },
              { path: "pkg-b", type: "patch" },
            ],
          },
          {
            id: "beta",
            summary: "Fix bug",
            releases: [{ path: "pkg-b", type: "patch" }],
          },
        ] as any,
        "pkg-b",
      ),
    ).toEqual([
      { id: "alpha", summary: "Ship feature", type: "patch" },
      { id: "beta", summary: "Fix bug", type: "patch" },
    ]);
  });

  describe("deduplicateEntries", () => {
    it("removes duplicate entries by changeset id", () => {
      expect(
        deduplicateEntries([
          { id: "cs-1", summary: "Fix bug", type: "patch" },
          { id: "cs-1", summary: "Fix bug", type: "patch" },
        ]),
      ).toEqual([{ id: "cs-1", summary: "Fix bug", type: "patch" }]);
    });

    it("keeps the highest bump type when same id has different types", () => {
      expect(
        deduplicateEntries([
          { id: "cs-1", summary: "Add feature", type: "patch" },
          { id: "cs-1", summary: "Add feature", type: "minor" },
        ]),
      ).toEqual([{ id: "cs-1", summary: "Add feature", type: "minor" }]);
    });

    it("keeps major over minor and patch", () => {
      expect(
        deduplicateEntries([
          { id: "cs-1", summary: "Breaking", type: "patch" },
          { id: "cs-1", summary: "Breaking", type: "minor" },
          { id: "cs-1", summary: "Breaking", type: "major" },
        ]),
      ).toEqual([{ id: "cs-1", summary: "Breaking", type: "major" }]);
    });

    it("preserves order and deduplicates across multiple changesets", () => {
      expect(
        deduplicateEntries([
          { id: "cs-1", summary: "Shared fix", type: "patch" },
          { id: "cs-2", summary: "Core only", type: "minor" },
          { id: "cs-1", summary: "Shared fix", type: "minor" },
          { id: "cs-3", summary: "CLI only", type: "patch" },
          { id: "cs-2", summary: "Core only", type: "patch" },
        ]),
      ).toEqual([
        { id: "cs-1", summary: "Shared fix", type: "minor" },
        { id: "cs-2", summary: "Core only", type: "minor" },
        { id: "cs-3", summary: "CLI only", type: "patch" },
      ]);
    });

    it("returns empty array for empty input", () => {
      expect(deduplicateEntries([])).toEqual([]);
    });

    it("passes through entries with unique ids unchanged", () => {
      const entries = [
        { id: "cs-1", summary: "First", type: "patch" as const },
        { id: "cs-2", summary: "Second", type: "minor" as const },
        { id: "cs-3", summary: "Third", type: "major" as const },
      ];
      expect(deduplicateEntries(entries)).toEqual(entries);
    });
  });

  it("prepends the changelog header when writing to a new file", () => {
    mockedExistsSync.mockReturnValue(false);

    writeChangelogToFile("/repo", "## 1.0.0\n\n- Added");

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      path.join("/repo", "CHANGELOG.md"),
      "# Changelog\n\n## 1.0.0\n\n- Added\n",
      "utf-8",
    );
  });

  it("preserves older sections when updating an existing changelog", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "# Changelog\n\n## 0.9.0\n\n- Previous release\n",
    );

    writeChangelogToFile("/repo", "## 1.0.0\n\n- Added");

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      path.join("/repo", "CHANGELOG.md"),
      "# Changelog\n\n## 1.0.0\n\n- Added\n## 0.9.0\n\n- Previous release\n",
      "utf-8",
    );
  });
});
