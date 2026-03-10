import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function detectDefaultBranch(cwd: string): string {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // refs/remotes/origin/main → main
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}

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
      content = content.trimEnd() + "\n.pubm/*\n";
    }
  }

  if (!hasChangesetsExclusion) {
    // Insert `!.pubm/changesets/` right after `.pubm/*`
    content = content.replace(".pubm/*", ".pubm/*\n!.pubm/changesets/");
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

export function writeChangesetCheckWorkflow(
  cwd: string,
  defaultBranch: string,
): boolean {
  const workflowDir = path.join(cwd, ".github", "workflows");
  const filePath = path.join(workflowDir, "changeset-check.yml");

  if (existsSync(filePath)) {
    return false;
  }

  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(filePath, generateChangesetCheckWorkflow(defaultBranch));
  return true;
}
