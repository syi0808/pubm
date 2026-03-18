import type { Options, ResolvedOptions } from "./types/options.js";

export const defaultOptions: Partial<Options> = {
  testScript: "test",
  buildScript: "build",
  mode: "local",
  branch: "main",
  tag: "latest",
};

export function resolveOptions(options: Partial<Options>): ResolvedOptions {
  const defined = Object.fromEntries(
    Object.entries(options).filter(([, v]) => v !== undefined),
  );

  const nextOptions = { ...defaultOptions, ...defined };

  return nextOptions as ResolvedOptions;
}
