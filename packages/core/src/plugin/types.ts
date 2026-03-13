import type { PubmContext } from "../context.js";
import type { Ecosystem } from "../ecosystem/ecosystem.js";
import type { Registry } from "../registry/registry.js";
import type { ReleaseContext } from "../tasks/github-release.js";

export type HookFn = (ctx: PubmContext) => Promise<void> | void;
export type ErrorHookFn = (
  ctx: PubmContext,
  error: Error,
) => Promise<void> | void;
export type AfterReleaseHookFn = (
  ctx: PubmContext,
  releaseCtx: ReleaseContext,
) => Promise<void> | void;

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
  afterRelease?: AfterReleaseHookFn;
  onError?: ErrorHookFn;
  onRollback?: HookFn;
  onSuccess?: HookFn;
}

export type HookName = keyof PluginHooks;

export interface PluginCommandOption {
  name: string;
  description: string;
  required?: boolean;
}

export interface PluginSubcommand {
  name: string;
  description: string;
  options?: PluginCommandOption[];
  action: (args: Record<string, unknown>) => Promise<void>;
}

export interface PluginCommand {
  name: string;
  description: string;
  subcommands?: PluginSubcommand[];
}

export interface PubmPlugin {
  name: string;
  registries?: Registry[];
  ecosystems?: Ecosystem[];
  hooks?: PluginHooks;
  commands?: PluginCommand[];
}
