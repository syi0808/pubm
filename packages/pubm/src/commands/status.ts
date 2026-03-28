import { getStatus, t, ui } from "@pubm/core";
import type { Command } from "commander";

export function registerStatusCommand(parent: Command): void {
  parent
    .command("status")
    .description(t("cmd.status.description"))
    .option("--verbose", t("cmd.status.optionVerbose"))
    .option("--since <ref>", t("cmd.status.optionSince"))
    .action(async (options: { verbose?: boolean; since?: string }) => {
      const status = getStatus();

      if (!status.hasChangesets) {
        if (options.since) {
          ui.info(t("cmd.status.noChangesets"));
          process.exit(1);
        }
        ui.info(t("cmd.status.noPending"));
        return;
      }

      ui.info(t("cmd.status.pending"));
      for (const [name, info] of status.packages) {
        console.log(
          `  ${t("cmd.status.packageLine", { name, type: info.bumpType, count: info.changesetCount })}`,
        );
        if (options.verbose) {
          for (const summary of info.summaries) {
            console.log(`    - ${summary}`);
          }
        }
      }
    });
}
