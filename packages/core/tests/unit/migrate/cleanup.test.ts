import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs");

import * as fs from "node:fs";
import { removeFiles } from "../../../src/migrate/cleanup.js";

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
    mockStatSync.mockReturnValue(makeStats(false));

    const removed = removeFiles(["/project/.releaserc", "/project/.npmrc"]);

    expect(removed).toEqual(["/project/.releaserc", "/project/.npmrc"]);
    expect(mockUnlinkSync).toHaveBeenCalledWith("/project/.releaserc");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/project/.npmrc");
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it("removes directories with rmSync({ recursive: true })", () => {
    mockStatSync.mockReturnValue(makeStats(true));

    const removed = removeFiles(["/project/.changeset"]);

    expect(removed).toEqual(["/project/.changeset"]);
    expect(mockRmSync).toHaveBeenCalledWith("/project/.changeset", {
      recursive: true,
    });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("skips non-existent files (ENOENT from statSync)", () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockStatSync.mockImplementation(() => {
      throw enoent;
    });

    const removed = removeFiles(["/project/.releaserc"]);

    expect(removed).toEqual([]);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it("handles mix of files and directories, skipping missing", () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockStatSync.mockImplementation((p) => {
      if (p === "/project/missing.json") throw enoent;
      return makeStats(p === "/project/.changeset");
    });

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

  it("rethrows non-ENOENT errors", () => {
    const permError = Object.assign(new Error("EPERM"), { code: "EPERM" });
    mockStatSync.mockImplementation(() => {
      throw permError;
    });

    expect(() => removeFiles(["/project/.releaserc"])).toThrow("EPERM");
  });
});
