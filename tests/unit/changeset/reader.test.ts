import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readChangesets } from "../../../src/changeset/reader.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);

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
      releases: [{ name: "pkg-a", type: "minor" }],
    });
    expect(result[1]).toEqual({
      id: "calm-bear",
      summary: "Second change.",
      releases: [{ name: "pkg-b", type: "patch" }],
    });
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
