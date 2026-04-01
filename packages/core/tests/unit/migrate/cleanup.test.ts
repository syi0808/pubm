import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs");

import * as fs from "node:fs";
import { removeFiles } from "../../../src/migrate/cleanup.js";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);
const mockRmSync = vi.mocked(fs.rmSync);
const mockStatSync = vi.mocked(fs.statSync);

function makeStats(isDir: boolean): fs.Stats {
  return { isDirectory: () => isDir } as unknown as fs.Stats;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("removeFiles", () => {
  it("removes individual files with unlinkSync", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue(makeStats(false));

    const removed = removeFiles(["/project/.releaserc", "/project/.npmrc"]);

    expect(removed).toEqual(["/project/.releaserc", "/project/.npmrc"]);
    expect(mockUnlinkSync).toHaveBeenCalledWith("/project/.releaserc");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/project/.npmrc");
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it("removes directories with rmSync({ recursive: true })", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue(makeStats(true));

    const removed = removeFiles(["/project/.changeset"]);

    expect(removed).toEqual(["/project/.changeset"]);
    expect(mockRmSync).toHaveBeenCalledWith("/project/.changeset", {
      recursive: true,
    });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("skips non-existent files", () => {
    mockExistsSync.mockReturnValue(false);

    const removed = removeFiles(["/project/.releaserc"]);

    expect(removed).toEqual([]);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it("handles mix of files and directories, skipping missing", () => {
    mockExistsSync.mockImplementation((p) => p !== "/project/missing.json");
    mockStatSync.mockImplementation((p) =>
      makeStats(p === "/project/.changeset"),
    );

    const removed = removeFiles([
      "/project/.releaserc",
      "/project/.changeset",
      "/project/missing.json",
    ]);

    expect(removed).toEqual(["/project/.releaserc", "/project/.changeset"]);
    expect(mockUnlinkSync).toHaveBeenCalledWith("/project/.releaserc");
    expect(mockRmSync).toHaveBeenCalledWith("/project/.changeset", {
      recursive: true,
    });
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/project/missing.json");
  });
});
