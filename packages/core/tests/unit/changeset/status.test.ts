import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(),
}));

import { readChangesets } from "../../../src/changeset/reader.js";
import { getStatus } from "../../../src/changeset/status.js";

const mockedReadChangesets = vi.mocked(readChangesets);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getStatus", () => {
  it("uses process.cwd() as default when cwd is omitted", () => {
    mockedReadChangesets.mockReturnValue([]);

    const result = getStatus();

    expect(result.hasChangesets).toBe(false);
    expect(mockedReadChangesets).toHaveBeenCalledWith(process.cwd());
  });

  it("returns empty map when no changesets", () => {
    mockedReadChangesets.mockReturnValue([]);

    const result = getStatus("/tmp/project");

    expect(result.packages.size).toBe(0);
    expect(result.changesets).toEqual([]);
    expect(result.hasChangesets).toBe(false);
  });

  it("aggregates bump types with max winning (patch + minor = minor)", () => {
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

    const result = getStatus("/tmp/project");

    const pkgA = result.packages.get("pkg-a");
    expect(pkgA).toBeDefined();
    expect(pkgA!.bumpType).toBe("minor");
    expect(pkgA!.changesetCount).toBe(2);
    expect(pkgA!.summaries).toEqual(["Fix bug.", "Add feature."]);
    expect(result.hasChangesets).toBe(true);
  });

  it("major beats minor and patch", () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "change-1",
        summary: "Minor change.",
        releases: [{ name: "pkg-a", type: "minor" }],
      },
      {
        id: "change-2",
        summary: "Patch fix.",
        releases: [{ name: "pkg-a", type: "patch" }],
      },
      {
        id: "change-3",
        summary: "Breaking change.",
        releases: [{ name: "pkg-a", type: "major" }],
      },
    ]);

    const result = getStatus("/tmp/project");

    const pkgA = result.packages.get("pkg-a");
    expect(pkgA!.bumpType).toBe("major");
    expect(pkgA!.changesetCount).toBe(3);
  });

  it("tracks multiple packages independently", () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "change-1",
        summary: "Fix for A.",
        releases: [
          { name: "pkg-a", type: "patch" },
          { name: "pkg-b", type: "minor" },
        ],
      },
      {
        id: "change-2",
        summary: "Feature for A.",
        releases: [{ name: "pkg-a", type: "minor" }],
      },
    ]);

    const result = getStatus("/tmp/project");

    expect(result.packages.size).toBe(2);

    const pkgA = result.packages.get("pkg-a");
    expect(pkgA!.bumpType).toBe("minor");
    expect(pkgA!.changesetCount).toBe(2);

    const pkgB = result.packages.get("pkg-b");
    expect(pkgB!.bumpType).toBe("minor");
    expect(pkgB!.changesetCount).toBe(1);
    expect(pkgB!.summaries).toEqual(["Fix for A."]);
  });
});
