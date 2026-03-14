import type { PubmContext } from "../context.js";
import type { Ecosystem } from "../ecosystem/ecosystem.js";
import type { PackageRegistry } from "../registry/package-registry.js";
import type { ReleaseContext } from "../tasks/github-release.js";

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
}
