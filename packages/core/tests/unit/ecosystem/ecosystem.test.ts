import { describe, expect, it } from "vitest";
import { Ecosystem } from "../../../src/ecosystem/ecosystem.js";
import type { PackageRegistry } from "../../../src/registry/package-registry.js";
import type { RegistryType } from "../../../src/types/options.js";

class TestEcosystem extends Ecosystem {
  registryClasses(): (typeof PackageRegistry)[] {
    return [];
  }
  async writeVersion(_version: string): Promise<void> {}
  manifestFiles(): string[] {
    return ["test.json"];
  }
  defaultTestCommand(): string {
    return "test-cmd";
  }
  defaultBuildCommand(): string {
    return "build-cmd";
  }
  supportedRegistries(): RegistryType[] {
    return ["npm"];
  }
}

describe("Ecosystem", () => {
  it("can be instantiated via subclass", () => {
    const eco = new TestEcosystem("/some/path");
    expect(eco.packagePath).toBe("/some/path");
  });

  it("exposes methods through subclass", () => {
    const eco = new TestEcosystem("/some/path");
    expect(eco.manifestFiles()).toEqual(["test.json"]);
    expect(eco.defaultTestCommand()).toBe("test-cmd");
    expect(eco.defaultBuildCommand()).toBe("build-cmd");
    expect(eco.supportedRegistries()).toEqual(["npm"]);
  });

  it("throws when readManifest finds no manifest", async () => {
    const eco = new TestEcosystem("/some/path");
    await expect(eco.readManifest()).rejects.toThrow("No manifest file found");
  });
});
