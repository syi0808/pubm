import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerInitCommand } from "../../../src/commands/init.js";
import { detectDefaultBranch } from "../../../src/commands/init-prompts.js";
import {
  generateChangesetCheckWorkflow,
  updateGitignoreForChangesets,
  writeWorkflowFile,
} from "../../../src/commands/init-workflows.js";

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

describe("writeWorkflowFile", () => {
  it("creates workflow file in .github/workflows/", () => {
    const content = generateChangesetCheckWorkflow("main");
    const result = writeWorkflowFile(TEST_DIR, "changeset-check.yml", content);

    expect(result).toBe(true);
    const filePath = path.join(
      TEST_DIR,
      ".github",
      "workflows",
      "changeset-check.yml",
    );
    expect(existsSync(filePath)).toBe(true);

    const written = readFileSync(filePath, "utf8");
    expect(written).toContain("name: Changeset Check");
  });

  it("returns false when workflow file already exists", () => {
    const workflowDir = path.join(TEST_DIR, ".github", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(path.join(workflowDir, "changeset-check.yml"), "existing");

    const content = generateChangesetCheckWorkflow("main");
    const result = writeWorkflowFile(TEST_DIR, "changeset-check.yml", content);
    expect(result).toBe(false);
  });
});

describe("detectDefaultBranch", () => {
  it("returns 'main' as fallback when git command fails", () => {
    const result = detectDefaultBranch(TEST_DIR);
    expect(result).toBe("main");
  });

  it("returns 'main' as fallback for a repo without remote", () => {
    execSync("git init", { cwd: TEST_DIR, stdio: "pipe" });
    const result = detectDefaultBranch(TEST_DIR);
    expect(result).toBe("main");
  });
});

describe("registerInitCommand", () => {
  it("registers init command without --changesets option", () => {
    const parent = new Command();
    registerInitCommand(parent);
    const initCmd = parent.commands.find((c) => c.name() === "init");
    expect(initCmd).toBeDefined();
    expect(initCmd!.description()).toBe(
      "Interactive setup wizard for pubm configuration",
    );
    const opt = initCmd!.options.find((o) => o.long === "--changesets");
    expect(opt).toBeUndefined();
  });
});
