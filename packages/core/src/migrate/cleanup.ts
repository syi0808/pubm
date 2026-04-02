import { rmSync, statSync, unlinkSync } from "node:fs";

export function removeFiles(targets: string[]): string[] {
  const removed: string[] = [];

  for (const target of targets) {
    try {
      if (statSync(target).isDirectory()) {
        rmSync(target, { recursive: true });
      } else {
        unlinkSync(target);
      }
      removed.push(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }

  return removed;
}
