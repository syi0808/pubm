import type { Options } from "../types/options.js";

export type ReleasePhase = "prepare" | "publish";

export function resolvePhases(
  options: Pick<Options, "mode" | "prepare" | "publish">,
): ReleasePhase[] {
  validateOptions(options);

  if (options.prepare) return ["prepare"];
  if (options.publish) return ["publish"];

  return ["prepare", "publish"];
}

export function validateOptions(
  options: Pick<Options, "mode" | "prepare" | "publish">,
): void {
  const mode = options.mode ?? "local";

  if (options.prepare && options.publish) {
    throw new Error(
      "Cannot specify both --prepare and --publish. Omit both to run the full pipeline.",
    );
  }

  if (mode === "ci" && !options.prepare && !options.publish) {
    throw new Error(
      "CI mode requires --prepare or --publish. Example: pubm --mode ci --prepare",
    );
  }
}
