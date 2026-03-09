import type { Ecosystem } from "../ecosystem/ecosystem.js";
import type { Registry } from "../registry/registry.js";
import type { Ctx } from "../tasks/runner.js";

export type HookFn = (ctx: Ctx) => Promise<void> | void;
export type ErrorHookFn = (ctx: Ctx, error: Error) => Promise<void> | void;

export interface PluginHooks {
  beforeTest?: HookFn;
  afterTest?: HookFn;
  beforeBuild?: HookFn;
  afterBuild?: HookFn;
  beforeVersion?: HookFn;
  afterVersion?: HookFn;
  beforePublish?: HookFn;
  afterPublish?: HookFn;
  beforePush?: HookFn;
  afterPush?: HookFn;
  onError?: ErrorHookFn;
  onRollback?: HookFn;
  onSuccess?: HookFn;
}

export type HookName = keyof PluginHooks;

export interface PubmPlugin {
  name: string;
  registries?: Registry[];
  ecosystems?: Ecosystem[];
  hooks?: PluginHooks;
}
