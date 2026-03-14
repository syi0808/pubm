import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface PackageManifest {
  name: string;
  version: string;
  private: boolean;
  dependencies: string[];
}

export interface ManifestSchema {
  file: string;
  parser: (raw: string) => Record<string, unknown>;
  fields: {
    name: (parsed: Record<string, unknown>) => string;
    version: (parsed: Record<string, unknown>) => string;
    private: (parsed: Record<string, unknown>) => boolean;
    dependencies: (parsed: Record<string, unknown>) => string[];
  };
}

export class ManifestReader {
  private cache = new Map<string, PackageManifest>();

  constructor(private schema: ManifestSchema) {}

  async read(packagePath: string): Promise<PackageManifest> {
    const cached = this.cache.get(packagePath);
    if (cached) return cached;

    const raw = await readFile(join(packagePath, this.schema.file), "utf-8");
    const parsed = this.schema.parser(raw);
    const manifest: PackageManifest = {
      name: this.schema.fields.name(parsed),
      version: this.schema.fields.version(parsed),
      private: this.schema.fields.private(parsed),
      dependencies: this.schema.fields.dependencies(parsed),
    };

    this.cache.set(packagePath, manifest);
    return manifest;
  }

  async exists(packagePath: string): Promise<boolean> {
    try {
      const s = await stat(join(packagePath, this.schema.file));
      return s.isFile();
    } catch {
      return false;
    }
  }

  invalidate(packagePath: string): void {
    this.cache.delete(packagePath);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
