import type { ResolvedPackageConfig } from "../config/types.js";

export function createKeyResolver(
  packages: Pick<ResolvedPackageConfig, "name" | "path">[],
): (key: string) => string {
  const nameToPath = new Map(packages.map((p) => [p.name, p.path]));
  const validPaths = new Set(packages.map((p) => p.path));

  return (key: string): string => {
    if (validPaths.has(key)) return key;
    const resolved = nameToPath.get(key);
    if (resolved) return resolved;
    return key;
  };
}
