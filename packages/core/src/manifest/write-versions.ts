import type { ResolvedPackageConfig } from "../config/types.js";
import type { Ecosystem } from "../ecosystem/ecosystem.js";

export async function writeVersionsForEcosystem(
  ecosystems: { eco: Ecosystem; pkg: ResolvedPackageConfig }[],
  versions: Map<string, string>,
): Promise<string[]> {
  const modifiedFiles: string[] = [];

  // Phase 1: Write versions to manifests (path-keyed)
  for (const { eco } of ecosystems) {
    const version = versions.get(eco.packagePath);
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
    for (const { eco } of ecosystems) {
      const name = await eco.packageName();
      const version = versions.get(eco.packagePath);
      if (version) nameKeyedVersions.set(name, version);
    }
    await Promise.all(
      ecosystems.map(({ eco }) =>
        eco.updateSiblingDependencyVersions(nameKeyedVersions),
      ),
    );
  }

  // Phase 3: Sync lockfiles
  for (const { eco } of ecosystems) {
    const lockfilePath = await eco.syncLockfile();
    if (lockfilePath) modifiedFiles.push(lockfilePath);
  }

  return modifiedFiles;
}
