import type { RegistryType } from "../types/options.js";
import type { EcosystemKey } from "./catalog.js";

export async function inferRegistries(
  packagePath: string,
  ecosystemKey: EcosystemKey,
  rootPath?: string,
): Promise<RegistryType[]> {
  // Dynamic import to avoid circular dependency:
  // catalog.ts -> js.ts -> npm.ts -> registry/catalog.ts -> custom-registry.ts -> npm.ts
  const { ecosystemCatalog } = await import("./catalog.js");

  const descriptor = ecosystemCatalog.get(ecosystemKey);
  if (!descriptor) return [];

  const ecosystem = new descriptor.ecosystemClass(packagePath);
  const registries: RegistryType[] = [];

  for (const RegistryClass of ecosystem.registryClasses()) {
    const result = await RegistryClass.canInfer(packagePath, rootPath);
    if (result) registries.push(result);
  }

  return registries;
}
