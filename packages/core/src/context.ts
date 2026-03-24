import process from "node:process";
import type { ReleaseContext } from "./assets/types.js";
import type { ResolvedPubmConfig } from "./config/types.js";
import { PluginRunner } from "./plugin/runner.js";
import type { ResolvedOptions } from "./types/options.js";

export interface SingleVersionPlan {
  mode: "single";
  version: string;
  packagePath: string;
}

export interface FixedVersionPlan {
  mode: "fixed";
  version: string;
  packages: Map<string, string>;
}

export interface IndependentVersionPlan {
  mode: "independent";
  packages: Map<string, string>;
}

export type VersionPlan =
  | SingleVersionPlan
  | FixedVersionPlan
  | IndependentVersionPlan;

export function resolveVersion(
  plan: VersionPlan,
  picker?: (packages: Map<string, string>) => string,
): string {
  if (plan.mode === "single") return plan.version;
  if (plan.mode === "fixed") return plan.version;
  if (!picker) {
    throw new Error(
      "independent mode requires an explicit version picker. " +
        "Provide a picker function or set the 'version' option.",
    );
  }
  return picker(plan.packages);
}

export function getPackageVersion(
  ctx: PubmContext,
  packagePath: string,
): string {
  const plan = ctx.runtime.versionPlan;
  if (plan) {
    if (plan.mode === "single") return plan.version;
    if (plan.mode === "fixed") return plan.version;
    return plan.packages.get(packagePath) ?? "";
  }
  return "";
}

export interface PubmContext {
  /** Writable reference — must always be replaced with a frozen value via `filterConfigPackages`. */
  config: ResolvedPubmConfig;
  readonly options: ResolvedOptions;
  readonly cwd: string;

  runtime: {
    changesetConsumed?: boolean;
    tag: string;
    promptEnabled: boolean;
    cleanWorkingTree: boolean;
    pluginRunner: PluginRunner;
    versionPlan?: VersionPlan;
    releaseContext?: ReleaseContext;
    scopeCreated?: boolean;
    packageCreated?: boolean;
    tempDir?: string;
    npmOtp?: string;
    npmOtpPromise?: Promise<string>;
    tokenRetryPromises?: Record<string, Promise<string>>;
    workspaceBackups?: Map<string, string>;
    dryRunVersionBackup?: Map<string, string>;
    pluginTokens?: Record<string, string>;
  };
}

export function createContext(
  config: ResolvedPubmConfig,
  options: ResolvedOptions,
  cwd?: string,
): PubmContext {
  const runtime: PubmContext["runtime"] = {
    tag: options.tag ?? "latest",
    promptEnabled: false,
    cleanWorkingTree: false,
    pluginRunner: new PluginRunner([]),
    tokenRetryPromises: {},
  };

  const ctx = Object.defineProperties(Object.create(null), {
    config: {
      value: Object.freeze(config),
      writable: true,
      enumerable: true,
      configurable: false,
    },
    options: {
      value: Object.freeze(options),
      writable: false,
      enumerable: true,
      configurable: false,
    },
    cwd: {
      value: cwd ?? process.cwd(),
      writable: false,
      enumerable: true,
      configurable: false,
    },
    runtime: {
      value: runtime,
      writable: true,
      enumerable: true,
      configurable: false,
    },
  }) as PubmContext;

  return ctx;
}
