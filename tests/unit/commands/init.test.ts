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
  generateChangesetCheckWorkflow,
  updateGitignoreForChangesets,
  writeChangesetCheckWorkflow,
} from "../../../src/commands/init-changesets.js";

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

describe("writeChangesetCheckWorkflow", () => {
  it("creates .github/workflows/changeset-check.yml", () => {
    const result = writeChangesetCheckWorkflow(TEST_DIR, "main");

    expect(result).toBe(true);
    const filePath = path.join(
      TEST_DIR,
      ".github",
      "workflows",
      "changeset-check.yml",
    );
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
