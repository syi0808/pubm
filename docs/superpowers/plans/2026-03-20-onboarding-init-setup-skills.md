# Onboarding: Interactive Init & Setup-Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal `pubm init` with an interactive onboarding wizard and add `pubm setup-skills` for installing coding agent skills from GitHub.

**Architecture:** Two new command modules — `init.ts` (full rewrite) absorbs `init-changesets.ts` utilities and adds interactive prompts via Enquirer; `setup-skills.ts` (new) handles GitHub API download and agent-specific skill installation. The init flow chains into setup-skills at the end. Config generation is conditional: only creates `pubm.config.ts` when user choices differ from defaults.

**Tech Stack:** Commander (CLI framework), Enquirer (interactive prompts), GitHub REST API (fetch), existing @pubm/core utilities (ui, discoverPackages, detectWorkspace).

**Spec:** `docs/superpowers/specs/2026-03-20-onboarding-init-setup-skills-design.md`

---

## File Structure

### New Files
- `packages/pubm/src/commands/setup-skills.ts` — Skills download/install command + CLI registration
- `packages/pubm/src/commands/init-prompts.ts` — Interactive prompt functions (extracted for testability; spec places all in init.ts but splitting improves modularity)
- `packages/pubm/src/commands/init-workflows.ts` — CI workflow generation (release.yml templates)

### Modified Files
- `packages/pubm/src/commands/init.ts` — Full rewrite: interactive orchestration
- `packages/pubm/src/cli.ts` — Add `registerSetupSkillsCommand` import and registration

### Deleted Files
- `packages/pubm/src/commands/init-changesets.ts` — Merged into `init.ts` and `init-workflows.ts`

### Documentation Files (Modified)
- `website/src/content/docs/en/reference/cli.mdx`
- `website/src/content/docs/en/guides/quick-start.mdx`
- `website/src/content/docs/en/guides/changesets.mdx`
- `website/src/content/docs/en/guides/coding-agents.mdx`
- `website/src/content/docs/en/guides/configuration.mdx`
- `website/src/content/docs/en/guides/ci-cd.mdx`
- `README.md`
- `plugins/pubm-plugin/skills/publish-setup/SKILL.md`
- `plugins/pubm-plugin/INSTALLATION.md`
- All 5 translation directories (de, es, fr, ko, zh-cn) for website docs

---

## Task 1: Create init-prompts.ts — Interactive Prompt Functions

**Files:**
- Create: `packages/pubm/src/commands/init-prompts.ts`

All interactive prompt functions are isolated here for reuse and clarity. Each function handles one prompt stage.

- [ ] **Step 1: Create the prompt types and package detection function**

```typescript
// packages/pubm/src/commands/init-prompts.ts
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Enquirer from "enquirer";
import { detectWorkspace, discoverPackages, type WorkspaceInfo } from "@pubm/core";

export interface PackageDetectionResult {
  isMonorepo: boolean;
  workspaces: WorkspaceInfo[];
  packages: Array<{ name: string; path: string }>;
}

export interface InitResult {
  packages: string[];
  branch: string;
  versioning: "independent" | "fixed";
  changelog: boolean;
  changelogFormat: "default" | "github";
  releaseDraft: boolean;
  changesets: boolean;
  ci: boolean;
  isMonorepo: boolean;
}

export const INIT_DEFAULTS = {
  versioning: "independent" as const,
  branch: "main",
  changelog: true,
  changelogFormat: "default" as const,
  releaseDraft: true,
};

export function detectDefaultBranch(cwd: string): string {
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

export async function detectPackages(cwd: string): Promise<PackageDetectionResult> {
  const workspaces = detectWorkspace(cwd);
  const isMonorepo = workspaces.length > 0;

  if (!isMonorepo) {
    // Single package — read name from manifest
    const pkgPath = path.join(cwd, "package.json");
    const cargoPath = path.join(cwd, "Cargo.toml");
    let name = path.basename(cwd);

    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      name = pkg.name ?? name;
    }

    return { isMonorepo: false, workspaces: [], packages: [{ name, path: "." }] };
  }

  // Monorepo — discover all workspace packages
  const discovered = await discoverPackages({ cwd });
  const packages = discovered.map((pkg) => ({
    name: pkg.name,
    path: path.relative(cwd, pkg.path),
  }));

  return { isMonorepo, workspaces, packages };
}
```

