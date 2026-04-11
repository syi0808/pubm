import { ecosystemCatalog } from "./catalog.js";
import type { Ecosystem } from "./ecosystem.js";

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
