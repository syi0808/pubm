import { migrateFromChangesets } from "@pubm/core";
import type { Command } from "commander";

export function registerMigrateCommand(parent: Command): void {
  parent
    .command("migrate")
    .description("Migrate from .changeset/ to .pubm/")
    .action(async () => {
      const result = migrateFromChangesets();

      if (!result.success) {
        console.error(result.error);
        process.exit(1);
      }

      console.log(`Migrated ${result.migratedFiles.length} changeset files.`);
      if (result.configMigrated) {
        console.log(
          "Note: .changeset/config.json detected. Please manually create pubm.config.ts.",
        );
      }
    });
}
