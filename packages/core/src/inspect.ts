import type { ResolvedPubmConfig } from "./config/types.js";
import { ecosystemCatalog } from "./ecosystem/catalog.js";
import { detectWorkspace } from "./monorepo/workspace.js";
import { registryCatalog } from "./registry/catalog.js";

export interface InspectPackagesResult {
  ecosystem: string;
  workspace: {
    type: string;
    monorepo: boolean;
  };
  packages: Array<{
    name: string;
    version: string;
    path: string;
    registries: string[];
  }>;
}

function inferEcosystem(registries: string[]): string {
  const ecosystems = new Set<string>();
  for (const reg of registries) {
    const descriptor = registryCatalog.get(reg);
    if (descriptor) {
      const ecoDesc = ecosystemCatalog.get(descriptor.ecosystem);
      ecosystems.add(ecoDesc?.label ?? descriptor.ecosystem);
    }
  }
  const list = [...ecosystems];
  return list.length > 0 ? list.join(", ") : "unknown";
}

export function inspectPackages(
  config: ResolvedPubmConfig,
  cwd: string,
): InspectPackagesResult {
  const workspaces = detectWorkspace(cwd);

  const ecosystems = new Set<string>();
  const packages = config.packages.map((pkg) => {
    ecosystems.add(inferEcosystem(pkg.registries));
    return {
      name: pkg.name,
      version: pkg.version,
      path: pkg.path,
      registries: [...pkg.registries],
    };
  });

  const ecosystemList = [...ecosystems].filter((e) => e !== "unknown");
  const ecosystem =
    ecosystemList.length > 0 ? ecosystemList.join(", ") : "unknown";

  return {
    ecosystem,
    workspace: {
      type: workspaces.length > 0 ? workspaces[0].type : "single",
      monorepo: workspaces.length > 0,
    },
    packages,
  };
}
