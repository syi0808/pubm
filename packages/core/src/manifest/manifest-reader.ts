import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface PackageManifest {
  name: string;
  version: string;
  private: boolean;
  dependencies: string[];
}

export interface ConsistencyResult {
  resolved: PackageManifest;
  errors: string[];
  warnings: string[];
}

export interface ManifestSchema<
  F extends string | string[] = string | string[],
  P = Record<string, unknown>,
> {
  file: F;
  parser: (filename: string, content: string) => P;
  fields: {
    name: (parsed: P) => string;
    version: (parsed: P) => string;
    private: (parsed: P) => boolean;
    dependencies: (parsed: P) => string[];
  };
  validate?: (manifests: Map<string, PackageManifest>) => ConsistencyResult;
}

export class ManifestReader<
  F extends string | string[] = string | string[],
  P = Record<string, unknown>,
> {
  private cache = new Map<string, PackageManifest>();

  constructor(private schema: ManifestSchema<F, P>) {}

  private get files(): string[] {
    return Array.isArray(this.schema.file)
      ? this.schema.file
      : [this.schema.file];
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const s = await stat(filePath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  private parseFile(filename: string, content: string): PackageManifest {
    const parsed = this.schema.parser(filename, content);
    return {
      name: this.schema.fields.name(parsed),
      version: this.schema.fields.version(parsed),
      private: this.schema.fields.private(parsed),
      dependencies: this.schema.fields.dependencies(parsed),
    };
  }

  async read(packagePath: string): Promise<PackageManifest> {
    const cached = this.cache.get(packagePath);
    if (cached) return cached;

    for (const file of this.files) {
      const filePath = join(packagePath, file);
      if (await this.fileExists(filePath)) {
        const raw = await readFile(filePath, "utf-8");
        const manifest = this.parseFile(file, raw);
        this.cache.set(packagePath, manifest);
        return manifest;
      }
    }

    throw new Error(
      `No manifest file found in ${packagePath} (looked for: ${this.files.join(", ")})`,
    );
  }

  async readAll(packagePath: string): Promise<Map<string, PackageManifest>> {
    const result = new Map<string, PackageManifest>();

    for (const file of this.files) {
      const filePath = join(packagePath, file);
      if (await this.fileExists(filePath)) {
        const raw = await readFile(filePath, "utf-8");
        result.set(file, this.parseFile(file, raw));
      }
    }

    return result;
  }

  async exists(packagePath: string): Promise<boolean> {
    for (const file of this.files) {
      if (await this.fileExists(join(packagePath, file))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validate consistency across all existing manifest files.
   * Assumes at least one file exists — callers should check `exists()` first.
   * When no files are found, returns an error to prevent silent success.
   */
  async validate(packagePath: string): Promise<ConsistencyResult> {
    const manifests = await this.readAll(packagePath);

    if (manifests.size === 0) {
      return {
        resolved: { name: "", version: "", private: false, dependencies: [] },
        errors: [
          `No manifest file found in ${packagePath} (looked for: ${this.files.join(", ")})`,
        ],
        warnings: [],
      };
    }

    if (!this.schema.validate || manifests.size <= 1) {
      const resolved = manifests.values().next().value!;
      return { resolved, errors: [], warnings: [] };
    }

    return this.schema.validate(manifests);
  }

  invalidate(packagePath: string): void {
    this.cache.delete(packagePath);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
