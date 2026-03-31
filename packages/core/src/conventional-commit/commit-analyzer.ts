import { maxBump } from "../changeset/bump-utils.js";
import type { BumpType } from "../changeset/parser.js";
import { resolveCommitPackages } from "./scope-resolver.js";
import type { CommitTypeMapping, ConventionalCommit } from "./types.js";
import { DEFAULT_TYPE_BUMP_MAP } from "./types.js";

export interface PackageCommitAnalysis {
  bumpType: BumpType;
  entries: PackageCommitEntry[];
}

export interface PackageCommitEntry {
  summary: string;
  type: string;
  hash: string;
}

export function analyzeCommits(
  commits: ConventionalCommit[],
  packagePaths: string[],
  typeOverrides: CommitTypeMapping,
): Map<string, PackageCommitAnalysis> {
  const typeMap: CommitTypeMapping = {
    ...DEFAULT_TYPE_BUMP_MAP,
    ...typeOverrides,
  };
  const result = new Map<string, PackageCommitAnalysis>();

  for (const commit of commits) {
    const bumpType = resolveBumpType(commit, typeMap);
    if (!bumpType) continue;

    const packages = resolveCommitPackages(commit, packagePaths);
    if (packages.length === 0) continue;
    const summary = commit.scope
      ? `${commit.type}(${commit.scope}): ${commit.description}`
      : `${commit.type}: ${commit.description}`;

    for (const pkgPath of packages) {
      const existing = result.get(pkgPath);
      const entry: PackageCommitEntry = {
        summary,
        type: commit.type,
        hash: commit.hash,
      };

      if (existing) {
        existing.bumpType = maxBump(existing.bumpType, bumpType);
        existing.entries.push(entry);
      } else {
        result.set(pkgPath, { bumpType, entries: [entry] });
      }
    }
  }

  return result;
}

function resolveBumpType(
  commit: ConventionalCommit,
  typeMap: CommitTypeMapping,
): BumpType | null {
  if (commit.breaking) return "major";
  const mapped = typeMap[commit.type];
  if (mapped === false || mapped === undefined) return null;
  return mapped;
}
