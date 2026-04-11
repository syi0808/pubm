import type { ResolvedPackageConfig } from "../config/types.js";
import type { EcosystemKey } from "../ecosystem/catalog.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { t } from "../i18n/index.js";
import { registryCatalog } from "../registry/catalog.js";
import type { RegistryType } from "../types/options.js";
import { packageKey } from "../utils/package-key.js";

interface RegistrySource {
  packages?: ResolvedPackageConfig[];
}

export interface RegistryGroup {
  registry: RegistryType;
  packageKeys: string[];
}

export interface EcosystemGroup {
  ecosystem: EcosystemKey;
  registries: RegistryGroup[];
}

function resolveEcosystem(
  registry: RegistryType,
  fallback?: ResolvedPackageConfig["ecosystem"],
): EcosystemKey {
  const descriptor = registryCatalog.get(registry);
  return descriptor?.ecosystem ?? fallback ?? "js";
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
  const label = ecosystemCatalog.get(ecosystem)?.label ?? ecosystem;
  return t("task.grouping.ecosystem", { label });
}

export function registryLabel(registry: RegistryType): string {
  return registryCatalog.get(registry)?.label ?? registry;
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
        ).add(packageKey(pkg));
      }
    }
  }

  return [...ecosystems.entries()].map(([ecosystem, registries]) => ({
    ecosystem,
    registries: [...registries.entries()].map(([registry, packageKeys]) => ({
      registry,
      packageKeys: [...packageKeys],
    })),
  }));
}

export function countRegistryTargets(groups: EcosystemGroup[]): number {
  return groups.reduce((count, group) => count + group.registries.length, 0);
}