- [ ] **Step 2: Add prompt functions**

Append to `init-prompts.ts`:

```typescript
export async function promptPackages(
  detected: PackageDetectionResult,
): Promise<string[]> {
  if (!detected.isMonorepo) {
    const { confirmed } = await Enquirer.prompt<{ confirmed: boolean }>({
      type: "confirm",
      name: "confirmed",
      message: `Is "${detected.packages[0].name}" the package to publish?`,
    });
    if (!confirmed) return [];
    return [detected.packages[0].path];
  }

  const { selected } = await Enquirer.prompt<{ selected: string[] }>({
    type: "multiselect",
    name: "selected",
    message: "Select packages to publish",
    choices: detected.packages.map((pkg) => ({
      name: pkg.path,
      message: `${pkg.path} (${pkg.name})`,
      value: pkg.path,
    })),
    // @ts-expect-error — Enquirer multiselect supports initial but types are incomplete
    initial: detected.packages.map((_, i) => i),
  });

  return selected;
}

export async function promptBranch(cwd: string): Promise<string> {
  const detected = detectDefaultBranch(cwd);

  const { choice } = await Enquirer.prompt<{ choice: string }>({
    type: "select",
    name: "choice",
    message: "Release branch",
    choices: [
      { name: detected, message: `${detected} (detected from git)` },
      { name: "__other__", message: "Other..." },
    ],
  });

  if (choice === "__other__") {
    const { branch } = await Enquirer.prompt<{ branch: string }>({
      type: "input",
      name: "branch",
      message: "Enter branch name",
    });
    return branch;
  }

  return choice;
}

export async function promptVersioning(): Promise<"independent" | "fixed"> {
  const { versioning } = await Enquirer.prompt<{
    versioning: "independent" | "fixed";
  }>({
    type: "select",
    name: "versioning",
    message: "Versioning strategy",
    choices: [
      {
        name: "independent",
        message: "independent — Each package versioned separately",
      },
      {
        name: "fixed",
        message: "fixed — All packages share one version",
      },
    ],
  });

  return versioning;
}

export async function promptChangelog(): Promise<{
  enabled: boolean;
  format: "default" | "github";
}> {
  const { enabled } = await Enquirer.prompt<{ enabled: boolean }>({
    type: "confirm",
    name: "enabled",
    message: "Generate changelog?",
    initial: true,
  });

  if (!enabled) return { enabled: false, format: "default" };

  const { format } = await Enquirer.prompt<{
    format: "default" | "github";
  }>({
    type: "select",
    name: "format",
    message: "Changelog format",
    choices: [
      { name: "github", message: "github — Includes PR/commit links" },
      { name: "default", message: "default — Simple text format" },
    ],
  });

  return { enabled, format };
}

export async function promptGithubRelease(): Promise<boolean> {
  const { enabled } = await Enquirer.prompt<{ enabled: boolean }>({
    type: "confirm",
    name: "enabled",
    message: "Create GitHub Release draft?",
    initial: true,
  });
  return enabled;
}

export async function promptChangesets(): Promise<boolean> {
  const { enabled } = await Enquirer.prompt<{ enabled: boolean }>({
    type: "confirm",
    name: "enabled",
    message: "Enable changesets?",
    initial: true,
  });
  return enabled;
}

export async function promptCI(): Promise<boolean> {
  const { enabled } = await Enquirer.prompt<{ enabled: boolean }>({
    type: "confirm",
    name: "enabled",
    message: "Set up CI workflow?",
    initial: true,
  });
  return enabled;
}

export async function promptSkills(): Promise<boolean> {
  const { enabled } = await Enquirer.prompt<{ enabled: boolean }>({
    type: "confirm",
    name: "enabled",
    message: "Install coding agent skills?",
  });
  return enabled;
}

export async function promptOverwriteConfig(): Promise<boolean> {
  const { overwrite } = await Enquirer.prompt<{ overwrite: boolean }>({
    type: "confirm",
    name: "overwrite",
    message: "pubm.config.ts already exists. Overwrite?",
  });
  return overwrite;
}
```

- [ ] **Step 3: Add config generation helpers**

Append to `init-prompts.ts`:

