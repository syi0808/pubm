import { maxBump } from "../changeset/bump-utils.js";
import type { BumpType, Changeset } from "../changeset/parser.js";
import { deleteChangesetFiles, readChangesets } from "../changeset/reader.js";
import { packageKey } from "../utils/package-key.js";
import type {
  VersionEntry,
  VersionRecommendation,
  VersionSource,
  VersionSourceContext,
} from "./types.js";

export class ChangesetSource implements VersionSource {
  readonly name = "changeset";
  private changesets: Changeset[] = [];
  private cwd = "";

  async analyze(
    context: VersionSourceContext,
  ): Promise<VersionRecommendation[]> {
    this.cwd = context.cwd;
    this.changesets = readChangesets(context.cwd, context.resolveKey);
    if (this.changesets.length === 0) return [];

    const pkgBumps = new Map<
      string,
      { bumpType: BumpType; entries: VersionEntry[] }
    >();
    for (const changeset of this.changesets) {
      for (const release of changeset.releases) {
        const key = release.ecosystem
          ? packageKey({ path: release.path, ecosystem: release.ecosystem })
          : release.path;
        const existing = pkgBumps.get(key);
        const entry: VersionEntry = {
          summary: changeset.summary,
          id: changeset.id,
        };
        if (existing) {
          existing.bumpType = maxBump(existing.bumpType, release.type);
          existing.entries.push(entry);
        } else {
          pkgBumps.set(key, {
            bumpType: release.type,
            entries: [entry],
          });
        }
      }
    }

    const recommendations: VersionRecommendation[] = [];
    for (const [key, { bumpType, entries }] of pkgBumps) {
      const separatorIndex = key.lastIndexOf("::");
      const hasPackageKey = separatorIndex !== -1;
      const packagePath = hasPackageKey ? key.slice(0, separatorIndex) : key;
      recommendations.push({
        packagePath,
        ...(hasPackageKey ? { packageKey: key } : {}),
        bumpType,
        source: this.name,
        entries,
      });
    }
    return recommendations;
  }

  async consume(): Promise<void> {
    if (this.changesets.length > 0) {
      deleteChangesetFiles(this.cwd, this.changesets);
    }
  }
}
