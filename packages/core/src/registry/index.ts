import type { RegistryType } from "../types/options.js";
import { registryCatalog } from "./catalog.js";
import type { RegistryConnector } from "./connector.js";
import { customPackageRegistry } from "./custom-registry.js";
import type { PackageRegistry } from "./package-registry.js";

export function getConnector(registryKey: RegistryType): RegistryConnector {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) {
    throw new Error(
      `Unknown registry: ${registryKey}. Cannot create connector.`,
    );
  }
  return descriptor.connector();
}

export async function getPackageRegistry(
  registryKey: RegistryType,
  packagePath: string,
): Promise<PackageRegistry> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) return await customPackageRegistry(packagePath);
  return await descriptor.factory(packagePath);
}

/** @deprecated Use getPackageRegistry */
export const getRegistry = getPackageRegistry;
