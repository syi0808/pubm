/**
 * Parse owner/repo from a git remote URL.
 * Handles both SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git).
 */
export function parseOwnerRepo(remoteUrl: string): {
  owner: string;
  repo: string;
} {
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

  throw new Error(`Cannot parse owner/repo from remote URL: ${remoteUrl}`);
}
