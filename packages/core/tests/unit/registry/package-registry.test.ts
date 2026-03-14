import { describe, expect, it, vi } from "vitest";
import { PackageRegistry } from "../../../src/registry/package-registry.js";

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
      "https://registry.npmjs.org",
    );
    expect(reg.packageName).toBe("my-package");
    expect(reg.registry).toBe("https://registry.npmjs.org");
  });

  it("has default checkAvailability implementation", async () => {
    const reg = new TestPackageRegistry("my-package");
    await expect(reg.checkAvailability({} as any)).resolves.toBeUndefined();
  });

  it("has default dryRunPublish as no-op", async () => {
    const reg = new TestPackageRegistry("my-package");
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
    const reg = new BaseTestRegistry("my-package");
    await expect(reg.checkAvailability({} as any)).resolves.toBeUndefined();
  });

  it("succeeds when package exists but user has permission", async () => {
    const reg = new BaseTestRegistry("my-package");
    vi.spyOn(reg, "isPackageNameAvailable").mockResolvedValue(false);
    vi.spyOn(reg, "hasPermission").mockResolvedValue(true);
    await expect(reg.checkAvailability({} as any)).resolves.toBeUndefined();
  });

  it("throws when package exists and user lacks permission", async () => {
    const reg = new BaseTestRegistry("my-package");
    vi.spyOn(reg, "isPackageNameAvailable").mockResolvedValue(false);
    vi.spyOn(reg, "hasPermission").mockResolvedValue(false);
    await expect(reg.checkAvailability({} as any)).rejects.toThrow(
      "No permission to publish my-package.",
    );
  });
});
