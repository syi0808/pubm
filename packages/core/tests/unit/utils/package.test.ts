import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
}));

async function getFsMocks() {
  const { stat } = await import("node:fs/promises");
  return {
    mockStat: vi.mocked(stat),
  };
}

async function freshImport() {
  vi.clearAllMocks();
  vi.resetModules();
  return await import("../../../src/utils/package.js");
}

describe("findOutFile", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("finds a file in the current working directory", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join("/projects/my-app", "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const result = await findOutFile("package.json", {
      cwd: "/projects/my-app",
    });
    expect(result).toBe(path.join("/projects/my-app", "package.json"));
  });

  it("finds a file in a parent directory", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join("/projects", "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const result = await findOutFile("package.json", {
      cwd: "/projects/my-app",
    });
    expect(result).toBe(path.join("/projects", "package.json"));
  });

  it("returns null when the file is not found anywhere up to root", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await findOutFile("nonexistent.json", {
      cwd: "/projects/my-app",
    });
    expect(result).toBeNull();
  });

  it("uses process.cwd() as default cwd", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();
    const cwd = process.cwd();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const result = await findOutFile("package.json");
    expect(result).toBe(path.join(cwd, "package.json"));
  });

  it("skips entries where stat resolves but isFile() returns false", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      // In /projects/my-app it exists but is a directory
      if (filePath === path.join("/projects/my-app", "target")) {
        return { isFile: () => false } as any;
      }
      // In /projects it is an actual file
      if (filePath === path.join("/projects", "target")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const result = await findOutFile("target", { cwd: "/projects/my-app" });
    expect(result).toBe(path.join("/projects", "target"));
  });
});
