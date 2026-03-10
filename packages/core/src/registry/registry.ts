export interface RegistryRequirements {
  needsPackageScripts: boolean;
  requiredManifest: string;
}

export abstract class Registry {
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
  abstract isPackageNameAvaliable(): Promise<boolean>;
  abstract getRequirements(): RegistryRequirements;

  async dryRunPublish(_manifestDir?: string): Promise<void> {
    // Default no-op: registries that support dry-run override this
  }
}
