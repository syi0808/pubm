import path from "node:path";
import process from "node:process";
import type { PubmPlugin } from "../../plugin/types.js";
import { syncVersionInFile } from "./sync.js";
import type { ExternalVersionSyncOptions } from "./types.js";

export type {
  ExternalVersionSyncOptions,
  JsonTarget,
  RegexTarget,
  SyncTarget,
} from "./types.js";

export function externalVersionSync(
  options: ExternalVersionSyncOptions,
): PubmPlugin {
  return {
    name: "external-version-sync",
    hooks: {
      afterVersion: async (ctx) => {
        const cwd = process.cwd();

        const errors: string[] = [];

        for (const target of options.targets) {
          try {
            const filePath = path.isAbsolute(target.file)
              ? target.file
              : path.resolve(cwd, target.file);

            const changed = syncVersionInFile(filePath, ctx.version, target);

            if (changed) {
              console.log(`  Synced version in ${target.file}`);
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.error(`  Failed to sync ${target.file}: ${message}`);
            errors.push(`${target.file}: ${message}`);
          }
        }

        if (errors.length > 0) {
          throw new Error(
            `external-version-sync failed for ${errors.length} target(s):\n${errors.join("\n")}`,
          );
        }
      },
    },
  };
}
