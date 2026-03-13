import { ecosystemCatalog } from "./catalog.js";
import type { Ecosystem } from "./ecosystem.js";

export async function detectEcosystem(
  packagePath: string,
): Promise<Ecosystem | null> {
  const detected = await ecosystemCatalog.detect(packagePath);
  if (detected) {
    return new detected.ecosystemClass(packagePath);
  }

  return null;
}

export { Ecosystem } from "./ecosystem.js";
export { JsEcosystem } from "./js.js";
export { RustEcosystem } from "./rust.js";
