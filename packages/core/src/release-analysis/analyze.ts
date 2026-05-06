import path from "node:path";
import { createKeyResolver } from "../changeset/resolve.js";
import type { PubmContext } from "../context.js";
import { resolveCommitBumpType } from "../conventional-commit/commit-analyzer.js";
import {
  findLastReleaseRef,
  getCommitsSinceRef,
  type RawCommit,
} from "../conventional-commit/git-log.js";
import { parseConventionalCommit } from "../conventional-commit/parser.js";
import { resolveCommitPackages } from "../conventional-commit/scope-resolver.js";
import {
  type CommitTypeMapping,
  type ConventionalCommit,
  DEFAULT_TYPE_BUMP_MAP,
} from "../conventional-commit/types.js";
import {
  ChangesetSource,
  ConventionalCommitSource,
} from "../version-source/index.js";
import { mergeRecommendations } from "../version-source/merge.js";
import type { VersionSourceContext } from "../version-source/types.js";
import type { ReleaseAnalysis, UnversionedChange } from "./types.js";

export async function analyzeReleaseChanges(
  ctx: PubmContext,
): Promise<ReleaseAnalysis> {
  const currentVersions = new Map(
    ctx.config.packages.map((pkg) => [pkg.path, pkg.version]),
  );
  const sourceContext: VersionSourceContext = {
    cwd: ctx.cwd,
    packages: currentVersions,
    resolveKey: createKeyResolver(ctx.config.packages),
  };
  const changesets = await new ChangesetSource(
    ctx.config.release?.changesets?.directory ?? ".pubm/changesets",
  ).analyze(sourceContext);
  const commits = await new ConventionalCommitSource(
    ctx.config.release?.commits?.types ?? {},
  ).analyze(sourceContext);

  return {
    recommendations: mergeRecommendations([changesets, commits]),
    unversionedChanges: analyzeUnversionedCommits(ctx),
  };
}

function analyzeUnversionedCommits(ctx: PubmContext): UnversionedChange[] {
  const packagePaths = ctx.config.packages.map((pkg) => pkg.path);
  const typeMap: CommitTypeMapping = {
    ...DEFAULT_TYPE_BUMP_MAP,
    ...(ctx.config.release?.commits?.types ?? {}),
  };
  const changes = new Map<string, UnversionedChange>();

  for (const packagePath of packagePaths) {
    const packageName = path.basename(packagePath);
    const ref = findLastReleaseRef(ctx.cwd, packageName);
    const rawCommits = getCommitsSinceRef(ctx.cwd, ref);

    for (const raw of rawCommits) {
      const parsed = parseConventionalCommit(raw.hash, raw.message, raw.files);
      if (!parsed) {
        if (commitTouchesPackage(raw, packagePath)) {
          remember(changes, {
            hash: raw.hash,
            summary: firstLine(raw.message),
            files: raw.files,
            reason: "non-conventional",
            packagePath,
          });
        } else if (isUnmatchedPackageChange(raw, packagePaths)) {
          remember(changes, {
            hash: raw.hash,
            summary: firstLine(raw.message),
            files: raw.files,
            reason: "unmatched-package",
          });
        }
        continue;
      }

      const bumpType = resolveCommitBumpType(parsed, typeMap);
      const resolvedPackages = resolveCommitPackages(parsed, packagePaths);
      if (bumpType && resolvedPackages.length === 0) {
        remember(changes, {
          hash: raw.hash,
          summary: conventionalSummary(parsed),
          files: raw.files,
          reason: "unmatched-package",
          type: parsed.type,
        });
        continue;
      }
      if (bumpType) continue;

      if (resolvedPackages.includes(packagePath)) {
        remember(changes, {
          hash: raw.hash,
          summary: conventionalSummary(parsed),
          files: raw.files,
          reason: "ignored-type",
          packagePath,
          type: parsed.type,
        });
      } else if (isUnmatchedPackageChange(raw, packagePaths)) {
        remember(changes, {
          hash: raw.hash,
          summary: conventionalSummary(parsed),
          files: raw.files,
          reason: "unmatched-package",
          type: parsed.type,
        });
      }
    }
  }

  return [...changes.values()];
}

function commitTouchesPackage(commit: RawCommit, packagePath: string): boolean {
  if (commit.files.length === 0 || packagePath === ".") return true;
  const normalizedPackage = packagePath.replace(/\\/g, "/");
  return commit.files.some((file) => {
    const normalized = file.replace(/\\/g, "/");
    return (
      normalized === normalizedPackage ||
      normalized.startsWith(`${normalizedPackage}/`)
    );
  });
}

function isUnmatchedPackageChange(
  commit: RawCommit,
  packagePaths: readonly string[],
): boolean {
  if (commit.files.length === 0) return false;
  return !packagePaths.some((packagePath) =>
    commitTouchesPackage(commit, packagePath),
  );
}

function remember(
  changes: Map<string, UnversionedChange>,
  change: UnversionedChange,
): void {
  const key = [
    change.hash,
    change.reason,
    change.packagePath ?? "workspace",
  ].join(":");
  changes.set(key, change);
}

function firstLine(message: string): string {
  const newline = message.indexOf("\n");
  return newline === -1 ? message : message.slice(0, newline);
}

function conventionalSummary(commit: ConventionalCommit): string {
  return commit.scope
    ? `${commit.type}(${commit.scope}): ${commit.description}`
    : `${commit.type}: ${commit.description}`;
}
