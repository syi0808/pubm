import process from "node:process";
import { inc } from "semver";
import { maxBump } from "./bump-utils.js";
import type { BumpType } from "./parser.js";
import { readChangesets } from "./reader.js";

export interface VersionBump {
  currentVersion: string;
  newVersion: string;
  bumpType: BumpType;
}

export function calculateVersionBumps(
  currentVersions: Map<string, string>,
  cwd: string = process.cwd(),
): Map<string, VersionBump> {
  const changesets = readChangesets(cwd);
  const bumpTypes = new Map<string, BumpType>();

  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      if (!currentVersions.has(release.name)) continue;

      const existing = bumpTypes.get(release.name);
      if (existing) {
        bumpTypes.set(release.name, maxBump(existing, release.type));
      } else {
        bumpTypes.set(release.name, release.type);
      }
    }
  }

  const result = new Map<string, VersionBump>();

  for (const [name, bumpType] of bumpTypes) {
    const currentVersion = currentVersions.get(name);
    if (!currentVersion) continue;

    const newVersion = inc(currentVersion, bumpType);

    if (newVersion) {
      result.set(name, {
        currentVersion,
        newVersion,
        bumpType,
      });
    }
  }

  return result;
}
