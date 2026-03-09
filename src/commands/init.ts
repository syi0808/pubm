import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";

export function registerInitCommand(parent: Command): void {
  parent
    .command("init")
    .description("Initialize pubm configuration")
    .action(async () => {
      const pubmDir = path.resolve(".pubm", "changesets");
      if (!existsSync(pubmDir)) {
        mkdirSync(pubmDir, { recursive: true });
        console.log("Created .pubm/changesets/");
      }

      const configPath = path.resolve("pubm.config.ts");
      if (!existsSync(configPath)) {
        writeFileSync(
          configPath,
          [
            "import { defineConfig } from 'pubm'",
            "",
            "export default defineConfig({})",
            "",
          ].join("\n"),
        );
        console.log("Created pubm.config.ts");
      }

      console.log("pubm initialized successfully.");
    });
}
