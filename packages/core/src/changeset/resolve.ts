import type { EcosystemKey } from "../ecosystem/catalog.js";
import { packageKey } from "../utils/package-key.js";

export function createKeyResolver(
  packages: { name: string; path: string; ecosystem: EcosystemKey }[],
): (key: string) => string {
  const validKeys = new Set(packages.map((p) => packageKey(p)));
  const pathEcosystems = new Map<string, EcosystemKey[]>();
  const nameEcosystems = new Map<string, EcosystemKey[]>();
  for (const p of packages) {
    const existingPath = pathEcosystems.get(p.path) ?? [];
    existingPath.push(p.ecosystem);
    pathEcosystems.set(p.path, existingPath);

    const existingName = nameEcosystems.get(p.name) ?? [];
    existingName.push(p.ecosystem);
    nameEcosystems.set(p.name, existingName);
  }

  return (key: string): string => {
    if (validKeys.has(key)) return key;
    const nameEcos = nameEcosystems.get(key);
    if (nameEcos) {
      if (nameEcos.length === 1) {
        const pkg = packages.find((p) => p.name === key);
        if (pkg) return packageKey(pkg);
      }
      throw new Error(
        `Ambiguous changeset key "${key}": name is shared across ecosystems (${nameEcos.join(", ")}). ` +
          `Use the path::ecosystem format to specify.`,
      );
    }
    const ecosystems = pathEcosystems.get(key);
    if (ecosystems) {
      if (ecosystems.length === 1) {
        return `${key}::${ecosystems[0]}`;
      }
      throw new Error(
        `Ambiguous changeset key "${key}": directory contains multiple ecosystems (${ecosystems.join(", ")}). ` +
          `Use "${key}::${ecosystems[0]}" or "${key}::${ecosystems[1]}" to specify.`,
      );
    }
    return key;
  };
}
