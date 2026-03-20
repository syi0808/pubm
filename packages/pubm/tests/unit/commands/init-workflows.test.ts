import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectPackageManager,
  generateChangesetCheckWorkflow,
  generateReleaseWorkflow,
  updateGitignoreForChangesets,
  writeWorkflowFile,
} from "../../../src/commands/init-workflows.js";

const TEST_DIR = path.resolve("tests/unit/commands/.tmp-init-workflows");

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// detectPackageManager
// ---------------------------------------------------------------------------

describe("detectPackageManager", () => {
  it("returns 'bun' when bun.lock exists", () => {
    writeFileSync(path.join(TEST_DIR, "bun.lock"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("bun");
  });

  it("returns 'pnpm' when pnpm-lock.yaml exists", () => {
    writeFileSync(path.join(TEST_DIR, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("pnpm");
  });

  it("returns 'yarn' when yarn.lock exists", () => {
    writeFileSync(path.join(TEST_DIR, "yarn.lock"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("yarn");
  });

  it("returns 'cargo' when Cargo.lock exists and package.json does NOT exist", () => {
    writeFileSync(path.join(TEST_DIR, "Cargo.lock"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("cargo");
  });

  it("returns 'npm' when Cargo.lock exists but package.json also exists (hybrid)", () => {
    writeFileSync(path.join(TEST_DIR, "Cargo.lock"), "");
    writeFileSync(path.join(TEST_DIR, "package.json"), "{}");
    expect(detectPackageManager(TEST_DIR)).toBe("npm");
  });

  it("returns 'npm' when only package-lock.json exists", () => {
    writeFileSync(path.join(TEST_DIR, "package-lock.json"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("npm");
  });

  it("returns 'npm' when no lock file exists at all", () => {
    expect(detectPackageManager(TEST_DIR)).toBe("npm");
  });

  it("bun takes priority over pnpm when both lock files exist", () => {
    writeFileSync(path.join(TEST_DIR, "bun.lock"), "");
    writeFileSync(path.join(TEST_DIR, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("bun");
  });

  it("bun takes priority over yarn when both lock files exist", () => {
    writeFileSync(path.join(TEST_DIR, "bun.lock"), "");
    writeFileSync(path.join(TEST_DIR, "yarn.lock"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("bun");
  });

  it("pnpm takes priority over yarn when both lock files exist", () => {
    writeFileSync(path.join(TEST_DIR, "pnpm-lock.yaml"), "");
    writeFileSync(path.join(TEST_DIR, "yarn.lock"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("pnpm");
  });

  it("yarn takes priority over cargo (pure) when both exist", () => {
    writeFileSync(path.join(TEST_DIR, "yarn.lock"), "");
    writeFileSync(path.join(TEST_DIR, "Cargo.lock"), "");
    expect(detectPackageManager(TEST_DIR)).toBe("yarn");
  });
});

// ---------------------------------------------------------------------------
// generateReleaseWorkflow — single package (tag-based)
// ---------------------------------------------------------------------------

describe("generateReleaseWorkflow — single package (tag-based)", () => {
  const pms = ["bun", "pnpm", "yarn", "npm", "cargo"] as const;

  for (const pm of pms) {
    describe(`package manager: ${pm}`, () => {
      it("uses tag-based trigger (push: tags: v*)", () => {
        const yaml = generateReleaseWorkflow(false, "main", pm);
        expect(yaml).toContain("push:");
        expect(yaml).toContain("tags:");
        expect(yaml).toContain("- 'v*'");
        expect(yaml).not.toContain("branches:");
      });

      it("includes fetch-depth: 0", () => {
        const yaml = generateReleaseWorkflow(false, "main", pm);
        expect(yaml).toContain("fetch-depth: 0");
      });

      it("does not include monorepo if-condition", () => {
        const yaml = generateReleaseWorkflow(false, "main", pm);
        expect(yaml).not.toContain(
          "startsWith(github.event.head_commit.message",
        );
      });
    });
  }

  it("bun: includes oven-sh/setup-bun setup action", () => {
    const yaml = generateReleaseWorkflow(false, "main", "bun");
    expect(yaml).toContain("oven-sh/setup-bun@v2");
  });

  it("bun: includes bun install --frozen-lockfile", () => {
    const yaml = generateReleaseWorkflow(false, "main", "bun");
    expect(yaml).toContain("bun install --frozen-lockfile");
  });

  it("bun: publish command is 'bunx pubm --mode ci --phase publish'", () => {
    const yaml = generateReleaseWorkflow(false, "main", "bun");
    expect(yaml).toContain("bunx pubm --mode ci --phase publish");
  });

  it("bun: env includes NODE_AUTH_TOKEN", () => {
    const yaml = generateReleaseWorkflow(false, "main", "bun");
    expect(yaml).toContain("NODE_AUTH_TOKEN:");
    expect(yaml).not.toContain("CARGO_REGISTRY_TOKEN:");
  });

  it("bun: permissions include id-token: write", () => {
    const yaml = generateReleaseWorkflow(false, "main", "bun");
    expect(yaml).toContain("id-token: write");
  });

  it("pnpm: includes pnpm/action-setup action", () => {
    const yaml = generateReleaseWorkflow(false, "main", "pnpm");
    expect(yaml).toContain("pnpm/action-setup@v4");
  });

  it("pnpm: includes pnpm install --frozen-lockfile", () => {
    const yaml = generateReleaseWorkflow(false, "main", "pnpm");
    expect(yaml).toContain("pnpm install --frozen-lockfile");
  });

  it("pnpm: publish command is 'pnpm exec pubm --mode ci --phase publish'", () => {
    const yaml = generateReleaseWorkflow(false, "main", "pnpm");
    expect(yaml).toContain("pnpm exec pubm --mode ci --phase publish");
  });

  it("pnpm: env includes NODE_AUTH_TOKEN", () => {
    const yaml = generateReleaseWorkflow(false, "main", "pnpm");
    expect(yaml).toContain("NODE_AUTH_TOKEN:");
    expect(yaml).not.toContain("CARGO_REGISTRY_TOKEN:");
  });

  it("pnpm: permissions include id-token: write", () => {
    const yaml = generateReleaseWorkflow(false, "main", "pnpm");
    expect(yaml).toContain("id-token: write");
  });

  it("yarn: setup-node with cache: yarn", () => {
    const yaml = generateReleaseWorkflow(false, "main", "yarn");
    expect(yaml).toContain("cache: yarn");
  });

  it("yarn: includes yarn install --immutable", () => {
    const yaml = generateReleaseWorkflow(false, "main", "yarn");
    expect(yaml).toContain("yarn install --immutable");
  });

  it("yarn: publish command is 'yarn pubm --mode ci --phase publish'", () => {
    const yaml = generateReleaseWorkflow(false, "main", "yarn");
    expect(yaml).toContain("yarn pubm --mode ci --phase publish");
  });

  it("yarn: env includes NODE_AUTH_TOKEN", () => {
    const yaml = generateReleaseWorkflow(false, "main", "yarn");
    expect(yaml).toContain("NODE_AUTH_TOKEN:");
    expect(yaml).not.toContain("CARGO_REGISTRY_TOKEN:");
  });

  it("yarn: permissions include id-token: write", () => {
    const yaml = generateReleaseWorkflow(false, "main", "yarn");
    expect(yaml).toContain("id-token: write");
  });

  it("npm: setup-node without cache option (no package manager cache)", () => {
    const yaml = generateReleaseWorkflow(false, "main", "npm");
    // npm uses setup-node but without 'cache: pnpm' or 'cache: yarn'
    expect(yaml).toContain("actions/setup-node@v4");
    expect(yaml).not.toContain("cache: pnpm");
    expect(yaml).not.toContain("cache: yarn");
  });

  it("npm: includes npm ci", () => {
    const yaml = generateReleaseWorkflow(false, "main", "npm");
    expect(yaml).toContain("npm ci");
  });

  it("npm: publish command is 'npx pubm --mode ci --phase publish'", () => {
    const yaml = generateReleaseWorkflow(false, "main", "npm");
    expect(yaml).toContain("npx pubm --mode ci --phase publish");
  });

  it("npm: env includes NODE_AUTH_TOKEN", () => {
    const yaml = generateReleaseWorkflow(false, "main", "npm");
    expect(yaml).toContain("NODE_AUTH_TOKEN:");
    expect(yaml).not.toContain("CARGO_REGISTRY_TOKEN:");
  });

  it("npm: permissions include id-token: write", () => {
    const yaml = generateReleaseWorkflow(false, "main", "npm");
    expect(yaml).toContain("id-token: write");
  });

  it("cargo: includes dtolnay/rust-toolchain@stable", () => {
    const yaml = generateReleaseWorkflow(false, "main", "cargo");
    expect(yaml).toContain("dtolnay/rust-toolchain@stable");
  });

  it("cargo: installs pubm via brew", () => {
    const yaml = generateReleaseWorkflow(false, "main", "cargo");
    expect(yaml).toContain("brew install pubm");
  });

  it("cargo: publish command is 'pubm --mode ci --phase publish'", () => {
    const yaml = generateReleaseWorkflow(false, "main", "cargo");
    expect(yaml).toContain("pubm --mode ci --phase publish");
  });

  it("cargo: env includes CARGO_REGISTRY_TOKEN, not NODE_AUTH_TOKEN", () => {
    const yaml = generateReleaseWorkflow(false, "main", "cargo");
    expect(yaml).toContain("CARGO_REGISTRY_TOKEN:");
    expect(yaml).not.toContain("NODE_AUTH_TOKEN:");
  });

  it("cargo: permissions do NOT include id-token: write", () => {
    const yaml = generateReleaseWorkflow(false, "main", "cargo");
    expect(yaml).not.toContain("id-token: write");
    expect(yaml).toContain("contents: write");
  });

  it("all PMs: env always includes GITHUB_TOKEN", () => {
    for (const pm of pms) {
      const yaml = generateReleaseWorkflow(false, "main", pm);
      expect(yaml).toContain("GITHUB_TOKEN:");
    }
  });
});

// ---------------------------------------------------------------------------
// generateReleaseWorkflow — monorepo (commit-based)
// ---------------------------------------------------------------------------

describe("generateReleaseWorkflow — monorepo (commit-based)", () => {
  it("bun: uses branch-based trigger (push: branches)", () => {
    const yaml = generateReleaseWorkflow(true, "main", "bun");
    expect(yaml).toContain("branches:");
    expect(yaml).toContain("- main");
    expect(yaml).not.toContain("tags:");
  });

  it("bun: has 'Version Packages' if-condition", () => {
    const yaml = generateReleaseWorkflow(true, "main", "bun");
    expect(yaml).toContain(
      "startsWith(github.event.head_commit.message, 'Version Packages')",
    );
  });

  it("bun: includes correct setup and publish steps", () => {
    const yaml = generateReleaseWorkflow(true, "main", "bun");
    expect(yaml).toContain("oven-sh/setup-bun@v2");
    expect(yaml).toContain("bunx pubm --mode ci --phase publish");
  });

  it("pnpm: uses branch-based trigger", () => {
    const yaml = generateReleaseWorkflow(true, "main", "pnpm");
    expect(yaml).toContain("branches:");
    expect(yaml).not.toContain("tags:");
  });

  it("pnpm: has 'Version Packages' if-condition", () => {
    const yaml = generateReleaseWorkflow(true, "main", "pnpm");
    expect(yaml).toContain(
      "startsWith(github.event.head_commit.message, 'Version Packages')",
    );
  });

  it("pnpm: includes correct setup and publish steps", () => {
    const yaml = generateReleaseWorkflow(true, "main", "pnpm");
    expect(yaml).toContain("pnpm/action-setup@v4");
    expect(yaml).toContain("pnpm exec pubm --mode ci --phase publish");
  });

  it("npm: uses branch-based trigger", () => {
    const yaml = generateReleaseWorkflow(true, "main", "npm");
    expect(yaml).toContain("branches:");
    expect(yaml).not.toContain("tags:");
  });

  it("npm: has 'Version Packages' if-condition", () => {
    const yaml = generateReleaseWorkflow(true, "main", "npm");
    expect(yaml).toContain(
      "startsWith(github.event.head_commit.message, 'Version Packages')",
    );
  });

  it("npm: includes correct setup and publish steps", () => {
    const yaml = generateReleaseWorkflow(true, "main", "npm");
    expect(yaml).toContain("npm ci");
    expect(yaml).toContain("npx pubm --mode ci --phase publish");
  });

  it("yarn: uses branch-based trigger", () => {
    const yaml = generateReleaseWorkflow(true, "main", "yarn");
    expect(yaml).toContain("branches:");
    expect(yaml).not.toContain("tags:");
  });

  it("yarn: has 'Version Packages' if-condition", () => {
    const yaml = generateReleaseWorkflow(true, "main", "yarn");
    expect(yaml).toContain(
      "startsWith(github.event.head_commit.message, 'Version Packages')",
    );
  });

  it("cargo: uses branch-based trigger", () => {
    const yaml = generateReleaseWorkflow(true, "main", "cargo");
    expect(yaml).toContain("branches:");
    expect(yaml).not.toContain("tags:");
  });

  it("cargo: has 'Version Packages' if-condition", () => {
    const yaml = generateReleaseWorkflow(true, "main", "cargo");
    expect(yaml).toContain(
      "startsWith(github.event.head_commit.message, 'Version Packages')",
    );
  });

  it("all PMs: monorepo includes fetch-depth: 0", () => {
    const pms = ["bun", "pnpm", "yarn", "npm", "cargo"] as const;
    for (const pm of pms) {
      const yaml = generateReleaseWorkflow(true, "main", pm);
      expect(yaml).toContain("fetch-depth: 0");
    }
  });
});

// ---------------------------------------------------------------------------
// generateReleaseWorkflow — branch customization
// ---------------------------------------------------------------------------

describe("generateReleaseWorkflow — branch customization", () => {
  it("uses custom branch name 'develop' in monorepo trigger", () => {
    const yaml = generateReleaseWorkflow(true, "develop", "bun");
    expect(yaml).toContain("- develop");
    expect(yaml).not.toContain("- main");
  });

  it("uses custom branch name 'release' in monorepo trigger", () => {
    const yaml = generateReleaseWorkflow(true, "release", "npm");
    expect(yaml).toContain("- release");
  });

  it("single package: defaultBranch is NOT used in tag-based trigger", () => {
    const yaml = generateReleaseWorkflow(false, "develop", "bun");
    // tag-based; branch name should not appear as a trigger branch
    expect(yaml).toContain("- 'v*'");
    expect(yaml).not.toContain("branches:\n      - develop");
  });
});

// ---------------------------------------------------------------------------
// generateChangesetCheckWorkflow — additional tests
// ---------------------------------------------------------------------------

describe("generateChangesetCheckWorkflow — additional tests", () => {
  it("contains actions/github-script for PR comment logic", () => {
    const yaml = generateChangesetCheckWorkflow("main");
    expect(yaml).toContain("actions/github-script@v7");
  });

  it("contains 'Fail if no changeset' step", () => {
    const yaml = generateChangesetCheckWorkflow("main");
    expect(yaml).toContain("Fail if no changeset");
  });

  it("contains no-changeset label skip logic", () => {
    const yaml = generateChangesetCheckWorkflow("main");
    expect(yaml).toContain("no-changeset");
    expect(yaml).toContain("skipped=true");
  });

  it("contains pull-requests: write permission", () => {
    const yaml = generateChangesetCheckWorkflow("main");
    expect(yaml).toContain("pull-requests: write");
  });

  it("contains .pubm/changesets/*.md path pattern", () => {
    const yaml = generateChangesetCheckWorkflow("main");
    expect(yaml).toContain(".pubm/changesets/*.md");
  });

  it("uses 'develop' branch in trigger when specified", () => {
    const yaml = generateChangesetCheckWorkflow("develop");
    expect(yaml).toContain("branches: [develop]");
    expect(yaml).not.toContain("branches: [main]");
  });

  it("contains PR event types including labeled and unlabeled", () => {
    const yaml = generateChangesetCheckWorkflow("main");
    expect(yaml).toContain("labeled");
    expect(yaml).toContain("unlabeled");
  });

  it("contains exit 1 for failing when no changeset found", () => {
    const yaml = generateChangesetCheckWorkflow("main");
    expect(yaml).toContain("exit 1");
  });
});

// ---------------------------------------------------------------------------
// updateGitignoreForChangesets — edge cases
// ---------------------------------------------------------------------------

describe("updateGitignoreForChangesets — edge cases", () => {
  it("handles .gitignore with trailing whitespace after .pubm line", () => {
    writeFileSync(
      path.join(TEST_DIR, ".gitignore"),
      "node_modules\n.pubm/\n\n",
    );

    const result = updateGitignoreForChangesets(TEST_DIR);

    const content = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
    expect(content).toContain(".pubm/*");
    expect(content).toContain("!.pubm/changesets/");
    expect(result).toBe(true);
  });

  it("does not add duplicate .pubm/* if already present but missing !.pubm/changesets/", () => {
    writeFileSync(path.join(TEST_DIR, ".gitignore"), "node_modules\n.pubm/*\n");

    const result = updateGitignoreForChangesets(TEST_DIR);

    const content = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
    const matches = content.match(/\.pubm\/\*/g);
    expect(matches).toHaveLength(1);
    expect(content).toContain("!.pubm/changesets/");
    expect(result).toBe(true);
  });

  it("returns false and does not write when both entries are already present", () => {
    const original = "node_modules\n.pubm/*\n!.pubm/changesets/\n";
    writeFileSync(path.join(TEST_DIR, ".gitignore"), original);

    const result = updateGitignoreForChangesets(TEST_DIR);

    const content = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
    expect(result).toBe(false);
    expect(content).toBe(original);
  });

  it("works on an empty .gitignore file", () => {
    writeFileSync(path.join(TEST_DIR, ".gitignore"), "");

    const result = updateGitignoreForChangesets(TEST_DIR);

    const content = readFileSync(path.join(TEST_DIR, ".gitignore"), "utf8");
    expect(content).toContain(".pubm/*");
    expect(content).toContain("!.pubm/changesets/");
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// writeWorkflowFile — additional tests
// ---------------------------------------------------------------------------

describe("writeWorkflowFile — additional tests", () => {
  it("creates nested .github/workflows directory if it does not exist", () => {
    const workflowDir = path.join(TEST_DIR, ".github", "workflows");
    expect(existsSync(workflowDir)).toBe(false);

    writeWorkflowFile(TEST_DIR, "release.yml", "content");

    expect(existsSync(workflowDir)).toBe(true);
  });

  it("does not overwrite an existing workflow file", () => {
    const workflowDir = path.join(TEST_DIR, ".github", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const filePath = path.join(workflowDir, "release.yml");
    writeFileSync(filePath, "original content");

    const result = writeWorkflowFile(TEST_DIR, "release.yml", "new content");

    expect(result).toBe(false);
    expect(readFileSync(filePath, "utf8")).toBe("original content");
  });

  it("creates file with the exact content provided", () => {
    const content = "name: My Workflow\n";
    writeWorkflowFile(TEST_DIR, "my-workflow.yml", content);

    const filePath = path.join(
      TEST_DIR,
      ".github",
      "workflows",
      "my-workflow.yml",
    );
    expect(readFileSync(filePath, "utf8")).toBe(content);
  });

  it("returns true after successfully creating a new file", () => {
    const result = writeWorkflowFile(TEST_DIR, "new.yml", "content");
    expect(result).toBe(true);
  });

  it("handles different filenames independently (no cross-contamination)", () => {
    writeWorkflowFile(TEST_DIR, "release.yml", "release content");
    writeWorkflowFile(TEST_DIR, "check.yml", "check content");

    const releasePath = path.join(
      TEST_DIR,
      ".github",
      "workflows",
      "release.yml",
    );
    const checkPath = path.join(TEST_DIR, ".github", "workflows", "check.yml");

    expect(readFileSync(releasePath, "utf8")).toBe("release content");
    expect(readFileSync(checkPath, "utf8")).toBe("check content");
  });

  it("creates file at correct path inside cwd/.github/workflows/", () => {
    writeWorkflowFile(TEST_DIR, "test.yml", "test");

    const expectedPath = path.join(
      TEST_DIR,
      ".github",
      "workflows",
      "test.yml",
    );
    expect(existsSync(expectedPath)).toBe(true);
  });
});
