import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildChangelogEntries,
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
              { name: "pkg-a", type: "minor" },
              { name: "pkg-b", type: "patch" },
            ],
          },
          {
            id: "beta",
            summary: "Fix bug",
            releases: [{ name: "pkg-b", type: "patch" }],
          },
        ] as any,
        "pkg-b",
      ),
    ).toEqual([
      { id: "alpha", summary: "Ship feature", type: "patch" },
      { id: "beta", summary: "Fix bug", type: "patch" },
    ]);
  });

  it("prepends the changelog header when writing to a new file", () => {
    mockedExistsSync.mockReturnValue(false);

    writeChangelogToFile("/repo", "## 1.0.0\n\n- Added");

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      "/repo/CHANGELOG.md",
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
      "/repo/CHANGELOG.md",
      "# Changelog\n\n## 1.0.0\n\n- Added\n## 0.9.0\n\n- Previous release\n",
      "utf-8",
    );
  });
});
