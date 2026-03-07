import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(),
}));

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { detectWorkspace } from "../../../src/monorepo/workspace.js";
import { discoverPackages } from "../../../src/monorepo/discover.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedStatSync = vi.mocked(statSync);
const mockedDetectWorkspace = vi.mocked(detectWorkspace);

beforeEach(() => {
  vi.clearAllMocks();
});

function setupDirectoryEntries(entries: string[]) {
  mockedReaddirSync.mockReturnValue(entries as unknown as ReturnType<typeof readdirSync>);
  mockedStatSync.mockImplementation(() => ({
    isDirectory: () => true,
  }) as ReturnType<typeof statSync>);
}

describe("discoverPackages", () => {
  it("returns empty array when no workspace and no config packages", () => {
    mockedDetectWorkspace.mockReturnValue(null);

    const result = discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("discovers JS packages (package.json found) with default registries", () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/foo", "packages/bar"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );

    const result = discoverPackages({ cwd: "/project" });

    expect(result).toEqual([
      {
        path: path.join("packages", "foo"),
        registries: ["npm", "jsr"],
        ecosystem: "js",
      },
      {
        path: path.join("packages", "bar"),
        registries: ["npm", "jsr"],
        ecosystem: "js",
      },
    ]);
  });

  it("discovers Rust packages (Cargo.toml found) with default registries", () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["crates/*"],
    });
    setupDirectoryEntries(["crates/my-crate"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("Cargo.toml"),
    );

    const result = discoverPackages({ cwd: "/project" });

    expect(result).toEqual([
      {
        path: path.join("crates", "my-crate"),
        registries: ["crates"],
        ecosystem: "rust",
      },
    ]);
  });

  it("excludes packages matching ignore globs", () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/foo", "packages/internal"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );

    const result = discoverPackages({
      cwd: "/project",
      ignore: ["packages/internal"],
    });

    expect(result).toEqual([
      {
        path: path.join("packages", "foo"),
        registries: ["npm", "jsr"],
        ecosystem: "js",
      },
    ]);
  });

  it("merges config packages over auto-detected (config overrides)", () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/foo"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );

    const fooPath = path.join("packages", "foo");
    const result = discoverPackages({
      cwd: "/project",
      configPackages: [
        {
          path: fooPath,
          registries: ["npm"],
        },
      ],
    });

    expect(result).toEqual([
      {
        path: fooPath,
        registries: ["npm"],
        ecosystem: "js",
      },
    ]);
  });

  it("adds config-only packages not in workspace", () => {
    mockedDetectWorkspace.mockReturnValue(null);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );

    const result = discoverPackages({
      cwd: "/project",
      configPackages: [
        {
          path: "standalone",
          registries: ["npm"],
        },
      ],
    });

    expect(result).toEqual([
      {
        path: "standalone",
        registries: ["npm"],
        ecosystem: "js",
      },
    ]);
  });

  it("config ecosystem overrides manifest detection", () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/foo"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );

    const fooPath = path.join("packages", "foo");
    const result = discoverPackages({
      cwd: "/project",
      configPackages: [
        {
          path: fooPath,
          registries: ["crates"],
          ecosystem: "rust",
        },
      ],
    });

    expect(result).toEqual([
      {
        path: fooPath,
        registries: ["crates"],
        ecosystem: "rust",
      },
    ]);
  });

  it("skips packages with undetectable ecosystem and no config override", () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/unknown"]);
    mockedExistsSync.mockReturnValue(false);

    const result = discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });
});
