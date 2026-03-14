import type {
  ManifestReader,
  PackageManifest,
} from "../manifest/manifest-reader.js";
import type { Registry } from "../registry/registry.js";
import type { RegistryType } from "../types/options.js";

export abstract class Ecosystem {
  constructor(public packagePath: string) {}

  abstract registryClasses(): (typeof Registry)[];
  abstract writeVersion(newVersion: string): Promise<void>;
  abstract manifestFiles(): string[];
  abstract defaultTestCommand(): Promise<string> | string;
  abstract defaultBuildCommand(): Promise<string> | string;
  abstract supportedRegistries(): RegistryType[];

  async readManifest(): Promise<PackageManifest> {
    for (const RegClass of this.registryClasses()) {
      const reader: ManifestReader = RegClass.reader;
      if (await reader.exists(this.packagePath)) {
        return reader.read(this.packagePath);
      }
    }
    throw new Error(
      `No manifest file found in ${this.packagePath} for any configured registry`,
    );
  }

  async readRegistryVersions(): Promise<Map<RegistryType, string>> {
    const versions = new Map<RegistryType, string>();
    for (const RegClass of this.registryClasses()) {
      const reader: ManifestReader = RegClass.reader;
      if (await reader.exists(this.packagePath)) {
        const manifest = await reader.read(this.packagePath);
        versions.set(RegClass.registryType as RegistryType, manifest.version);
      }
    }
    return versions;
  }

  async isPrivate(): Promise<boolean> {
    return (await this.readManifest()).private;
  }

  async packageName(): Promise<string> {
    return (await this.readManifest()).name;
  }

  async readVersion(): Promise<string> {
    return (await this.readManifest()).version;
  }

  async dependencies(): Promise<string[]> {
    return (await this.readManifest()).dependencies;
  }

  async updateSiblingDependencyVersions(
    _siblingVersions: Map<string, string>,
  ): Promise<boolean> {
    return false;
  }

  async syncLockfile(): Promise<string | undefined> {
    return undefined;
  }
}
