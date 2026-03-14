import type { ManifestReader } from "../manifest/manifest-reader.js";

export interface RegistryRequirements {
  needsPackageScripts: boolean;
  requiredManifest: string;
}

export abstract class Registry {
  static reader: ManifestReader;
  static registryType: string;
  constructor(
    public packageName: string,
    public registry?: string,
  ) {}

  abstract ping(): Promise<boolean>;
  abstract isInstalled(): Promise<boolean>;
  abstract distTags(): Promise<string[]>;
  abstract version(): Promise<string>;
  abstract publish(): Promise<boolean>;
  abstract isPublished(): Promise<boolean>;
  abstract isVersionPublished(version: string): Promise<boolean>;
  abstract hasPermission(): Promise<boolean>;
  abstract isPackageNameAvailable(): Promise<boolean>;
  abstract getRequirements(): RegistryRequirements;

  async dryRunPublish(_manifestDir?: string): Promise<void> {
    // Default no-op: registries that support dry-run override this
  }

  get concurrentPublish(): boolean {
    return true;
  }

  async orderPackages(paths: string[]): Promise<string[]> {
    return paths;
  }

  async checkAvailability(
    // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
    _task: any,
  ): Promise<void> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error(`${this.packageName} registry is not installed.`);
    }
    const available = await this.isPackageNameAvailable();
    if (!available) {
      const hasAccess = await this.hasPermission();
      if (!hasAccess) {
        throw new Error(`No permission to publish ${this.packageName}.`);
      }
    }
  }
}
