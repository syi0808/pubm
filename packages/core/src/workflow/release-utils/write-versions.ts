import path from "node:path";
import type { PubmContext } from "../../context.js";
import { ecosystemCatalog } from "../../ecosystem/catalog.js";
import { writeVersionsForEcosystem } from "../../manifest/write-versions.js";

export async function writeVersions(
  ctx: PubmContext,
  versions: Map<string, string>,
): Promise<string[]> {
  const ecosystems = ctx.config.packages.map((pkg) => {
    const absPath = path.resolve(ctx.cwd, pkg.path);
    const descriptor = ecosystemCatalog.get(pkg.ecosystem);
    if (!descriptor) throw new Error(`Unknown ecosystem: ${pkg.ecosystem}`);
    const eco = new descriptor.ecosystemClass(absPath);
    return { eco, pkg };
  });

  const lockfileChanges = await writeVersionsForEcosystem(
    ecosystems,
    versions,
    ctx.config.lockfileSync,
  );

  // Collect manifest file paths for git staging
  const manifestFiles = ecosystems.flatMap(({ eco }) =>
    eco.manifestFiles().map((f) => path.resolve(eco.packagePath, f)),
  );

  return [...manifestFiles, ...lockfileChanges];
}
