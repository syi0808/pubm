import { migrateFromChangesets, t, ui } from "@pubm/core";
import type { Command } from "commander";

export function registerMigrateCommand(parent: Command): void {
  parent
    .command("migrate")
    .description(t("cmd.migrate.description"))
    .action(async () => {
      const result = migrateFromChangesets();

      if (!result.success) {
        ui.error(String(result.error));
        process.exit(1);
      }

      ui.success(
        t("cmd.migrate.success", { count: result.migratedFiles.length }),
      );
      if (result.configMigrated) {
        ui.hint(t("cmd.migrate.configHint"));
      }
    });
}