```typescript
export function shouldCreateConfig(
  result: InitResult,
  detectedBranch: string,
): boolean {
  // Monorepo always needs packages field
  if (result.isMonorepo) return true;

  // Compare prompt-settable fields against defaults
  const defaults = { ...INIT_DEFAULTS, branch: detectedBranch };

  if (result.versioning !== defaults.versioning) return true;
  if (result.branch !== defaults.branch) return true;
  if (result.changelog !== defaults.changelog) return true;
  if (result.changelogFormat !== defaults.changelogFormat) return true;
  if (result.releaseDraft !== defaults.releaseDraft) return true;

  return false;
}

export function buildConfigContent(result: InitResult): string {
  const fields: string[] = [];

  // Packages (always for monorepo)
  if (result.isMonorepo && result.packages.length > 0) {
    const pkgEntries = result.packages
      .map((p) => `    { path: "${p}" }`)
      .join(",\n");
    fields.push(`  packages: [\n${pkgEntries},\n  ]`);
  }

  // Only include fields that differ from defaults
  if (result.versioning !== INIT_DEFAULTS.versioning) {
    fields.push(`  versioning: "${result.versioning}"`);
  }
  if (result.branch !== INIT_DEFAULTS.branch) {
    fields.push(`  branch: "${result.branch}"`);
  }
  if (!result.changelog) {
    fields.push(`  changelog: false`);
  }
  if (result.changelog && result.changelogFormat !== INIT_DEFAULTS.changelogFormat) {
    fields.push(`  changelogFormat: "${result.changelogFormat}"`);
  }
  if (result.releaseDraft !== INIT_DEFAULTS.releaseDraft) {
    fields.push(`  releaseDraft: ${result.releaseDraft}`);
  }

  return `import { defineConfig } from "@pubm/core";

export default defineConfig({
${fields.join(",\n")}${fields.length > 0 ? "," : ""}
});
`;
}
```

- [ ] **Step 4: Verify the module compiles**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run typecheck`
Expected: No errors from init-prompts.ts

- [ ] **Step 5: Commit**

```bash
git add packages/pubm/src/commands/init-prompts.ts
git commit -m "feat(pubm): add interactive init prompt functions"
```

---

## Task 2: Create init-workflows.ts — CI Workflow Generation

**Files:**
- Create: `packages/pubm/src/commands/init-workflows.ts`

Extracts workflow template generation from `init-changesets.ts` and adds the new `release.yml` generator.

- [ ] **Step 1: Create the workflow generation module**

```typescript
// packages/pubm/src/commands/init-workflows.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// --- Gitignore ---

export function updateGitignoreForChangesets(cwd: string): boolean {
  const gitignorePath = path.join(cwd, ".gitignore");
  let content = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf8")
    : "";

  const hasPubmWildcard = content.includes(".pubm/*");
  const hasChangesetsExclusion = content.includes("!.pubm/changesets/");

  if (hasPubmWildcard && hasChangesetsExclusion) return false;

  if (!hasPubmWildcard) {
    const pubmLineRegex = /^\.pubm\/?$/m;
    if (pubmLineRegex.test(content)) {
      content = content.replace(pubmLineRegex, ".pubm/*");
    } else {
      content = `${content.trimEnd()}\n.pubm/*\n`;
    }
  }

  if (!hasChangesetsExclusion) {
    content = content.replace(/^\.pubm\/\*/m, ".pubm/*\n!.pubm/changesets/");
  }

  writeFileSync(gitignorePath, content);
  return true;
}

// --- Changeset Check Workflow ---

