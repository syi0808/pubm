import type { VersionRecommendation } from "./types.js";

export function mergeRecommendations(
  sourceResults: VersionRecommendation[][],
): VersionRecommendation[] {
  const seen = new Set<string>();
  const merged: VersionRecommendation[] = [];
  for (const results of sourceResults) {
    for (const rec of results) {
      if (seen.has(rec.packagePath)) continue;
      seen.add(rec.packagePath);
      merged.push(rec);
    }
  }
  return merged;
}
