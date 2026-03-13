import process from "node:process";
import type { ResolvedPubmConfig } from "./config/types.js";
import { PluginRunner } from "./plugin/runner.js";
import type { ReleaseContext } from "./tasks/github-release.js";
import type { ResolvedOptions } from "./types/options.js";

export interface PubmContext {
  readonly config: ResolvedPubmConfig;
  readonly options: ResolvedOptions;
  readonly cwd: string;

  runtime: {
    version?: string;
    versions?: Map<string, string>;
    changesetConsumed?: boolean;
    tag: string;
    promptEnabled: boolean;
    cleanWorkingTree: boolean;
    pluginRunner: PluginRunner;
    releaseContext?: ReleaseContext;
    scopeCreated?: boolean;
    packageCreated?: boolean;
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
  };

  const ctx = Object.defineProperties(Object.create(null), {
    config: {
      value: Object.freeze(config),
      writable: false,
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
