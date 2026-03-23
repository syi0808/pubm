import type { ResolvedPackageConfig } from "../config/types.js";
import type { Ecosystem } from "../ecosystem/ecosystem.js";

export async function writeVersionsForEcosystem(
  ecosystems: { eco: Ecosystem; pkg: ResolvedPackageConfig }[],
  versions: Map<string, string>,
  lockfileSync?: "required" | "optional" | "skip",
): Promise<string[]> {
  const modifiedFiles: string[] = [];

  // Phase 1: Write versions to manifests (path-keyed by pkg.path)
  for (const { eco, pkg } of ecosystems) {
    const version = versions.get(pkg.path);
    if (version) {
      await eco.writeVersion(version);
      // Invalidate ManifestReader cache
      for (const RegistryClass of eco.registryClasses()) {
        RegistryClass.reader.invalidate(eco.packagePath);
      }
    }
  }

  // Phase 2: Build name-keyed map for sibling dependency updates
  if (ecosystems.length > 1) {
    const nameKeyedVersions = new Map<string, string>();
    for (const { eco, pkg } of ecosystems) {
      const name = await eco.packageName();
      const version = versions.get(pkg.path);
      if (version) nameKeyedVersions.set(name, version);
    }
    await Promise.all(
      ecosystems.map(({ eco }) =>
        eco.updateSiblingDependencyVersions(nameKeyedVersions),
      ),
    );
  }

  // Phase 3: Sync lockfiles (deduplicated)
  const syncedLockfiles = new Set<string>();
  for (const { eco } of ecosystems) {
    const lockfilePath = await eco.syncLockfile(lockfileSync);
    if (lockfilePath && !syncedLockfiles.has(lockfilePath)) {
      syncedLockfiles.add(lockfilePath);
      modifiedFiles.push(lockfilePath);
    }
  }

  return modifiedFiles;
}
