import type { CompressOption, ReleaseAssetEntry } from "../assets/types.js";
import type { BumpType } from "../changeset/parser.js";
import type { EcosystemKey } from "../ecosystem/catalog.js";
import type { PubmPlugin } from "../plugin/types.js";
import type { RegistryType } from "../types/options.js";

export interface PrivateRegistryConfig {
  url: string;
  token: { envVar: string };
}

export interface EcosystemConfig {
  testScript?: string;
  testCommand?: string;
  buildScript?: string;
  buildCommand?: string;
}

export interface PackageConfig {
  path: string;
  registries?: (RegistryType | PrivateRegistryConfig)[];
  ecosystem?: string;
  testScript?: string;
  testCommand?: string;
  buildScript?: string;
  buildCommand?: string;
}

export interface ResolvedPackageConfig
  extends Omit<PackageConfig, "registries" | "ecosystem"> {
  name: string;
  version: string;
  dependencies: string[];
  registries: RegistryType[];
  ecosystem: EcosystemKey;
  registryVersions?: Map<RegistryType, string>;
}

export interface ValidateConfig {
  cleanInstall?: boolean;
  entryPoints?: boolean;
  extraneousFiles?: boolean;
}

export interface RollbackConfig {
  /** @default "individual" */
  strategy?: "individual" | "all";
  /** Allow registry unpublish/yank during rollback in non-TTY environments. @default false */
  dangerouslyAllowUnpublish?: boolean;
}

export interface ReleasePrBumpLabelsConfig {
  patch?: string;
  minor?: string;
  major?: string;
  prerelease?: string;
}

export interface ReleasePrConfig {
  enabled?: boolean;
  dryRun?: boolean;
  branchTemplate?: string;
  titleTemplate?: string;
  label?: string;
  bumpLabels?: ReleasePrBumpLabelsConfig;
  grouping?: "auto" | "single" | "independent";
}

export interface ResolvedReleasePrConfig {
  enabled: boolean;
  dryRun: boolean;
  branchTemplate: string;
  titleTemplate: string;
  label: string;
  bumpLabels: Required<ReleasePrBumpLabelsConfig>;
  grouping: "auto" | "single" | "independent";
}

export interface PubmConfig {
  versioning?: "independent" | "fixed";
  branch?: string;
  packages?: PackageConfig[];
  changelog?: boolean | string;
  changelogFormat?: "default" | "github" | string;
  commit?: boolean;
  access?: "public" | "restricted";
  fixed?: string[][];
  linked?: string[][];
  updateInternalDependencies?: "patch" | "minor";
  ignore?: string[];
  validate?: ValidateConfig;
  snapshotTemplate?: string;
  tag?: string;
  contents?: string;
  saveToken?: boolean;
  releaseDraft?: boolean;
  releaseNotes?: boolean;
  releasePr?: ReleasePrConfig;
  /** @deprecated Use `rollback.strategy` instead. */
  rollbackStrategy?: "individual" | "all";
  rollback?: RollbackConfig;
  lockfileSync?: "required" | "optional" | "skip";
  /** Skip dry-run validation during prepare phase. @default false */
  skipDryRun?: boolean;
  ecosystems?: Record<string, EcosystemConfig>;
  plugins?: PubmPlugin[];
  compress?: CompressOption;
  releaseAssets?: ReleaseAssetEntry[];
  excludeRelease?: string[];
  locale?: "en" | "ko" | "zh-cn" | "fr" | "de" | "es";
  /** Version bump source strategy. @default "all" */
  versionSources?: "all" | "changesets" | "commits";
  /** Conventional commit configuration */
  conventionalCommits?: {
    /** Override default commit type → bump mapping. Set to false to ignore a type. */
    types?: Record<string, BumpType | false>;
  };
  /** Use registry-qualified tag names (e.g. npm/pkg@1.0.0) to avoid collisions in multi-ecosystem independent versioning. */
  registryQualifiedTags?: boolean;
}

export interface ResolvedPubmConfig
  extends Required<
    Omit<
      PubmConfig,
      | "packages"
      | "validate"
      | "registries"
      | "compress"
      | "releaseAssets"
      | "excludeRelease"
      | "rollbackStrategy"
      | "rollback"
      | "locale"
      | "versionSources"
      | "conventionalCommits"
      | "ecosystems"
      | "releasePr"
      | "testScript"
      | "buildScript"
      | "skipDryRun"
    >
  > {
  compress?: CompressOption;
  releaseAssets?: ReleaseAssetEntry[];
  excludeRelease?: string[];
  locale?: "en" | "ko" | "zh-cn" | "fr" | "de" | "es";
  packages: ResolvedPackageConfig[];
  validate: Required<ValidateConfig>;
  rollback: Required<RollbackConfig>;
  versionSources: "all" | "changesets" | "commits";
  conventionalCommits: {
    types: Record<string, BumpType | false>;
  };
  releasePr: ResolvedReleasePrConfig;
  ecosystems: Record<string, EcosystemConfig>;
  testScript?: string;
  buildScript?: string;
  skipDryRun?: boolean;
  discoveryEmpty?: boolean;
}

export function defineConfig(config: PubmConfig): PubmConfig {
  return config;
}
