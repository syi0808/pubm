import { describe, expect, it } from "vitest";
import type { ResolvedPubmConfig } from "../../src/config/types.js";
import { createContext } from "../../src/context.js";
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
    expect(ctx.runtime.changesetConsumed).toBeUndefined();
  });

  it("runtime is mutable", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    ctx.runtime.version = "1.0.0";
    ctx.runtime.tag = "next";
    expect(ctx.runtime.version).toBe("1.0.0");
    expect(ctx.runtime.tag).toBe("next");
  });

  it("config is immutable (top-level reassignment throws)", () => {
    const ctx = createContext(makeConfig(), makeOptions());
    expect(() => {
      (ctx as any).config = makeConfig();
    }).toThrow();
  });
});
