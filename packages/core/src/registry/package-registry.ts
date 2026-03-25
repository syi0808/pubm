import type { PubmContext } from "../context.js";
import type { ManifestReader } from "../manifest/manifest-reader.js";
import type { RegistryType } from "../types/options.js";

export interface RegistryRequirements {
  needsPackageScripts: boolean;
  requiredManifest: string;
}

export abstract class PackageRegistry {
  static reader: ManifestReader;
  static registryType: string;

  /**
   * Infer whether this registry applies to the given package.
   * Must be called on a subclass (e.g., `NpmPackageRegistry.canInfer()`),
   * not on the base `PackageRegistry` class directly — the base class has
   * no `reader` or `registryType` assigned.
   */
  static async canInfer(
    _packagePath: string,
    _rootPath?: string,
  ): Promise<RegistryType | false> {
    // biome-ignore lint/complexity/noThisInStatic: `this` is intentional for polymorphic static dispatch — subclasses inherit this method and `this` resolves to the calling subclass
    const exists = await this.reader.exists(_packagePath);
    // biome-ignore lint/complexity/noThisInStatic: same as above
    return exists ? (this.registryType as RegistryType) : false;
  }

  constructor(
    public packageName: string,
    public packagePath: string,
    public registry?: string,
  ) {}

  abstract publish(): Promise<boolean>;
  abstract isPublished(): Promise<boolean>;
  abstract isVersionPublished(version: string): Promise<boolean>;
  abstract hasPermission(): Promise<boolean>;
  abstract isPackageNameAvailable(): Promise<boolean>;
  abstract distTags(): Promise<string[]>;
  abstract getRequirements(): RegistryRequirements;

  async dryRunPublish(): Promise<void> {}

  get supportsUnpublish(): boolean {
    return false;
  }

  async unpublish(_packageName: string, _version: string): Promise<void> {
    // Default no-op. Registries that support unpublish override this.
  }

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
