import { findOutFile } from "./package";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export const lockFiles: Record<PackageManager, string[]> = {
  bun: ["bun.lock", "bun.lockb"],
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
};

export function getInstallCommand(
  pm: PackageManager,
  isYarnBerry?: boolean,
): string[] {
  switch (pm) {
    case "bun":
      return ["bun", "install", "--lockfile-only"];
    case "npm":
      return ["npm", "install", "--package-lock-only"];
    case "pnpm":
      return ["pnpm", "install", "--lockfile-only"];
    case "yarn":
      return isYarnBerry
        ? ["yarn", "install", "--mode", "update-lockfile"]
        : ["yarn", "install"];
  }
}

export async function getPackageManager(): Promise<PackageManager> {
  for (const [packageManager, files] of Object.entries(lockFiles)) {
    for (const file of files) {
      if (await findOutFile(file)) return packageManager as PackageManager;
    }
  }

  console.warn("No lock file found, defaulting to npm.");
  return "npm";
}
