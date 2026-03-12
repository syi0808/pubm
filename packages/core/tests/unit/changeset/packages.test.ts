import path from "node:path";
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
    expect(mockedGetPackageJson).toHaveBeenCalledWith({ cwd: "/tmp/project" });
  });

  it("returns multiple packages for monorepo", async () => {
    mockedDiscoverPackages.mockReturnValue([
      { path: "packages/core", registries: ["npm"], ecosystem: "js" },
      { path: "packages/pubm", registries: ["npm"], ecosystem: "js" },
    ]);
    mockedGetPackageJson
      .mockResolvedValueOnce({ name: "@pubm/core", version: "1.2.0" })
      .mockResolvedValueOnce({ name: "pubm", version: "0.9.1" });

    const result = await discoverCurrentVersions("/tmp/project");
    expect(result.size).toBe(2);
    expect(result.get("@pubm/core")).toBe("1.2.0");
    expect(result.get("pubm")).toBe("0.9.1");
    expect(mockedGetPackageJson).toHaveBeenNthCalledWith(1, {
      cwd: path.resolve("/tmp/project", "packages/core"),
    });
    expect(mockedGetPackageJson).toHaveBeenNthCalledWith(2, {
      cwd: path.resolve("/tmp/project", "packages/pubm"),
    });
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
    expect(mockedGetPackageJson).toHaveBeenCalledWith({ cwd: "/tmp/project" });
  });

  it("returns package infos with paths for monorepo", async () => {
    mockedDiscoverPackages.mockReturnValue([
      { path: "packages/core", registries: ["npm"], ecosystem: "js" },
      { path: "packages/pubm", registries: ["npm"], ecosystem: "js" },
    ]);
    mockedGetPackageJson
      .mockResolvedValueOnce({ name: "@pubm/core", version: "1.2.0" })
      .mockResolvedValueOnce({ name: "pubm", version: "0.9.1" });

    const result = await discoverPackageInfos("/tmp/project");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "@pubm/core",
      version: "1.2.0",
      path: "packages/core",
    });
    expect(result[1]).toEqual({
      name: "pubm",
      version: "0.9.1",
      path: "packages/pubm",
    });
    expect(mockedGetPackageJson).toHaveBeenNthCalledWith(1, {
      cwd: path.resolve("/tmp/project", "packages/core"),
    });
    expect(mockedGetPackageJson).toHaveBeenNthCalledWith(2, {
      cwd: path.resolve("/tmp/project", "packages/pubm"),
    });
  });
});
