import { satisfies } from "semver";
import type { Engine } from "../types/package-json.js";
import { PUBM_ENGINES } from "./pubm-metadata.js";

export async function validateEngineVersion(
  engine: Engine,
  version: string,
): Promise<boolean> {
  return satisfies(version, PUBM_ENGINES[engine], {
    includePrerelease: true,
  });
}
