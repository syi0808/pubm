import { execFileSync } from "node:child_process";

export interface RawCommit {
  hash: string;
  message: string;
  files: string[];
}

const COMMIT_START_MARKER = "COMMIT_START";
const COMMIT_FILES_MARKER = "COMMIT_FILES";

export function findLastReleaseRef(
  cwd: string,
  packageName?: string,
): string | undefined {
  if (packageName) {
    const scopedTags = execGit(cwd, [
      "tag",
      "--list",
      `${packageName}@[0-9]*.[0-9]*.[0-9]*`,
      "--sort=-v:refname",
    ]);
    if (scopedTags.length > 0) return scopedTags[0];
  }

  const vTags = execGit(cwd, [
    "tag",
    "--list",
    "v[0-9]*.[0-9]*.[0-9]*",
    "--sort=-v:refname",
  ]);
  if (vTags.length > 0) return vTags[0];

  const versionCommit = execGit(cwd, [
    "log",
    "--format=%H",
    "--grep=^Version Packages$",
    "-1",
  ]);
  if (versionCommit.length > 0) return versionCommit[0];

  return undefined;
}

export function getCommitsSinceRef(
  cwd: string,
  ref: string | undefined,
  toRef?: string,
): RawCommit[] {
  const range = ref ? `${ref}..${toRef ?? "HEAD"}` : (toRef ?? "HEAD");
  const format = `${COMMIT_START_MARKER} %h%n%B%n${COMMIT_FILES_MARKER}`;

  const output = execGitRaw(cwd, [
    "log",
    `--format=${format}`,
    "--name-only",
    range,
  ]);

  if (!output.trim()) return [];

  const commits: RawCommit[] = [];
  const lines = output.split("\n");
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith(COMMIT_START_MARKER)) {
      i++;
      continue;
    }

    const hash = lines[i].slice(COMMIT_START_MARKER.length + 1).trim();
    i++;

    const messageLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith(COMMIT_FILES_MARKER)) {
      if (lines[i].startsWith(COMMIT_START_MARKER)) break;
      messageLines.push(lines[i]);
      i++;
    }

    if (i < lines.length && lines[i].startsWith(COMMIT_FILES_MARKER)) {
      i++;
    }

    const files: string[] = [];
    while (i < lines.length && !lines[i].startsWith(COMMIT_START_MARKER)) {
      const file = lines[i].trim();
      if (file) files.push(file);
      i++;
    }

    const message = messageLines.join("\n").trim();
    if (hash && message) {
      commits.push({ hash, message, files });
    }
  }

  return commits;
}

function execGit(cwd: string, args: string[]): string[] {
  return execGitRaw(cwd, args)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function execGitRaw(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8" });
  } catch {
    return "";
  }
}
