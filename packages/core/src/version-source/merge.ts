import type { VersionRecommendation } from "./types.js";

export function mergeRecommendations(
  sourceResults: VersionRecommendation[][],
): VersionRecommendation[] {
  const seenKeys = new Set<string>();
  const seenQualifiedPaths = new Set<string>();
  const seenUnqualifiedPaths = new Set<string>();
  const merged: VersionRecommendation[] = [];
  for (const results of sourceResults) {
    for (const rec of results) {
      if (isRecommendationSeen(rec)) continue;
      rememberRecommendation(rec);
      merged.push(rec);
    }
  }
  return merged;

  function isRecommendationSeen(rec: VersionRecommendation): boolean {
    if (rec.packageKey) {
      return (
        seenKeys.has(rec.packageKey) ||
        seenUnqualifiedPaths.has(rec.packagePath)
      );
    }
    return (
      seenUnqualifiedPaths.has(rec.packagePath) ||
      seenQualifiedPaths.has(rec.packagePath)
    );
  }

  function rememberRecommendation(rec: VersionRecommendation): void {
    if (rec.packageKey) {
      seenKeys.add(rec.packageKey);
      seenQualifiedPaths.add(rec.packagePath);
      return;
    }
    seenUnqualifiedPaths.add(rec.packagePath);
  }
}
