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

export function resolveConfig(config: PubmConfig): ResolvedPubmConfig {
  if (config.registries) {
    console.warn(
      '[pubm] The global "registries" field is deprecated. Registries are now inferred from manifest files or specified per-package in the "packages" array.',
    );
  }

  const { registries: _ignored, ...configWithoutRegistries } = config;
  const packages = (config.packages ?? [{ path: "." }]).map((pkg) => {
    if (!pkg.registries) return pkg;

    const normalizedRegistries = pkg.registries.map((entry) => {
      if (typeof entry === "string") return entry;

      const ecosystemKey = resolveEcosystemKey(pkg, entry);
      return registerPrivateRegistry(entry, ecosystemKey);
    });

    return { ...pkg, registries: normalizedRegistries };
  });

  return {
    ...defaultConfig,
    ...configWithoutRegistries,
    packages,
    validate: { ...defaultValidate, ...config.validate },
    snapshotTemplate: config.snapshotTemplate ?? defaultConfig.snapshotTemplate,
    plugins: config.plugins ?? [],
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
