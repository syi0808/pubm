import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ui } from "@pubm/core";
import type { Command } from "commander";
import Enquirer from "enquirer";

export type Agent = "claude-code" | "codex" | "gemini";

interface SkillFile {
  relativePath: string;
  downloadUrl: string;
}

const REPO = "syi0808/pubm";
const SKILLS_PATH = "plugins/pubm-plugin/skills";

const AGENT_PATHS: Record<Agent, string> = {
  "claude-code": ".claude/skills/pubm",
  codex: ".agents/skills/pubm",
  gemini: ".gemini/skills/pubm",
};

export const AGENT_LABELS: Record<Agent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

async function fetchLatestRef(): Promise<string> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
    );
    if (res.ok) {
      const data = (await res.json()) as { tag_name: string };
      return data.tag_name;
    }
  } catch {
    // Fallback to main
  }
  return "main";
}

async function fetchSkillsTree(ref: string): Promise<SkillFile[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/git/trees/${ref}?recursive=1`,
  );
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    tree: Array<{ path: string; type: string }>;
  };

  return data.tree
    .filter(
      (entry) =>
        entry.type === "blob" && entry.path.startsWith(`${SKILLS_PATH}/`),
    )
    .map((entry) => ({
      relativePath: entry.path.slice(`${SKILLS_PATH}/`.length),
      downloadUrl: `https://raw.githubusercontent.com/${REPO}/${ref}/${entry.path}`,
    }));
}

async function downloadAndInstall(
  files: SkillFile[],
  installPath: string,
): Promise<void> {
  for (const file of files) {
    const targetPath = path.join(installPath, file.relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });

    const res = await fetch(file.downloadUrl);
    if (!res.ok) {
      throw new Error(`Failed to download ${file.relativePath}: ${res.status}`);
    }

    const content = await res.text();
    writeFileSync(targetPath, content);
  }
}

export function getInstallPath(agent: Agent, cwd: string): string {
  return path.join(cwd, AGENT_PATHS[agent]);
}

export async function runSetupSkills(cwd: string): Promise<{
  agents: Agent[];
  skillCount: number;
}> {
  const { agents } = await Enquirer.prompt<{ agents: Agent[] }>({
    type: "multiselect",
    name: "agents",
    message: "Select coding agents",
    choices: [
      { name: "claude-code", message: "Claude Code" },
      { name: "codex", message: "Codex CLI" },
      { name: "gemini", message: "Gemini CLI" },
    ],
  });

  if (agents.length === 0) {
    ui.info("No agents selected. Skipping skills installation.");
    return { agents: [], skillCount: 0 };
  }

  ui.info("Downloading skills from GitHub...");

  const ref = await fetchLatestRef();
  const files = await fetchSkillsTree(ref);

  if (files.length === 0) {
    throw new Error("No skill files found in repository.");
  }

  const skillCount = files.filter((f) =>
    f.relativePath.endsWith("/SKILL.md"),
  ).length;

  for (const agent of agents) {
    const installPath = getInstallPath(agent, cwd);
    ui.info(`Installing for ${AGENT_LABELS[agent]}...`);
    await downloadAndInstall(files, installPath);

    for (const file of files) {
      console.log(`  → ${path.join(AGENT_PATHS[agent], file.relativePath)}`);
    }
  }

  return { agents, skillCount };
}

export function registerSetupSkillsCommand(parent: Command): void {
  parent
    .command("setup-skills")
    .description("Download and install coding agent skills")
    .action(async () => {
      try {
        if (!process.stdin.isTTY) {
          throw new Error(
            "pubm setup-skills requires an interactive terminal.",
          );
        }

        const cwd = process.cwd();
        const { agents, skillCount } = await runSetupSkills(cwd);

        if (agents.length > 0) {
          ui.success(
            `${skillCount} skills installed for ${agents.map((a) => AGENT_LABELS[a]).join(", ")}.`,
          );
        }
      } catch (e) {
        ui.error((e as Error).message);
        ui.info(
          `Manual installation: https://github.com/${REPO}/tree/main/${SKILLS_PATH}`,
        );
        process.exitCode = 1;
      }
    });
}
