import type { PubmPlugin } from "../plugin/types.js";
import type { RegistryType } from "../types/options.js";

export interface PrivateRegistryConfig {
  url: string;
  token: { envVar: string };
}

export interface PackageConfig {
  path: string;
  registries?: (RegistryType | PrivateRegistryConfig)[];
  ecosystem?: "js" | "rust";
  buildCommand?: string;
  testCommand?: string;
}

export interface ValidateConfig {
  cleanInstall?: boolean;
  entryPoints?: boolean;
  extraneousFiles?: boolean;
}

export interface SnapshotConfig {
  useCalculatedVersion?: boolean;
  prereleaseTemplate?: string;
}

export interface PubmConfig {
  versioning?: "independent" | "fixed";
  branch?: string;
  /** @deprecated Use manifest-based inference. This field is ignored. */
  registries?: RegistryType[];
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
  snapshot?: SnapshotConfig;
  tag?: string;
  contents?: string;
  saveToken?: boolean;
  releaseDraft?: boolean;
  releaseNotes?: boolean;
  rollbackStrategy?: "individual" | "all";
  plugins?: PubmPlugin[];
}

export interface ResolvedPubmConfig
  extends Required<
    Omit<PubmConfig, "packages" | "validate" | "snapshot" | "registries">
  > {
  packages: PackageConfig[];
  validate: Required<ValidateConfig>;
  snapshot: Required<SnapshotConfig>;
}

export function defineConfig(config: PubmConfig): PubmConfig {
  return config;
}
