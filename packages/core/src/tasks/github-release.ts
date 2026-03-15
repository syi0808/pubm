import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import SemVer from "semver";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";
import { exec } from "../utils/exec.js";

const { prerelease } = SemVer;

export interface ReleaseAsset {
  name: string;
  url: string;
  sha256: string;
}

export interface ReleaseContext {
  packageName: string;
  version: string;
  tag: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

class GitHubReleaseError extends AbstractError {
  name = "GitHub Release Error";
}

/**
 * Parse owner/repo from a git remote URL.
 * Handles both SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git).
 */
function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } {
  const cleaned = remoteUrl.replace(/\.git$/, "");

  // SSH format: git@github.com:owner/repo (no slashes before colon)
  const sshMatch = cleaned.match(/^[^/]*:([^/]+)\/([^/]+)$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // HTTPS format: https://github.com/owner/repo
  const httpsMatch = cleaned.match(/\/([^/]+)\/([^/]+)$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  throw new GitHubReleaseError(
    `Cannot parse owner/repo from remote URL: ${remoteUrl}`,
  );
}

/**
 * Discover platform binary directories under npm/@pubm/{platform}/bin/
 */
function discoverPlatformBinaries(
  rootDir: string,
): { name: string; path: string }[] {
  const scopeDir = join(rootDir, "npm", "@pubm");
  if (!existsSync(scopeDir)) return [];

  const entries = readdirSync(scopeDir, { withFileTypes: true });
  const binaries: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const binDir = join(scopeDir, entry.name, "bin");
    if (!existsSync(binDir)) continue;

    const files = readdirSync(binDir);
    for (const file of files) {
      binaries.push({
        name: `pubm-${entry.name}`,
        path: join(binDir, file),
      });
    }
  }

  return binaries;
}

/**
 * Compute SHA256 hash of a file
 */
function sha256(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Compress a binary into a .tar.gz archive and return the archive path
 */
async function compressBinary(
  binaryPath: string,
  archiveName: string,
  outDir: string,
): Promise<string> {
  const archivePath = join(outDir, `${archiveName}.tar.gz`);
  const binaryFile = basename(binaryPath);
  const binaryDir = join(binaryPath, "..");

  await exec("tar", ["-czf", archivePath, "-C", binaryDir, binaryFile], {
    throwOnError: true,
  });

  return archivePath;
}

/**
 * Format release notes from commits
 */
function formatReleaseNotes(
  commits: { id: string; message: string }[],
  repositoryUrl: string,
  previousTag: string,
  latestTag: string,
): string {
  const lines = commits.map(
    ({ id, message }) =>
      `- ${message.replace(/#(\d+)/g, `[#$1](${repositoryUrl}/issues/$1)`)} ([${id.slice(0, 7)}](${repositoryUrl}/commit/${id}))`,
  );

  lines.push("");
  lines.push(
    `**Full Changelog**: ${repositoryUrl}/compare/${previousTag}...${latestTag}`,
  );

  return lines.join("\n");
}

/**
 * Create a GitHub Release using the GitHub REST API
 */
export async function createGitHubRelease(
  _ctx: PubmContext,
  options: {
    packageName: string;
    version: string;
    tag: string;
    changelogBody?: string;
  },
): Promise<ReleaseContext> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GitHubReleaseError(
      "GITHUB_TOKEN environment variable is required to create a GitHub Release",
    );
  }

  const git = new Git();

  const remoteUrl = await git.repository();
  const repositoryUrl = remoteUrl
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  const { owner, repo } = parseOwnerRepo(remoteUrl);

  // Get tags
  const previousTag =
    (await git.previousTag(options.tag)) || (await git.firstCommit());

  // Use changelog content if provided, otherwise build from commits
  let body: string;
  if (options.changelogBody) {
    body = options.changelogBody;
  } else {
    const commits = (await git.commits(previousTag, options.tag)).slice(1);
    body = formatReleaseNotes(commits, repositoryUrl, previousTag, options.tag);
  }

  // Create the release via GitHub API
  const createResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        tag_name: options.tag,
        name: options.tag,
        body,
        prerelease: !!prerelease(options.version),
      }),
    },
  );

  if (!createResponse.ok) {
    const errorBody = await createResponse.text();
    throw new GitHubReleaseError(
      `Failed to create GitHub Release (${createResponse.status}): ${errorBody}`,
    );
  }

  const release = (await createResponse.json()) as {
    html_url: string;
    upload_url: string;
  };
  const releaseUrl = release.html_url;
  const uploadUrl = release.upload_url.replace(/\{[^}]*\}/, "");

  // Discover and compress platform binaries
  const rootDir = process.cwd();
  const binaries = discoverPlatformBinaries(rootDir);
  const tempDir = join(tmpdir(), `pubm-release-${Date.now()}`);

  const assets: ReleaseAsset[] = [];

  if (binaries.length > 0) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });

    for (const binary of binaries) {
      const archivePath = await compressBinary(
        binary.path,
        binary.name,
        tempDir,
      );
      const archiveName = `${binary.name}.tar.gz`;
      const archiveContent = readFileSync(archivePath);

      // Upload asset via GitHub API
      const uploadResponse = await fetch(
        `${uploadUrl}?name=${encodeURIComponent(archiveName)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/gzip",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: archiveContent,
        },
      );

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text();
        throw new GitHubReleaseError(
          `Failed to upload asset ${archiveName} (${uploadResponse.status}): ${errorBody}`,
        );
      }

      const uploadedAsset = (await uploadResponse.json()) as {
        browser_download_url: string;
      };

      assets.push({
        name: archiveName,
        url: uploadedAsset.browser_download_url,
        sha256: sha256(archivePath),
      });
    }

    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    packageName: options.packageName,
    version: options.version,
    tag: options.tag,
    releaseUrl,
    assets,
  };
}
