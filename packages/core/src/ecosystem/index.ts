import { ecosystemCatalog } from "./catalog.js";
import type { Ecosystem } from "./ecosystem.js";

/**
 * Detects the ecosystem for a single package path, returning only the first
 * detected ecosystem. This is a convenience API for single-ecosystem packages.
 * For packages that may belong to multiple ecosystems, use
 * `ecosystemCatalog.detectAll()` instead.
 */
export async function detectEcosystem(
  packagePath: string,
): Promise<Ecosystem | null> {
  const detected = await ecosystemCatalog.detectAll(packagePath);
  if (detected.length > 0) {
    return new detected[0].ecosystemClass(packagePath);
  }

  return null;
}

export { Ecosystem } from "./ecosystem.js";
export { JsEcosystem } from "./js.js";
export { RustEcosystem } from "./rust.js";
