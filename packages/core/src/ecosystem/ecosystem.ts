import type { RegistryType } from "../types/options.js";

export abstract class Ecosystem {
  constructor(public packagePath: string) {}

  abstract packageName(): Promise<string>;
  abstract readVersion(): Promise<string>;
  abstract writeVersion(newVersion: string): Promise<void>;
  abstract manifestFiles(): string[];
  abstract defaultTestCommand(): Promise<string> | string;
  abstract defaultBuildCommand(): Promise<string> | string;
  abstract supportedRegistries(): RegistryType[];

  async updateSiblingDependencyVersions(
    _siblingVersions: Map<string, string>,
  ): Promise<boolean> {
    return false;
  }

  async syncLockfile(): Promise<string | undefined> {
    return undefined;
  }

  async dependencies(): Promise<string[]> {
    return [];
  }
}
