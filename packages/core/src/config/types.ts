import type { CompressOption, ReleaseAssetEntry } from "../assets/types.js";
import type { BumpType } from "../changeset/parser.js";
import type { PubmPlugin } from "../plugin/types.js";
import type { RegistryType } from "../types/options.js";

export interface PrivateRegistryConfig {
  url: string;
  token: { envVar: string };
}

export interface PackageConfig {
  path: string;
  registries?: (RegistryType | PrivateRegistryConfig)[];
  ecosystem?: string;
  buildCommand?: string;
  testCommand?: string;
}

export interface ResolvedPackageConfig
  extends Omit<PackageConfig, "registries"> {
  name: string;
  version: string;
  dependencies: string[];
  registries: RegistryType[];
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
  /** Create a pull request for the version bump commit instead of pushing directly. @default false */
  createPr?: boolean;
  /** @deprecated Use `rollback.strategy` instead. */
  rollbackStrategy?: "individual" | "all";
  rollback?: RollbackConfig;
  lockfileSync?: "required" | "optional" | "skip";
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
  discoveryEmpty?: boolean;
}

export function defineConfig(config: PubmConfig): PubmConfig {
  return config;
}
