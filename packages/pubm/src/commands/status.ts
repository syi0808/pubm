import { getStatus, ui } from "@pubm/core";
import type { Command } from "commander";

export function registerStatusCommand(parent: Command): void {
  parent
    .command("status")
    .description("Show pending changeset status")
    .option("--verbose", "Show full changeset contents")
    .option("--since <ref>", "Only check changesets since git ref")
    .action(async (options: { verbose?: boolean; since?: string }) => {
      const status = getStatus();

      if (!status.hasChangesets) {
        if (options.since) {
          ui.info("No changesets found.");
          process.exit(1);
        }
        ui.info("No pending changesets.");
        return;
      }

      ui.info("Pending changesets:");
      for (const [name, info] of status.packages) {
        console.log(
          `  ${name}: ${info.bumpType} (${info.changesetCount} changeset${info.changesetCount > 1 ? "s" : ""})`,
        );
        if (options.verbose) {
          for (const summary of info.summaries) {
            console.log(`    - ${summary}`);
          }
        }
      }
    });
}
