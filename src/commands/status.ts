import type { CAC } from "cac";
import { getStatus } from "../changeset/status.js";

export function registerStatusCommand(cli: CAC): void {
  cli
    .command("status", "Show pending changeset status")
    .option("--verbose", "Show full changeset contents")
    .option("--since <ref>", "Only check changesets since git ref")
    .action(async (options: { verbose?: boolean; since?: string }) => {
      const status = getStatus();

      if (!status.hasChangesets) {
        if (options.since) {
          console.log("No changesets found.");
          process.exit(1);
        }
        console.log("No pending changesets.");
        return;
      }

      console.log("Pending changesets:");
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
