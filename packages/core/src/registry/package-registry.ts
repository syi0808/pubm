import type { PubmContext } from "../context.js";
import type { ManifestReader } from "../manifest/manifest-reader.js";

export interface RegistryRequirements {
  needsPackageScripts: boolean;
  requiredManifest: string;
}

export abstract class PackageRegistry {
  static reader: ManifestReader;
  static registryType: string;

  constructor(
    public packageName: string,
    public registry?: string,
  ) {}

  abstract publish(): Promise<boolean>;
  abstract isPublished(): Promise<boolean>;
  abstract isVersionPublished(version: string): Promise<boolean>;
  abstract hasPermission(): Promise<boolean>;
  abstract isPackageNameAvailable(): Promise<boolean>;
  abstract distTags(): Promise<string[]>;
  abstract getRequirements(): RegistryRequirements;

  async dryRunPublish(_manifestDir?: string): Promise<void> {}

  async checkAvailability(
    // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
    _task: any,
    _ctx: PubmContext,
  ): Promise<void> {
    const available = await this.isPackageNameAvailable();
    if (!available) {
      const hasAccess = await this.hasPermission();
      if (!hasAccess) {
        throw new Error(`No permission to publish ${this.packageName}.`);
      }
    }
  }
}
