import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(),
}));

vi.mock("../../../src/ecosystem/infer.js", () => ({
  inferRegistries: vi.fn(),
}));

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { inferRegistries } from "../../../src/ecosystem/infer.js";
import { discoverPackages } from "../../../src/monorepo/discover.js";
import { detectWorkspace } from "../../../src/monorepo/workspace.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedStatSync = vi.mocked(statSync);
const mockedDetectWorkspace = vi.mocked(detectWorkspace);
const mockedInferRegistries = vi.mocked(inferRegistries);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: inferRegistries returns based on ecosystem
  mockedInferRegistries.mockImplementation(async (_path, ecosystem) => {
    if (ecosystem === "js") return ["npm"];
    if (ecosystem === "rust") return ["crates"];
    return [];
  });
});

function setupDirectoryEntries(entries: string[]) {
  mockedReaddirSync.mockReturnValue(
    entries as unknown as ReturnType<typeof readdirSync>,
  );
  mockedStatSync.mockImplementation(
    () =>
      ({
        isDirectory: () => true,
      }) as ReturnType<typeof statSync>,
  );
}

describe("discoverPackages", () => {
  it("returns empty array when no workspace and no config packages", async () => {
    mockedDetectWorkspace.mockReturnValue(null);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("discovers JS packages using inferRegistries", async () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/foo", "packages/bar"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );
    mockedInferRegistries.mockResolvedValue(["npm", "jsr"]);

    const result = await discoverPackages({ cwd: "/project" });

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

    // Verify inferRegistries was called with correct args
    expect(mockedInferRegistries).toHaveBeenCalledWith(
      path.resolve("/project", "packages/foo"),
      "js",
      "/project",
    );
    expect(mockedInferRegistries).toHaveBeenCalledWith(
      path.resolve("/project", "packages/bar"),
      "js",
      "/project",
    );
  });

  it("discovers Rust packages using inferRegistries", async () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["crates/*"],
    });
    setupDirectoryEntries(["crates/my-crate"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("Cargo.toml"),
    );
    mockedInferRegistries.mockResolvedValue(["crates"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([
      {
        path: path.join("crates", "my-crate"),
        registries: ["crates"],
        ecosystem: "rust",
      },
    ]);
  });

  it("excludes packages matching ignore globs", async () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/foo", "packages/internal"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({
      cwd: "/project",
      ignore: ["packages/internal"],
    });

    expect(result).toEqual([
      {
        path: path.join("packages", "foo"),
        registries: ["npm"],
        ecosystem: "js",
      },
    ]);
  });

  it("merges config packages over auto-detected (config overrides)", async () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/foo"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );
    mockedInferRegistries.mockResolvedValue(["npm", "jsr"]);

    const fooPath = path.join("packages", "foo");
    const result = await discoverPackages({
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

  it("adds config-only packages not in workspace", async () => {
    mockedDetectWorkspace.mockReturnValue(null);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );

    const result = await discoverPackages({
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

  it("config ecosystem overrides manifest detection", async () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/foo"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const fooPath = path.join("packages", "foo");
    const result = await discoverPackages({
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

  it("skips packages with undetectable ecosystem and no config override", async () => {
    mockedDetectWorkspace.mockReturnValue({
      type: "pnpm",
      patterns: ["packages/*"],
    });
    setupDirectoryEntries(["packages/unknown"]);
    mockedExistsSync.mockReturnValue(false);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("uses inferRegistries for config-only packages without explicit registries", async () => {
    mockedDetectWorkspace.mockReturnValue(null);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );
    mockedInferRegistries.mockResolvedValue(["npm", "jsr"]);

    const result = await discoverPackages({
      cwd: "/project",
      configPackages: [
        {
          path: "standalone",
        },
      ],
    });

    expect(result).toEqual([
      {
        path: "standalone",
        registries: ["npm", "jsr"],
        ecosystem: "js",
      },
    ]);

    expect(mockedInferRegistries).toHaveBeenCalledWith(
      path.join("/project", "standalone"),
      "js",
      "/project",
    );
  });
});
