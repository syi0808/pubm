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
    expect(resolved.rollbackStrategy).toBe("individual");
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
