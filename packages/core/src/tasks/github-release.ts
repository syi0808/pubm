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
import { t } from "../i18n/index.js";
import { parseOwnerRepo } from "../utils/parse-owner-repo.js";

const { prerelease } = SemVer;

class GitHubReleaseError extends AbstractError {
  name = t("error.githubRelease.name");
}

function isAlreadyExistingRelease(errorBody: string): boolean {
  if (/already[_ ]exists/i.test(errorBody)) {
    return true;
  }

  try {
    const parsed = JSON.parse(errorBody) as {
      message?: unknown;
      errors?: unknown;
    };

    if (Array.isArray(parsed.errors)) {
      return parsed.errors.some((error) => {
        if (!error || typeof error !== "object") {
          return false;
        }

        const { code, message } = error as {
          code?: unknown;
          message?: unknown;
        };
        return (
          code === "already_exists" ||
          (typeof message === "string" && /already[_ ]exists/i.test(message))
        );
      });
    }

    return false;
  } catch {
    return false;
  }
}

async function deleteGitHubReleaseByRepository(options: {
  token: string;
  owner: string;
  repo: string;
  releaseId: number;
}): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${options.owner}/${options.repo}/releases/${options.releaseId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok && response.status !== 404) {
    const errorBody = await response.text();
    throw new GitHubReleaseError(
      t("error.githubRelease.deleteFailed", {
        id: options.releaseId,
        status: response.status,
        body: errorBody,
      }),
    );
  }
}

/**
 * Create a GitHub Release using the GitHub REST API
 */
export async function createGitHubRelease(
  _ctx: PubmContext,
  options: {
    displayLabel: string;
    version: string;
    tag: string;
    body: string;
    assets: PreparedAsset[];
    draft?: boolean;
  },
): Promise<ReleaseContext | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GitHubReleaseError(t("error.githubRelease.tokenRequired"));
  }

  const git = new Git();

  const remoteUrl = await git.repository();
  const { owner, repo } = parseOwnerRepo(remoteUrl);

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
        body: options.body,
        draft: !!options.draft,
        prerelease: !!prerelease(options.version),
      }),
    },
  );

  if (createResponse.status === 422) {
    const errorBody = await createResponse.text();
    if (isAlreadyExistingRelease(errorBody)) {
      return null;
    }

    throw new GitHubReleaseError(
      t("error.githubRelease.createFailed", {
        status: createResponse.status,
        body: errorBody,
      }),
    );
  }

  if (!createResponse.ok) {
    const errorBody = await createResponse.text();
    throw new GitHubReleaseError(
      t("error.githubRelease.createFailed", {
        status: createResponse.status,
        body: errorBody,
      }),
    );
  }

  const release = (await createResponse.json()) as {
    id: number;
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
      try {
        await deleteGitHubReleaseByRepository({
          token,
          owner,
          repo,
          releaseId: release.id,
        });
      } catch {
        // Preserve the upload failure as the primary release error.
      }

      throw new GitHubReleaseError(
        t("error.githubRelease.uploadFailed", {
          name: asset.name,
          status: uploadResponse.status,
          body: errorBody,
        }),
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
    displayLabel: options.displayLabel,
    version: options.version,
    tag: options.tag,
    releaseUrl,
    releaseId: release.id,
    assets: releaseAssets,
  };
}

/**
 * Delete a GitHub Release by its ID
 */
export async function deleteGitHubRelease(releaseId: number): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GitHubReleaseError(t("error.githubRelease.tokenRequiredDelete"));
  }

  const git = new Git();
  const remoteUrl = await git.repository();
  const { owner, repo } = parseOwnerRepo(remoteUrl);

  await deleteGitHubReleaseByRepository({ token, owner, repo, releaseId });
}
