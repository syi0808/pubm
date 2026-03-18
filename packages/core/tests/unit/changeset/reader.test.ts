import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  deleteChangesetFiles,
  readChangesets,
} from "../../../src/changeset/reader.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedRmSync = vi.mocked(rmSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readChangesets", () => {
  it("returns empty array when directory does not exist", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = readChangesets("/tmp/project");

    expect(result).toEqual([]);
  });

  it("reads and parses all changeset files", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue(["brave-ant.md", "calm-bear.md"] as any);

    mockedReadFileSync
      .mockReturnValueOnce('---\n"pkg-a": minor\n---\n\nFirst change.')
      .mockReturnValueOnce('---\n"pkg-b": patch\n---\n\nSecond change.');

    const result = readChangesets("/tmp/project");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "brave-ant",
      summary: "First change.",
      releases: [{ path: "pkg-a", type: "minor" }],
    });
    expect(result[1]).toEqual({
      id: "calm-bear",
      summary: "Second change.",
      releases: [{ path: "pkg-b", type: "patch" }],
    });
  });

  it("uses process.cwd() as default when cwd is omitted", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = readChangesets();

    expect(result).toEqual([]);
    expect(mockedExistsSync).toHaveBeenCalledWith(
      path.join(process.cwd(), ".pubm", "changesets"),
    );
  });

  it("skips non-.md files", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([
      "brave-ant.md",
      "README.md",
      "config.json",
      ".gitkeep",
    ] as any);

    mockedReadFileSync.mockReturnValueOnce('---\n"pkg": patch\n---\n\nA fix.');

    const result = readChangesets("/tmp/project");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("brave-ant");
    expect(mockedReadFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("deleteChangesetFiles", () => {
  it("removes each changeset file that still exists", () => {
    mockedExistsSync.mockReturnValue(true);

    deleteChangesetFiles("/tmp/project", [
      { id: "brave-ant" },
      { id: "calm-bear" },
    ] as any);

    expect(mockedRmSync).toHaveBeenCalledWith(
      path.join("/tmp/project", ".pubm", "changesets", "brave-ant.md"),
    );
    expect(mockedRmSync).toHaveBeenCalledWith(
      path.join("/tmp/project", ".pubm", "changesets", "calm-bear.md"),
    );
  });

  it("skips removal when a changeset file is already gone", () => {
    mockedExistsSync.mockReturnValue(false);

    deleteChangesetFiles("/tmp/project", [{ id: "brave-ant" }] as any);

    expect(mockedRmSync).not.toHaveBeenCalled();
  });
});
