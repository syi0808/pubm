import { execFileSync } from "node:child_process";
import path from "node:path";

export function detectChangesetFiles(
  baseBranch: string,
  cwd: string,
  directory = ".pubm/changesets",
): string[] {
  try {
    const changesetDirectory = normalizeChangesetDirectory(directory);
    const output = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "--diff-filter=ACMR",
        `origin/${baseBranch}...HEAD`,
        "--",
        `${changesetDirectory}/*.md`,
      ],
      { cwd, encoding: "utf8" },
    );

    return output
      .trim()
      .split("\n")
      .filter((f: string) => f.length > 0)
      .filter(
        (f: string) =>
          path.posix.basename(f.replace(/\\/g, "/")) !== "README.md",
      );
  } catch {
    return [];
  }
}

function normalizeChangesetDirectory(directory: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || normalized === ".") return ".";
  return normalized;
}
