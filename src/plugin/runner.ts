import type { Ecosystem } from "../ecosystem/ecosystem.js";
import type { Registry } from "../registry/registry.js";
import type { Ctx } from "../tasks/runner.js";
import type { HookName, PubmPlugin } from "./types.js";

export class PluginRunner {
  constructor(private plugins: PubmPlugin[]) {}

  async runHook(
    hookName: Exclude<HookName, "onError">,
    ctx: Ctx,
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.[hookName];
      if (hook) {
        await (hook as (ctx: Ctx) => Promise<void> | void)(ctx);
      }
    }
  }

  async runErrorHook(ctx: Ctx, error: Error): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.onError;
      if (hook) {
        await hook(ctx, error);
      }
    }
  }

  collectRegistries(): Registry[] {
    return this.plugins.flatMap((p) => p.registries ?? []);
  }

  collectEcosystems(): Ecosystem[] {
    return this.plugins.flatMap((p) => p.ecosystems ?? []);
  }
}
