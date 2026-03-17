import type { ReleaseAsset } from "@pubm/core";

export type AssetPlatformMatcher = (asset: ReleaseAsset) => boolean;

export interface BrewTapOptions {
  formula: string;
  repo?: string;
  packageName?: string;
  assetPlatforms?: Record<string, AssetPlatformMatcher>;
}

export interface BrewCoreOptions {
  formula: string;
  packageName?: string;
  assetPlatforms?: Record<string, AssetPlatformMatcher>;
}
