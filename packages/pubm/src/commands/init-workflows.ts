import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function updateGitignoreForChangesets(cwd: string): boolean {
  const gitignorePath = path.join(cwd, ".gitignore");
  let content = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf8")
    : "";

  const hasPubmWildcard = content.includes(".pubm/*");
  const hasChangesetsExclusion = content.includes("!.pubm/changesets/");

  if (hasPubmWildcard && hasChangesetsExclusion) {
    return false;
  }

  // Replace exact `.pubm/` or `.pubm` line with `.pubm/*`
  if (!hasPubmWildcard) {
    const pubmLineRegex = /^\.pubm\/?$/m;
    if (pubmLineRegex.test(content)) {
      content = content.replace(pubmLineRegex, ".pubm/*");
    } else {
      content = `${content.trimEnd()}\n.pubm/*\n`;
    }
  }

  if (!hasChangesetsExclusion) {
    // Insert `!.pubm/changesets/` right after `.pubm/*`
    content = content.replace(/^\.pubm\/\*/m, ".pubm/*\n!.pubm/changesets/");
  }

  writeFileSync(gitignorePath, content);
  return true;
}

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm" | "cargo";

export type GithubWorkflowId = "changeset-check" | "release-pr" | "publish";

export interface GeneratedGithubWorkflow {
  id: GithubWorkflowId;
  filename: string;
  content: string;
}

export interface GithubWorkflowOptions {
  defaultBranch: string;
  packageManager: PackageManager;
  includeChangesetCheck?: boolean;
  includeReleasePr?: boolean;
  includePublish?: boolean;
}

export interface InstallGithubWorkflowOptions extends GithubWorkflowOptions {
  force?: boolean;
  dryRun?: boolean;
  confirmOverwrite?: (
    filePath: string,
    workflow: GeneratedGithubWorkflow,
  ) => boolean | Promise<boolean>;
}

export interface InstalledGithubWorkflow extends GeneratedGithubWorkflow {
  filePath: string;
  status: "created" | "overwritten" | "skipped" | "dry-run";
}

export const GITHUB_WORKFLOW_FILENAMES = {
  changesetCheck: "pubm-changeset-check.yml",
  releasePr: "pubm-release-pr.yml",
  publish: "pubm-publish.yml",
} as const;

export function githubWorkflowPath(cwd: string, filename: string): string {
  return path.join(cwd, ".github", "workflows", filename);
}

export function generateChangesetCheckWorkflow(defaultBranch: string): string {
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

      - uses: syi0808/pubm/actions/changeset-check@v1
        with:
          skip-label: no-changeset
`;
}

export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(path.join(cwd, "bun.lock"))) return "bun";
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (
    existsSync(path.join(cwd, "Cargo.lock")) &&
    !existsSync(path.join(cwd, "package.json"))
  ) {
    return "cargo";
  }
  return "npm";
}

function generateSetupSteps(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return `      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Cache bun dependencies
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-\${{ runner.os }}-\${{ hashFiles('bun.lock') }}
          restore-keys: |
            bun-\${{ runner.os }}-

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

function generateActionSetupSteps(pm: PackageManager): string {
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
        run: bun install --frozen-lockfile`;

    case "pnpm":
      return `      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile`;

    case "yarn":
      return `      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          cache: yarn

      - name: Install dependencies
        run: yarn install --immutable`;

    case "cargo":
      return `      - uses: dtolnay/rust-toolchain@stable`;

    case "npm":
      return `      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm ci`;
  }
}

function getPublishCommand(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return "bunx pubm --phase publish";
    case "pnpm":
      return "pnpm exec pubm --phase publish";
    case "yarn":
      return "yarn pubm --phase publish";
    case "cargo":
      return "pubm --phase publish";
    case "npm":
      return "npx pubm --phase publish";
  }
}

function generateEnvBlock(pm: PackageManager): string {
  if (pm === "cargo") {
    return `          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          CARGO_REGISTRY_TOKEN: \${{ secrets.CARGO_REGISTRY_TOKEN }}`;
  }
  return `          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: \${{ secrets.NODE_AUTH_TOKEN }}`;
}

function generatePermissions(pm: PackageManager): string {
  if (pm === "cargo") {
    return `permissions:
  contents: write`;
  }
  return `permissions:
  contents: write
  id-token: write`;
}

export function generateReleaseWorkflow(
  isMonorepo: boolean,
  defaultBranch: string,
  pm: PackageManager,
): string {
  const setupSteps = generateSetupSteps(pm);
  const publishCmd = getPublishCommand(pm);
  const envBlock = generateEnvBlock(pm);
  const permissions = generatePermissions(pm);

  if (isMonorepo) {
    return `name: Release

on:
  push:
    branches:
      - ${defaultBranch}

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
${envBlock}
`;
  }

  return `name: Release

on:
  push:
    tags:
      - 'v*'

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
${envBlock}
`;
}

export interface ReleasePrWorkflowOptions {
  defaultBranch: string;
  packageManager: PackageManager;
}

export function generateReleasePrWorkflow({
  defaultBranch,
  packageManager,
}: ReleasePrWorkflowOptions): string {
  const setupSteps = generateActionSetupSteps(packageManager);

  return `name: pubm Release PR

on:
  push:
    branches:
      - ${defaultBranch}
  workflow_dispatch:
  issue_comment:
    types: [created]

permissions:
  contents: write
  pull-requests: write
  issues: write
  checks: write
  packages: write

jobs:
  release-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

${setupSteps}

      - uses: syi0808/pubm/actions/release-pr@v1
        with:
          token: \${{ secrets.PUBM_BOT_TOKEN || secrets.GITHUB_TOKEN }}
          base-branch: ${defaultBranch}
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NODE_AUTH_TOKEN || secrets.NPM_TOKEN || github.token }}
          NPM_TOKEN: \${{ secrets.NPM_TOKEN || secrets.NODE_AUTH_TOKEN || github.token }}
          JSR_TOKEN: \${{ secrets.JSR_TOKEN }}
          CARGO_REGISTRY_TOKEN: \${{ secrets.CARGO_REGISTRY_TOKEN }}
