import { describe, expect, it } from "vitest";
import type { ResolvedPubmConfig } from "../../src/config/types.js";
import { createContext, getPackageVersion } from "../../src/context.js";
import type { ResolvedOptions } from "../../src/types/options.js";

function makeConfig(
  overrides: Partial<ResolvedPubmConfig> = {},
): ResolvedPubmConfig {
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
    rollbackStrategy: "individual",
    packages: [],
    validate: { cleanInstall: true, entryPoints: true, extraneousFiles: true },
    plugins: [],
    ...overrides,
  };
}

function makeOptions(
  overrides: Partial<ResolvedOptions> = {},
): ResolvedOptions {
  return {
    testScript: "test",
    buildScript: "build",
    branch: "main",
    tag: "latest",
    saveToken: true,
    version: "",
    ...overrides,
  };
}

describe("createContext", () => {
  it("assembles PubmContext with frozen config and options", () => {
    const config = makeConfig();
    const options = makeOptions();
    const ctx = createContext(config, options, "/test/cwd");

    expect(ctx.config).toEqual(config);
    expect(ctx.options).toEqual(options);
    expect(ctx.cwd).toBe("/test/cwd");
    expect(Object.isFrozen(ctx.config)).toBe(true);
    expect(Object.isFrozen(ctx.options)).toBe(true);
  });

  it("defaults cwd to process.cwd()", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    expect(ctx.cwd).toBe(process.cwd());
  });

  it("initializes runtime with default values", () => {
    const ctx = createContext(makeConfig(), makeOptions({ tag: "beta" }));

    expect(ctx.runtime.tag).toBe("beta");
    expect(ctx.runtime.promptEnabled).toBe(false);
    expect(ctx.runtime.cleanWorkingTree).toBe(false);
    expect(ctx.runtime.version).toBeUndefined();
    expect(ctx.runtime.versions).toBeUndefined();
    expect(ctx.runtime.versionPlan).toBeUndefined();
    expect(ctx.runtime.changesetConsumed).toBeUndefined();
  });

  it("defaults tag to 'latest' when options.tag is undefined", () => {
    const ctx = createContext(
      makeConfig(),
      makeOptions({ tag: undefined }),
      "/test/cwd",
    );
    expect(ctx.runtime.tag).toBe("latest");
  });

  it("runtime is mutable", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    ctx.runtime.version = "1.0.0";
    ctx.runtime.tag = "next";
    ctx.runtime.versionPlan = {
      mode: "single",
      version: "1.0.0",
      packageName: "test",
    };
    expect(ctx.runtime.version).toBe("1.0.0");
    expect(ctx.runtime.tag).toBe("next");
    expect(ctx.runtime.versionPlan?.version).toBe("1.0.0");
  });

  it("config is immutable (top-level reassignment throws)", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    expect(() => {
      (ctx as any).config = makeConfig();
    }).toThrow();
  });
});

describe("getPackageVersion", () => {
  it("returns plan.version for single mode", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    ctx.runtime.versionPlan = {
      mode: "single",
      version: "1.2.3",
      packageName: "my-pkg",
    };
    expect(getPackageVersion(ctx, "my-pkg")).toBe("1.2.3");
  });

  it("returns plan.version for fixed mode", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    ctx.runtime.versionPlan = {
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["pkg-a", "2.0.0"]]),
    };
    expect(getPackageVersion(ctx, "pkg-a")).toBe("2.0.0");
  });

  it("returns per-package version for independent mode", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    ctx.runtime.versionPlan = {
      mode: "independent",
      packages: new Map([
        ["pkg-a", "1.0.0"],
        ["pkg-b", "2.0.0"],
      ]),
    };
    expect(getPackageVersion(ctx, "pkg-b")).toBe("2.0.0");
  });

  it("returns empty string for independent mode when package is not in map", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    ctx.runtime.versionPlan = {
      mode: "independent",
      packages: new Map([["pkg-a", "1.0.0"]]),
    };
    expect(getPackageVersion(ctx, "unknown-pkg")).toBe("");
  });

  it("falls back to runtime.version when no versionPlan", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    ctx.runtime.version = "3.0.0";
    expect(getPackageVersion(ctx, "any-pkg")).toBe("3.0.0");
  });

  it("returns empty string when no versionPlan and no runtime.version", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    expect(getPackageVersion(ctx, "any-pkg")).toBe("");
  });
});
