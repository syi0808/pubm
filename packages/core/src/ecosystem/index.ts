import { registryCatalog } from "../registry/catalog.js";
import type { RegistryType } from "../types/options.js";
import { ecosystemCatalog } from "./catalog.js";
import type { Ecosystem } from "./ecosystem.js";

export async function detectEcosystem(
  packagePath: string,
  registries?: RegistryType[],
): Promise<Ecosystem | null> {
  if (registries?.length) {
    const descriptor = registryCatalog.get(registries[0]);
    if (descriptor) {
      const ecoDescriptor = ecosystemCatalog.get(descriptor.ecosystem);
      if (ecoDescriptor) {
        return new ecoDescriptor.ecosystemClass(packagePath);
      }
    }
  }

  const detected = await ecosystemCatalog.detect(packagePath);
  if (detected) {
    return new detected.ecosystemClass(packagePath);
  }

  return null;
}

export { Ecosystem } from "./ecosystem.js";
export { JsEcosystem } from "./js.js";
export { RustEcosystem } from "./rust.js";