export function generateChangesetCheckWorkflow(defaultBranch: string): string {
  // Exact same content as existing init-changesets.ts generateChangesetCheckWorkflow
  return `name: Changeset Check

on:
  pull_request:
    branches: [${defaultBranch}]
    types: [opened, synchronize, reopened, labeled, unlabeled]

permissions:
  contents: read
  pull-requests: write

jobs:
  changeset-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Check for changesets
        id: check
        run: |
          BASE_REF="\${{ github.event.pull_request.base.ref }}"
          if [[ "\${{ contains(github.event.pull_request.labels.*.name, 'no-changeset') }}" == "true" ]]; then
            echo "skipped=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          CHANGESETS=$(git diff --name-only "origin/\${BASE_REF}...HEAD" -- '.pubm/changesets/*.md')
          if [ -z "$CHANGESETS" ]; then
            echo "found=false" >> "$GITHUB_OUTPUT"
          else
            echo "found=true" >> "$GITHUB_OUTPUT"
            echo "$CHANGESETS" > /tmp/changesets.txt
          fi

      - name: Update PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const marker = '<!-- changeset-check -->';
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c => c.body.includes(marker));
            let body;
            const skipped = '\${{ steps.check.outputs.skipped }}' === 'true';
            const found = '\${{ steps.check.outputs.found }}' === 'true';
            if (skipped) {
              body = \`\${marker}\\n### ⚠️ Changeset check skipped\\n\\n\\\`no-changeset\\\` label detected. This PR will not require a changeset.\`;
            } else if (found) {
              const fs = require('fs');
              const files = fs.readFileSync('/tmp/changesets.txt', 'utf8').trim();
              body = \`\${marker}\\n### ✅ Changeset detected\\n\\n\\\`\\\`\\\`\\n\${files}\\n\\\`\\\`\\\`\`;
            } else {
              body = \`\${marker}\\n### ❌ No changeset found\\n\\nThis PR requires a changeset. Run \\\`pubm changesets add\\\` and commit the generated file.\\n\\nIf this change doesn't need a changeset (docs, CI config, etc.), add the \\\`no-changeset\\\` label.\`;
            }
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }

      - name: Fail if no changeset
        if: steps.check.outputs.skipped != 'true' && steps.check.outputs.found != 'true'
        run: exit 1
`;
}

// --- Package Manager Detection ---

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm" | "cargo";

export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(path.join(cwd, "bun.lock"))) return "bun";
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (
    !existsSync(path.join(cwd, "package.json")) &&
    existsSync(path.join(cwd, "Cargo.lock"))
  )
    return "cargo";
  return "npm";
}

// --- Release Workflow ---

function getSetupSteps(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return `      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build`;

    case "pnpm":
      return `      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm run build`;

    case "yarn":
      return `      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          cache: yarn

      - name: Install dependencies
        run: yarn install --immutable

      - name: Build
        run: yarn build`;

    case "cargo":
      return `      - uses: dtolnay/rust-toolchain@stable

      - name: Install pubm
        run: |
          brew tap syi0808/tap
          brew install pubm`;

    case "npm":
    default:
      return `      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build`;
  }
}

function getPublishCommand(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return "bunx pubm --mode ci --phase publish";
    case "pnpm":
      return "pnpm exec pubm --mode ci --phase publish";
    case "yarn":
      return "yarn pubm --mode ci --phase publish";
    case "cargo":
      return "pubm --mode ci --phase publish";
    default:
      return "npx pubm --mode ci --phase publish";
  }
}

function getEnvVars(pm: PackageManager): string {
  const vars = ["          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}"];

  if (pm !== "cargo") {
    vars.push(
      "          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}",
    );
  } else {
    vars.push(
      "          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}",
    );
  }

  return vars.join("\n");
}

function getPermissions(pm: PackageManager): string {
  if (pm === "cargo") {
    return `  contents: write`;
  }
  return `  contents: write
  id-token: write`;
}

export function generateReleaseWorkflow(
  isMonorepo: boolean,
  defaultBranch: string,
  pm: PackageManager,
): string {
  const setupSteps = getSetupSteps(pm);
  const publishCmd = getPublishCommand(pm);
  const envVars = getEnvVars(pm);
  const permissions = getPermissions(pm);

  if (isMonorepo) {
    return `name: Release

on:
  push:
    branches:
      - ${defaultBranch}

permissions:
${permissions}

jobs:
  release:
    if: startsWith(github.event.head_commit.message, 'Version Packages')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

${setupSteps}

      - name: Publish and release
        run: ${publishCmd}
        env:
${envVars}
`;
  }

  return `name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
${permissions}

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

${setupSteps}

      - name: Publish and release
        run: ${publishCmd}
        env:
${envVars}
`;
}

// --- Write Workflow Files ---

