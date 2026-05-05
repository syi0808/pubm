import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pubm/runner", () => ({
  color: new Proxy(
    {},
    {
      get: () => (value: string) => value,
    },
  ),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(() => ({ rdev: 0, birthtimeMs: 0, nlink: 0, gid: 0 })),
}));

vi.mock("../../../src/monorepo/discover.js", () => ({
  discoverPackages: vi.fn(),
}));

import { existsSync } from "node:fs";
import { resolveConfig } from "../../../src/config/defaults.js";
import type { PubmConfig } from "../../../src/config/types.js";
import { discoverPackages } from "../../../src/monorepo/discover.js";
import { registryCatalog } from "../../../src/registry/catalog.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedDiscoverPackages = vi.mocked(discoverPackages);

describe("resolveConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mockedDiscoverPackages.mockResolvedValue([]);
  });

  it("returns full defaults when no config provided", async () => {
    const resolved = await resolveConfig({});
    expect(resolved.branch).toBe("main");
    expect(resolved.release).toEqual({
      versioning: {
        mode: "independent",
        fixed: [],
        linked: [],
        updateInternalDependencies: "patch",
      },
      changesets: { directory: ".pubm/changesets" },
      commits: { format: "conventional", types: {} },
      changelog: true,
      pullRequest: {
        branchTemplate: "pubm/release/{scopeSlug}",
        titleTemplate: "chore(release): {scope} {version}",
        label: "pubm:release-pr",
        bumpLabels: {
          patch: "release:patch",
          minor: "release:minor",
          major: "release:major",
          prerelease: "release:prerelease",
        },
        grouping: "independent",
        fixed: [],
        linked: [],
        unversionedChanges: "warn",
      },
    });
    expect(resolved).not.toHaveProperty("versionSources");
    expect(resolved).not.toHaveProperty("conventionalCommits");
    expect(resolved).not.toHaveProperty("releasePr");
    expect(resolved).not.toHaveProperty("changelogFormat");
    expect(resolved.validate.cleanInstall).toBe(true);
    expect(resolved.validate.entryPoints).toBe(true);
    expect(resolved.validate.extraneousFiles).toBe(true);
    expect(resolved.commit).toBe(false);
    expect(resolved.access).toBe("public");
    expect(resolved.rollback).toEqual({
      strategy: "individual",
      dangerouslyAllowUnpublish: false,
    });
  });

  it("merges user config over defaults", async () => {
    const config: PubmConfig = {
      branch: "develop",
      release: { changelog: false },
      validate: { cleanInstall: false },
    };
    const resolved = await resolveConfig(config);
    expect(resolved.branch).toBe("develop");
    expect(resolved.release.changelog).toBe(false);
    expect(resolved.validate.cleanInstall).toBe(false);
    expect(resolved.validate.entryPoints).toBe(true);
  });

  it("drops removed top-level release config keys from resolved config", async () => {
    const resolved = await resolveConfig({
      versionSources: "changesets",
      conventionalCommits: { types: { feat: "minor" } },
      releasePr: { label: "legacy-release-pr" },
      changelogFormat: "github",
      release: {
        pullRequest: {
          enabled: true,
          label: "custom-release-pr",
        },
      },
    } as never);

    expect(resolved).not.toHaveProperty("versionSources");
    expect(resolved).not.toHaveProperty("conventionalCommits");
    expect(resolved).not.toHaveProperty("releasePr");
    expect(resolved).not.toHaveProperty("changelogFormat");
    expect(resolved.release.pullRequest).not.toHaveProperty("enabled");
    expect(resolved.release.pullRequest.label).toBe("custom-release-pr");
  });

  it("should not include default registries in resolved config", async () => {
    const resolved = await resolveConfig({});
    expect(resolved.registries).toBeUndefined();
  });

  it("should not include default registries in default package", async () => {
    mockedDiscoverPackages.mockResolvedValue([
      {
        path: ".",
        name: "my-pkg",
        version: "1.0.0",
        dependencies: [],
        registries: [],
        ecosystem: "js",
      },
    ]);
    const resolved = await resolveConfig({});
    expect(resolved.packages[0].registries).toEqual([]);
  });

  it("sets discoveryEmpty when no packages discovered", async () => {
    mockedDiscoverPackages.mockResolvedValue([]);

    const resolved = await resolveConfig({}, "/project");

    expect(resolved.discoveryEmpty).toBe(true);
    expect(resolved.packages).toEqual([]);
  });

  it("calls discoverPackages when packages not specified", async () => {
    mockedDiscoverPackages.mockResolvedValue([
      {
        path: "packages/a",
        name: "pkg-a",
        version: "1.0.0",
        dependencies: [],
        registries: ["npm"],
        ecosystem: "js",
      },
    ]);

    const resolved = await resolveConfig({}, "/project");

    expect(mockedDiscoverPackages).toHaveBeenCalledWith({
      cwd: "/project",
      configPackages: undefined,
      ignore: undefined,
    });
    expect(resolved.packages).toEqual([
      {
        path: "packages/a",
        name: "pkg-a",
        version: "1.0.0",
        dependencies: [],
        registries: ["npm"],
        ecosystem: "js",
      },
    ]);
  });

  it("passes config packages to discoverPackages for resolution", async () => {
    mockedDiscoverPackages.mockResolvedValue([
      {
        path: "my-pkg",
        name: "my-pkg",
        version: "1.0.0",
        dependencies: [],
        registries: ["npm"],
        ecosystem: "js",
      },
    ]);

    const resolved = await resolveConfig({
      packages: [{ path: "my-pkg" }],
    });

    expect(mockedDiscoverPackages).toHaveBeenCalledWith(
      expect.objectContaining({
        configPackages: [{ path: "my-pkg" }],
      }),
    );
    expect(resolved.packages).toEqual([
      {
        path: "my-pkg",
        name: "my-pkg",
        version: "1.0.0",
        dependencies: [],
        registries: ["npm"],
        ecosystem: "js",
      },
    ]);
  });

  describe("glob pattern config packages", () => {
    it("applies testScript/buildScript from a glob config entry to all matched discovered packages", async () => {
      mockedDiscoverPackages.mockResolvedValue([
        {
          path: "packages/a",
          name: "pkg-a",
          version: "1.0.0",
          dependencies: [],
          registries: ["npm"],
          ecosystem: "js",
        },
        {
          path: "packages/b",
          name: "pkg-b",
          version: "1.0.0",
          dependencies: [],
          registries: ["npm"],
          ecosystem: "js",
        },
      ]);

      const resolved = await resolveConfig({
        packages: [
          {
            path: "packages/*",
            testScript: "test:ci",
            buildScript: "build:prod",
          },
        ],
      });

      expect(resolved.packages[0].testScript).toBe("test:ci");
      expect(resolved.packages[0].buildScript).toBe("build:prod");
      expect(resolved.packages[1].testScript).toBe("test:ci");
      expect(resolved.packages[1].buildScript).toBe("build:prod");
    });

    it("does not apply glob config overrides to non-matching packages", async () => {
      mockedDiscoverPackages.mockResolvedValue([
        {
          path: "packages/a",
          name: "pkg-a",
          version: "1.0.0",
          dependencies: [],
          registries: ["npm"],
          ecosystem: "js",
        },
        {
          path: "tools/cli",
          name: "cli",
          version: "1.0.0",
          dependencies: [],
          registries: ["npm"],
          ecosystem: "js",
        },
      ]);

      const resolved = await resolveConfig({
        packages: [
          {
            path: "packages/*",
            testScript: "test:ci",
          },
        ],
      });

      expect(resolved.packages[0].testScript).toBe("test:ci");
      expect(resolved.packages[1].testScript).toBeUndefined();
    });
  });

  it("migrates deprecated rollbackStrategy to rollback.strategy", async () => {
    const resolved = await resolveConfig({ rollbackStrategy: "all" });
    expect(resolved.rollback.strategy).toBe("all");
  });

  it("rollback.strategy takes precedence over rollbackStrategy", async () => {
    const resolved = await resolveConfig({
      rollbackStrategy: "all",
      rollback: { strategy: "individual" },
    });
    expect(resolved.rollback.strategy).toBe("individual");
  });

  it("defaults release pull request config for GitHub action workflows", async () => {
    const config = await resolveConfig({});

    expect(config.release.pullRequest).toEqual({
      branchTemplate: "pubm/release/{scopeSlug}",
      titleTemplate: "chore(release): {scope} {version}",
      label: "pubm:release-pr",
      bumpLabels: {
        patch: "release:patch",
        minor: "release:minor",
        major: "release:major",
        prerelease: "release:prerelease",
      },
      grouping: "independent",
      fixed: [],
      linked: [],
      unversionedChanges: "warn",
    });
  });

  it("defaults unversioned release pull request changes to warn", async () => {
    const config = await resolveConfig({});

    expect(config.release.pullRequest.unversionedChanges).toBe("warn");
  });

  it("merges release pull request config over defaults", async () => {
    const config = await resolveConfig({
      release: {
        versioning: {
          fixed: [["packages/core"]],
          linked: [["packages/pubm"]],
        },
        pullRequest: {
          branchTemplate: "release/{scopeSlug}",
          bumpLabels: { minor: "kind/minor" },
          grouping: "fixed",
          fixed: [["packages/runner"]],
          linked: [],
          unversionedChanges: "fail",
        },
      },
    });

    expect(config.release.pullRequest).toEqual({
      branchTemplate: "release/{scopeSlug}",
      titleTemplate: "chore(release): {scope} {version}",
      label: "pubm:release-pr",
      bumpLabels: {
        patch: "release:patch",
        minor: "kind/minor",
        major: "release:major",
        prerelease: "release:prerelease",
      },
      grouping: "fixed",
      fixed: [["packages/runner"]],
      linked: [],
      unversionedChanges: "fail",
    });
  });

  it("inherits release pull request grouping and groups from release versioning", async () => {
    const config = await resolveConfig({
      release: {
        versioning: {
          mode: "fixed",
          fixed: [["packages/core", "packages/pubm"]],
          linked: [["packages/runner", "packages/plugins/*"]],
        },
      },
    });

    expect(config.release.pullRequest.grouping).toBe("fixed");
    expect(config.release.pullRequest.fixed).toEqual([
      ["packages/core", "packages/pubm"],
    ]);
    expect(config.release.pullRequest.linked).toEqual([
      ["packages/runner", "packages/plugins/*"],
    ]);
  });

  it("clones release config collections from defaults and user input", async () => {
    const fixed = [["packages/core", "packages/pubm"]];
    const linked = [["packages/runner"]];
    const types: NonNullable<
      NonNullable<PubmConfig["release"]>["commits"]
    >["types"] = { feat: "minor" };

    const configured = await resolveConfig({
      release: {
        versioning: { fixed, linked },
        commits: { types },
      },
    });

    fixed[0].push("packages/mutated");
    linked.push(["packages/mutated"]);
    types.feat = false;
    types.fix = "patch";

    expect(configured.release.versioning.fixed).toEqual([
      ["packages/core", "packages/pubm"],
    ]);
    expect(configured.release.versioning.linked).toEqual([["packages/runner"]]);
    expect(configured.release.commits.types).toEqual({ feat: "minor" });

    const defaults = await resolveConfig({});
    defaults.release.versioning.fixed.push(["packages/default-fixed"]);
    defaults.release.versioning.linked.push(["packages/default-linked"]);
    defaults.release.commits.types.feat = "minor";

    const nextDefaults = await resolveConfig({});
    expect(nextDefaults.release.versioning.fixed).toEqual([]);
    expect(nextDefaults.release.versioning.linked).toEqual([]);
    expect(nextDefaults.release.commits.types).toEqual({});
  });

  it("defaults dangerouslyAllowUnpublish to false", async () => {
    const resolved = await resolveConfig({});
    expect(resolved.rollback.dangerouslyAllowUnpublish).toBe(false);
  });

  it("accepts rollback.dangerouslyAllowUnpublish from config", async () => {
    const resolved = await resolveConfig({
      rollback: { dangerouslyAllowUnpublish: true },
    });
    expect(resolved.rollback.dangerouslyAllowUnpublish).toBe(true);
  });

  it("throws when ecosystem cannot be inferred from private registry", async () => {
    const config: PubmConfig = {
      packages: [
        {
          path: ".",
          registries: [
            {
              url: "https://private.registry.com",
              token: { envVar: "PRIV_TOKEN" },
            },
          ],
        },
      ],
    };
    await expect(resolveConfig(config)).rejects.toThrow(
      /Cannot infer ecosystem/,
    );
  });

  it("throws for unregistered ecosystem key", async () => {
    const config: PubmConfig = {
      packages: [
        {
          path: ".",
          ecosystem: "python",
          registries: ["npm"],
        },
      ],
    };
    await expect(resolveConfig(config)).rejects.toThrow(
      /Unknown ecosystem "python"/,
    );
  });

  describe("private registry normalization", () => {
    it("normalizes PrivateRegistryConfig objects to string keys in packages", async () => {
      mockedDiscoverPackages.mockResolvedValue([
        {
          path: "packages/a",
          name: "pkg-a",
          version: "1.0.0",
          dependencies: [],
          registries: ["npm", "npm.internal.com"],
          ecosystem: "js",
        },
      ]);

      const resolved = await resolveConfig({
        packages: [
          {
            path: "packages/a",
            registries: [
              "npm",
              {
                url: "https://npm.internal.com",
                token: { envVar: "MY_TOKEN" },
              },
            ],
          },
        ],
      });
      // After normalization, the object should become a string key
      expect(resolved.packages[0].registries).toEqual([
        "npm",
        "npm.internal.com",
      ]);
    });

    it("registers private registry in catalog during normalization", async () => {
      mockedDiscoverPackages.mockResolvedValue([]);

      await resolveConfig({
        packages: [
          {
            path: "packages/a",
            ecosystem: "js",
            registries: [
              {
                url: "https://npm.internal.com",
                token: { envVar: "MY_TOKEN" },
              },
            ],
          },
        ],
      });
      expect(registryCatalog.get("npm.internal.com")).toBeDefined();
    });
  });
});
