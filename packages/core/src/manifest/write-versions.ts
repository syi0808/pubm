import type { ResolvedPackageConfig } from "../config/types.js";
import type { Ecosystem } from "../ecosystem/ecosystem.js";

export async function writeVersionsForEcosystem(
  ecosystems: { eco: Ecosystem; pkg: ResolvedPackageConfig }[],
  versions: Map<string, string>,
): Promise<string[]> {
  const modifiedFiles: string[] = [];

  // Phase 1: Write versions to manifests
  for (const { eco } of ecosystems) {
    const name = await eco.packageName();
    const version = versions.get(name);
    if (version) {
      await eco.writeVersion(version);
      // Invalidate ManifestReader cache
      for (const RegistryClass of eco.registryClasses()) {
        RegistryClass.reader.invalidate(eco.packagePath);
      }
    }
  }

  // Phase 2: Update sibling dependency versions (only for multi-package)
  if (ecosystems.length > 1) {
    await Promise.all(
      ecosystems.map(({ eco }) =>
        eco.updateSiblingDependencyVersions(versions),
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
