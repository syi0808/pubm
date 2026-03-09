import type { Command } from "commander";
import { consoleError } from "../error.js";
import { syncGhSecrets } from "../tasks/preflight.js";
import { loadTokensFromDb } from "../utils/token.js";

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
          : ["npm", "jsr", "crates"];

        const tokens = loadTokensFromDb(registries);

        if (Object.keys(tokens).length === 0) {
          console.log(
            "No stored tokens found. Run `pubm --preflight` first to save tokens.",
          );
          return;
        }

        console.log(
          `Syncing ${Object.keys(tokens).length} token(s) to GitHub Secrets...`,
        );
        await syncGhSecrets(tokens);
        console.log("Done! Tokens synced to GitHub Secrets.");
      } catch (e) {
        consoleError(e as Error);
        process.exitCode = 1;
      }
    });
}
