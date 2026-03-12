import type { PackageConfig } from "../config/types.js";
import type { RegistryType } from "../types/options.js";

type EcosystemKey = "js" | "rust";

interface RegistrySource {
  packages?: PackageConfig[];
  registries: RegistryType[];
}

export interface RegistryGroup {
  registry: RegistryType;
  packagePaths: string[];
}

export interface EcosystemGroup {
  ecosystem: EcosystemKey;
  registries: RegistryGroup[];
}

const registryEcosystemMap: Record<string, EcosystemKey> = {
  npm: "js",
  jsr: "js",
  crates: "rust",
};

function resolveEcosystem(
  registry: RegistryType,
  fallback?: PackageConfig["ecosystem"],
): EcosystemKey {
  return registryEcosystemMap[registry] ?? fallback ?? "js";
}

function dedupeRegistries(registries: RegistryType[]): RegistryType[] {
  const seen = new Set<RegistryType>();
  return registries.filter((registry) => {
    if (seen.has(registry)) {
      return false;
    }

    seen.add(registry);
    return true;
  });
}

export function ecosystemLabel(ecosystem: EcosystemKey): string {
  switch (ecosystem) {
    case "rust":
      return "Rust ecosystem";
    case "js":
    default:
      return "JavaScript ecosystem";
  }
}

export function registryLabel(registry: RegistryType): string {
  switch (registry) {
    case "npm":
      return "npm";
    case "jsr":
      return "jsr";
    case "crates":
      return "crates.io";
    default:
      return registry;
  }
}

export function collectEcosystemRegistryGroups(
  source: RegistrySource,
): EcosystemGroup[] {
  const ecosystems = new Map<EcosystemKey, Map<RegistryType, Set<string>>>();

  const ensureRegistrySet = (
    ecosystem: EcosystemKey,
    registry: RegistryType,
  ): Set<string> => {
    let registryMap = ecosystems.get(ecosystem);
    if (!registryMap) {
      registryMap = new Map<RegistryType, Set<string>>();
      ecosystems.set(ecosystem, registryMap);
    }

    let paths = registryMap.get(registry);
    if (!paths) {
      paths = new Set<string>();
      registryMap.set(registry, paths);
    }

    return paths;
  };

  if (source.packages?.length) {
    for (const pkg of source.packages) {
      for (const registry of dedupeRegistries(pkg.registries)) {
        ensureRegistrySet(
          resolveEcosystem(registry, pkg.ecosystem),
          registry,
        ).add(pkg.path);
      }
    }
  } else {
    for (const registry of dedupeRegistries(source.registries)) {
      ensureRegistrySet(resolveEcosystem(registry), registry);
    }
  }

  return [...ecosystems.entries()].map(([ecosystem, registries]) => ({
    ecosystem,
    registries: [...registries.entries()].map(([registry, packagePaths]) => ({
      registry,
      packagePaths: [...packagePaths],
    })),
  }));
}

export function countRegistryTargets(groups: EcosystemGroup[]): number {
  return groups.reduce((count, group) => count + group.registries.length, 0);
}
