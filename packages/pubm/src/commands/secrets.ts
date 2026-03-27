import {
  consoleError,
  loadTokensFromDb,
  registryCatalog,
  syncGhSecrets,
  ui,
} from "@pubm/core";
import type { Command } from "commander";

export function registerSecretsCommand(parent: Command): void {
  const secrets = parent.command("secrets").description("Manage stored tokens");

  secrets
    .command("sync")
    .description("Sync stored tokens to GitHub Secrets")
    .option("--registry <registries>", "Filter to specific registries")
    .action(async (options: { registry?: string }) => {
      try {
        const registries = options.registry
          ? options.registry.split(",")
          : registryCatalog.keys();

        const tokens = loadTokensFromDb(registries);

        if (Object.keys(tokens).length === 0) {
          ui.info(
            "No stored tokens found. Run `pubm --mode ci --phase prepare` first to save tokens.",
          );
          return;
        }

        ui.info(
          `Syncing ${Object.keys(tokens).length} token(s) to GitHub Secrets...`,
        );
        await syncGhSecrets(tokens);
        ui.success("Tokens synced to GitHub Secrets.");
      } catch (e) {
        consoleError(e as Error);
        process.exitCode = 1;
      }
    });
}
