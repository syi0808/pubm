import process from "node:process";
import { packageKey } from "../utils/package-key.js";
import { maxBump } from "./bump-utils.js";
import type { BumpType, Changeset } from "./parser.js";
import { readChangesets } from "./reader.js";

export interface PackageStatus {
  bumpType: BumpType;
  changesetCount: number;
  summaries: string[];
}

export interface Status {
  packages: Map<string, PackageStatus>;
  changesets: Changeset[];
  hasChangesets: boolean;
}

export function getStatus(
  cwd: string = process.cwd(),
  resolveKey?: (key: string) => string,
): Status {
  const changesets = readChangesets(cwd, resolveKey);
  const packages = new Map<string, PackageStatus>();

  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      const key = release.ecosystem
        ? packageKey({ path: release.path, ecosystem: release.ecosystem })
        : release.path;
      const existing = packages.get(key);

      if (existing) {
        existing.bumpType = maxBump(existing.bumpType, release.type);
        existing.changesetCount += 1;
        existing.summaries.push(changeset.summary);
      } else {
        packages.set(key, {
          bumpType: release.type,
          changesetCount: 1,
          summaries: [changeset.summary],
        });
      }
    }
  }

  return {
    packages,
    changesets,
    hasChangesets: changesets.length > 0,
  };
}
