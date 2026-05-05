import path from "node:path";
import micromatch from "micromatch";
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
  ReleasePullRequestConfig,
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

const defaultRelease = {
  versioning: {
    mode: "independent" as const,
    fixed: [] as string[][],
    linked: [] as string[][],
    updateInternalDependencies: "patch" as const,
  },
  changesets: {
    directory: ".pubm/changesets",
  },
  commits: {
    format: "conventional" as const,
    types: {} as Record<string, BumpType | false>,
  },
  changelog: true as boolean | string,
};

const defaultReleasePullRequest = {
  branchTemplate: "pubm/release/{scopeSlug}",
  titleTemplate: "chore(release): {scope} {version}",
  label: "pubm:release-pr",
  bumpLabels: {
    patch: "release:patch",
    minor: "release:minor",
    major: "release:major",
    prerelease: "release:prerelease",
  },
  unversionedChanges: "warn" as const,
};

const defaultConfig = {
  branch: "main",
  commit: false,
  access: "public" as const,
  ignore: [] as string[],
  snapshotTemplate: "{tag}-{timestamp}",
  tag: "latest",
  contents: ".",
  saveToken: true,
  releaseDraft: true,
  releaseNotes: true,
  lockfileSync: "optional" as const,
  release: defaultRelease,
  registryQualifiedTags: false,
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
      const configPkg = configPackages?.find((cp) => {
        const normalized = cp.path.replace(/\\/g, "/");
        const pkgPathForward = pkg.path.replace(/\\/g, "/");
        if (micromatch.scan(normalized).isGlob) {
          return micromatch.isMatch(pkgPathForward, normalized);
        }
        return path.normalize(cp.path) === pkg.path;
      });
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

  const release = resolveReleaseConfig(config.release);
  const configWithoutLegacyReleaseKeys = {
    ...(config as PubmConfig & Record<string, unknown>),
  };
  delete configWithoutLegacyReleaseKeys.versionSources;
  delete configWithoutLegacyReleaseKeys.conventionalCommits;
  delete configWithoutLegacyReleaseKeys.releasePr;
  delete configWithoutLegacyReleaseKeys.changelogFormat;

  return {
    ...defaultConfig,
    ...configWithoutLegacyReleaseKeys,
    packages,
    validate: { ...defaultValidate, ...config.validate },
    rollback: {
      ...defaultRollback,
      ...(config.rollbackStrategy ? { strategy: config.rollbackStrategy } : {}),
      ...config.rollback,
    },
    snapshotTemplate: config.snapshotTemplate ?? defaultConfig.snapshotTemplate,
    ecosystems: config.ecosystems ?? {},
    release,
    versioning: release.versioning.mode,
    fixed: release.versioning.fixed,
    linked: release.versioning.linked,
    updateInternalDependencies: release.versioning.updateInternalDependencies,
    changelog: release.changelog,
    plugins: config.plugins ?? [],
    ...(discoveryEmpty ? { discoveryEmpty } : {}),
  };
}

function resolveReleaseConfig(config: PubmConfig["release"] | undefined) {
  const versioning = {
    ...defaultRelease.versioning,
    ...config?.versioning,
    fixed: cloneReleaseGroups(
      config?.versioning?.fixed ?? defaultRelease.versioning.fixed,
    ),
    linked: cloneReleaseGroups(
      config?.versioning?.linked ?? defaultRelease.versioning.linked,
    ),
  };

  return {
    versioning,
    changesets: {
      ...defaultRelease.changesets,
      ...config?.changesets,
    },
    commits: {
      ...defaultRelease.commits,
      ...config?.commits,
      types: {
        ...(config?.commits?.types ?? defaultRelease.commits.types),
      },
    },
    changelog: config?.changelog ?? defaultRelease.changelog,
    pullRequest: resolveReleasePullRequestConfig(config?.pullRequest, {
      versioning: versioning.mode,
      fixed: versioning.fixed,
      linked: versioning.linked,
    }),
  };
}

function cloneReleaseGroups(
  groups: readonly (readonly string[])[],
): string[][] {
  return groups.map((group) => [...group]);
}

function resolveReleasePullRequestConfig(
  config: ReleasePullRequestConfig | undefined,
  inherited: {
    versioning: "fixed" | "independent";
    fixed: string[][];
    linked: string[][];
  },
) {
  const fixed = config?.fixed ?? inherited.fixed;
  const linked = config?.linked ?? inherited.linked;
  const grouping =
    config?.grouping && config.grouping !== "inherit"
      ? config.grouping
      : inherited.versioning;

  return {
    branchTemplate:
      config?.branchTemplate ?? defaultReleasePullRequest.branchTemplate,
    titleTemplate:
      config?.titleTemplate ?? defaultReleasePullRequest.titleTemplate,
    label: config?.label ?? defaultReleasePullRequest.label,
    grouping,
    bumpLabels: {
      ...defaultReleasePullRequest.bumpLabels,
      ...config?.bumpLabels,
    },
    fixed: fixed.map((group) => [...group]),
    linked: linked.map((group) => [...group]),
    unversionedChanges:
      config?.unversionedChanges ??
      defaultReleasePullRequest.unversionedChanges,
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
