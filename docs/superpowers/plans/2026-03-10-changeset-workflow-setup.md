# Changeset Workflow Setup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--changesets` flag to `pubm init` that generates a GitHub Actions changeset-check workflow, updates CLAUDE.md with workflow guide, and fixes `.gitignore` to track changeset files.

**Architecture:** Extend the existing `registerInitCommand` in `src/commands/init.ts` with an `--changesets` option. Extract each file-generation concern (gitignore, workflow, CLAUDE.md) into focused helper functions within the same file. Update the publish-setup skill to include a changesets question in the setup scope and invoke `pubm init --changesets`.

**Tech Stack:** TypeScript, Commander.js, Node.js fs, Vitest, GitHub Actions YAML

---

## File Structure

| File | Responsibility |
|---|---|
| `src/commands/init.ts` | CLI command registration + `--changesets` flag + orchestration |
| `src/commands/init-changesets.ts` (new) | Changeset setup logic: gitignore, workflow yml, CLAUDE.md generation |
| `tests/unit/commands/init.test.ts` (new) | Tests for init command and `--changesets` flag |
| `plugins/pubm-plugin/skills/publish-setup/SKILL.md` | Skill workflow update with changesets question |
| `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` | Changeset-check workflow documentation |

---

## Chunk 1: CLI `--changesets` Implementation

### Task 1: Gitignore helper — test + implement

**Files:**
- Create: `src/commands/init-changesets.ts`
- Create: `tests/unit/commands/init.test.ts`

- [ ] **Step 1: Write failing test for gitignore update**

```typescript
// tests/unit/commands/init.test.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateGitignoreForChangesets } from "../../../src/commands/init-changesets.js";

const TEST_DIR = path.resolve("tests/unit/commands/.tmp-init");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("updateGitignoreForChangesets", () => {
  it("replaces '.pubm/' with '.pubm/*' and adds '!.pubm/changesets/' exclusion", () => {
    writeFileSync(path.join(TEST_DIR, ".gitignore"), "node_modules\n.pubm/\n");

    const result = updateGitignoreForChangesets(TEST_DIR);

    const content = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
    expect(content).toContain(".pubm/*");
    expect(content).toContain("!.pubm/changesets/");
    expect(content).not.toContain(".pubm/\n");
    expect(result).toBe(true);
  });

  it("adds both lines when .gitignore exists but has no .pubm entry", () => {
    writeFileSync(path.join(TEST_DIR, ".gitignore"), "node_modules\n");

    const result = updateGitignoreForChangesets(TEST_DIR);

    const content = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
    expect(content).toContain(".pubm/*");
    expect(content).toContain("!.pubm/changesets/");
    expect(result).toBe(true);
  });

  it("creates .gitignore with both lines when file does not exist", () => {
    const result = updateGitignoreForChangesets(TEST_DIR);

    const content = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
    expect(content).toContain(".pubm/*");
    expect(content).toContain("!.pubm/changesets/");
    expect(result).toBe(true);
  });

  it("replaces '.pubm' (no trailing slash) with '.pubm/*'", () => {
    writeFileSync(path.join(TEST_DIR, ".gitignore"), "node_modules\n.pubm\n");

    const result = updateGitignoreForChangesets(TEST_DIR);

    const content = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
    expect(content).toContain(".pubm/*");
    expect(content).toContain("!.pubm/changesets/");
    expect(content).not.toMatch(/^\.pubm$/m);
    expect(result).toBe(true);
  });

  it("returns false when .gitignore already has correct entries", () => {
    writeFileSync(
      path.join(TEST_DIR, ".gitignore"),
      "node_modules\n.pubm/*\n!.pubm/changesets/\n",
    );

    const result = updateGitignoreForChangesets(TEST_DIR);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest --run tests/unit/commands/init.test.ts`
Expected: FAIL — `init-changesets.js` module not found

- [ ] **Step 3: Implement `updateGitignoreForChangesets`**

