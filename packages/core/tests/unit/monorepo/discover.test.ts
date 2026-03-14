import { beforeEach, describe, expect, it, vi } from "vitest";

const { originalStatSync, originalMkdirSync, originalWriteFileSync } =
  vi.hoisted(() => {
    // biome-ignore lint/style/noNamespaceImport: needed for hoisted mock
    const fs = require("node:fs");
    return {
      originalStatSync: fs.statSync,
      originalMkdirSync: fs.mkdirSync,
      originalWriteFileSync: fs.writeFileSync,
    };
  });

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn((...args: unknown[]) => {
    // Allow db.ts module-level statSync(homedir()) to work
    const p = String(args[0]);
    if (!p.includes("/project")) {
      return originalStatSync(...(args as Parameters<typeof originalStatSync>));
    }
    return { isDirectory: () => true };
  }),
  mkdirSync: originalMkdirSync,
  writeFileSync: originalWriteFileSync,
}));

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(),
}));

vi.mock("../../../src/ecosystem/infer.js", () => ({
  inferRegistries: vi.fn(),
}));

vi.mock("../../../src/ecosystem/catalog.js", async (importOriginal) => {
  const original =
    (await importOriginal()) as typeof import("../../../src/ecosystem/catalog.js");
  return {
    ...original,
    ecosystemCatalog: {
      detect: vi.fn(),
      get: vi.fn(),
      all: original.ecosystemCatalog.all.bind(original.ecosystemCatalog),
    },
  };
});

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ecosystemCatalog } from "../../../src/ecosystem/catalog.js";
import { inferRegistries } from "../../../src/ecosystem/infer.js";
import type { PackageManifest } from "../../../src/manifest/manifest-reader.js";
import { discoverPackages } from "../../../src/monorepo/discover.js";
import { detectWorkspace } from "../../../src/monorepo/workspace.js";

const mockedReaddirSync = vi.mocked(readdirSync);
const mockedStatSync = vi.mocked(statSync);
const mockedDetectWorkspace = vi.mocked(detectWorkspace);
const mockedInferRegistries = vi.mocked(inferRegistries);
const mockedEcosystemCatalog = vi.mocked(ecosystemCatalog);

function createMockEcosystemDescriptor(
  key: string,
  manifest: Partial<PackageManifest> = {},
  registryVersions: Map<string, string> = new Map(),
) {
  const defaultManifest: PackageManifest = {
    name: manifest.name ?? "pkg",
    version: manifest.version ?? "1.0.0",
    private: manifest.private ?? false,
    dependencies: manifest.dependencies ?? [],
  };

  return {
    key,
    label: `${key} ecosystem`,
    defaultRegistries: key === "js" ? ["npm", "jsr"] : ["crates"],
    ecosystemClass: class MockEcosystem {
      constructor(public packagePath: string) {}
      async readManifest() {
        return defaultManifest;
      }
      async readRegistryVersions() {
        return registryVersions;
      }
      async isPrivate() {
        return defaultManifest.private;
      }
      registryClasses() {
        return [];
      }
      manifestFiles() {
        return key === "js" ? ["package.json"] : ["Cargo.toml"];
      }
      supportedRegistries() {
        return key === "js" ? ["npm", "jsr"] : ["crates"];
      }
    } as any,
    detect: vi.fn().mockResolvedValue(true),
  };
}

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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: inferRegistries returns based on ecosystem
  mockedInferRegistries.mockImplementation(async (_path, ecosystem) => {
    if (ecosystem === "js") return ["npm"];
    if (ecosystem === "rust") return ["crates"];
    return [];
  });
});

