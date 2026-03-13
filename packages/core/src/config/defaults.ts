import { discoverPackages } from "../monorepo/discover.js";
import {
  registerPrivateRegistry,
  registryCatalog,
} from "../registry/catalog.js";
import type {
  PrivateRegistryConfig,
  PubmConfig,
  ResolvedPubmConfig,
  ValidateConfig,
} from "./types.js";

const defaultValidate: Required<ValidateConfig> = {
  cleanInstall: true,
  entryPoints: true,
  extraneousFiles: true,
};

const defaultConfig = {
  versioning: "independent" as const,
  branch: "main",
  changelog: true as boolean | string,
  changelogFormat: "default" as string,
  commit: false,
  access: "public" as const,
  fixed: [] as string[][],
  linked: [] as string[][],
  updateInternalDependencies: "patch" as const,
  ignore: [] as string[],
  snapshotTemplate: "{tag}-{timestamp}",
  tag: "latest",
  contents: ".",
  saveToken: true,
  releaseDraft: true,
  releaseNotes: true,
  rollbackStrategy: "individual" as const,
};

export async function resolveConfig(
  config: PubmConfig,
  cwd?: string,
): Promise<ResolvedPubmConfig> {
  let packages: PubmConfig["packages"];
  let discoveryEmpty: boolean | undefined;

  if (config.packages) {
    // Explicit packages: normalize registries
    packages = config.packages.map((pkg) => {
      if (!pkg.registries) return pkg;
      const normalizedRegistries = pkg.registries.map((entry) => {
        if (typeof entry === "string") return entry;
        const ecosystemKey = resolveEcosystemKey(pkg, entry);
        return registerPrivateRegistry(entry, ecosystemKey);
      });
      return { ...pkg, registries: normalizedRegistries };
    });
  } else {
    // Auto-discover packages
    const resolvedCwd = cwd ?? process.cwd();
    const discovered = await discoverPackages({ cwd: resolvedCwd });

    if (discovered.length === 0) {
      discoveryEmpty = true;
      packages = [];
    } else {
      packages = discovered.map((d) => ({
        path: d.path,
        registries: d.registries,
        ecosystem: d.ecosystem,
      }));
    }
  }

  return {
    ...defaultConfig,
    ...config,
    packages,
    validate: { ...defaultValidate, ...config.validate },
    snapshotTemplate: config.snapshotTemplate ?? defaultConfig.snapshotTemplate,
    plugins: config.plugins ?? [],
    ...(discoveryEmpty ? { discoveryEmpty } : {}),
  };
}

function resolveEcosystemKey(
  pkg: { ecosystem?: string; registries?: (string | PrivateRegistryConfig)[] },
  _entry: PrivateRegistryConfig,
): string {
  if (pkg.ecosystem) return pkg.ecosystem;

  const firstStringRegistry = pkg.registries?.find(
    (r): r is string => typeof r === "string",
  );
  if (firstStringRegistry) {
    const descriptor = registryCatalog.get(firstStringRegistry);
    if (descriptor) return descriptor.ecosystem;
  }

  return "js";
}
