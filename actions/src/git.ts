import { execFileSync } from "node:child_process";

export function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function configureGitAuthor(cwd: string): void {
  git(["config", "user.name", "pubm-release-bot"], cwd);
  git(
    ["config", "user.email", "pubm-release-bot@users.noreply.github.com"],
    cwd,
  );
}

export function checkoutReleaseBranch(
  cwd: string,
  baseBranch: string,
  releaseBranch: string,
): void {
  git(["fetch", "origin", baseBranch], cwd);
  git(["checkout", "-B", releaseBranch, `origin/${baseBranch}`], cwd);
}

export function forcePushBranch(cwd: string, branch: string): void {
  git(["push", "--force", "origin", `${branch}:${branch}`], cwd);
}
