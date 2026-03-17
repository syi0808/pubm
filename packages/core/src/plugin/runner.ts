import type { AssetPipelineHooks, ReleaseContext } from "../assets/types.js";
import type { PubmContext } from "../context.js";
import type { Ecosystem } from "../ecosystem/ecosystem.js";
import type { PackageRegistry } from "../registry/package-registry.js";

import type { HookName, PubmPlugin } from "./types.js";

export class PluginRunner {
  constructor(private plugins: PubmPlugin[]) {}

  async runHook(
    hookName: Exclude<HookName, "onError" | "afterRelease">,
    ctx: PubmContext,
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.[hookName];
      if (hook) {
        await (hook as (ctx: PubmContext) => Promise<void> | void)(ctx);
      }
    }
  }

  async runErrorHook(ctx: PubmContext, error: Error): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.onError;
      if (hook) {
        await hook(ctx, error);
      }
    }
  }

  async runAfterReleaseHook(
    ctx: PubmContext,
    releaseCtx: ReleaseContext,
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.afterRelease;
      if (hook) {
        await hook(ctx, releaseCtx);
      }
    }
  }

  collectRegistries(): PackageRegistry[] {
    return this.plugins.flatMap((p) => p.registries ?? []);
  }

  collectEcosystems(): Ecosystem[] {
    return this.plugins.flatMap((p) => p.ecosystems ?? []);
  }

  collectAssetHooks(): AssetPipelineHooks {
    const collected: AssetPipelineHooks = {};

    // Chain: resolveAssets — each plugin's output is next plugin's input
    const resolveChain = this.plugins
      .map((p) => p.hooks?.resolveAssets)
      .filter(Boolean);
    if (resolveChain.length > 0) {
      collected.resolveAssets = async (assets, ctx) => {
        let result = assets;
        for (const hook of resolveChain) {
          result = await hook!(result, ctx);
        }
        return result;
      };
    }

    // Chain: transformAsset — per-asset, supports array fan-out
    const transformChain = this.plugins
      .map((p) => p.hooks?.transformAsset)
      .filter(Boolean);
    if (transformChain.length > 0) {
      collected.transformAsset = async (asset, ctx) => {
        let items = [asset] as any[];
        for (const hook of transformChain) {
          const next: any[] = [];
          for (const item of items) {
            const result = await hook!(item, ctx);
            next.push(...(Array.isArray(result) ? result : [result]));
          }
          items = next;
        }
        return items.length === 1 ? items[0] : items;
      };
    }

    // Chain: compressAsset — per-asset
    const compressChain = this.plugins
      .map((p) => p.hooks?.compressAsset)
      .filter(Boolean);
    if (compressChain.length > 0) {
      collected.compressAsset = async (asset, ctx) => {
        let result = asset as any;
        for (const hook of compressChain) {
          result = await hook!(result, ctx);
        }
        return result;
      };
    }

    // Chain: nameAsset — per-asset
    const nameChain = this.plugins
      .map((p) => p.hooks?.nameAsset)
      .filter(Boolean);
    if (nameChain.length > 0) {
      collected.nameAsset = (asset, ctx) => {
        let result = "";
        for (const hook of nameChain) {
          result = hook!(asset, ctx);
        }
        return result;
      };
    }

    // Chain: generateChecksums — chaining
    const checksumChain = this.plugins
      .map((p) => p.hooks?.generateChecksums)
      .filter(Boolean);
    if (checksumChain.length > 0) {
      collected.generateChecksums = async (assets, ctx) => {
        let result = assets;
        for (const hook of checksumChain) {
          result = await hook!(result, ctx);
        }
        return result;
      };
    }

    // Concat: uploadAssets — each plugin gets same input, results concatenated
    const uploadHooks = this.plugins
      .map((p) => p.hooks?.uploadAssets)
      .filter(Boolean);
    if (uploadHooks.length > 0) {
      collected.uploadAssets = async (assets, ctx) => {
        const allResults = [];
        for (const hook of uploadHooks) {
          const result = await hook!(assets, ctx);
          allResults.push(...result);
        }
        return allResults;
      };
    }

    return collected;
  }
}