`;
}

export interface PublishWorkflowOptions {
  defaultBranch: string;
  packageManager: PackageManager;
}

export function generatePublishWorkflow({
  defaultBranch,
  packageManager,
}: PublishWorkflowOptions): string {
  const setupSteps = generateActionSetupSteps(packageManager);

  return `name: pubm Publish

on:
  push:
    branches:
      - ${defaultBranch}

permissions:
  contents: write
  pull-requests: read
  packages: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

${setupSteps}

      - uses: syi0808/pubm/actions/publish@v1
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          base-branch: ${defaultBranch}
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NODE_AUTH_TOKEN || secrets.NPM_TOKEN || github.token }}
          NPM_TOKEN: \${{ secrets.NPM_TOKEN || secrets.NODE_AUTH_TOKEN || github.token }}
          JSR_TOKEN: \${{ secrets.JSR_TOKEN }}
          CARGO_REGISTRY_TOKEN: \${{ secrets.CARGO_REGISTRY_TOKEN }}
`;
}

export function generateGithubWorkflowFiles({
  defaultBranch,
  packageManager,
  includeChangesetCheck = true,
  includeReleasePr = true,
  includePublish = true,
}: GithubWorkflowOptions): GeneratedGithubWorkflow[] {
  const workflows: GeneratedGithubWorkflow[] = [];

  if (includeChangesetCheck) {
    workflows.push({
      id: "changeset-check",
      filename: GITHUB_WORKFLOW_FILENAMES.changesetCheck,
      content: generateChangesetCheckWorkflow(defaultBranch),
    });
  }

  if (includeReleasePr) {
    workflows.push({
      id: "release-pr",
      filename: GITHUB_WORKFLOW_FILENAMES.releasePr,
      content: generateReleasePrWorkflow({ defaultBranch, packageManager }),
    });
  }

  if (includePublish) {
    workflows.push({
      id: "publish",
      filename: GITHUB_WORKFLOW_FILENAMES.publish,
      content: generatePublishWorkflow({ defaultBranch, packageManager }),
    });
  }

  return workflows;
}

export async function installGithubWorkflows(
  cwd: string,
  options: InstallGithubWorkflowOptions,
): Promise<InstalledGithubWorkflow[]> {
  const workflows = generateGithubWorkflowFiles(options);
  const installed: InstalledGithubWorkflow[] = [];

  for (const workflow of workflows) {
    const filePath = githubWorkflowPath(cwd, workflow.filename);
    const exists = existsSync(filePath);

    if (options.dryRun) {
      installed.push({ ...workflow, filePath, status: "dry-run" });
      continue;
    }

    if (exists && !options.force) {
      const overwrite = options.confirmOverwrite
        ? await options.confirmOverwrite(filePath, workflow)
        : false;

      if (!overwrite) {
        installed.push({ ...workflow, filePath, status: "skipped" });
        continue;
      }
    }

    writeWorkflowFile(cwd, workflow.filename, workflow.content, {
      force: true,
    });
    installed.push({
      ...workflow,
      filePath,
      status: exists ? "overwritten" : "created",
    });
  }

  return installed;
}

export function writeWorkflowFile(
  cwd: string,
  filename: string,
  content: string,
  options: { force?: boolean } = {},
): boolean {
  const workflowDir = path.join(cwd, ".github", "workflows");
  const filePath = githubWorkflowPath(cwd, filename);

  if (existsSync(filePath) && !options.force) {
    return false;
  }

  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(filePath, content);
  return true;
}
