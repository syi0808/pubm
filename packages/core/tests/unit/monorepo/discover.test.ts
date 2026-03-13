import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("smol-toml", () => ({
  parse: vi.fn(),
}));

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(),
}));

vi.mock("../../../src/ecosystem/infer.js", () => ({
  inferRegistries: vi.fn(),
}));

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { inferRegistries } from "../../../src/ecosystem/infer.js";
import { discoverPackages } from "../../../src/monorepo/discover.js";
import { detectWorkspace } from "../../../src/monorepo/workspace.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedStatSync = vi.mocked(statSync);
const mockedDetectWorkspace = vi.mocked(detectWorkspace);
const mockedInferRegistries = vi.mocked(inferRegistries);
const mockedParseToml = vi.mocked(parseToml);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: inferRegistries returns based on ecosystem
  mockedInferRegistries.mockImplementation(async (_path, ecosystem) => {
    if (ecosystem === "js") return ["npm"];
    if (ecosystem === "rust") return ["crates"];
    return [];
  });
  // Default: readFileSync returns a non-private package.json
  mockedReadFileSync.mockReturnValue(JSON.stringify({ name: "pkg" }));
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
  it("returns empty array when no workspace, no config packages, and no ecosystem at cwd", async () => {
    mockedDetectWorkspace.mockReturnValue([]);
    mockedExistsSync.mockReturnValue(false);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("discovers JS packages using inferRegistries", async () => {
    mockedDetectWorkspace.mockReturnValue([
      {
        type: "pnpm",
        patterns: ["packages/*"],
      },
    ]);
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
    mockedDetectWorkspace.mockReturnValue([
      {
        type: "pnpm",
        patterns: ["crates/*"],
      },
    ]);
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
    mockedDetectWorkspace.mockReturnValue([
      {
        type: "pnpm",
        patterns: ["packages/*"],
      },
    ]);
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
    mockedDetectWorkspace.mockReturnValue([
      {
        type: "pnpm",
        patterns: ["packages/*"],
      },
    ]);
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
    mockedDetectWorkspace.mockReturnValue([]);
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
    mockedDetectWorkspace.mockReturnValue([
      {
        type: "pnpm",
        patterns: ["packages/*"],
      },
    ]);
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
    mockedDetectWorkspace.mockReturnValue([
      {
        type: "pnpm",
        patterns: ["packages/*"],
      },
    ]);
    setupDirectoryEntries(["packages/unknown"]);
    mockedExistsSync.mockReturnValue(false);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("uses inferRegistries for config-only packages without explicit registries", async () => {
    mockedDetectWorkspace.mockReturnValue([]);
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

  it("filters out JS packages with private: true", async () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    setupDirectoryEntries(["packages/public-pkg", "packages/private-pkg"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );
    mockedReadFileSync.mockImplementation((p) => {
      if (String(p).includes("private-pkg"))
        return JSON.stringify({ name: "private-pkg", private: true });
      return JSON.stringify({ name: "public-pkg" });
    });
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(path.join("packages", "public-pkg"));
  });

  it("filters out Rust packages with publish = false", async () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "cargo", patterns: ["crates/*"] },
    ]);
    setupDirectoryEntries(["crates/published", "crates/internal"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("Cargo.toml"),
    );
    mockedReadFileSync.mockReturnValue("");
    let callCount = 0;
    mockedParseToml.mockImplementation(() => {
      callCount++;
      if (callCount === 2)
        return { package: { name: "internal", publish: false } } as never;
      return { package: { name: "published" } } as never;
    });
    mockedInferRegistries.mockResolvedValue(["crates"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(path.join("crates", "published"));
  });

  it("falls back to cwd as single package when no workspace detected", async () => {
    mockedDetectWorkspace.mockReturnValue([]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );
    mockedReadFileSync.mockReturnValue(JSON.stringify({ name: "my-pkg" }));
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([
      { path: ".", registries: ["npm"], ecosystem: "js" },
    ]);
  });

  it("returns empty when single package is private", async () => {
    mockedDetectWorkspace.mockReturnValue([]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("package.json"),
    );
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ name: "my-pkg", private: true }),
    );

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("returns empty when no ecosystem detected at cwd", async () => {
    mockedDetectWorkspace.mockReturnValue([]);
    mockedExistsSync.mockReturnValue(false);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("excludes Cargo workspace exclude patterns", async () => {
    mockedDetectWorkspace.mockReturnValue([
      {
        type: "cargo",
        patterns: ["crates/*"],
        exclude: ["crates/excluded"],
      },
    ]);
    setupDirectoryEntries(["crates/included", "crates/excluded"]);
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith("Cargo.toml"),
    );
    mockedReadFileSync.mockReturnValue("");
    mockedParseToml.mockReturnValue({
      package: { name: "pkg" },
    } as never);
    mockedInferRegistries.mockResolvedValue(["crates"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(path.join("crates", "included"));
  });
});
