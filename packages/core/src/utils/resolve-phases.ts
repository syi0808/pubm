import type { Options, ReleasePhase } from "../types/options.js";

export function resolvePhases(options: Pick<Options, "phase">): ReleasePhase[] {
  validateOptions(options);

  if (options.phase) return [options.phase];

  return ["prepare", "publish"];
}

export function validateOptions(options: Pick<Options, "phase">): void {
  if (
    options.phase !== undefined &&
    options.phase !== "prepare" &&
    options.phase !== "publish"
  ) {
    throw new Error(
      `Invalid release phase "${options.phase}". Use "prepare" or "publish".`,
    );
  }
}
