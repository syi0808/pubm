import type { EcosystemKey } from "../ecosystem/catalog.js";
import { packageKey } from "../utils/package-key.js";

export function createKeyResolver(
  packages: { name: string; path: string; ecosystem: EcosystemKey }[],
): (key: string) => string {
  const nameToKey = new Map(
    packages.map((p) => [p.name, packageKey(p)]),
  );
  const validKeys = new Set(packages.map((p) => packageKey(p)));
  const pathEcosystems = new Map<string, EcosystemKey[]>();
  for (const p of packages) {
    const existing = pathEcosystems.get(p.path) ?? [];
    existing.push(p.ecosystem);
    pathEcosystems.set(p.path, existing);
  }

  return (key: string): string => {
    if (validKeys.has(key)) return key;
    const fromName = nameToKey.get(key);
    if (fromName) return fromName;
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
