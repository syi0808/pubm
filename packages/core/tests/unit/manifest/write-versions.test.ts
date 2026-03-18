import { describe, expect, it, vi } from "vitest";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import type { Ecosystem } from "../../../src/ecosystem/ecosystem.js";
import { writeVersionsForEcosystem } from "../../../src/manifest/write-versions.js";

function createMockEcosystem(name: string, lockfilePath?: string) {
  return {
    packagePath: `/mock/${name}`,
    packageName: vi.fn().mockResolvedValue(name),
    writeVersion: vi.fn().mockResolvedValue(undefined),
    updateSiblingDependencyVersions: vi.fn().mockResolvedValue(false),
    syncLockfile: vi.fn().mockResolvedValue(lockfilePath),
    registryClasses: vi.fn().mockReturnValue([
      {
        reader: { invalidate: vi.fn() },
      },
    ]),
  } as unknown as Ecosystem;
}

function createMockPkg(name: string): ResolvedPackageConfig {
  return {
    name,
    version: "1.0.0",
    path: `/mock/${name}`,
    dependencies: [],
    registries: [],
  };
}

describe("writeVersionsForEcosystem", () => {
  describe("Phase 1: writeVersion", () => {
    it("calls writeVersion with the correct version for each package", async () => {
      const ecoA = createMockEcosystem("pkg-a");
      const ecoB = createMockEcosystem("pkg-b");

      const ecosystems = [
        { eco: ecoA, pkg: createMockPkg("pkg-a") },
        { eco: ecoB, pkg: createMockPkg("pkg-b") },
      ];
      const versions = new Map([
        ["/mock/pkg-a", "2.0.0"],
        ["/mock/pkg-b", "3.0.0"],
      ]);

      await writeVersionsForEcosystem(ecosystems, versions);

      expect(ecoA.writeVersion).toHaveBeenCalledWith("2.0.0");
      expect(ecoB.writeVersion).toHaveBeenCalledWith("3.0.0");
    });

    it("skips writeVersion when package has no version in the map", async () => {
      const eco = createMockEcosystem("pkg-a");
      const ecosystems = [{ eco, pkg: createMockPkg("pkg-a") }];
      const versions = new Map([["/mock/pkg-b", "2.0.0"]]);

      await writeVersionsForEcosystem(ecosystems, versions);

      expect(eco.writeVersion).not.toHaveBeenCalled();
    });
  });

  describe("Phase 1: ManifestReader cache invalidation", () => {
    it("invalidates cache for each registry class after writing version", async () => {
      const invalidateFn = vi.fn();
      const eco = {
        packagePath: "/mock/pkg-a",
        packageName: vi.fn().mockResolvedValue("pkg-a"),
        writeVersion: vi.fn().mockResolvedValue(undefined),
        updateSiblingDependencyVersions: vi.fn().mockResolvedValue(false),
        syncLockfile: vi.fn().mockResolvedValue(undefined),
        registryClasses: vi
          .fn()
          .mockReturnValue([
            { reader: { invalidate: invalidateFn } },
            { reader: { invalidate: invalidateFn } },
          ]),
      } as unknown as Ecosystem;

      const ecosystems = [{ eco, pkg: createMockPkg("pkg-a") }];
      const versions = new Map([["/mock/pkg-a", "2.0.0"]]);

      await writeVersionsForEcosystem(ecosystems, versions);

      expect(invalidateFn).toHaveBeenCalledTimes(2);
      expect(invalidateFn).toHaveBeenCalledWith("/mock/pkg-a");
    });

    it("does not invalidate cache when version is not in map", async () => {
      const invalidateFn = vi.fn();
      const eco = {
        packagePath: "/mock/pkg-a",
        packageName: vi.fn().mockResolvedValue("pkg-a"),
        writeVersion: vi.fn().mockResolvedValue(undefined),
        updateSiblingDependencyVersions: vi.fn().mockResolvedValue(false),
        syncLockfile: vi.fn().mockResolvedValue(undefined),
        registryClasses: vi
          .fn()
          .mockReturnValue([{ reader: { invalidate: invalidateFn } }]),
      } as unknown as Ecosystem;

      const ecosystems = [{ eco, pkg: createMockPkg("pkg-a") }];
      const versions = new Map<string, string>();

      await writeVersionsForEcosystem(ecosystems, versions);

      expect(invalidateFn).not.toHaveBeenCalled();
    });
  });

  describe("Phase 2: updateSiblingDependencyVersions", () => {
    it("calls updateSiblingDependencyVersions with name-keyed map for all packages when multiple packages", async () => {
      const ecoA = createMockEcosystem("pkg-a");
      const ecoB = createMockEcosystem("pkg-b");

      const ecosystems = [
        { eco: ecoA, pkg: createMockPkg("pkg-a") },
        { eco: ecoB, pkg: createMockPkg("pkg-b") },
      ];
      const versions = new Map([
        ["/mock/pkg-a", "2.0.0"],
        ["/mock/pkg-b", "3.0.0"],
      ]);

      await writeVersionsForEcosystem(ecosystems, versions);

      const expectedNameKeyedVersions = new Map([
        ["pkg-a", "2.0.0"],
        ["pkg-b", "3.0.0"],
      ]);
      expect(ecoA.updateSiblingDependencyVersions).toHaveBeenCalledWith(
        expectedNameKeyedVersions,
      );
      expect(ecoB.updateSiblingDependencyVersions).toHaveBeenCalledWith(
        expectedNameKeyedVersions,
      );
    });

    it("does NOT call updateSiblingDependencyVersions for a single package", async () => {
      const eco = createMockEcosystem("pkg-a");
      const ecosystems = [{ eco, pkg: createMockPkg("pkg-a") }];
      const versions = new Map([["/mock/pkg-a", "2.0.0"]]);

      await writeVersionsForEcosystem(ecosystems, versions);

      expect(eco.updateSiblingDependencyVersions).not.toHaveBeenCalled();
    });

    it("excludes packages with no version from the name-keyed map in Phase 2", async () => {
      const ecoA = createMockEcosystem("pkg-a");
      const ecoB = createMockEcosystem("pkg-b");

      const ecosystems = [
        { eco: ecoA, pkg: createMockPkg("pkg-a") },
        { eco: ecoB, pkg: createMockPkg("pkg-b") },
      ];
      // pkg-b has no entry in versions map
      const versions = new Map([["/mock/pkg-a", "2.0.0"]]);

      await writeVersionsForEcosystem(ecosystems, versions);

      // The name-keyed map should only contain pkg-a (pkg-b is excluded)
      const expectedNameKeyedVersions = new Map([["pkg-a", "2.0.0"]]);
      expect(ecoA.updateSiblingDependencyVersions).toHaveBeenCalledWith(
        expectedNameKeyedVersions,
      );
      expect(ecoB.updateSiblingDependencyVersions).toHaveBeenCalledWith(
        expectedNameKeyedVersions,
      );
    });
  });

  describe("Phase 3: syncLockfile", () => {
    it("collects lockfile paths returned by syncLockfile", async () => {
      const ecoA = createMockEcosystem("pkg-a", "/mock/pkg-a/bun.lock");
      const ecoB = createMockEcosystem("pkg-b", "/mock/pkg-b/bun.lock");

      const ecosystems = [
        { eco: ecoA, pkg: createMockPkg("pkg-a") },
        { eco: ecoB, pkg: createMockPkg("pkg-b") },
      ];
      const versions = new Map([
        ["/mock/pkg-a", "2.0.0"],
        ["/mock/pkg-b", "3.0.0"],
      ]);

      const result = await writeVersionsForEcosystem(ecosystems, versions);

      expect(result).toEqual(["/mock/pkg-a/bun.lock", "/mock/pkg-b/bun.lock"]);
    });

    it("excludes undefined lockfile paths from the result", async () => {
      const ecoA = createMockEcosystem("pkg-a", "/mock/pkg-a/bun.lock");
      const ecoB = createMockEcosystem("pkg-b", undefined);

      const ecosystems = [
        { eco: ecoA, pkg: createMockPkg("pkg-a") },
        { eco: ecoB, pkg: createMockPkg("pkg-b") },
      ];
      const versions = new Map([
        ["/mock/pkg-a", "2.0.0"],
        ["/mock/pkg-b", "3.0.0"],
      ]);

      const result = await writeVersionsForEcosystem(ecosystems, versions);

      expect(result).toEqual(["/mock/pkg-a/bun.lock"]);
    });

    it("returns an empty array when no lockfiles are synced", async () => {
      const eco = createMockEcosystem("pkg-a", undefined);
      const ecosystems = [{ eco, pkg: createMockPkg("pkg-a") }];
      const versions = new Map([["/mock/pkg-a", "2.0.0"]]);

      const result = await writeVersionsForEcosystem(ecosystems, versions);

      expect(result).toEqual([]);
    });

    it("calls syncLockfile for every ecosystem", async () => {
      const ecoA = createMockEcosystem("pkg-a");
      const ecoB = createMockEcosystem("pkg-b");

      const ecosystems = [
        { eco: ecoA, pkg: createMockPkg("pkg-a") },
        { eco: ecoB, pkg: createMockPkg("pkg-b") },
      ];
      const versions = new Map([
        ["/mock/pkg-a", "2.0.0"],
        ["/mock/pkg-b", "3.0.0"],
      ]);

      await writeVersionsForEcosystem(ecosystems, versions);

      expect(ecoA.syncLockfile).toHaveBeenCalled();
      expect(ecoB.syncLockfile).toHaveBeenCalled();
    });
  });

  describe("empty ecosystems", () => {
    it("returns an empty array when ecosystems list is empty", async () => {
      const result = await writeVersionsForEcosystem([], new Map());
      expect(result).toEqual([]);
    });
  });
});
