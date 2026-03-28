import {
  consoleError,
  loadTokensFromDb,
  registryCatalog,
  syncGhSecrets,
  t,
  ui,
} from "@pubm/core";
import type { Command } from "commander";

export function registerSecretsCommand(parent: Command): void {
  const secrets = parent
    .command("secrets")
    .description(t("cmd.secrets.description"));

  secrets
    .command("sync")
    .description(t("cmd.secrets.sync"))
    .option("--registry <registries>", t("cmd.secrets.optionRegistry"))
    .action(async (options: { registry?: string }) => {
      try {
        const registries = options.registry
          ? options.registry.split(",")
          : registryCatalog.keys();

        const tokens = loadTokensFromDb(registries);

        if (Object.keys(tokens).length === 0) {
          ui.info(t("cmd.secrets.noTokens"));
          return;
        }

        ui.info(
          t("cmd.secrets.syncing", { count: Object.keys(tokens).length }),
        );
        await syncGhSecrets(tokens);
        ui.success(t("cmd.secrets.synced"));
      } catch (e) {
        consoleError(e as Error);
        process.exitCode = 1;
      }
    });
}
