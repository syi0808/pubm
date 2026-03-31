import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeChangelogToFile } from "../../../src/changelog/file.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("writeChangelogToFile", () => {
  it("prepends header when writing to a new file", () => {
    mockedExistsSync.mockReturnValue(false);
    writeChangelogToFile("/repo", "## 1.0.0\n\n- Added");
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      path.join("/repo", "CHANGELOG.md"),
      "# Changelog\n\n## 1.0.0\n\n- Added\n",
      "utf-8",
    );
  });

  it("preserves older sections when updating existing changelog", () => {
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
