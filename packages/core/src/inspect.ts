import type { ResolvedPubmConfig } from "./config/types.js";
import { detectWorkspace } from "./monorepo/workspace.js";

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
  if (registries.some((r) => r === "npm" || r === "jsr")) return "javascript";
  if (registries.includes("crates")) return "rust";
  return "unknown";
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
