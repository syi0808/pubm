import type { PackageConfig } from "../config/types.js";
import type { RegistryType } from "../types/options.js";

interface RegistrySource {
  packages?: PackageConfig[];
}

export function collectRegistries(ctx: RegistrySource): RegistryType[] {
  if (ctx.packages?.length) {
    const seen = new Set<string>();
    const result: RegistryType[] = [];
    for (const pkg of ctx.packages) {
      for (const reg of (pkg.registries ?? []) as RegistryType[]) {
        if (!seen.has(reg)) {
          seen.add(reg);
          result.push(reg);
        }
      }
    }
    return result;
  }
  return [];
}
