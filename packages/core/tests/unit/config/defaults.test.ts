import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(resolved.versioning).toBe("independent");
    expect(resolved.branch).toBe("main");
    expect(resolved.changelog).toBe(true);
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
      changelog: false,
      validate: { cleanInstall: false },
    };
    const resolved = await resolveConfig(config);
    expect(resolved.branch).toBe("develop");
    expect(resolved.changelog).toBe(false);
    expect(resolved.validate.cleanInstall).toBe(false);
    expect(resolved.validate.entryPoints).toBe(true);
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

  it("defaults createPr to false", async () => {
    const config = await resolveConfig({});
    expect(config.createPr).toBe(false);
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