describe("discoverPackages", () => {
  it("returns empty array when no workspace, no config packages, and no ecosystem at cwd", async () => {
    mockedDetectWorkspace.mockReturnValue([]);
    mockedEcosystemCatalog.detect.mockResolvedValue(null);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("discovers JS packages using inferRegistries", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "foo",
      version: "1.0.0",
    });
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    setupDirectoryEntries(["packages/foo", "packages/bar"]);
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm", "jsr"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([
      {
        name: "foo",
        version: "1.0.0",
        path: path.join("packages", "foo"),
        registries: ["npm", "jsr"],
        ecosystem: "js",
        dependencies: [],
      },
      {
        name: "foo",
        version: "1.0.0",
        path: path.join("packages", "bar"),
        registries: ["npm", "jsr"],
        ecosystem: "js",
        dependencies: [],
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
    const rustDescriptor = createMockEcosystemDescriptor("rust", {
      name: "my-crate",
      version: "0.1.0",
    });
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["crates/*"] },
    ]);
    setupDirectoryEntries(["crates/my-crate"]);
    mockedEcosystemCatalog.detect.mockResolvedValue(rustDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(rustDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["crates"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([
      {
        name: "my-crate",
        version: "0.1.0",
        path: path.join("crates", "my-crate"),
        registries: ["crates"],
        ecosystem: "rust",
        dependencies: [],
      },
    ]);
  });

  it("excludes packages matching ignore globs", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "foo",
      version: "1.0.0",
    });
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    setupDirectoryEntries(["packages/foo", "packages/internal"]);
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({
      cwd: "/project",
      ignore: ["packages/internal"],
    });

    expect(result).toEqual([
      {
        name: "foo",
        version: "1.0.0",
        path: path.join("packages", "foo"),
        registries: ["npm"],
        ecosystem: "js",
        dependencies: [],
      },
    ]);
  });

  it("config packages skip workspace discovery entirely", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "foo",
      version: "2.0.0",
    });
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);

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

    // detectWorkspace should NOT be called when configPackages is provided
    expect(mockedDetectWorkspace).not.toHaveBeenCalled();

    expect(result).toEqual([
      {
        name: "foo",
        version: "2.0.0",
        path: fooPath,
        registries: ["npm"],
        ecosystem: "js",
        dependencies: [],
      },
    ]);
  });

  it("config-only packages resolve via ecosystem detection", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "standalone",
      version: "1.0.0",
    });
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm"]);

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
        name: "standalone",
        version: "1.0.0",
        path: "standalone",
        registries: ["npm"],
        ecosystem: "js",
        dependencies: [],
      },
    ]);
  });

  it("config ecosystem overrides manifest detection", async () => {
    const rustDescriptor = createMockEcosystemDescriptor("rust", {
      name: "foo",
      version: "0.1.0",
    });
    mockedEcosystemCatalog.get.mockReturnValue(rustDescriptor as any);

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

    // detect should not be called when ecosystem is explicitly set
    expect(mockedEcosystemCatalog.detect).not.toHaveBeenCalled();

    expect(result).toEqual([
      {
        name: "foo",
        version: "0.1.0",
        path: fooPath,
        registries: ["crates"],
        ecosystem: "rust",
        dependencies: [],
      },
    ]);
  });

  it("skips packages with undetectable ecosystem and no config override", async () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    setupDirectoryEntries(["packages/unknown"]);
    mockedEcosystemCatalog.detect.mockResolvedValue(null);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("uses inferRegistries for config-only packages without explicit registries", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "standalone",
      version: "1.0.0",
    });
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);
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
        name: "standalone",
        version: "1.0.0",
        path: "standalone",
        registries: ["npm", "jsr"],
        ecosystem: "js",
        dependencies: [],
      },
    ]);

    expect(mockedInferRegistries).toHaveBeenCalledWith(
      path.join("/project", "standalone"),
      "js",
      "/project",
    );
  });

  it("filters out private packages", async () => {
    const publicDescriptor = createMockEcosystemDescriptor("js", {
      name: "public-pkg",
      version: "1.0.0",
      private: false,
    });
    const privateDescriptor = createMockEcosystemDescriptor("js", {
      name: "private-pkg",
      version: "1.0.0",
      private: true,
    });

    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);
    setupDirectoryEntries(["packages/public-pkg", "packages/private-pkg"]);

    mockedEcosystemCatalog.detect.mockImplementation(
      async (pkgPath: string) => {
        if (String(pkgPath).includes("private-pkg")) {
          return privateDescriptor as any;
        }
        return publicDescriptor as any;
      },
    );
    mockedEcosystemCatalog.get.mockReturnValue(publicDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(path.join("packages", "public-pkg"));
    expect(result[0].name).toBe("public-pkg");
  });

  it("falls back to cwd as single package when no workspace detected", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "my-pkg",
      version: "1.0.0",
    });
    mockedDetectWorkspace.mockReturnValue([]);
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([
      {
        name: "my-pkg",
        version: "1.0.0",
        path: ".",
        registries: ["npm"],
        ecosystem: "js",
        dependencies: [],
      },
    ]);
  });

  it("returns empty when single package is private", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "my-pkg",
      version: "1.0.0",
      private: true,
    });
    mockedDetectWorkspace.mockReturnValue([]);
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("returns empty when no ecosystem detected at cwd", async () => {
    mockedDetectWorkspace.mockReturnValue([]);
    mockedEcosystemCatalog.detect.mockResolvedValue(null);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toEqual([]);
  });

  it("excludes Cargo workspace exclude patterns", async () => {
    const rustDescriptor = createMockEcosystemDescriptor("rust", {
      name: "pkg",
      version: "0.1.0",
    });
    mockedDetectWorkspace.mockReturnValue([
      {
        type: "cargo",
        patterns: ["crates/*"],
        exclude: ["crates/excluded"],
      },
    ]);
    setupDirectoryEntries(["crates/included", "crates/excluded"]);
    mockedEcosystemCatalog.detect.mockResolvedValue(rustDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(rustDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["crates"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(path.join("crates", "included"));
  });

  it("includes registryVersions when versions are available", async () => {
    const registryVersions = new Map([
      ["npm", "1.0.0"],
      ["jsr", "0.9.0"],
    ]);
    const jsDescriptor = createMockEcosystemDescriptor(
      "js",
      { name: "pkg", version: "1.0.0" },
      registryVersions as Map<string, string>,
    );
    mockedDetectWorkspace.mockReturnValue([]);
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm", "jsr"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toHaveLength(1);
    expect(result[0].registryVersions).toEqual(registryVersions);
  });

  it("returns dependencies from manifest", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "pkg",
      version: "1.0.0",
      dependencies: ["dep-a", "dep-b"],
    });
    mockedDetectWorkspace.mockReturnValue([]);
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedEcosystemCatalog.get.mockReturnValue(jsDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({ cwd: "/project" });

    expect(result).toHaveLength(1);
    expect(result[0].dependencies).toEqual(["dep-a", "dep-b"]);
  });

  it("expands glob pattern in configPackages path", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "plugin",
      version: "1.0.0",
    });
    setupDirectoryEntries([
      "packages/plugins/plugin-a",
      "packages/plugins/plugin-b",
    ]);
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({
      cwd: "/project",
      configPackages: [{ path: "packages/plugins/*", registries: ["npm"] }],
    });

    expect(result).toHaveLength(2);
    const paths = result.map((r) => r.path);
    expect(paths).toContain(path.join("packages", "plugins", "plugin-a"));
    expect(paths).toContain(path.join("packages", "plugins", "plugin-b"));
  });

  it("propagates registries and ecosystem from glob config to all matched packages", async () => {
    const rustDescriptor = createMockEcosystemDescriptor("rust", {
      name: "crate",
      version: "0.1.0",
    });
    setupDirectoryEntries(["crates/crate-a", "crates/crate-b"]);
    mockedEcosystemCatalog.get.mockReturnValue(rustDescriptor as any);

    const result = await discoverPackages({
      cwd: "/project",
      configPackages: [
        { path: "crates/*", registries: ["crates"], ecosystem: "rust" },
      ],
    });

    expect(result).toHaveLength(2);
    for (const pkg of result) {
      expect(pkg.registries).toEqual(["crates"]);
      expect(pkg.ecosystem).toBe("rust");
    }
    // ecosystemCatalog.get should be used (not detect) since ecosystem is explicit
    expect(mockedEcosystemCatalog.detect).not.toHaveBeenCalled();
  });

  it("filters private packages matched by glob pattern", async () => {
    const publicDescriptor = createMockEcosystemDescriptor("js", {
      name: "public-plugin",
      version: "1.0.0",
      private: false,
    });
    const privateDescriptor = createMockEcosystemDescriptor("js", {
      name: "private-plugin",
      version: "1.0.0",
      private: true,
    });
    setupDirectoryEntries([
      "packages/plugins/public-plugin",
      "packages/plugins/private-plugin",
    ]);
    mockedEcosystemCatalog.detect.mockImplementation(
      async (pkgPath: string) => {
        if (String(pkgPath).includes("private-plugin")) {
          return privateDescriptor as any;
        }
        return publicDescriptor as any;
      },
    );
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({
      cwd: "/project",
      configPackages: [{ path: "packages/plugins/*" }],
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("public-plugin");
  });

  it("handles mixed glob and explicit paths in configPackages", async () => {
    const jsDescriptor = createMockEcosystemDescriptor("js", {
      name: "pkg",
      version: "1.0.0",
    });
    setupDirectoryEntries(["packages/plugins/plugin-a"]);
    mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
    mockedInferRegistries.mockResolvedValue(["npm"]);

    const result = await discoverPackages({
      cwd: "/project",
      configPackages: [
        { path: "packages/plugins/*", registries: ["npm", "jsr"] },
        { path: "packages/core", registries: ["npm"] },
      ],
    });

    expect(result).toHaveLength(2);
    const pluginPkg = result.find((r) =>
      r.path.includes(path.join("plugins", "plugin-a")),
    );
    const corePkg = result.find(
      (r) => r.path === path.join("packages", "core"),
    );
    expect(pluginPkg?.registries).toEqual(["npm", "jsr"]);
    expect(corePkg?.registries).toEqual(["npm"]);
  });

  it("returns empty array when glob pattern matches nothing", async () => {
    setupDirectoryEntries([]);

    const result = await discoverPackages({
      cwd: "/project",
      configPackages: [{ path: "nonexistent/*" }],
    });

    expect(result).toEqual([]);
  });
});
