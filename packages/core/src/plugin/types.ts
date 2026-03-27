import type { ListrTask } from "listr2";
import type { AssetPipelineHooks, ReleaseContext } from "../assets/types.js";
import type { ResolvedPackageConfig } from "../config/types.js";
import type { PubmContext } from "../context.js";
import type { EcosystemDescriptor } from "../ecosystem/catalog.js";
import type { TokenEntry } from "../registry/catalog.js";
import type { RegistryConnector } from "../registry/connector.js";
import type { PackageRegistry } from "../registry/package-registry.js";

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
  onSuccess?: HookFn;
  // Asset pipeline hooks
  resolveAssets?: AssetPipelineHooks<PubmContext>["resolveAssets"];
  transformAsset?: AssetPipelineHooks<PubmContext>["transformAsset"];
  compressAsset?: AssetPipelineHooks<PubmContext>["compressAsset"];
  nameAsset?: AssetPipelineHooks<PubmContext>["nameAsset"];
  generateChecksums?: AssetPipelineHooks<PubmContext>["generateChecksums"];
  uploadAssets?: AssetPipelineHooks<PubmContext>["uploadAssets"];
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

export interface PluginTaskContext {
  /** Display status message on the current task */
  output: string;
  /** Modify task title */
  title: string;
  /** Run an enquirer prompt */
  prompt<T = unknown>(options: {
    type: string;
    message: string;
    [key: string]: unknown;
  }): Promise<T>;
}

export interface PluginCredential {
  /** SecureStore storage key (e.g. "brew-github-token") */
  key: string;
  /** Environment variable name (e.g. "PUBM_BREW_GITHUB_TOKEN") */
  env: string;
  /** Prompt display label (e.g. "GitHub PAT for Homebrew tap") */
  label: string;
  /** Token generation URL for user guidance */
  tokenUrl?: string;
  /** Display text for the token URL */
  tokenUrlLabel?: string;
  /** GitHub Secrets key name for sync */
  ghSecretName?: string;
  /** If false, collection failure is skipped (default: true) */
  required?: boolean;
  /** Custom resolver tried after env, before keyring */
  resolve?: () => Promise<string | null>;
  /** Token validation function */
  validate?: (token: string, task: PluginTaskContext) => Promise<boolean>;
}

export interface PluginCheck {
  /** Check display title */
  title: string;
  /** Which preflight phase to insert into */
  phase: "prerequisites" | "conditions";
  /** Check logic */
  task: (ctx: PubmContext, task: PluginTaskContext) => Promise<void>;
}

/** External plugin-facing interface for registry registration.
 *  Flat structure — PluginRunner maps to internal RegistryDescriptor + RegistryTaskFactory.
 */
export interface PluginRegistryDefinition {
  key: string;
  ecosystem: string;
  label: string;
  tokenConfig: TokenEntry;
  unpublishLabel: string;
  requiresEarlyAuth: boolean;
  needsPackageScripts: boolean;
  concurrentPublish: boolean;
  additionalEnvVars?: (token: string) => Record<string, string>;
  validateToken?: (token: string) => Promise<boolean>;
  resolveTokenUrl?: (baseUrl: string) => Promise<string>;
  resolveDisplayName?: (ctx: {
    packages?: ResolvedPackageConfig[];
  }) => Promise<string[]>;
  orderPackages?: (paths: string[]) => Promise<string[]>;
  connector: () => RegistryConnector;
  factory: (packagePath: string) => Promise<PackageRegistry>;
  createPublishTask?: (packagePath: string) => ListrTask<PubmContext>;
  createDryRunTask?: (
    packagePath: string,
    siblingPaths?: string[],
  ) => ListrTask<PubmContext>;
}

export interface PubmPlugin {
  name: string;
  registries?: PluginRegistryDefinition[];
  ecosystems?: EcosystemDescriptor[];
  hooks?: PluginHooks;
  commands?: PluginCommand[];
  /** Declare credentials this plugin needs */
  credentials?: (ctx: PubmContext) => PluginCredential[];
  /** Declare preflight checks this plugin adds */
  checks?: (ctx: PubmContext) => PluginCheck[];
}