export function writeWorkflowFile(
  cwd: string,
  filename: string,
  content: string,
): boolean {
  const workflowDir = path.join(cwd, ".github", "workflows");
  const filePath = path.join(workflowDir, filename);

  if (existsSync(filePath)) return false;

  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(filePath, content);
  return true;
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run typecheck`
Expected: No errors from init-workflows.ts

- [ ] **Step 3: Commit**

```bash
git add packages/pubm/src/commands/init-workflows.ts
git commit -m "feat(pubm): add CI workflow generation for init command"
```

---

## Task 3: Create setup-skills.ts — Agent Skills Installer

**Files:**
- Create: `packages/pubm/src/commands/setup-skills.ts`

- [ ] **Step 1: Create the setup-skills module**

```typescript
// packages/pubm/src/commands/setup-skills.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import Enquirer from "enquirer";
import { ui } from "@pubm/core";

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

const AGENT_LABELS: Record<Agent, string> = {
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

  // Count unique skills (directories containing SKILL.md)
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
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run typecheck`
Expected: No errors from setup-skills.ts

- [ ] **Step 3: Commit**

```bash
git add packages/pubm/src/commands/setup-skills.ts
git commit -m "feat(pubm): add setup-skills command for coding agent skill installation"
```

---

## Task 4: Rewrite init.ts — Interactive Orchestration

**Files:**
- Modify: `packages/pubm/src/commands/init.ts` (full rewrite)
- Delete: `packages/pubm/src/commands/init-changesets.ts`

- [ ] **Step 1: Rewrite init.ts with the full interactive flow**

```typescript
// packages/pubm/src/commands/init.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { ui } from "@pubm/core";
import {
  type InitResult,
  buildConfigContent,
  detectDefaultBranch,
  detectPackages,
  promptBranch,
  promptChangesets,
  promptChangelog,
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
import { runSetupSkills } from "./setup-skills.js";

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
          const wsType = detected.workspaces
            .map((w) => w.type)
            .join(", ");
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
            console.log(
              "  → .pubm/changesets/ (already exists, skipped)",
            );
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
            console.log(
              "  → .github/workflows/release.yml created",
            );
          } else {
            console.log(
              "  → .github/workflows/release.yml (already exists, skipped)",
            );
          }

          // changeset-check.yml (only if changesets enabled)
          if (changesets) {
            const checkContent =
              generateChangesetCheckWorkflow(branch);
            const checkWritten = writeWorkflowFile(
              cwd,
              "changeset-check.yml",
              checkContent,
            );
            if (checkWritten) {
              workflowsCreated++;
              console.log(
                "  → .github/workflows/changeset-check.yml created",
              );
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
          const { agents, skillCount } = await runSetupSkills(cwd);
          if (agents.length > 0) {
            const agentNames = agents
              .map(
                (a) =>
                  ({
                    "claude-code": "Claude Code",
                    codex: "Codex CLI",
                    gemini: "Gemini CLI",
                  })[a],
              )
              .join(", ");
            summary.push({
              label: "Skills",
              value: `${agentNames} (${skillCount} skills)`,
            });
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
```

- [ ] **Step 2: Delete init-changesets.ts**

```bash
rm packages/pubm/src/commands/init-changesets.ts
```

- [ ] **Step 3: Remove the init-changesets import from init.ts if any residual references exist**

Verify no other files import from `init-changesets.ts`:

Run: `cd /Users/classting/Workspace/temp/pubm && grep -r "init-changesets" packages/pubm/src/`
Expected: No results (the old init.ts was fully replaced)

- [ ] **Step 4: Verify typecheck passes**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/pubm/src/commands/init.ts
git rm packages/pubm/src/commands/init-changesets.ts
git commit -m "feat(pubm): rewrite init command as interactive onboarding wizard

Replaces minimal scaffolding with full interactive setup:
- Package detection (monorepo/single)
- Branch, versioning, changelog, release draft prompts
- Changesets and CI workflow setup
- Chains into setup-skills for agent skill installation
- Only creates pubm.config.ts when values differ from defaults

Removes --changesets flag. Merges init-changesets.ts utilities
into init-workflows.ts."
```

---

## Task 5: Register setup-skills in CLI

**Files:**
- Modify: `packages/pubm/src/cli.ts`

- [ ] **Step 1: Add import for registerSetupSkillsCommand**

In `packages/pubm/src/cli.ts`, add the import alongside existing command imports:

```typescript
import { registerSetupSkillsCommand } from "./commands/setup-skills.js";
```

- [ ] **Step 2: Register the command**

After the existing `registerInitCommand(program)` call (around line 100), add:

```typescript
registerSetupSkillsCommand(program);
```

- [ ] **Step 3: Verify typecheck and build**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run typecheck && bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/pubm/src/cli.ts
git commit -m "feat(pubm): register setup-skills command in CLI"
```

---

## Task 6: Manual Smoke Test

- [ ] **Step 1: Test init in the repo root**

Run: `cd /tmp && mkdir pubm-test && cd pubm-test && git init && npm init -y`
Then: `cd /Users/classting/Workspace/temp/pubm && bun run build && cd /tmp/pubm-test && bunx --bun /Users/classting/Workspace/temp/pubm/packages/pubm/src/cli.ts init`

Verify:
- Non-TTY check works
- Package detection identifies single package
- Prompts appear in correct order
- Config is only created when needed
- Summary is displayed

- [ ] **Step 2: Test setup-skills independently**

Run: `cd /tmp/pubm-test && bunx --bun /Users/classting/Workspace/temp/pubm/packages/pubm/src/cli.ts setup-skills`

Verify:
- Agent selection prompt appears
- Skills are downloaded from GitHub
- Files are written to correct directory

- [ ] **Step 3: Fix any issues found during smoke testing**

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix(pubm): address issues found during init/setup-skills smoke testing"
```

---

## Task 7: Run Checks

- [ ] **Step 1: Run format check**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run format`
Expected: No formatting issues, or auto-fixed

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run typecheck`
Expected: No type errors

- [ ] **Step 3: Run tests**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run test`
Expected: All existing tests pass (commands are excluded from coverage)

- [ ] **Step 4: Commit formatting fixes if any**

```bash
git add -A
git commit -m "style(pubm): format new init and setup-skills modules"
```

---

## Task 8: Update CLI Reference Documentation

**Files:**
- Modify: `website/src/content/docs/en/reference/cli.mdx`

- [ ] **Step 1: Update the command overview table**

At lines 25-26, replace:
```
| pubm init | Create pubm.config.ts and .pubm/changesets/. |
| pubm init --changesets | Also set up the PR changeset-check workflow. |
```

With:
```
| pubm init | Interactive setup wizard — package detection, config, changesets, CI workflows, and coding agent skills. |
| pubm setup-skills | Download and install coding agent skills (Claude Code, Codex, Gemini). |
```

- [ ] **Step 2: Rewrite the pubm init section**

Replace lines 168-184 with updated content describing the interactive flow, each prompt stage, and the "skip config if defaults match" behavior.

- [ ] **Step 3: Add pubm setup-skills section**

After the init section, add a new section documenting:
- Syntax: `pubm setup-skills`
- Supported agents: Claude Code, Codex CLI, Gemini CLI
- Installation paths for each agent
- GitHub source (latest release tag, fallback to main)
- Idempotent behavior (overwrites existing skills)

- [ ] **Step 4: Update example command patterns**

At lines 308-317, replace `pubm init --changesets` with `pubm init`.

- [ ] **Step 5: Commit**

```bash
git add website/src/content/docs/en/reference/cli.mdx
git commit -m "docs: update CLI reference for interactive init and setup-skills"
```

---

## Task 9: Update Quick Start Guide

**Files:**
- Modify: `website/src/content/docs/en/guides/quick-start.mdx`

- [ ] **Step 1: Update "For coding agents" section (lines 24-30)**

Add mention of `pubm setup-skills` as an alternative to manual plugin installation.

- [ ] **Step 2: Update "Initialize the repository" section (lines 32-40)**

Replace the static `pubm init` instruction with a note about the interactive setup wizard that guides through package detection, config, and workflow setup.

- [ ] **Step 3: Commit**

```bash
git add website/src/content/docs/en/guides/quick-start.mdx
git commit -m "docs: update quick-start guide for interactive init"
```

---

## Task 10: Update Changesets Guide

**Files:**
- Modify: `website/src/content/docs/en/guides/changesets.mdx`

- [ ] **Step 1: Update "File location" section (lines 14-32)**

Replace references to `pubm init --changesets` with:
- "`pubm init` will prompt you to enable changesets during setup"
- Remove the separate `--changesets` flag documentation

- [ ] **Step 2: Commit**

```bash
git add website/src/content/docs/en/guides/changesets.mdx
git commit -m "docs: update changesets guide to reference interactive init"
```

---

## Task 11: Update Coding Agents Guide

**Files:**
- Modify: `website/src/content/docs/en/guides/coding-agents.mdx`

- [ ] **Step 1: Update "Start with setup automation" section (lines 8-20)**

Add `pubm setup-skills` as a quick way to install agent skills:
- Explain it downloads skills from GitHub
- Note it's also available as the last step of `pubm init`
- Keep existing `publish-setup` skill documentation

- [ ] **Step 2: Commit**

```bash
git add website/src/content/docs/en/guides/coding-agents.mdx
git commit -m "docs: add setup-skills command to coding agents guide"
```

---

## Task 12: Update README and Remaining Docs

**Files:**
- Modify: `README.md`
- Modify: `website/src/content/docs/en/guides/configuration.mdx`
- Modify: `website/src/content/docs/en/guides/ci-cd.mdx`
- Modify: `plugins/pubm-plugin/skills/publish-setup/SKILL.md`
- Modify: `plugins/pubm-plugin/INSTALLATION.md`

- [ ] **Step 1: Update README Quick Start (lines 78-107)**

Update the Quick Start code block to show `pubm init` as an interactive wizard. Add a brief note about `pubm setup-skills` for coding agent users.

- [ ] **Step 2: Update configuration.mdx**

Add a note near the top (after line 6): "Run `pubm init` to interactively generate this configuration file."

- [ ] **Step 3: Update ci-cd.mdx**

Add a note: "`pubm init` can generate CI workflows for you during setup."

- [ ] **Step 4: Update publish-setup SKILL.md (lines 197-213)**

Replace `pubm init --changesets` at line 202 with `pubm init` and note that changesets are now configured interactively.

- [ ] **Step 5: Update INSTALLATION.md**

Add a section noting `pubm setup-skills` as an alternative installation method:
```markdown
## Alternative: pubm setup-skills

If pubm is already installed, run `pubm setup-skills` to download and install skills for your coding agent.
```

- [ ] **Step 6: Commit**

```bash
git add README.md \
  website/src/content/docs/en/guides/configuration.mdx \
  website/src/content/docs/en/guides/ci-cd.mdx \
  plugins/pubm-plugin/skills/publish-setup/SKILL.md \
  plugins/pubm-plugin/INSTALLATION.md
git commit -m "docs: update README, guides, and plugin docs for interactive init and setup-skills"
```

---

## Task 13: Update Translations

**Files:**
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/reference/cli.mdx`
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/guides/quick-start.mdx`
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/guides/changesets.mdx`
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/guides/coding-agents.mdx`
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/guides/configuration.mdx`
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/guides/ci-cd.mdx`

- [ ] **Step 1: Apply the same structural changes to all 5 translation directories**

For each language (de, es, fr, ko, zh-cn), apply the equivalent changes made to English docs in Tasks 8-12:
- CLI reference: update command table, init section, add setup-skills section
- Quick start: update init and agent sections
- Changesets: remove `--changesets` references
- Coding agents: add `pubm setup-skills` mention
- Configuration: add init reference
- CI/CD: add init CI generation note

Translate the new content to each language.

- [ ] **Step 2: Commit per language**

```bash
git add website/src/content/docs/de/
git commit -m "docs(de): update German translations for init and setup-skills"

git add website/src/content/docs/es/
git commit -m "docs(es): update Spanish translations for init and setup-skills"

git add website/src/content/docs/fr/
git commit -m "docs(fr): update French translations for init and setup-skills"

git add website/src/content/docs/ko/
git commit -m "docs(ko): update Korean translations for init and setup-skills"

git add website/src/content/docs/zh-cn/
git commit -m "docs(zh-cn): update Chinese translations for init and setup-skills"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Run full check suite**

```bash
cd /Users/classting/Workspace/temp/pubm
bun run format
bun run typecheck
bun run test
```

Expected: All pass

- [ ] **Step 2: Verify documentation site builds**

```bash
bun run build:site
```

Expected: No build errors

- [ ] **Step 3: Create changeset**

```bash
bunx pubm changesets add --packages packages/pubm --bump minor --message "Add interactive init wizard and setup-skills command for coding agent onboarding"
```

- [ ] **Step 4: Commit changeset**

```bash
git add .pubm/changesets/
git commit -m "chore: add changeset for interactive init and setup-skills"
```
