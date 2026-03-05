import type { RegistryType } from "../types/options.js";

export interface PackageConfig {
  path: string;
  registries: RegistryType[];
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
}

export interface ResolvedPubmConfig
  extends Required<Omit<PubmConfig, "packages" | "validate" | "snapshot">> {
  packages: PackageConfig[];
  validate: Required<ValidateConfig>;
  snapshot: Required<SnapshotConfig>;
}

export function defineConfig(config: PubmConfig): PubmConfig {
  return config;
}
