import { maxBump } from "../changeset/bump-utils.js";
import type { BumpType, Changeset } from "../changeset/parser.js";
import { deleteChangesetFiles, readChangesets } from "../changeset/reader.js";
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
        const existing = pkgBumps.get(release.path);
        const entry: VersionEntry = {
          summary: changeset.summary,
          id: changeset.id,
        };
        if (existing) {
          existing.bumpType = maxBump(existing.bumpType, release.type);
          existing.entries.push(entry);
        } else {
          pkgBumps.set(release.path, {
            bumpType: release.type,
            entries: [entry],
          });
        }
      }
    }

    const recommendations: VersionRecommendation[] = [];
    for (const [packagePath, { bumpType, entries }] of pkgBumps) {
      recommendations.push({
        packagePath,
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
