import { discoverPackages } from "../monorepo/discover.js";
import {
  registerPrivateRegistry,
  registryCatalog,
} from "../registry/catalog.js";
import type { RegistryType } from "../types/options.js";
import type {
  PrivateRegistryConfig,
  PubmConfig,
  ResolvedPackageConfig,
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
  lockfileSync: "optional" as const,
};

export async function resolveConfig(
  config: PubmConfig,
  cwd?: string,
): Promise<ResolvedPubmConfig> {
  const resolvedCwd = cwd ?? process.cwd();
  let discoveryEmpty: boolean | undefined;

  // Normalize private registries in config packages before passing to discover
  const configPackages = config.packages?.map((pkg) => {
    if (!pkg.registries) return pkg;
    const normalizedRegistries = pkg.registries.map((entry) => {
      if (typeof entry === "string") return entry;
      const ecosystemKey = resolveEcosystemKey(pkg, entry);
      return registerPrivateRegistry(entry, ecosystemKey);
    });
    return { ...pkg, registries: normalizedRegistries };
  });

  const discovered = await discoverPackages({
    cwd: resolvedCwd,
    configPackages,
    ignore: config.ignore,
  });

  let packages: ResolvedPackageConfig[];
  if (discovered.length === 0 && !config.packages) {
    discoveryEmpty = true;
    packages = [];
  } else {
    packages = discovered.map((pkg) => ({
      path: pkg.path,
      name: pkg.name,
      version: pkg.version,
      dependencies: pkg.dependencies,
      ecosystem: pkg.ecosystem as "js" | "rust",
      registries: pkg.registries as RegistryType[],
      ...(pkg.registryVersions
        ? { registryVersions: pkg.registryVersions }
        : {}),
    }));
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
