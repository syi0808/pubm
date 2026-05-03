// packages/pubm/src/commands/init.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { t, ui } from "@pubm/core";
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
  installGithubWorkflows,
  updateGitignoreForChangesets,
} from "./init-workflows.js";
import { AGENT_LABELS, runSetupSkills } from "./setup-skills.js";

interface SummaryItem {
  label: string;
  value: string;
}

export function registerInitCommand(parent: Command): void {
  parent
    .command("init")
    .description(t("init.description"))
    .action(async () => {
      try {
        if (!process.stdin.isTTY) {
          throw new Error(t("error.init.requiresTty"));
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
        console.log(
          `\n── ${t("init.section.packageDetection")} ──────────────────────────`,
        );
        const detected = await detectPackages(cwd);

        if (detected.isMonorepo) {
          const wsType = detected.workspaces.map((w) => w.type).join(", ");
          console.log(`◆ ${t("init.monorepo.detected", { type: wsType })}\n`);
        }

        const packages = await promptPackages(detected);
        if (packages.length === 0) {
          ui.warn(t("init.noPackages"));
          return;
        }

        // --- Basic Configuration ---
        console.log(
          `\n── ${t("init.section.basicConfig")} ────────────────────────`,
        );
        const branch = await promptBranch(cwd);
        const versioning = detected.isMonorepo
          ? await promptVersioning()
          : ("independent" as const);

        // --- Release Options ---
        console.log(
          `\n── ${t("init.section.releaseOptions")} ────────────────────────────`,
        );
        const changelog = await promptChangelog();
        const releaseDraft = await promptGithubRelease();

        // --- Workflow Setup ---
        console.log(
          `\n── ${t("init.section.workflowSetup")} ──────────────────────────────`,
        );
        const changesets = await promptChangesets();
        const ci = await promptCI();

        // --- Apply: Changesets ---
        if (changesets) {
          const changesetsDir = path.join(cwd, ".pubm", "changesets");
          if (!existsSync(changesetsDir)) {
            mkdirSync(changesetsDir, { recursive: true });
            console.log(`  ${t("init.changeset.created")}`);
          } else {
            console.log(`  ${t("init.changeset.exists")}`);
          }

          const gitignoreUpdated = updateGitignoreForChangesets(cwd);
          if (gitignoreUpdated) {
            console.log(`  ${t("init.gitignore.updated")}`);
          }
          summary.push({ label: "Changesets", value: "enabled" });
        }

        // --- Apply: CI Workflows ---
        if (ci) {
          const pm = detectPackageManager(cwd);
          const workflowResults = await installGithubWorkflows(cwd, {
            defaultBranch: branch,
            packageManager: pm,
            includeChangesetCheck: changesets,
            includeReleasePr: true,
            includePublish: true,
          });
          const workflowsCreated = workflowResults.filter(
            (result) => result.status === "created",
          ).length;

          for (const result of workflowResults) {
            const relativePath = path
              .relative(cwd, result.filePath)
              .replace(/\\/g, "/");
            const action =
              result.status === "created"
                ? "created"
                : "already exists, skipped";
            console.log(`  → ${relativePath} ${action}`);
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
              value: t("init.config.created"),
            });
          } else {
            summary.push({
              label: "Config",
              value: t("init.config.default"),
            });
          }
        } else {
          summary.push({
            label: "Config",
            value: t("init.config.kept"),
          });
        }

        // --- Coding Agent Skills ---
        console.log(
          `\n── ${t("init.section.codingAgentSkills")} ────────────────────────`,
        );
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
            ui.warn(t("init.skills.failed", { error: (e as Error).message }));
            ui.info(t("init.skills.installLater"));
          }
        }

        // --- Summary ---
        console.log(
          `\n── ${t("init.section.summary")} ────────────────────────────────────`,
        );
        for (const item of summary) {
          console.log(`  ${item.label.padEnd(12)} ${item.value}`);
        }

        ui.success(t("init.ready"));
      } catch (e) {
        ui.error((e as Error).message);
        process.exitCode = 1;
      }
    });
}
