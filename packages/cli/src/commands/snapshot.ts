import process from "node:process";
import {
  exec,
  generateSnapshotVersion,
  getPackageJson,
  getPackageManager,
  loadConfig,
  replaceVersion,
} from "@pubm/core";
import type { Command } from "commander";

export function registerSnapshotCommand(parent: Command): void {
  parent
    .command("snapshot")
    .description("Create a snapshot release")
    .argument("[tag]", "Snapshot tag name")
    .option("--snapshot-id <id>", "Custom snapshot identifier (e.g., git SHA)")
    .option("--registry <registries>", "Target registries", "npm,jsr")
    .option("--no-build", "Skip build step")
    .option("--dry-run", "Show what would happen without publishing")
    .action(
      async (
        tag?: string,
        options?: {
          snapshotId?: string;
          registry?: string;
          build?: boolean;
          dryRun?: boolean;
        },
      ) => {
        const cwd = process.cwd();
        const config = await loadConfig(cwd);
        const pkg = await getPackageJson();

        const snapshotVersion = generateSnapshotVersion({
          tag: tag ?? "snapshot",
          baseVersion: pkg.version,
          commit: options?.snapshotId,
          template: options?.snapshotId ? "{base}-{tag}-{commit}" : undefined,
          useCalculatedVersion: !!config?.snapshot?.useCalculatedVersion,
        });

        console.log(`Snapshot version: ${snapshotVersion}`);

        if (options?.dryRun) {
          console.log("Dry run — no changes made.");
          return;
        }

        // Write snapshot version temporarily
        await replaceVersion(snapshotVersion);

        try {
          // Build if needed
          if (options?.build !== false) {
            const packageManager = await getPackageManager();
            await exec(packageManager, ["run", "build"], {
              throwOnError: true,
            });
          }

          // Publish to registries with snapshot tag
          const registries = options?.registry?.split(",") ?? ["npm", "jsr"];

          for (const registry of registries) {
            if (registry === "npm") {
              try {
                await exec(
                  "npm",
                  ["publish", "--tag", tag ?? "snapshot", "--no-git-checks"],
                  { throwOnError: true },
                );
                console.log(`Published ${snapshotVersion} to npm`);
              } catch (error) {
                console.error(`Failed to publish to npm: ${error}`);
              }
            } else if (registry === "jsr") {
              try {
                await exec("jsr", ["publish", "--allow-dirty"], {
                  throwOnError: true,
                });
                console.log(`Published ${snapshotVersion} to jsr`);
              } catch (error) {
                console.error(`Failed to publish to jsr: ${error}`);
              }
            }
          }

          console.log(`\nSnapshot ${snapshotVersion} published successfully.`);
        } finally {
          // Always restore original version
          await replaceVersion(pkg.version);
        }
      },
    );
}
