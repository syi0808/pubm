import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ui } from "@pubm/core";
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
        ui.success("Created .pubm/changesets/");
      }

      // Base init: create pubm.config.ts
      const configPath = path.resolve(cwd, "pubm.config.ts");
      if (!existsSync(configPath)) {
        writeFileSync(
          configPath,
          [
            "import { defineConfig } from '@pubm/core'",
            "",
            "export default defineConfig({})",
            "",
          ].join("\n"),
        );
        ui.success("Created pubm.config.ts");
      }

      // Changesets setup (only with --changesets flag)
      if (options.changesets) {
        const defaultBranch = detectDefaultBranch(cwd);

        if (updateGitignoreForChangesets(cwd)) {
          ui.success("Updated .gitignore (changeset files tracked)");
        }

        if (writeChangesetCheckWorkflow(cwd, defaultBranch)) {
          ui.success("Created .github/workflows/changeset-check.yml");
        }

        ui.success("pubm initialized successfully.");
        console.log(
          "- Add changesets: pubm changesets add\n" +
            "- PRs without changesets will fail the changeset-check CI\n" +
            "- Use 'no-changeset' label to skip for non-code changes",
        );
      } else {
        ui.success("pubm initialized successfully.");
      }
    });
}
