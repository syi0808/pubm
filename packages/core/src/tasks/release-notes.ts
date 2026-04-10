import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConventionalCommitChangelogWriter } from "../changelog/conventional-commit-writer.js";
import type { ChangelogSection } from "../changelog/types.js";
import { parseChangelogSection } from "../changeset/changelog-parser.js";
import type { PubmContext } from "../context.js";
import type { RawCommit } from "../conventional-commit/git-log.js";
import { parseConventionalCommit } from "../conventional-commit/parser.js";
import { resolveCommitPackages } from "../conventional-commit/scope-resolver.js";
import { Git } from "../git.js";
import { copyToClipboard } from "../utils/clipboard.js";

export function renderReleaseNoteSections(
  sections: ChangelogSection[],
): string {
  if (sections.length === 0) return "";

  const parts: string[] = [];
  for (const section of sections) {
    if (section.category) {
      parts.push(`### ${section.category}\n\n${section.items.join("\n")}`);
    } else {
      parts.push(section.items.join("\n"));
    }
  }

  return parts.join("\n\n");
}

export async function buildReleaseBody(
  ctx: PubmContext,
  options: {
    pkgPath?: string;
    version: string;
    tag: string;
    repositoryUrl: string;
    appendCompareLink?: boolean;
    /** Pre-resolved previousTag to avoid redundant git calls (used by buildFixedReleaseBody) */
    previousTag?: string;
  },
): Promise<string> {
  const { pkgPath, version, tag, repositoryUrl } = options;
  const appendCompareLink = options.appendCompareLink ?? true;

  const git = new Git();
  const previousTag =
    options.previousTag ??
    ((await git.previousTag(tag)) || (await git.firstCommit()));

  const compareLink = `**Full Changelog**: ${repositoryUrl}/compare/${previousTag}...${tag}`;

  // Priority 1: CHANGELOG.md
  const changelogBody = extractChangelog(ctx, pkgPath, version);
  if (changelogBody) {
    return appendCompareLink
      ? `${changelogBody}\n\n${compareLink}`
      : changelogBody;
  }

  // Priority 2 & 3: Commits
  // Use git.commits for the raw list; the first entry is the boundary commit itself, so slice(1)
  const commits = (await git.commits(previousTag, tag)).slice(1);
  if (commits.length === 0) {
    return appendCompareLink ? compareLink : "";
  }

  // Parse as conventional commits with file paths (needed for scope resolution in monorepos)
  // Use bounded range (previousTag..tag) to avoid including commits past the tag
  const rawCommits = getCommitsBetweenRefs(ctx.cwd, previousTag, tag);
  const parsed = rawCommits
    .map((c) => parseConventionalCommit(c.hash, c.message, c.files))
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Filter by package scope in monorepo independent mode
  const filtered = pkgPath
    ? parsed.filter((c) => {
        const packages = resolveCommitPackages(c, [pkgPath]);
        return packages.length > 0;
      })
    : parsed;

  if (filtered.length > 0) {
    // Map to VersionEntry for the writer
    const entries = filtered.map((c) => ({
      summary: c.description,
      type: c.type,
      hash: c.hash.slice(0, 7),
    }));

    const writer = new ConventionalCommitChangelogWriter();
    const sections = writer.formatEntries(entries);
    const body = renderReleaseNoteSections(sections);

    return appendCompareLink ? `${body}\n\n${compareLink}` : body;
  }

  // Priority 3: Raw commit list (no conventional commits found, or none matched this package)
  const lines = commits.map(
    ({ id, message }) => `- ${message} (${id.slice(0, 7)})`,
  );
  const body = lines.join("\n");

  return appendCompareLink ? `${body}\n\n${compareLink}` : body;
}

export async function buildFixedReleaseBody(
  ctx: PubmContext,
  options: {
    packages: Array<{ pkgPath: string; pkgName: string; version: string }>;
    tag: string;
    repositoryUrl: string;
  },
): Promise<string> {
  const { packages, tag, repositoryUrl } = options;

  // Resolve previousTag once and pass it down to avoid redundant git calls per package
  const git = new Git();
  const previousTag = (await git.previousTag(tag)) || (await git.firstCommit());

  const sections: string[] = [];
  for (const pkg of packages) {
    const body = await buildReleaseBody(ctx, {
      pkgPath: pkg.pkgPath,
      version: pkg.version,
      tag,
      repositoryUrl,
      appendCompareLink: false,
      previousTag,
    });

    sections.push(`## ${pkg.pkgName} v${pkg.version}\n\n${body}`);
  }

  const joined = sections.join("\n\n---\n\n");
  return `${joined}\n\n**Full Changelog**: ${repositoryUrl}/compare/${previousTag}...${tag}`;
}

function extractChangelog(
  ctx: PubmContext,
  pkgPath: string | undefined,
  version: string,
): string | null {
  const changelogPath = pkgPath
    ? join(ctx.cwd, pkgPath, "CHANGELOG.md")
    : join(ctx.cwd, "CHANGELOG.md");

  if (!existsSync(changelogPath)) return null;

  return parseChangelogSection(readFileSync(changelogPath, "utf-8"), version);
}

const MAX_URL_LENGTH = 8000;

export interface TruncateResult {
  body: string;
  truncated: boolean;
  clipboardCopied: boolean;
}

export async function truncateForUrl(
  body: string,
  baseUrl: string,
): Promise<TruncateResult> {
  const testUrl = `${baseUrl}${encodeURIComponent(body)}`;
  if (testUrl.length <= MAX_URL_LENGTH) {
    return { body, truncated: false, clipboardCopied: false };
  }

  const clipboardCopied = await copyToClipboard(body);

  const suffix = clipboardCopied
    ? "\n\n... (truncated, full notes copied to clipboard)"
    : "\n\n... (truncated)";

  const availableLength =
    MAX_URL_LENGTH - baseUrl.length - encodeURIComponent(suffix).length;

  let lo = 0;
  let hi = body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodeURIComponent(body.slice(0, mid)).length <= availableLength) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return {
    body: body.slice(0, lo) + suffix,
    truncated: true,
    clipboardCopied,
  };
}

/**
 * Get commits with file paths between two refs (bounded range).
 * Uses previousTag..tag to avoid including commits past the tag.
 */
function getCommitsBetweenRefs(
  cwd: string,
  fromRef: string,
  toRef: string,
): RawCommit[] {
  try {
    const output = execFileSync(
      "git",
      [
        "log",
        `${fromRef}..${toRef}`,
        "--format=COMMIT_START %h%n%B%nCOMMIT_FILES",
        "--name-only",
      ],
      { cwd, encoding: "utf-8" },
    );

    if (!output.trim()) return [];

    const commits: RawCommit[] = [];
    const lines = output.split("\n");
    let i = 0;

    while (i < lines.length) {
      if (!lines[i].startsWith("COMMIT_START")) {
        i++;
        continue;
      }

      const hash = lines[i].slice("COMMIT_START ".length).trim();
      i++;

      const messageLines: string[] = [];
      while (
        i < lines.length &&
        !lines[i].startsWith("COMMIT_FILES") &&
        !lines[i].startsWith("COMMIT_START")
      ) {
        messageLines.push(lines[i]);
        i++;
      }

      if (i < lines.length && lines[i].startsWith("COMMIT_FILES")) i++;

      const files: string[] = [];
      while (i < lines.length && !lines[i].startsWith("COMMIT_START")) {
        const file = lines[i].trim();
        if (file) files.push(file);
        i++;
      }

      const message = messageLines.join("\n").trim();
      if (hash && message) commits.push({ hash, message, files });
    }

    return commits;
  } catch {
    return [];
  }
}
