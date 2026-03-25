import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PackageRegistry } from "../../../src/registry/package-registry.js";

const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");

class TestPackageRegistry extends PackageRegistry {
  async publish(): Promise<boolean> {
    return true;
  }
  async dryRunPublish(): Promise<void> {}
  async isPublished(): Promise<boolean> {
    return false;
  }
  async isVersionPublished(): Promise<boolean> {
    return false;
  }
  async hasPermission(): Promise<boolean> {
    return true;
  }
  async isPackageNameAvailable(): Promise<boolean> {
    return true;
  }
  async distTags(): Promise<string[]> {
    return [];
  }
  async checkAvailability(): Promise<void> {}
  getRequirements() {
    return { needsPackageScripts: false, requiredManifest: "test.json" };
  }
}

describe("PackageRegistry", () => {
  it("stores packageName and registry", () => {
    const reg = new TestPackageRegistry(
      "my-package",
      FIXTURE_PATH,
      "https://registry.npmjs.org",
    );
    expect(reg.packageName).toBe("my-package");
    expect(reg.packagePath).toBe(FIXTURE_PATH);
    expect(reg.registry).toBe("https://registry.npmjs.org");
  });

  it("has default checkAvailability implementation", async () => {
    const reg = new TestPackageRegistry("my-package", FIXTURE_PATH);
    await expect(
      reg.checkAvailability({} as any, {} as any),
    ).resolves.toBeUndefined();
  });

  it("has default dryRunPublish as no-op", async () => {
    const reg = new TestPackageRegistry("my-package", FIXTURE_PATH);
    await expect(reg.dryRunPublish()).resolves.toBeUndefined();
  });
});

describe("PackageRegistry defaults", () => {
  class MinimalTestRegistry extends PackageRegistry {
    async publish(): Promise<boolean> {
      return true;
    }
    async isPublished(): Promise<boolean> {
      return false;
    }
    async isVersionPublished(): Promise<boolean> {
      return false;
    }
    async hasPermission(): Promise<boolean> {
      return true;
    }
    async isPackageNameAvailable(): Promise<boolean> {
      return true;
    }
    async distTags(): Promise<string[]> {
      return [];
    }
    getRequirements() {
      return { needsPackageScripts: false, requiredManifest: "test.json" };
    }
  }

  it("supportsUnpublish returns false by default", () => {
    const reg = new MinimalTestRegistry("my-package", FIXTURE_PATH);
    expect(reg.supportsUnpublish).toBe(false);
  });

  it("unpublish is a no-op by default", async () => {
    const reg = new MinimalTestRegistry("my-package", FIXTURE_PATH);
    await expect(reg.unpublish("my-package", "1.0.0")).resolves.toBeUndefined();
  });

  it("dryRunPublish is a no-op by default", async () => {
    const reg = new MinimalTestRegistry("my-package", FIXTURE_PATH);
    await expect(reg.dryRunPublish()).resolves.toBeUndefined();
  });
});

describe("base checkAvailability", () => {
  class BaseTestRegistry extends PackageRegistry {
    async publish(): Promise<boolean> {
      return true;
    }
    async isPublished(): Promise<boolean> {
      return false;
    }
    async isVersionPublished(): Promise<boolean> {
      return false;
    }
    async hasPermission(): Promise<boolean> {
      return true;
    }
    async isPackageNameAvailable(): Promise<boolean> {
      return true;
    }
    async distTags(): Promise<string[]> {
      return [];
    }
    getRequirements() {
      return { needsPackageScripts: false, requiredManifest: "test.json" };
    }
  }

  it("succeeds when package name is available", async () => {
    const reg = new BaseTestRegistry("my-package", FIXTURE_PATH);
    await expect(
      reg.checkAvailability({} as any, {} as any),
    ).resolves.toBeUndefined();
  });

  it("succeeds when package exists but user has permission", async () => {
    const reg = new BaseTestRegistry("my-package", FIXTURE_PATH);
    vi.spyOn(reg, "isPackageNameAvailable").mockResolvedValue(false);
    vi.spyOn(reg, "hasPermission").mockResolvedValue(true);
    await expect(
      reg.checkAvailability({} as any, {} as any),
    ).resolves.toBeUndefined();
  });

  it("throws when package exists and user lacks permission", async () => {
    const reg = new BaseTestRegistry("my-package", FIXTURE_PATH);
    vi.spyOn(reg, "isPackageNameAvailable").mockResolvedValue(false);
    vi.spyOn(reg, "hasPermission").mockResolvedValue(false);
    await expect(reg.checkAvailability({} as any, {} as any)).rejects.toThrow(
      "No permission to publish my-package.",
    );
  });
});
