import path from "node:path";
import { analyzeCommits } from "../conventional-commit/commit-analyzer.js";
import {
  findLastReleaseRef,
  getCommitsSinceRef,
} from "../conventional-commit/git-log.js";
import { parseConventionalCommit } from "../conventional-commit/parser.js";
import { resolveCommitPackages } from "../conventional-commit/scope-resolver.js";
import type {
  CommitTypeMapping,
  ConventionalCommit,
} from "../conventional-commit/types.js";
import type {
  VersionRecommendation,
  VersionSource,
  VersionSourceContext,
} from "./types.js";

export class ConventionalCommitSource implements VersionSource {
  readonly name = "conventional-commit";
  private typeOverrides: CommitTypeMapping;

  constructor(typeOverrides: CommitTypeMapping = {}) {
    this.typeOverrides = typeOverrides;
  }

  async analyze(
    context: VersionSourceContext,
  ): Promise<VersionRecommendation[]> {
    const packagePaths = [...context.packages.keys()];
    const recommendations: VersionRecommendation[] = [];

    for (const packagePath of packagePaths) {
      const packageName = path.basename(packagePath);
      const ref = findLastReleaseRef(context.cwd, packageName);
      const rawCommits = getCommitsSinceRef(context.cwd, ref);

      const parsed: ConventionalCommit[] = [];
      for (const raw of rawCommits) {
        const commit = parseConventionalCommit(
          raw.hash,
          raw.message,
          raw.files,
        );
        if (commit) parsed.push(commit);
      }
      if (parsed.length === 0) continue;

      // Filter commits to only those relevant to this package.
      // A commit is relevant if it has no files (global) or if scope/file
      // resolution matches this package path.
      const relevant = parsed.filter((commit) => {
        if (commit.files.length === 0) return true;
        const resolved = resolveCommitPackages(commit, packagePaths);
        return resolved.length === 0 || resolved.includes(packagePath);
      });
      if (relevant.length === 0) continue;

      const analysis = analyzeCommits(
        relevant,
        [packagePath],
        this.typeOverrides,
      );
      const pkg = analysis.get(packagePath);
      if (!pkg) continue;

      recommendations.push({
        packagePath,
        bumpType: pkg.bumpType,
        source: this.name,
        entries: pkg.entries.map((e) => ({
          summary: e.summary,
          type: e.type,
          hash: e.hash,
        })),
      });
    }
    return recommendations;
  }

  async consume(): Promise<void> {}
}