```typescript
// src/commands/init-changesets.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
      content = content.trimEnd() + "\n.pubm/*\n";
    }
  }

  if (!hasChangesetsExclusion) {
    // Insert `!.pubm/changesets/` right after `.pubm/*`
    content = content.replace(
      ".pubm/*",
      ".pubm/*\n!.pubm/changesets/",
    );
  }

  writeFileSync(gitignorePath, content);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest --run tests/unit/commands/init.test.ts`
Expected: PASS — all 4 gitignore tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/init-changesets.ts tests/unit/commands/init.test.ts
git commit -m "feat(init): add gitignore helper for changeset tracking"
```

---

### Task 2: Workflow file generator — test + implement

**Files:**
- Modify: `src/commands/init-changesets.ts`
- Modify: `tests/unit/commands/init.test.ts`

- [ ] **Step 1: Write failing test for workflow generation**

Append to `tests/unit/commands/init.test.ts`:

```typescript
import { generateChangesetCheckWorkflow, writeChangesetCheckWorkflow } from "../../../src/commands/init-changesets.js";

describe("generateChangesetCheckWorkflow", () => {
  it("generates workflow YAML with the given default branch", () => {
    const yaml = generateChangesetCheckWorkflow("main");

    expect(yaml).toContain("name: Changeset Check");
    expect(yaml).toContain("branches: [main]");
    expect(yaml).toContain("pull-requests: write");
    expect(yaml).toContain("no-changeset");
    expect(yaml).toContain(".pubm/changesets/*.md");
    expect(yaml).toContain("changeset-check");
  });

  it("uses custom branch name in trigger", () => {
    const yaml = generateChangesetCheckWorkflow("develop");
    expect(yaml).toContain("branches: [develop]");
  });
});

describe("writeChangesetCheckWorkflow", () => {
  it("creates .github/workflows/changeset-check.yml", () => {
    const result = writeChangesetCheckWorkflow(TEST_DIR, "main");

    expect(result).toBe(true);
    const filePath = path.join(TEST_DIR, ".github", "workflows", "changeset-check.yml");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("name: Changeset Check");
  });

  it("returns false when workflow file already exists", () => {
    const workflowDir = path.join(TEST_DIR, ".github", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(path.join(workflowDir, "changeset-check.yml"), "existing");

    const result = writeChangesetCheckWorkflow(TEST_DIR, "main");
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest --run tests/unit/commands/init.test.ts`
Expected: FAIL — `generateChangesetCheckWorkflow` / `writeChangesetCheckWorkflow` not exported

- [ ] **Step 3: Implement workflow generator**

Add to `src/commands/init-changesets.ts`:

```typescript
import { mkdirSync } from "node:fs";

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
            echo "skipped=true" >> "\$GITHUB_OUTPUT"
            exit 0
          fi
          CHANGESETS=$(git diff --name-only "origin/\${BASE_REF}...HEAD" -- '.pubm/changesets/*.md')
          if [ -z "\$CHANGESETS" ]; then
            echo "found=false" >> "\$GITHUB_OUTPUT"
          else
            echo "found=true" >> "\$GITHUB_OUTPUT"
            echo "\$CHANGESETS" > /tmp/changesets.txt
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
  const workflowPath = path.join(
    cwd,
    ".github",
    "workflows",
    "changeset-check.yml",
  );

  if (existsSync(workflowPath)) {
    return false;
  }

  mkdirSync(path.dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, generateChangesetCheckWorkflow(defaultBranch));
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest --run tests/unit/commands/init.test.ts`
Expected: PASS — all workflow tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/init-changesets.ts tests/unit/commands/init.test.ts
git commit -m "feat(init): add changeset-check workflow generator"
```

---

### Task 3: CLAUDE.md updater — test + implement

**Files:**
- Modify: `src/commands/init-changesets.ts`
- Modify: `tests/unit/commands/init.test.ts`

- [ ] **Step 1: Write failing test for CLAUDE.md update**

Append to `tests/unit/commands/init.test.ts`:

```typescript
import { updateClaudeMdWithChangesets } from "../../../src/commands/init-changesets.js";

describe("updateClaudeMdWithChangesets", () => {
  it("appends changesets section to existing CLAUDE.md", () => {
    writeFileSync(
      path.join(TEST_DIR, "CLAUDE.md"),
      "# Project\n\nSome instructions.\n",
    );

    const result = updateClaudeMdWithChangesets(TEST_DIR);

    expect(result).toBe(true);
    const content = readFileSync(path.join(TEST_DIR, "CLAUDE.md"), "utf8");
    expect(content).toContain("# Project");
    expect(content).toContain("## Changesets Workflow");
    expect(content).toContain("pubm changesets add");
  });

  it("creates CLAUDE.md with changesets section when file does not exist", () => {
    const result = updateClaudeMdWithChangesets(TEST_DIR);

    expect(result).toBe(true);
    const content = readFileSync(path.join(TEST_DIR, "CLAUDE.md"), "utf8");
    expect(content).toContain("## Changesets Workflow");
  });

  it("does not produce leading blank lines when CLAUDE.md is empty", () => {
    writeFileSync(path.join(TEST_DIR, "CLAUDE.md"), "");

    const result = updateClaudeMdWithChangesets(TEST_DIR);

    expect(result).toBe(true);
    const content = readFileSync(path.join(TEST_DIR, "CLAUDE.md"), "utf8");
    expect(content).not.toMatch(/^\n/);
    expect(content).toContain("## Changesets Workflow");
  });

  it("returns false when section already exists (idempotent)", () => {
    writeFileSync(
      path.join(TEST_DIR, "CLAUDE.md"),
      "# Project\n\n## Changesets Workflow\n\nAlready set up.\n",
    );

    const result = updateClaudeMdWithChangesets(TEST_DIR);
    expect(result).toBe(false);

    // Content should not be modified
    const content = readFileSync(path.join(TEST_DIR, "CLAUDE.md"), "utf8");
    expect(content).toBe("# Project\n\n## Changesets Workflow\n\nAlready set up.\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest --run tests/unit/commands/init.test.ts`
Expected: FAIL — `updateClaudeMdWithChangesets` not exported

- [ ] **Step 3: Implement CLAUDE.md updater**

Add to `src/commands/init-changesets.ts`:

```typescript
const CHANGESETS_WORKFLOW_SECTION = `## Changesets Workflow

This project uses pubm changesets to track changes and automate versioning.

### Rules
- Every PR that changes runtime code must include a changeset file
- Add a changeset: \`pubm changesets add\`
- PRs with \`no-changeset\` label skip the changeset check (use for docs, CI config, etc.)

### Workflow
1. Make changes on a feature branch
2. Run \`pubm changesets add\` — select packages, bump type, and summary
3. Commit the generated \`.pubm/changesets/<id>.md\` file with your PR
4. On merge, changesets accumulate on main
5. When releasing, \`pubm\` consumes pending changesets to determine versions and generate CHANGELOG

### Bump Type Guide
- **patch**: Bug fixes, internal refactors with no API changes
- **minor**: New features, backward-compatible additions
- **major**: Breaking changes, removed/renamed public APIs

### Review Checklist
- [ ] Changeset file included (or \`no-changeset\` label applied)
- [ ] Bump type matches the scope of changes
- [ ] Summary is clear and user-facing
`;

export function updateClaudeMdWithChangesets(cwd: string): boolean {
  const claudeMdPath = path.join(cwd, "CLAUDE.md");
  let content = existsSync(claudeMdPath)
    ? readFileSync(claudeMdPath, "utf8")
    : "";

  if (content.includes("## Changesets Workflow")) {
    return false;
  }

  const trimmed = content.trimEnd();
  content = trimmed.length > 0
    ? trimmed + "\n\n" + CHANGESETS_WORKFLOW_SECTION
    : CHANGESETS_WORKFLOW_SECTION;
  writeFileSync(claudeMdPath, content);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest --run tests/unit/commands/init.test.ts`
Expected: PASS — all CLAUDE.md tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/init-changesets.ts tests/unit/commands/init.test.ts
git commit -m "feat(init): add CLAUDE.md changesets workflow updater"
```

---

### Task 4: Wire `--changesets` flag into init command — test + implement

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `src/commands/init-changesets.ts`
- Modify: `tests/unit/commands/init.test.ts`

- [ ] **Step 1: Write failing test for `--changesets` flag integration**

Append to `tests/unit/commands/init.test.ts`:

```typescript
import { Command } from "commander";
import { detectDefaultBranch } from "../../../src/commands/init-changesets.js";
import { registerInitCommand } from "../../../src/commands/init.js";

describe("detectDefaultBranch", () => {
  it("returns 'main' as fallback when git command fails", () => {
    // TEST_DIR is not a git repo, so symbolic-ref will fail
    const result = detectDefaultBranch(TEST_DIR);
    expect(result).toBe("main");
  });

  it("returns 'main' as fallback for a repo without remote", () => {
    const { execSync } = require("node:child_process");
    execSync("git init", { cwd: TEST_DIR, stdio: "pipe" });

    const result = detectDefaultBranch(TEST_DIR);
    expect(result).toBe("main");
  });
});

describe("pubm init --changesets", () => {
  it("registers --changesets option", () => {
    const parent = new Command();
    registerInitCommand(parent);
    const initCmd = parent.commands.find((c) => c.name() === "init");
    expect(initCmd).toBeDefined();
    const opt = initCmd!.options.find((o) => o.long === "--changesets");
    expect(opt).toBeDefined();
  });

  it("creates workflow and updates CLAUDE.md when --changesets is passed", async () => {
    // Change cwd to TEST_DIR for this test
    const originalCwd = process.cwd();
    process.chdir(TEST_DIR);

    try {
      const parent = new Command();
      parent.exitOverride();
      registerInitCommand(parent);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await parent.parseAsync(["node", "test", "init", "--changesets"]);

      // Verify files were created
      expect(existsSync(path.join(TEST_DIR, ".pubm", "changesets"))).toBe(true);
      expect(existsSync(path.join(TEST_DIR, ".github", "workflows", "changeset-check.yml"))).toBe(true);

      const gitignore = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
      expect(gitignore).toContain(".pubm/*");
      expect(gitignore).toContain("!.pubm/changesets/");

      const claudeMd = readFileSync(path.join(TEST_DIR, "CLAUDE.md"), "utf8");
      expect(claudeMd).toContain("## Changesets Workflow");

      consoleSpy.mockRestore();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("does not create changeset files without --changesets flag", async () => {
    const originalCwd = process.cwd();
    process.chdir(TEST_DIR);

    try {
      const parent = new Command();
      parent.exitOverride();
      registerInitCommand(parent);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await parent.parseAsync(["node", "test", "init"]);

      // Base init runs (creates .pubm/changesets/ and pubm.config.ts)
      expect(existsSync(path.join(TEST_DIR, ".pubm", "changesets"))).toBe(true);

      // But changeset-specific files are NOT created
      expect(existsSync(path.join(TEST_DIR, ".github", "workflows", "changeset-check.yml"))).toBe(false);
      expect(existsSync(path.join(TEST_DIR, "CLAUDE.md"))).toBe(false);

      consoleSpy.mockRestore();
    } finally {
      process.chdir(originalCwd);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest --run tests/unit/commands/init.test.ts`
Expected: FAIL — `--changesets` option not recognized

- [ ] **Step 3: Add default branch detection helper**

Add to `src/commands/init-changesets.ts`:

```typescript
import { execSync } from "node:child_process";

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
```

- [ ] **Step 4: Update `init.ts` to add `--changesets` flag**

Replace the full content of `src/commands/init.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import {
  detectDefaultBranch,
  updateClaudeMdWithChangesets,
  updateGitignoreForChangesets,
  writeChangesetCheckWorkflow,
} from "./init-changesets.js";

export function registerInitCommand(parent: Command): void {
  parent
    .command("init")
    .description("Initialize pubm configuration")
    .option("--changesets", "Set up changesets workflow (CI check, CLAUDE.md)")
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

        if (updateClaudeMdWithChangesets(cwd)) {
          console.log("Updated CLAUDE.md with changesets workflow guide");
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun vitest --run tests/unit/commands/init.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 6: Run full test suite and lint**

Run: `bun run check && bun run typecheck && bun run test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/commands/init.ts src/commands/init-changesets.ts tests/unit/commands/init.test.ts
git commit -m "feat(init): wire --changesets flag into init command"
```

---

## Chunk 2: Skill Update + Documentation

### Task 5: Update publish-setup skill

**Files:**
- Modify: `plugins/pubm-plugin/skills/publish-setup/SKILL.md`

- [ ] **Step 1: Update SKILL.md with changesets question in Step 3**

Replace current Step 3 with a unified "Ask setup scope" step, and add a new changesets step after CI setup. The key changes:

**Replace Step 3 header and content** with:

```markdown
### 3. Ask setup scope

Ask the user all setup questions upfront before proceeding to configuration:

1. **Which registries** to publish to? (npm, jsr, crates, private)
2. **Set up CI/CD** for automated publishing?
3. **Use changesets workflow?** (Track changes per PR, automate versioning + CHANGELOG)
4. **Use external version sync?** (Sync version to non-manifest files)

Store the answers and use them to conditionally execute subsequent steps.
```

**After Step 7 (CI setup), add:**

```markdown
### 7.1. Changesets Workflow (if selected in Step 3)

Run the CLI to set up the changesets workflow:

\`\`\`bash
pubm init --changesets
\`\`\`

This creates:
- `.github/workflows/changeset-check.yml` — PR changeset detection with bot comments
- Updates `.gitignore` to track `.pubm/changesets/` while ignoring other `.pubm/` contents
- Adds a "Changesets Workflow" section to `CLAUDE.md` with team rules and guidelines

After running, verify the output and inform the user about the workflow:
- Every PR with code changes needs a changeset (`pubm changesets add`)
- `no-changeset` label skips the check for docs/CI-only changes
- On release, pubm consumes changesets to determine version bumps and generate CHANGELOG
```

**Update Step 6 (.gitignore)** — add a note:

```markdown
### 6. Update .gitignore

Check if `.pubm/` is already in `.gitignore`. If not, append it. This directory contains encrypted JSR tokens and should not be committed.

**Note:** If the user selected changesets workflow in Step 3, the `.gitignore` update will be handled by `pubm init --changesets` instead (it uses `.pubm/*` with `!.pubm/changesets/` to track changeset files while ignoring tokens). Skip this step in that case.
```

**Update Constraints** — add:

```markdown
- When changesets workflow is selected, do NOT add `.pubm/` to `.gitignore` directly — `pubm init --changesets` handles the correct pattern (`.pubm/*` + `!.pubm/changesets/`).
```

- [ ] **Step 2: Review the changes read back the modified file**

Read the modified SKILL.md to verify the structure is consistent and all step numbers flow correctly.

- [ ] **Step 3: Commit**

```bash
git add plugins/pubm-plugin/skills/publish-setup/SKILL.md
git commit -m "feat(skill): add changesets workflow to publish-setup wizard"
```

---

### Task 6: Update ci-templates.md reference

**Files:**
- Modify: `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`

- [ ] **Step 1: Append changeset-check workflow documentation**

Add the following section at the end of `references/ci-templates.md`:

```markdown
## Template: Changeset Check (PR Validation)

This workflow is generated by `pubm init --changesets`. It validates that every PR includes a changeset file.

### How It Works

- Triggers on pull_request events (opened, synchronize, reopened, labeled, unlabeled)
- Checks for new `.pubm/changesets/*.md` files in the PR diff
- Posts/updates a bot comment on the PR with the result
- Fails the check if no changeset is found
- Skips when the `no-changeset` label is applied

### Generated File

`.github/workflows/changeset-check.yml` — generated by `pubm init --changesets`. The default branch is auto-detected from the git remote.

### Comment Behavior

The workflow uses `actions/github-script@v7` to post a single PR comment (identified by an HTML marker `<!-- changeset-check -->`). The comment is updated on each push, not duplicated.

| State | Comment | Check Result |
|---|---|---|
| Changeset files found | ✅ Changeset detected (with file list) | Pass |
| No changeset files | ❌ No changeset found (with instructions) | Fail |
| `no-changeset` label | ⚠️ Check skipped | Pass |

### Required Permissions

```yaml
permissions:
  contents: read       # Read repository to diff files
  pull-requests: write # Post/update PR comments
```

No additional secrets are required — `GITHUB_TOKEN` is automatically available.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md
git commit -m "docs: add changeset-check workflow to ci-templates reference"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full check suite**

```bash
bun run format
bun run typecheck
bun run test
```

Expected: All pass with no errors.

- [ ] **Step 2: Verify all generated files look correct**

Manually run `pubm init --changesets` in a temporary directory and inspect:
- `.gitignore` has correct pattern
- `.github/workflows/changeset-check.yml` has valid YAML
- `CLAUDE.md` has the workflow section

```bash
cd $(mktemp -d)
git init && git remote add origin https://github.com/test/test.git
npx pubm init --changesets
cat .gitignore
cat .github/workflows/changeset-check.yml
cat CLAUDE.md
```

- [ ] **Step 3: Final commit if any format fixes needed**

```bash
git add -A
git commit -m "style: format changes from verification"
```
