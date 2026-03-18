// packages/core/src/assets/types.ts

export type CompressFormat = "tar.gz" | "zip" | "tar.xz" | "tar.zst";

export type CompressOption =
  | CompressFormat
  | false
  | Record<string, CompressFormat>;

export type ReleaseAssetEntry = string | ReleaseAssetGroupConfig;

export interface ReleaseAssetGroupConfig {
  packagePath?: string;
  files: (string | ReleaseAssetFileConfig)[];
  compress?: CompressOption;
  name?: string;
}

export interface ReleaseAssetFileConfig {
  path: string;
  compress?: CompressOption;
  name?: string;
}

export interface ResolvedAssetFileConfig {
  path: string;
  compress: CompressFormat | false;
  name: string;
}

export interface ResolvedReleaseAssetConfig {
  packagePath?: string;
  files: ResolvedAssetFileConfig[];
}

export interface ParsedPlatform {
  raw: string;
  os?: string;
  arch?: string;
  vendor?: string;
  abi?: string;
  variant?: string;
}

export interface ResolvedAsset {
  filePath: string;
  platform: ParsedPlatform;
  config: ResolvedAssetFileConfig;
}

export interface TransformedAsset extends ResolvedAsset {
  filePath: string;
  extraFiles?: string[];
}

export interface CompressedAsset {
  filePath: string;
  originalPath: string;
  platform: ParsedPlatform;
  compressFormat: CompressFormat | false;
  config: ResolvedAssetFileConfig;
}

export interface PreparedAsset extends CompressedAsset {
  name: string;
  sha256: string;
}

export interface UploadedAsset extends PreparedAsset {
  url: string;
  target: string;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  sha256: string;
  platform: ParsedPlatform;
}

export interface ReleaseContext {
  displayLabel: string;
  version: string;
  tag: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

export interface AssetPipelineHooks {
  resolveAssets?: (
    resolved: ResolvedAsset[],
    ctx: any,
  ) => Promise<ResolvedAsset[]> | ResolvedAsset[];
  transformAsset?: (
    asset: ResolvedAsset,
    ctx: any,
  ) =>
    | Promise<TransformedAsset | TransformedAsset[]>
    | TransformedAsset
    | TransformedAsset[];
  compressAsset?: (
    asset: TransformedAsset,
    ctx: any,
  ) => Promise<CompressedAsset> | CompressedAsset;
  nameAsset?: (asset: CompressedAsset, ctx: any) => string;
  generateChecksums?: (
    assets: PreparedAsset[],
    ctx: any,
  ) => Promise<PreparedAsset[]> | PreparedAsset[];
  uploadAssets?: (
    assets: PreparedAsset[],
    ctx: any,
  ) => Promise<UploadedAsset[]> | UploadedAsset[];
}
