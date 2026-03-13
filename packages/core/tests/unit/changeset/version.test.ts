import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(),
}));

vi.mock("semver", () => ({
  inc: vi.fn((v, t) => {
    const p = v.split(".").map(Number);
    if (t === "major") return `${p[0] + 1}.0.0`;
    if (t === "minor") return `${p[0]}.${p[1] + 1}.0`;
    return `${p[0]}.${p[1]}.${p[2] + 1}`;
  }),
}));

import { inc } from "semver";
import { readChangesets } from "../../../src/changeset/reader.js";
import { calculateVersionBumps } from "../../../src/changeset/version.js";

const mockedInc = vi.mocked(inc);
const mockedReadChangesets = vi.mocked(readChangesets);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calculateVersionBumps", () => {
  it("calculates single bump", () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "change-1",
        summary: "Fix bug.",
        releases: [{ name: "pkg-a", type: "patch" }],
      },
    ]);

    const currentVersions = new Map([["pkg-a", "1.0.0"]]);
    const result = calculateVersionBumps(currentVersions, "/tmp/project");

    expect(result.size).toBe(1);
    const bump = result.get("pkg-a");
    expect(bump).toEqual({
      currentVersion: "1.0.0",
      newVersion: "1.0.1",
      bumpType: "patch",
    });
  });

  it("takes max across multiple changesets", () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "change-1",
        summary: "Fix bug.",
        releases: [{ name: "pkg-a", type: "patch" }],
      },
      {
        id: "change-2",
        summary: "Add feature.",
        releases: [{ name: "pkg-a", type: "minor" }],
      },
    ]);

    const currentVersions = new Map([["pkg-a", "1.0.0"]]);
    const result = calculateVersionBumps(currentVersions, "/tmp/project");

    const bump = result.get("pkg-a");
    expect(bump).toEqual({
      currentVersion: "1.0.0",
      newVersion: "1.1.0",
      bumpType: "minor",
    });
  });

  it("handles multiple packages", () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "change-1",
        summary: "Fix bug in A.",
        releases: [
          { name: "pkg-a", type: "patch" },
          { name: "pkg-b", type: "major" },
        ],
      },
    ]);

    const currentVersions = new Map([
      ["pkg-a", "1.2.3"],
      ["pkg-b", "2.0.0"],
    ]);
    const result = calculateVersionBumps(currentVersions, "/tmp/project");

    expect(result.size).toBe(2);
    expect(result.get("pkg-a")).toEqual({
      currentVersion: "1.2.3",
      newVersion: "1.2.4",
      bumpType: "patch",
    });
    expect(result.get("pkg-b")).toEqual({
      currentVersion: "2.0.0",
      newVersion: "3.0.0",
      bumpType: "major",
    });
  });

  it("returns empty when no changesets", () => {
    mockedReadChangesets.mockReturnValue([]);

    const currentVersions = new Map([["pkg-a", "1.0.0"]]);
    const result = calculateVersionBumps(currentVersions, "/tmp/project");

    expect(result.size).toBe(0);
  });

  it("uses process.cwd() when cwd is omitted", () => {
    mockedReadChangesets.mockReturnValue([]);

    calculateVersionBumps(new Map([["pkg-a", "1.0.0"]]));

    expect(mockedReadChangesets).toHaveBeenCalledWith(process.cwd());
  });

  it("ignores releases for packages that are not in currentVersions", () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "change-1",
        summary: "Unknown package.",
        releases: [{ name: "pkg-b", type: "patch" }],
      },
    ]);

    const result = calculateVersionBumps(
      new Map([["pkg-a", "1.0.0"]]),
      "/tmp/project",
    );

    expect(result.size).toBe(0);
    expect(mockedInc).not.toHaveBeenCalled();
  });

  it("skips packages whose current version resolves to an empty value", () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "change-1",
        summary: "Broken metadata.",
        releases: [{ name: "pkg-a", type: "patch" }],
      },
    ]);

    const currentVersions = new Map([
      ["pkg-a", undefined as unknown as string],
    ]);
    const result = calculateVersionBumps(currentVersions, "/tmp/project");

    expect(result.size).toBe(0);
    expect(mockedInc).not.toHaveBeenCalled();
  });

  it("ignores changesets when semver cannot produce a next version", () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "change-1",
        summary: "Unsupported bump.",
        releases: [{ name: "pkg-a", type: "patch" }],
      },
    ]);
    mockedInc.mockReturnValueOnce(null as never);

    const result = calculateVersionBumps(
      new Map([["pkg-a", "1.0.0"]]),
      "/tmp/project",
    );

    expect(result.size).toBe(0);
  });
});
