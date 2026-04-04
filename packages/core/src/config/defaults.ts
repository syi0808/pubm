import path from "node:path";
import type { BumpType } from "../changeset/parser.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { t } from "../i18n/index.js";
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
  RollbackConfig,
  ValidateConfig,
} from "./types.js";

const defaultValidate: Required<ValidateConfig> = {
  cleanInstall: true,
  entryPoints: true,
  extraneousFiles: true,
};

const defaultRollback: Required<RollbackConfig> = {
  strategy: "individual",
  dangerouslyAllowUnpublish: false,
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
  createPr: false,
  lockfileSync: "optional" as const,
  versionSources: "all" as const,
  conventionalCommits: { types: {} as Record<string, BumpType | false> },
};

export async function resolveConfig(
  config: PubmConfig,
  cwd?: string,
): Promise<ResolvedPubmConfig> {
  const resolvedCwd = cwd ?? process.cwd();
  let discoveryEmpty: boolean | undefined;

  // Validate explicit ecosystem keys against catalog
  if (config.packages) {
    for (const pkg of config.packages) {
      if (pkg.ecosystem && !ecosystemCatalog.get(pkg.ecosystem)) {
        throw new Error(
          t("error.config.unknownEcosystem", {
            ecosystem: pkg.ecosystem,
            list: ecosystemCatalog
              .all()
              .map((d) => d.key)
              .join(", "),
          }),
        );
      }
    }
  }

  if (config.ecosystems) {
    for (const key of Object.keys(config.ecosystems)) {
      if (!ecosystemCatalog.get(key)) {
        throw new Error(
          t("error.config.unknownEcosystem", {
            ecosystem: key,
            list: ecosystemCatalog
              .all()
              .map((d) => d.key)
              .join(", "),
          }),
        );
      }
    }
  }

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
    packages = discovered.map((pkg) => {
      const configPkg = configPackages?.find(
        (cp) => path.normalize(cp.path) === pkg.path,
      );
      return {
        path: pkg.path,
        name: pkg.name,
        version: pkg.version,
        dependencies: pkg.dependencies,
        ecosystem: pkg.ecosystem,
        registries: pkg.registries as RegistryType[],
        ...(pkg.registryVersions
          ? { registryVersions: pkg.registryVersions }
          : {}),
        ...(configPkg?.testScript ? { testScript: configPkg.testScript } : {}),
        ...(configPkg?.testCommand
          ? { testCommand: configPkg.testCommand }
          : {}),
        ...(configPkg?.buildScript
          ? { buildScript: configPkg.buildScript }
          : {}),
        ...(configPkg?.buildCommand
          ? { buildCommand: configPkg.buildCommand }
          : {}),
      };
    });
  }

  return {
    ...defaultConfig,
    ...config,
    packages,
    validate: { ...defaultValidate, ...config.validate },
    rollback: {
      ...defaultRollback,
      ...(config.rollbackStrategy ? { strategy: config.rollbackStrategy } : {}),
      ...config.rollback,
    },
    snapshotTemplate: config.snapshotTemplate ?? defaultConfig.snapshotTemplate,
    ecosystems: config.ecosystems ?? {},
    plugins: config.plugins ?? [],
    versionSources: config.versionSources ?? defaultConfig.versionSources,
    conventionalCommits: {
      types: config.conventionalCommits?.types ?? {},
    },
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

  throw new Error(t("error.config.cannotInferEcosystem"));
}
