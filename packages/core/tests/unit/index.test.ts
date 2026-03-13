import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/config/defaults.js", () => ({
  resolveConfig: vi.fn(async (config: any) => {
    const { registries: _ignored, ...rest } = config;
    return {
      ...rest,
      packages: config.packages ?? [{ path: "." }],
      versioning: config.versioning ?? "independent",
      branch: config.branch ?? "main",
      changelog: true,
      changelogFormat: "default",
      commit: false,
      access: "public",
      fixed: [],
      linked: [],
      updateInternalDependencies: "patch",
      ignore: [],
      tag: config.tag ?? "latest",
      contents: config.contents ?? ".",
      saveToken: true,
      releaseDraft: true,
      releaseNotes: true,
      rollbackStrategy: "individual",
      validate: {
        cleanInstall: true,
        entryPoints: true,
        extraneousFiles: true,
      },
      snapshotTemplate: config.snapshotTemplate ?? "{tag}-{timestamp}",
    };
  }),
}));
vi.mock("../../src/options.js", () => ({
  resolveOptions: vi.fn((options: any) => ({
    ...options,
    testScript: options.testScript ?? "test",
    buildScript: options.buildScript ?? "build",
    branch: options.branch ?? "main",
    tag: options.tag ?? "latest",
    saveToken: options.saveToken ?? true,
  })),
}));
vi.mock("../../src/tasks/runner.js", () => ({
  run: vi.fn().mockResolvedValue(undefined),
}));

import { resolveConfig } from "../../src/config/defaults.js";
import { loadConfig } from "../../src/config/loader.js";
import { pubm } from "../../src/index.js";
import { resolveOptions } from "../../src/options.js";
import { run } from "../../src/tasks/runner.js";
import type { Options } from "../../src/types/options.js";

const mockedLoadConfig = vi.mocked(loadConfig);
const mockedResolveConfig = vi.mocked(resolveConfig);
const mockedResolveOptions = vi.mocked(resolveOptions);
const mockedRun = vi.mocked(run);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pubm", () => {
  it("calls resolveOptions with a copy of the provided options", async () => {
    const options: Options = { version: "1.0.0" };
    await pubm(options);

    expect(mockedResolveOptions).toHaveBeenCalledOnce();
    const passedOptions = mockedResolveOptions.mock.calls[0][0];

    // Should be a copy, not the same reference
    expect(passedOptions).not.toBe(options);
    expect(passedOptions).toEqual(options);
  });

  it("passes all options fields through to resolveOptions", async () => {
    const options: Options = {
      version: "2.0.0",
      testScript: "test:ci",
      buildScript: "build:prod",
      branch: "release",
      tag: "next",
      preview: true,
      anyBranch: true,
      skipTests: true,
      skipBuild: true,
      skipPublish: true,
      skipReleaseDraft: true,
      skipPrerequisitesCheck: true,
      skipConditionsCheck: true,
      publishOnly: false,
      contents: "./dist",
      saveToken: false,
    };
    await pubm(options);

    const passedOptions = mockedResolveOptions.mock.calls[0][0];
    expect(passedOptions).toEqual(options);
  });

  it("passes the resolved options to run", async () => {
    const options: Options = { version: "1.0.0" };
    await pubm(options);

    expect(mockedRun).toHaveBeenCalledOnce();
    const resolvedOptions = mockedResolveOptions.mock.results[0].value;
    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining(resolvedOptions),
    );
  });

  it("calls resolveOptions before run", async () => {
    const callOrder: string[] = [];
    mockedResolveOptions.mockImplementationOnce((opts) => {
      callOrder.push("resolveOptions");
      return opts as any;
    });
    mockedRun.mockImplementationOnce(async () => {
      callOrder.push("run");
    });

    await pubm({ version: "1.0.0" });

    expect(callOrder).toEqual(["resolveOptions", "run"]);
  });

  it("propagates errors thrown by resolveOptions", async () => {
    const error = new Error("Invalid options");
    mockedResolveOptions.mockImplementationOnce(() => {
      throw error;
    });

    await expect(pubm({ version: "1.0.0" })).rejects.toThrow("Invalid options");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by run", async () => {
    const error = new Error("Publish failed");
    mockedRun.mockRejectedValueOnce(error);

    await expect(pubm({ version: "1.0.0" })).rejects.toThrow("Publish failed");
  });

  it("does not modify the original options object", async () => {
    const options: Options = { version: "1.0.0", tag: "beta" };
    const optionsCopy = { ...options };

    await pubm(options);

    expect(options).toEqual(optionsCopy);
  });

  it("returns a promise that resolves to void on success", async () => {
    const result = await pubm({ version: "1.0.0" });

    expect(result).toBeUndefined();
  });

  it("loads config file and merges packages into resolved options", async () => {
    const configPackages = [
      { path: ".", registries: ["npm", "jsr"] },
      { path: "rust/crates/my-crate", registries: ["crates"] },
    ];

    mockedLoadConfig.mockResolvedValueOnce({
      versioning: "independent",
      packages: configPackages,
    });

    await pubm({ version: "1.0.0" });

    expect(mockedLoadConfig).toHaveBeenCalledOnce();
    const passedOptions = mockedResolveOptions.mock.calls[0][0];
    expect(passedOptions.packages).toStrictEqual(configPackages);
  });

  it("works without a config file (loadConfig returns null)", async () => {
    mockedLoadConfig.mockResolvedValueOnce(null);

    await pubm({ version: "1.0.0" });

    expect(mockedLoadConfig).toHaveBeenCalledOnce();
    expect(mockedRun).toHaveBeenCalledOnce();
  });

  it("throws when resolveConfig returns discoveryEmpty", async () => {
    mockedLoadConfig.mockResolvedValueOnce({
      versioning: "independent",
    });
    mockedResolveConfig.mockResolvedValueOnce({
      discoveryEmpty: true,
      packages: [],
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
      tag: "latest",
      contents: ".",
      saveToken: true,
      releaseDraft: true,
      releaseNotes: true,
      rollbackStrategy: "individual",
      validate: {
        cleanInstall: true,
        entryPoints: true,
        extraneousFiles: true,
      },
      snapshotTemplate: "{tag}-{timestamp}",
    });

    await expect(pubm({ version: "1.0.0" })).rejects.toThrow(
      "[pubm] No publishable packages found",
    );
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("does not propagate deprecated global registries from config", async () => {
    mockedLoadConfig.mockResolvedValueOnce({
      registries: ["npm", "jsr", "crates"],
    });

    await pubm({ version: "1.0.0" });

    const passedOptions = mockedResolveOptions.mock.calls[0][0];
    expect(passedOptions.registries).toBeUndefined();
  });
});
