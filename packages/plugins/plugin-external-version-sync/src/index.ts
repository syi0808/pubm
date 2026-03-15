import path from "node:path";
import process from "node:process";
import type { PubmPlugin } from "@pubm/core";
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
        const plan = ctx.runtime.versionPlan;
        let version: string;

        if (plan) {
          if (plan.mode === "independent") {
            if (options.version) {
              version = options.version(plan.packages);
            } else {
              throw new Error(
                "external-version-sync: 'version' callback is required in independent mode. " +
                  "Provide a version picker, e.g. version: (pkgs) => pkgs.get('@pubm/core') ?? ''",
              );
            }
          } else {
            version = plan.version;
          }
        } else {
          // Fallback during migration
          version = ctx.runtime.version!;
        }

        const errors: string[] = [];

        for (const target of options.targets) {
          try {
            const filePath = path.isAbsolute(target.file)
              ? target.file
              : path.resolve(cwd, target.file);

            syncVersionInFile(filePath, version, target);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
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
