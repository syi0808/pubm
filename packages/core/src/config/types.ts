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

export type ReleasePullRequestGrouping = "inherit" | "fixed" | "independent";
export type ResolvedReleasePullRequestGrouping = "fixed" | "independent";
export type UnversionedChangesPolicy = "ignore" | "warn" | "fail";

export interface ReleaseVersioningConfig {
  mode?: "independent" | "fixed";
  fixed?: string[][];
  linked?: string[][];
  updateInternalDependencies?: "patch" | "minor";
}

export interface ResolvedReleaseVersioningConfig {
  mode: "independent" | "fixed";
  fixed: string[][];
  linked: string[][];
  updateInternalDependencies: "patch" | "minor";
}

export interface ReleaseChangesetsConfig {
  directory?: string;
}

export interface ResolvedReleaseChangesetsConfig {
  directory: string;
}

export interface ReleaseCommitsConfig {
  format?: "conventional";
  types?: Record<string, BumpType | false>;
}

export interface ResolvedReleaseCommitsConfig {
  format: "conventional";
  types: Record<string, BumpType | false>;
}

export interface ReleasePullRequestConfig {
  branchTemplate?: string;
  titleTemplate?: string;
  label?: string;
  bumpLabels?: ReleasePrBumpLabelsConfig;
  grouping?: ReleasePullRequestGrouping;
  fixed?: string[][];
  linked?: string[][];
  unversionedChanges?: UnversionedChangesPolicy;
}

export interface ResolvedReleasePullRequestConfig {
  branchTemplate: string;
  titleTemplate: string;
  label: string;
  bumpLabels: Required<ReleasePrBumpLabelsConfig>;
  grouping: ResolvedReleasePullRequestGrouping;
  fixed: string[][];
  linked: string[][];
  unversionedChanges: UnversionedChangesPolicy;
}

export interface ReleaseConfig {
  versioning?: ReleaseVersioningConfig;
  changesets?: ReleaseChangesetsConfig;
  commits?: ReleaseCommitsConfig;
  changelog?: boolean | string;
  pullRequest?: ReleasePullRequestConfig;
}

export interface ResolvedReleaseConfig {
  versioning: ResolvedReleaseVersioningConfig;
  changesets: ResolvedReleaseChangesetsConfig;
  commits: ResolvedReleaseCommitsConfig;
  changelog: boolean | string;
  pullRequest: ResolvedReleasePullRequestConfig;
}

export interface PubmConfig {
  branch?: string;
  packages?: PackageConfig[];
  commit?: boolean;
  access?: "public" | "restricted";
  release?: ReleaseConfig;
  ignore?: string[];
  validate?: ValidateConfig;
  snapshotTemplate?: string;
  tag?: string;
  contents?: string;
  saveToken?: boolean;
  releaseDraft?: boolean;
  releaseNotes?: boolean;
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
      | "ecosystems"
      | "release"
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
  release: ResolvedReleaseConfig;
  versioning: "independent" | "fixed";
  fixed: string[][];
  linked: string[][];
  updateInternalDependencies: "patch" | "minor";
  changelog: boolean | string;
  ecosystems: Record<string, EcosystemConfig>;
  testScript?: string;
  buildScript?: string;
  skipDryRun?: boolean;
  discoveryEmpty?: boolean;
}

export function defineConfig(config: PubmConfig): PubmConfig {
  return config;
}
