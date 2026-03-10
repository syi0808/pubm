import { findOutFile } from "./package";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const lockFile: Record<PackageManager, string[]> = {
  bun: ["bun.lock", "bun.lockb"],
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
};

export async function getPackageManager(): Promise<PackageManager> {
  for (const [packageManager, lockFiles] of Object.entries(lockFile)) {
    for (const lockFile of lockFiles) {
      if (await findOutFile(lockFile)) return packageManager as PackageManager;
    }
  }

  console.warn("No lock file found, defaulting to npm.");
  return "npm";
}
