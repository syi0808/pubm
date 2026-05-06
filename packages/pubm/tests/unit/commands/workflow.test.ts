import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pubm/core", () => ({
  ui: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@pubm/runner", () => ({
  prompt: vi.fn(),
}));

import {
  installGithubActionsWorkflows,
  registerWorkflowCommand,
} from "../../../src/commands/workflow.js";

const TEST_DIR = path.resolve("tests/unit/commands/.tmp-workflow");

let originalIsTTY: boolean | undefined;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  originalIsTTY = process.stdin.isTTY;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.stdin.isTTY = originalIsTTY;
  rmSync(TEST_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("workflow command registration", () => {
  it("registers workflow install github with installer options", () => {
    const program = new Command();
    registerWorkflowCommand(program);

    const workflow = program.commands.find((cmd) => cmd.name() === "workflow");
    const install = workflow?.commands.find((cmd) => cmd.name() === "install");
    const github = install?.commands.find((cmd) => cmd.name() === "github");

    expect(github).toBeDefined();
    expect(github?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--force",
        "--dry-run",
        "--package-manager",
        "--branch",
        "--skip-changeset-check",
        "--skip-release-pr",
        "--skip-publish",
      ]),
    );
  });
});

describe("installGithubActionsWorkflows", () => {
  it("writes split GitHub workflows", async () => {
    process.stdin.isTTY = false;

    await installGithubActionsWorkflows(TEST_DIR, {
      branch: "release",
      packageManager: "bun",
    });

    const workflowDir = path.join(TEST_DIR, ".github", "workflows");
    expect(existsSync(path.join(workflowDir, "pubm-changeset-check.yml"))).toBe(
      true,
    );
    expect(existsSync(path.join(workflowDir, "pubm-release-pr.yml"))).toBe(
      true,
    );
    expect(existsSync(path.join(workflowDir, "pubm-publish.yml"))).toBe(true);
    expect(
      readFileSync(path.join(workflowDir, "pubm-release-pr.yml"), "utf8"),
    ).toContain("base-branch: release");
  });

  it("honors skip options", async () => {
    process.stdin.isTTY = false;

    await installGithubActionsWorkflows(TEST_DIR, {
      branch: "main",
      packageManager: "npm",
      skipChangesetCheck: true,
      skipPublish: true,
    });

    const workflowDir = path.join(TEST_DIR, ".github", "workflows");
    expect(existsSync(path.join(workflowDir, "pubm-changeset-check.yml"))).toBe(
      false,
    );
    expect(existsSync(path.join(workflowDir, "pubm-release-pr.yml"))).toBe(
      true,
    );
    expect(existsSync(path.join(workflowDir, "pubm-publish.yml"))).toBe(false);
  });

  it("prints a dry-run summary without writing files", async () => {
    process.stdin.isTTY = false;
    const log = vi.mocked(console.log);

    await installGithubActionsWorkflows(TEST_DIR, {
      dryRun: true,
      branch: "main",
      packageManager: "pnpm",
    });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(".github/workflows/pubm-release-pr.yml"),
    );
    expect(existsSync(path.join(TEST_DIR, ".github"))).toBe(false);
  });

  it("fails on existing files in non-interactive mode unless forced", async () => {
    process.stdin.isTTY = false;
    const workflowDir = path.join(TEST_DIR, ".github", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(path.join(workflowDir, "pubm-publish.yml"), "existing");

    await expect(
      installGithubActionsWorkflows(TEST_DIR, {
        branch: "main",
        packageManager: "npm",
      }),
    ).rejects.toThrow("Use --force");

    expect(
      readFileSync(path.join(workflowDir, "pubm-publish.yml"), "utf8"),
    ).toBe("existing");
  });

  it("overwrites existing files when forced", async () => {
    process.stdin.isTTY = false;
    const workflowDir = path.join(TEST_DIR, ".github", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(path.join(workflowDir, "pubm-publish.yml"), "existing");

    await installGithubActionsWorkflows(TEST_DIR, {
      branch: "main",
      packageManager: "cargo",
      force: true,
      skipChangesetCheck: true,
      skipReleasePr: true,
    });

    expect(
      readFileSync(path.join(workflowDir, "pubm-publish.yml"), "utf8"),
    ).toContain("dtolnay/rust-toolchain@stable");
  });
});
