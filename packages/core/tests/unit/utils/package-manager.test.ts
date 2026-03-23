import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/package.js", () => ({
  findOutFile: vi.fn(),
}));

import { findOutFile } from "../../../src/utils/package.js";
import { getInstallCommand, getPackageManager } from "../../../src/utils/package-manager.js";

const mockFindOutFile = vi.mocked(findOutFile);

describe("getPackageManager", () => {
  beforeEach(() => {
    mockFindOutFile.mockReset();
  });

  it('returns "npm" when package-lock.json is found', async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "package-lock.json") return "/project/package-lock.json";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("npm");
  });

  it('returns "npm" when npm-shrinkwrap.json is found', async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "npm-shrinkwrap.json") return "/project/npm-shrinkwrap.json";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("npm");
  });

  it('returns "pnpm" when pnpm-lock.yaml is found', async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "pnpm-lock.yaml") return "/project/pnpm-lock.yaml";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("pnpm");
  });

  it('returns "yarn" when yarn.lock is found', async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "yarn.lock") return "/project/yarn.lock";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("yarn");
  });

  it('returns "npm" as fallback when no lock file is found', async () => {
    mockFindOutFile.mockResolvedValue(null);

    const result = await getPackageManager();
    expect(result).toBe("npm");
  });

  it("warns when no lock file is found", async () => {
    mockFindOutFile.mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getPackageManager();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No lock file found"),
    );
    warnSpy.mockRestore();
  });

  it('returns "bun" when bun.lock is found', async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "bun.lock") return "/project/bun.lock";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("bun");
  });

  it('returns "bun" when bun.lockb is found', async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "bun.lockb") return "/project/bun.lockb";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("bun");
  });

  it("checks bun before npm due to object iteration order", async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "bun.lock") return "/project/bun.lock";
      if (file === "package-lock.json") return "/project/package-lock.json";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("bun");
  });

  it("checks npm lock files before pnpm and yarn", async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "package-lock.json") return "/project/package-lock.json";
      if (file === "pnpm-lock.yaml") return "/project/pnpm-lock.yaml";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("npm");
  });

  it("checks pnpm before yarn when npm lock files are absent", async () => {
    mockFindOutFile.mockImplementation(async (file) => {
      if (file === "pnpm-lock.yaml") return "/project/pnpm-lock.yaml";
      if (file === "yarn.lock") return "/project/yarn.lock";
      return null;
    });

    const result = await getPackageManager();
    expect(result).toBe("pnpm");
  });

  it("calls findOutFile with the correct lock file names", async () => {
    mockFindOutFile.mockResolvedValue(null);

    await getPackageManager();

    expect(mockFindOutFile).toHaveBeenCalledWith("bun.lock");
    expect(mockFindOutFile).toHaveBeenCalledWith("bun.lockb");
    expect(mockFindOutFile).toHaveBeenCalledWith("package-lock.json");
    expect(mockFindOutFile).toHaveBeenCalledWith("npm-shrinkwrap.json");
    expect(mockFindOutFile).toHaveBeenCalledWith("pnpm-lock.yaml");
    expect(mockFindOutFile).toHaveBeenCalledWith("yarn.lock");
  });
});

describe("getInstallCommand", () => {
  it("returns bun install for bun", () => {
    expect(getInstallCommand("bun")).toEqual(["bun", "install"]);
  });

  it("returns npm install --package-lock-only for npm", () => {
    expect(getInstallCommand("npm")).toEqual([
      "npm",
      "install",
      "--package-lock-only",
    ]);
  });

  it("returns pnpm install --lockfile-only for pnpm", () => {
    expect(getInstallCommand("pnpm")).toEqual([
      "pnpm",
      "install",
      "--lockfile-only",
    ]);
  });

  it("returns yarn install for yarn without .yarnrc.yml", () => {
    expect(getInstallCommand("yarn", false)).toEqual(["yarn", "install"]);
  });

  it("returns yarn install --mode update-lockfile for yarn with .yarnrc.yml", () => {
    expect(getInstallCommand("yarn", true)).toEqual([
      "yarn",
      "install",
      "--mode",
      "update-lockfile",
    ]);
  });
});
