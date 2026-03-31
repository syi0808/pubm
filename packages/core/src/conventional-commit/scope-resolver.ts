import path from "node:path";
import type { ConventionalCommit } from "./types.js";

export function resolveCommitPackages(
  commit: ConventionalCommit,
  packagePaths: string[],
): string[] {
  const matched = new Set<string>();

  if (commit.scope) {
    for (const pkgPath of packagePaths) {
      const dirName = path.basename(pkgPath);
      if (dirName === commit.scope) {
        matched.add(pkgPath);
      }
    }
    if (matched.size > 0) return [...matched];
  }

  for (const file of commit.files) {
    const normalized = file.replace(/\\/g, "/");
    for (const pkgPath of packagePaths) {
      // Root package (".") matches all files
      if (pkgPath === ".") {
        matched.add(pkgPath);
        continue;
      }
      const normalizedPkg = pkgPath.replace(/\\/g, "/");
      if (
        normalized.startsWith(`${normalizedPkg}/`) ||
        normalized === normalizedPkg
      ) {
        matched.add(pkgPath);
      }
    }
  }

  return [...matched];
}
