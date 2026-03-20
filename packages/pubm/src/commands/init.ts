// packages/pubm/src/commands/init.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ui } from "@pubm/core";
import type { Command } from "commander";
import {
  buildConfigContent,
  detectDefaultBranch,
  detectPackages,
  type InitResult,
  promptBranch,
  promptChangelog,
  promptChangesets,
  promptCI,
  promptGithubRelease,
  promptOverwriteConfig,
  promptPackages,
  promptSkills,
  promptVersioning,
  shouldCreateConfig,
} from "./init-prompts.js";
import {
  detectPackageManager,
  generateChangesetCheckWorkflow,
  generateReleaseWorkflow,
  updateGitignoreForChangesets,
  writeWorkflowFile,
} from "./init-workflows.js";
import { AGENT_LABELS, runSetupSkills } from "./setup-skills.js";

interface SummaryItem {
  label: string;
  value: string;
}

export function registerInitCommand(parent: Command): void {
  parent
    .command("init")
    .description("Interactive setup wizard for pubm configuration")
    .action(async () => {
      try {
        if (!process.stdin.isTTY) {
          throw new Error(
            "pubm init requires an interactive terminal. Use pubm.config.ts for non-interactive configuration.",
          );
        }

        const cwd = process.cwd();
        const summary: SummaryItem[] = [];

        // --- Check existing config ---
        const configPath = path.join(cwd, "pubm.config.ts");
        let skipConfig = false;

        if (existsSync(configPath)) {
          skipConfig = !(await promptOverwriteConfig());
        }

        // --- Package Detection ---
        console.log("\n── Package Detection ──────────────────────────");
        const detected = await detectPackages(cwd);

        if (detected.isMonorepo) {
          const wsType = detected.workspaces.map((w) => w.type).join(", ");
          console.log(`◆ Detected monorepo (${wsType} workspaces)\n`);
        }

        const packages = await promptPackages(detected);
        if (packages.length === 0) {
          ui.warn("No packages selected. Aborting.");
          return;
        }

        // --- Basic Configuration ---
        console.log("\n── Basic Configuration ────────────────────────");
        const branch = await promptBranch(cwd);
        const versioning = detected.isMonorepo
          ? await promptVersioning()
          : ("independent" as const);

        // --- Release Options ---
        console.log("\n── Release Options ────────────────────────────");
        const { enabled: changelog, format: changelogFormat } =
          await promptChangelog();
        const releaseDraft = await promptGithubRelease();

        // --- Workflow Setup ---
        console.log("\n── Workflow Setup ──────────────────────────────");
        const changesets = await promptChangesets();
        const ci = await promptCI();

        // --- Apply: Changesets ---
        if (changesets) {
          const changesetsDir = path.join(cwd, ".pubm", "changesets");
          if (!existsSync(changesetsDir)) {
            mkdirSync(changesetsDir, { recursive: true });
            console.log("  → .pubm/changesets/ created");
          } else {
            console.log("  → .pubm/changesets/ (already exists, skipped)");
          }

          const gitignoreUpdated = updateGitignoreForChangesets(cwd);
          if (gitignoreUpdated) {
            console.log("  → .gitignore updated");
          }
          summary.push({ label: "Changesets", value: "enabled" });
        }

        // --- Apply: CI Workflows ---
        if (ci) {
          const pm = detectPackageManager(cwd);
          let workflowsCreated = 0;

          // release.yml — use user-selected branch for consistency
          const releaseContent = generateReleaseWorkflow(
            detected.isMonorepo,
            branch,
            pm,
          );
          const releaseWritten = writeWorkflowFile(
            cwd,
            "release.yml",
            releaseContent,
          );
          if (releaseWritten) {
            workflowsCreated++;
            console.log("  → .github/workflows/release.yml created");
          } else {
            console.log(
              "  → .github/workflows/release.yml (already exists, skipped)",
            );
          }

          // changeset-check.yml (only if changesets enabled)
          if (changesets) {
            const checkContent = generateChangesetCheckWorkflow(branch);
            const checkWritten = writeWorkflowFile(
              cwd,
              "changeset-check.yml",
              checkContent,
            );
            if (checkWritten) {
              workflowsCreated++;
              console.log("  → .github/workflows/changeset-check.yml created");
            } else {
              console.log(
                "  → .github/workflows/changeset-check.yml (already exists, skipped)",
              );
            }
          }

          if (workflowsCreated > 0) {
            summary.push({
              label: "CI",
              value: `${workflowsCreated} workflow(s) created`,
            });
          }
        }

        // --- Apply: Config ---
        const result: InitResult = {
          packages,
          branch,
          versioning,
          changelog,
          changelogFormat,
          releaseDraft,
          changesets,
          ci,
          isMonorepo: detected.isMonorepo,
        };

        if (!skipConfig) {
          const gitBranch = detectDefaultBranch(cwd);
          if (shouldCreateConfig(result, gitBranch)) {
            const content = buildConfigContent(result);
            writeFileSync(configPath, content);
            summary.push({
              label: "Config",
              value: "pubm.config.ts (created)",
            });
          } else {
            summary.push({
              label: "Config",
              value: "Using default configuration",
            });
          }
        } else {
          summary.push({
            label: "Config",
            value: "pubm.config.ts (kept existing)",
          });
        }

        // --- Coding Agent Skills ---
        console.log("\n── Coding Agent Skills ────────────────────────");
        const wantsSkills = await promptSkills();

        if (wantsSkills) {
          try {
            const { agents, skillCount } = await runSetupSkills(cwd);
            if (agents.length > 0) {
              const agentNames = agents.map((a) => AGENT_LABELS[a]).join(", ");
              summary.push({
                label: "Skills",
                value: `${agentNames} (${skillCount} skills)`,
              });
            }
          } catch (e) {
            ui.warn(`Skills installation failed: ${(e as Error).message}`);
            ui.info("You can install skills later with `pubm setup-skills`.");
          }
        }

        // --- Summary ---
        console.log("\n── Summary ────────────────────────────────────");
        for (const item of summary) {
          console.log(`  ${item.label.padEnd(12)} ${item.value}`);
        }

        ui.success("Ready to publish! Run `pubm` to get started.");
      } catch (e) {
        ui.error((e as Error).message);
        process.exitCode = 1;
      }
    });
}
