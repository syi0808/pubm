import { readFileSync } from "node:fs";
import SemVer from "semver";
import type {
  PreparedAsset,
  ReleaseAsset,
  ReleaseContext,
} from "../assets/types.js";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";

const { prerelease } = SemVer;

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
    assets: PreparedAsset[];
  },
): Promise<ReleaseContext | null> {
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

  if (createResponse.status === 422) {
    return null;
  }

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

  const releaseAssets: ReleaseAsset[] = [];

  for (const asset of options.assets) {
    const archiveContent = readFileSync(asset.filePath);

    const uploadResponse = await fetch(
      `${uploadUrl}?name=${encodeURIComponent(asset.name)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/octet-stream",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: archiveContent,
      },
    );

    if (!uploadResponse.ok) {
      const errorBody = await uploadResponse.text();
      throw new GitHubReleaseError(
        `Failed to upload asset ${asset.name} (${uploadResponse.status}): ${errorBody}`,
      );
    }

    const uploaded = (await uploadResponse.json()) as {
      browser_download_url: string;
    };

    releaseAssets.push({
      name: asset.name,
      url: uploaded.browser_download_url,
      sha256: asset.sha256,
      platform: asset.platform,
    });
  }

  return {
    packageName: options.packageName,
    version: options.version,
    tag: options.tag,
    releaseUrl,
    assets: releaseAssets,
  };
}
