import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ui } from "@pubm/core";
import { prompt } from "@pubm/runner";
import type { Command } from "commander";
import {
  detectPackageManager,
  generateGithubWorkflowFiles,
  githubWorkflowPath,
  installGithubWorkflows,
  type PackageManager,
} from "./init-workflows.js";

const PACKAGE_MANAGERS = new Set<PackageManager>([
  "bun",
  "pnpm",
  "yarn",
  "npm",
  "cargo",
]);

function detectDefaultBranch(cwd: string): string {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}

interface GithubWorkflowInstallOptions {
  force?: boolean;
  dryRun?: boolean;
  packageManager?: PackageManager;
  branch?: string;
  skipChangesetCheck?: boolean;
  skipReleasePr?: boolean;
  skipPublish?: boolean;
}

export function registerWorkflowCommand(parent: Command): void {
  const workflow = parent
    .command("workflow")
    .description("Manage pubm workflow integrations");

  const install = workflow
    .command("install")
    .description("Install pubm workflow integrations");

  install
    .command("github")
    .description("Install GitHub Actions workflows for pubm")
    .option("--force", "overwrite existing workflow files")
    .option("--dry-run", "print workflow files without writing them")
    .option(
      "--package-manager <pm>",
      "package manager to prepare in publish workflow (bun, pnpm, yarn, npm, cargo)",
    )
    .option("--branch <branch>", "release branch name")
    .option("--skip-changeset-check", "do not install changeset check workflow")
    .option("--skip-release-pr", "do not install release PR workflow")
    .option("--skip-publish", "do not install publish workflow")
    .action(async (options: GithubWorkflowInstallOptions) => {
      try {
        await installGithubActionsWorkflows(process.cwd(), options);
      } catch (error) {
        ui.error((error as Error).message);
        process.exitCode = 1;
      }
    });
}

export async function installGithubActionsWorkflows(
  cwd: string,
  options: GithubWorkflowInstallOptions,
): Promise<void> {
  const packageManager = options.packageManager ?? detectPackageManager(cwd);
  if (!PACKAGE_MANAGERS.has(packageManager)) {
    throw new Error(
      `Unsupported package manager "${packageManager}". Use bun, pnpm, yarn, npm, or cargo.`,
    );
  }

  const defaultBranch = options.branch ?? detectDefaultBranch(cwd);
  const includeChangesetCheck = !options.skipChangesetCheck;
  const includeReleasePr = !options.skipReleasePr;
  const includePublish = !options.skipPublish;

  if (!includeChangesetCheck && !includeReleasePr && !includePublish) {
    ui.warn("No workflows selected.");
    return;
  }

  const workflowOptions = {
    defaultBranch,
    packageManager,
    includeChangesetCheck,
    includeReleasePr,
    includePublish,
  };
  const workflows = generateGithubWorkflowFiles(workflowOptions);
  const existing = workflows.filter((workflow) =>
    existsSync(githubWorkflowPath(cwd, workflow.filename)),
  );

  if (options.dryRun) {
    for (const workflow of workflows) {
      const relativePath = path
        .relative(cwd, githubWorkflowPath(cwd, workflow.filename))
        .replace(/\\/g, "/");
      const lineCount = workflow.content.trimEnd().split("\n").length;
      console.log(`${relativePath} (${lineCount} lines)`);
    }
    return;
  }

  if (existing.length > 0 && !options.force && !process.stdin.isTTY) {
    const files = existing.map((workflow) => workflow.filename).join(", ");
    throw new Error(
      `Workflow file already exists: ${files}. Use --force to overwrite.`,
    );
  }

  const results = await installGithubWorkflows(cwd, {
    ...workflowOptions,
    force: options.force,
    confirmOverwrite: process.stdin.isTTY
      ? async (filePath) =>
          prompt<boolean>({
            type: "confirm",
            message: `Overwrite ${path.relative(cwd, filePath).replace(/\\/g, "/")}?`,
            initial: false,
          })
      : undefined,
  });

  for (const result of results) {
    const relativePath = path
      .relative(cwd, result.filePath)
      .replace(/\\/g, "/");
    if (result.status === "skipped") {
      console.log(`Skipped ${relativePath}`);
    } else {
      console.log(
        `${result.status === "created" ? "Created" : "Overwrote"} ${relativePath}`,
      );
    }
  }
}
