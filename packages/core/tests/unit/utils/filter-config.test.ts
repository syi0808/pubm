import { describe, expect, it } from "vitest";
import type {
  ResolvedPackageConfig,
  ResolvedPubmConfig,
} from "../../../src/config/types.js";
import { createContext } from "../../../src/context.js";
import type { ResolvedOptions } from "../../../src/types/options.js";
import { filterConfigPackages } from "../../../src/utils/filter-config.js";

function makePkg(path: string, name: string): ResolvedPackageConfig {
  return {
    path,
    name,
    version: "1.0.0",
    dependencies: [],
    registries: ["npm"],
    ecosystem: "js",
  };
}

function makeConfig(packages: ResolvedPackageConfig[]): ResolvedPubmConfig {
  return {
    versioning: "independent",
    branch: "main",
    changelog: true,
    changelogFormat: "default",
    commit: false,
    access: "public",
    fixed: [],
    linked: [],
    updateInternalDependencies: "patch",
    ignore: [],
    snapshotTemplate: "{tag}-{timestamp}",
    tag: "latest",
    contents: ".",
    saveToken: true,
    releaseDraft: true,
    releaseNotes: true,
    rollback: { strategy: "individual", dangerouslyAllowUnpublish: false },
    lockfileSync: "optional",
    packages,
    validate: { cleanInstall: true, entryPoints: true, extraneousFiles: true },
    plugins: [],
  };
}

function makeOptions(): ResolvedOptions {
  return {
    testScript: "test",
    buildScript: "build",
    mode: "local",
    branch: "main",
    tag: "latest",
    saveToken: true,
  };
}

describe("filterConfigPackages", () => {
  const pkgA = makePkg("packages/a", "@scope/a");
  const pkgB = makePkg("packages/b", "@scope/b");
  const pkgC = makePkg("packages/c", "@scope/c");

  it("replaces ctx.config.packages with only the packages in publishKeys", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB, pkgC]), makeOptions());
    filterConfigPackages(ctx, new Set(["packages/a::js", "packages/c::js"]));
    expect(ctx.config.packages).toHaveLength(2);
    expect(ctx.config.packages.map((p) => p.path)).toEqual([
      "packages/a",
      "packages/c",
    ]);
  });

  it("freezes the new config object", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB]), makeOptions());
    filterConfigPackages(ctx, new Set(["packages/a::js"]));
    expect(Object.isFrozen(ctx.config)).toBe(true);
  });

  it("handles an empty publishKeys set (no packages)", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB]), makeOptions());
    filterConfigPackages(ctx, new Set());
    expect(ctx.config.packages).toHaveLength(0);
  });

  it("preserves all packages when all keys are in publishKeys", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB]), makeOptions());
    filterConfigPackages(ctx, new Set(["packages/a::js", "packages/b::js"]));
    expect(ctx.config.packages).toHaveLength(2);
  });

  it("preserves other config fields unchanged", () => {
    const ctx = createContext(makeConfig([pkgA, pkgB]), makeOptions());
    const originalBranch = ctx.config.branch;
    filterConfigPackages(ctx, new Set(["packages/a::js"]));
    expect(ctx.config.branch).toBe(originalBranch);
  });
});
