import type { Options, ResolvedOptions } from "./types/options.js";

export const defaultOptions: Omit<Options, "version"> = {
  testScript: "test",
  buildScript: "build",
  branch: "main",
  tag: "latest",
};

export function resolveOptions(options: Options): ResolvedOptions {
  const defined = Object.fromEntries(
    Object.entries(options).filter(([, v]) => v !== undefined),
  );

  const nextOptions = { ...defaultOptions, ...defined };

  return nextOptions as ResolvedOptions;
}
