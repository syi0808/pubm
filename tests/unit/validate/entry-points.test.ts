import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from "node:fs";
import { validateEntryPoints } from "../../../src/validate/entry-points.js";

const mockedExistsSync = vi.mocked(existsSync);

describe("validateEntryPoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(true);
  });

  it("returns no errors when all entry points exist", () => {
    const pkg = { main: "./dist/index.js", types: "./dist/index.d.ts" };
    const errors = validateEntryPoints(pkg, "/project");
    expect(errors).toEqual([]);
  });

  it("reports missing main", () => {
    mockedExistsSync.mockReturnValue(false);
    const pkg = { main: "./dist/index.js" };
    const errors = validateEntryPoints(pkg, "/project");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("main");
    expect(errors[0].path).toBe("./dist/index.js");
  });

  it("validates exports conditions", () => {
    mockedExistsSync.mockImplementation((p) => !String(p).includes("missing"));
    const pkg = {
      exports: {
        ".": {
          import: "./dist/index.mjs",
          require: "./dist/missing.cjs",
        },
      },
    };
    const errors = validateEntryPoints(pkg, "/project");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toContain("exports");
  });

  it("validates bin entries", () => {
    mockedExistsSync.mockReturnValue(false);
    const pkg = { bin: { mycli: "./bin/cli.js" } };
    const errors = validateEntryPoints(pkg, "/project");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("bin.mycli");
  });

  it("skips undefined fields", () => {
    const pkg = {};
    const errors = validateEntryPoints(pkg, "/project");
    expect(errors).toEqual([]);
  });

  it("handles string exports", () => {
    mockedExistsSync.mockReturnValue(false);
    const pkg = { exports: "./dist/index.js" };
    const errors = validateEntryPoints(pkg, "/project");
    expect(errors).toHaveLength(1);
  });
});
