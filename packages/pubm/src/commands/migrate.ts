import { migrateFromChangesets, ui } from "@pubm/core";
import type { Command } from "commander";

export function registerMigrateCommand(parent: Command): void {
  parent
    .command("migrate")
    .description("Migrate from .changeset/ to .pubm/")
    .action(async () => {
      const result = migrateFromChangesets();

      if (!result.success) {
        ui.error(String(result.error));
        process.exit(1);
      }

      ui.success(`Migrated ${result.migratedFiles.length} changeset files.`);
      if (result.configMigrated) {
        ui.hint(
          ".changeset/config.json detected. Please manually create pubm.config.ts.",
        );
      }
    });
}
