import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(() => ({ rdev: 0, birthtimeMs: 0, nlink: 0, gid: 0 })),
}));

import { existsSync } from "node:fs";
import { resolveConfig } from "../../../src/config/defaults.js";
import type { PubmConfig } from "../../../src/config/types.js";
import { registryCatalog } from "../../../src/registry/catalog.js";

const mockedExistsSync = vi.mocked(existsSync);

describe("resolveConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it("returns full defaults when no config provided", () => {
    const resolved = resolveConfig({});
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

  it("merges user config over defaults", () => {
    const config: PubmConfig = {
      branch: "develop",
      changelog: false,
      validate: { cleanInstall: false },
    };
    const resolved = resolveConfig(config);
    expect(resolved.branch).toBe("develop");
    expect(resolved.changelog).toBe(false);
    expect(resolved.validate.cleanInstall).toBe(false);
    expect(resolved.validate.entryPoints).toBe(true);
  });

  it("should not include default registries in resolved config", () => {
    const resolved = resolveConfig({});
    expect(resolved.registries).toBeUndefined();
  });

  it("should not include default registries in default package", () => {
    const resolved = resolveConfig({});
    expect(resolved.packages[0].registries).toBeUndefined();
  });

  it("should warn when deprecated global registries field is present", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveConfig({ registries: ["npm"] });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("registries"));
    warnSpy.mockRestore();
  });

  it("detects single package when no workspace config", () => {
    const resolved = resolveConfig({});
    expect(resolved.packages).toEqual([{ path: "." }]);
  });

  describe("private registry normalization", () => {
    it("normalizes PrivateRegistryConfig objects to string keys in packages", () => {
      const resolved = resolveConfig({
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

    it("registers private registry in catalog during normalization", () => {
      resolveConfig({
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
