import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
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

  /** Override to customize the error name shown in formatted output. */
  protected get registryErrorName(): string {
    return "Registry Error";
  }

  protected createRegistryError(
    message: string,
    options?: { cause?: unknown },
  ): AbstractError {
    const err = new AbstractError(message, options);
    err.name = this.registryErrorName;
    return err;
  }

  /** Build the URL to check if a package exists on this registry. */
  protected abstract buildPackageUrl(): string;

  /** Build the URL to check if a specific version is published. */
  protected abstract buildVersionUrl(version: string): string;

  /** Override in subclasses that need custom headers for fetch. */
  protected fetchHeaders(): Record<string, string> | undefined {
    return undefined;
  }

  abstract publish(): Promise<boolean>;

  async isPublished(): Promise<boolean> {
    const headers = this.fetchHeaders();
    try {
      const response = await fetch(
        this.buildPackageUrl(),
        headers ? { headers } : undefined,
      );
      return response.status === 200;
    } catch (error) {
      throw this.createRegistryError(
        `Failed to fetch \`${this.buildPackageUrl()}\``,
        { cause: error },
      );
    }
  }

  async isVersionPublished(version: string): Promise<boolean> {
    if (!version) return false;
    const headers = this.fetchHeaders();
    try {
      const response = await fetch(
        this.buildVersionUrl(version),
        headers ? { headers } : undefined,
      );
      return response.status === 200;
    } catch (error) {
      throw this.createRegistryError(
        `Failed to fetch \`${this.buildVersionUrl(version)}\``,
        { cause: error },
      );
    }
  }

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
