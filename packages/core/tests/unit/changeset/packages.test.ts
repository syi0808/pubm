import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/monorepo/discover.js", () => ({
  discoverPackages: vi.fn(),
}));

vi.mock("../../../src/utils/package.js", () => ({
  getPackageJson: vi.fn(),
}));

import {
  discoverCurrentVersions,
  discoverPackageInfos,
} from "../../../src/changeset/packages.js";
import { discoverPackages } from "../../../src/monorepo/discover.js";
import { getPackageJson } from "../../../src/utils/package.js";

const mockedDiscoverPackages = vi.mocked(discoverPackages);
const mockedGetPackageJson = vi.mocked(getPackageJson);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("discoverCurrentVersions", () => {
  it("returns single package when no workspace detected", async () => {
    mockedDiscoverPackages.mockReturnValue([]);
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
    });

    const result = await discoverCurrentVersions("/tmp/project");
    expect(result.size).toBe(1);
    expect(result.get("my-pkg")).toBe("1.0.0");
  });

  it("returns multiple packages for monorepo", async () => {
    mockedDiscoverPackages.mockReturnValue([
      { path: "packages/core", registries: ["npm"], ecosystem: "js" },
      { path: "packages/cli", registries: ["npm"], ecosystem: "js" },
    ]);
    mockedGetPackageJson
      .mockResolvedValueOnce({ name: "@pubm/core", version: "1.2.0" })
      .mockResolvedValueOnce({ name: "@pubm/cli", version: "0.9.1" });

    const result = await discoverCurrentVersions("/tmp/project");
    expect(result.size).toBe(2);
    expect(result.get("@pubm/core")).toBe("1.2.0");
    expect(result.get("@pubm/cli")).toBe("0.9.1");
  });
});

describe("discoverPackageInfos", () => {
  it("returns package infos with path for single package", async () => {
    mockedDiscoverPackages.mockReturnValue([]);
    mockedGetPackageJson.mockResolvedValue({
      name: "my-pkg",
      version: "1.0.0",
    });

    const result = await discoverPackageInfos("/tmp/project");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "my-pkg",
      version: "1.0.0",
      path: ".",
    });
  });

  it("returns package infos with paths for monorepo", async () => {
    mockedDiscoverPackages.mockReturnValue([
      { path: "packages/core", registries: ["npm"], ecosystem: "js" },
      { path: "packages/cli", registries: ["npm"], ecosystem: "js" },
    ]);
    mockedGetPackageJson
      .mockResolvedValueOnce({ name: "@pubm/core", version: "1.2.0" })
      .mockResolvedValueOnce({ name: "@pubm/cli", version: "0.9.1" });

    const result = await discoverPackageInfos("/tmp/project");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "@pubm/core",
      version: "1.2.0",
      path: "packages/core",
    });
    expect(result[1]).toEqual({
      name: "@pubm/cli",
      version: "0.9.1",
      path: "packages/cli",
    });
  });
});
