import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { migrateFromChangesets } from "../../../src/changeset/migrate.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedCopyFileSync = vi.mocked(copyFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("migrateFromChangesets", () => {
  it("returns error when .changeset/ does not exist", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = migrateFromChangesets("/tmp/project");

    expect(result.success).toBe(false);
    expect(result.error).toBe(".changeset/ directory not found");
    expect(result.migratedFiles).toEqual([]);
    expect(result.configMigrated).toBe(false);
  });

  it("migrates changeset files", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([
      "brave-ant.md",
      "calm-bear.md",
      "pre.json",
    ] as any);

    const result = migrateFromChangesets("/tmp/project");

    expect(result.success).toBe(true);
    expect(result.migratedFiles).toEqual([
      "brave-ant.md",
      "calm-bear.md",
      "pre.json",
    ]);
    expect(mockedMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join(".pubm", "changesets")),
      { recursive: true },
    );
    expect(mockedCopyFileSync).toHaveBeenCalledTimes(3);
  });

  it("skips config.json and README.md", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([
      "brave-ant.md",
      "config.json",
      "README.md",
    ] as any);

    const result = migrateFromChangesets("/tmp/project");

    expect(result.success).toBe(true);
    expect(result.migratedFiles).toEqual(["brave-ant.md"]);
    expect(result.configMigrated).toBe(true);
    expect(mockedCopyFileSync).toHaveBeenCalledTimes(1);
  });
});
