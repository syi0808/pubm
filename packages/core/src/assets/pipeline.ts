import { basename, extname } from "node:path";
import { compressFile } from "./compressor.js";
import { computeSha256 } from "./hasher.js";
import { applyNameTemplate } from "./namer.js";
import type {
  AssetPipelineHooks,
  CompressedAsset,
  PreparedAsset,
  ResolvedAsset,
  TransformedAsset,
} from "./types.js";

export interface PipelineContext {
  name: string;
  version: string;
  tempDir: string;
  pubmContext?: unknown;
}

export async function runAssetPipeline(
  resolved: ResolvedAsset[],
  hooks: AssetPipelineHooks,
  ctx: PipelineContext,
): Promise<PreparedAsset[]> {
  const hookCtx = ctx.pubmContext ?? ctx;

  // 1. Resolve hook
  let assets = resolved;
  if (hooks.resolveAssets) {
    assets = await hooks.resolveAssets(assets, hookCtx);
  }

  // 2. Transform
  const transformed: TransformedAsset[] = [];
  for (const asset of assets) {
    if (hooks.transformAsset) {
      const result = await hooks.transformAsset(asset, hookCtx);
      transformed.push(...(Array.isArray(result) ? result : [result]));
    } else {
      transformed.push(asset);
    }
  }

  // 3. Compress
  const compressed: CompressedAsset[] = [];
  for (const asset of transformed) {
    if (hooks.compressAsset) {
      compressed.push(await hooks.compressAsset(asset, hookCtx));
    } else {
      compressed.push(await defaultCompress(asset, ctx.tempDir));
    }
  }

  // 4. Name + 5. Hash
  let prepared: PreparedAsset[] = await Promise.all(
    compressed.map(async (a) => ({
      ...a,
      name: hooks.nameAsset
        ? hooks.nameAsset(a, hookCtx)
        : applyNameTemplate(a, ctx),
      sha256: await computeSha256(a.filePath),
    })),
  );

  // 6. Checksums
  if (hooks.generateChecksums) {
    prepared = await hooks.generateChecksums(prepared, hookCtx);
  }

  return prepared;
}

async function defaultCompress(
  asset: TransformedAsset,
  tempDir: string,
): Promise<CompressedAsset> {
  const { config, filePath, platform } = asset;

  if (config.compress === false) {
    return {
      filePath,
      originalPath: filePath,
      platform,
      compressFormat: false,
      config,
    };
  }

  // Build a unique archive base name to prevent overwrites when multiple
  // platform binaries share the same filename (e.g. all named "pubm").
  const stem = basename(filePath, extname(filePath));
  const platformSuffix = platform.raw ? `-${platform.raw}` : "";
  const archiveBaseName = `${stem}${platformSuffix}`;

  const archivePath = await compressFile(
    filePath,
    tempDir,
    config.compress,
    asset.extraFiles,
    archiveBaseName,
  );

  return {
    filePath: archivePath,
    originalPath: filePath,
    platform,
    compressFormat: config.compress,
    config,
  };
}
