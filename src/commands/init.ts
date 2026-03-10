import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import {
  detectDefaultBranch,
  updateGitignoreForChangesets,
  writeChangesetCheckWorkflow,
} from "./init-changesets.js";

export function registerInitCommand(parent: Command): void {
  parent
    .command("init")
    .description("Initialize pubm configuration")
    .option("--changesets", "Set up changesets workflow (CI check, gitignore)")
    .action(async (options: { changesets?: boolean }) => {
      const cwd = process.cwd();

      // Base init: create .pubm/changesets/ directory
      const pubmDir = path.resolve(cwd, ".pubm", "changesets");
      if (!existsSync(pubmDir)) {
        mkdirSync(pubmDir, { recursive: true });
        console.log("Created .pubm/changesets/");
      }

      // Base init: create pubm.config.ts
      const configPath = path.resolve(cwd, "pubm.config.ts");
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

      // Changesets setup (only with --changesets flag)
      if (options.changesets) {
        const defaultBranch = detectDefaultBranch(cwd);

        if (updateGitignoreForChangesets(cwd)) {
          console.log("Updated .gitignore (changeset files tracked)");
        }

        if (writeChangesetCheckWorkflow(cwd, defaultBranch)) {
          console.log("Created .github/workflows/changeset-check.yml");
        }

        console.log(
          "\nChangeset workflow is ready!\n" +
            "- Add changesets: pubm changesets add\n" +
            "- PRs without changesets will fail the changeset-check CI\n" +
            "- Use 'no-changeset' label to skip for non-code changes",
        );
      } else {
        console.log("pubm initialized successfully.");
      }
    });
}
