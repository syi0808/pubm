import { existsSync, rmSync, statSync, unlinkSync } from "node:fs";

export function removeFiles(targets: string[]): string[] {
  const removed: string[] = [];

  for (const target of targets) {
    if (!existsSync(target)) continue;

    if (statSync(target).isDirectory()) {
      rmSync(target, { recursive: true });
    } else {
      unlinkSync(target);
    }

    removed.push(target);
  }

  return removed;
}
