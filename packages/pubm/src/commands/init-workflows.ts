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

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm" | "cargo";

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
    case "npm":
      return "npx pubm --mode ci --phase publish";
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

export function writeWorkflowFile(
  cwd: string,
  filename: string,
  content: string,
): boolean {
  const workflowDir = path.join(cwd, ".github", "workflows");
  const filePath = path.join(workflowDir, filename);

  if (existsSync(filePath)) {
    return false;
  }

  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(filePath, content);
  return true;
}
