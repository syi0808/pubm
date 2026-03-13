import type { RegistryType } from "../types/options.js";
import { registryCatalog } from "./catalog.js";
import { customRegistry } from "./custom-registry.js";
import type { Registry } from "./registry.js";

export async function getRegistry(
  registryKey: RegistryType,
  packageName?: string,
): Promise<Registry> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) return await customRegistry();
  return await descriptor.factory(packageName);
}
