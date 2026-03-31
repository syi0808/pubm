import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(),
  deleteChangesetFiles: vi.fn(),
}));

import {
  deleteChangesetFiles,
  readChangesets,
} from "../../../src/changeset/reader.js";
import { ChangesetSource } from "../../../src/version-source/changeset-source.js";
import type { VersionSourceContext } from "../../../src/version-source/types.js";

const mockedReadChangesets = vi.mocked(readChangesets);
const mockedDeleteChangesetFiles = vi.mocked(deleteChangesetFiles);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChangesetSource", () => {
  const context: VersionSourceContext = {
    cwd: "/repo",
    packages: new Map([
      ["packages/core", "1.0.0"],
      ["packages/pubm", "2.0.0"],
    ]),
  };

  it("has name 'changeset'", () => {
    expect(new ChangesetSource().name).toBe("changeset");
  });

  it("returns recommendations from changesets", async () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "brave-cat",
        summary: "Add plugin API",
        releases: [{ path: "packages/core", type: "minor" }],
      },
    ]);
    const source = new ChangesetSource();
    const results = await source.analyze(context);
    expect(results).toEqual([
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "changeset",
        entries: [{ summary: "Add plugin API", id: "brave-cat" }],
      },
    ]);
  });

  it("takes highest bump when multiple changesets affect same package", async () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "brave-cat",
        summary: "Add plugin API",
        releases: [{ path: "packages/core", type: "minor" }],
      },
      {
        id: "calm-dog",
        summary: "Fix parser",
        releases: [{ path: "packages/core", type: "patch" }],
      },
    ]);
    const source = new ChangesetSource();
    const results = await source.analyze(context);
    expect(results).toHaveLength(1);
    expect(results[0].bumpType).toBe("minor");
    expect(results[0].entries).toHaveLength(2);
  });

  it("returns empty array when no changesets", async () => {
    mockedReadChangesets.mockReturnValue([]);
    const source = new ChangesetSource();
    const results = await source.analyze(context);
    expect(results).toEqual([]);
  });

  it("consume skips deletion when no changesets were analyzed", async () => {
    mockedReadChangesets.mockReturnValue([]);
    const source = new ChangesetSource();
    await source.analyze(context);
    await source.consume!([]);
    expect(mockedDeleteChangesetFiles).not.toHaveBeenCalled();
  });

  it("consume deletes changeset files", async () => {
    mockedReadChangesets.mockReturnValue([
      {
        id: "brave-cat",
        summary: "Add plugin API",
        releases: [{ path: "packages/core", type: "minor" }],
      },
    ]);
    const source = new ChangesetSource();
    await source.analyze(context);
    await source.consume!([]);
    expect(mockedDeleteChangesetFiles).toHaveBeenCalledWith(
      "/repo",
      expect.any(Array),
    );
  });
});
