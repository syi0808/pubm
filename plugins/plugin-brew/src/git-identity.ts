import { execSync } from "node:child_process";

export function ensureGitIdentity(cwd?: string): void {
  const opts = cwd
    ? { cwd, encoding: "utf-8" as const }
    : { encoding: "utf-8" as const };

  try {
    execSync("git config user.name", { ...opts, stdio: "pipe" });
  } catch {
    execSync('git config user.name "pubm[bot]"', opts);
  }

  try {
    execSync("git config user.email", { ...opts, stdio: "pipe" });
  } catch {
    execSync(
      'git config user.email "pubm[bot]@users.noreply.github.com"',
      opts,
    );
  }
}
