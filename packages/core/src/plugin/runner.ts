import type {
  AssetPipelineHooks,
  ReleaseContext,
  TransformedAsset,
} from "../assets/types.js";
import type { PubmContext } from "../context.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { registryCatalog } from "../registry/catalog.js";

import type {
  HookName,
  PluginCheck,
  PluginCredential,
  PubmPlugin,
} from "./types.js";

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export class PluginRunner {
  constructor(private plugins: PubmPlugin[]) {
    for (const plugin of plugins) {
      for (const def of plugin.registries ?? []) {
        const { createPublishTask, createDryRunTask, ...rest } = def;
        const taskFactory = createPublishTask
          ? {
              createPublishTask,
              createDryRunTask:
                createDryRunTask ??
                ((packagePath: string) => {
                  throw new Error(
                    `Plugin registry "${def.key}" cannot dry-run publish "${packagePath}" because createDryRunTask is not defined`,
                  );
                }),
            }
          : undefined;
        registryCatalog.register({
          ...rest,
          taskFactory,
          useWorkflowTaskFactory: !!taskFactory,
        });
      }
      for (const desc of plugin.ecosystems ?? []) {
        ecosystemCatalog.register(desc);
      }
    }
  }

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

  collectCredentials(ctx: PubmContext): PluginCredential[] {
    const all = this.plugins.flatMap((p) => p.credentials?.(ctx) ?? []);
    const seen = new Set<string>();
    return all.filter((c) => {
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    });
  }

  collectChecks(
    ctx: PubmContext,
    phase: "prerequisites" | "conditions",
  ): PluginCheck[] {
    return this.plugins
      .flatMap((p) => p.checks?.(ctx) ?? [])
      .filter((c) => c.phase === phase);
  }

  collectAssetHooks(): AssetPipelineHooks<PubmContext> {
    const collected: AssetPipelineHooks<PubmContext> = {};

    // Chain: resolveAssets — each plugin's output is next plugin's input
    const resolveChain = this.plugins
      .map((p) => p.hooks?.resolveAssets)
      .filter(isDefined);
    if (resolveChain.length > 0) {
      collected.resolveAssets = async (assets, ctx) => {
        let result = assets;
        for (const hook of resolveChain) {
          result = await hook(result, ctx);
        }
        return result;
      };
    }

    // Chain: transformAsset — per-asset, supports array fan-out
    const transformChain = this.plugins
      .map((p) => p.hooks?.transformAsset)
      .filter(isDefined);
    if (transformChain.length > 0) {
      collected.transformAsset = async (asset, ctx) => {
        let items: TransformedAsset[] = [asset];
        for (const hook of transformChain) {
          const next: TransformedAsset[] = [];
          for (const item of items) {
            const result = await hook(item, ctx);
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
      .filter(isDefined);
    if (compressChain.length > 0) {
      collected.compressAsset = async (asset, ctx) => {
        const [firstHook, ...restHooks] = compressChain;
        let result = await firstHook(asset, ctx);
        for (const hook of restHooks) {
          result = await hook(result, ctx);
        }
        return result;
      };
    }

    // Chain: nameAsset — per-asset
    const nameChain = this.plugins
      .map((p) => p.hooks?.nameAsset)
      .filter(isDefined);
    if (nameChain.length > 0) {
      collected.nameAsset = (asset, ctx) => {
        let result = "";
        for (const hook of nameChain) {
          result = hook(asset, ctx);
        }
        return result;
      };
    }

    // Chain: generateChecksums — chaining
    const checksumChain = this.plugins
      .map((p) => p.hooks?.generateChecksums)
      .filter(isDefined);
    if (checksumChain.length > 0) {
      collected.generateChecksums = async (assets, ctx) => {
        let result = assets;
        for (const hook of checksumChain) {
          result = await hook(result, ctx);
        }
        return result;
      };
    }

    // Concat: uploadAssets — each plugin gets same input, results concatenated
    const uploadHooks = this.plugins
      .map((p) => p.hooks?.uploadAssets)
      .filter(isDefined);
    if (uploadHooks.length > 0) {
      collected.uploadAssets = async (assets, ctx) => {
        const allResults = [];
        for (const hook of uploadHooks) {
          const result = await hook(assets, ctx);
          allResults.push(...result);
        }
        return allResults;
      };
    }

    return collected;
  }
}
