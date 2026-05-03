import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrompts = vi.hoisted(() => ({
  detectPackages: vi.fn(),
  promptBranch: vi.fn(),
  promptChangelog: vi.fn(),
  promptChangesets: vi.fn(),
  promptCI: vi.fn(),
  promptGithubRelease: vi.fn(),
  promptOverwriteConfig: vi.fn(),
  promptPackages: vi.fn(),
  promptSkills: vi.fn(),
  promptVersioning: vi.fn(),
}));

const mockSetupSkills = vi.hoisted(() => ({
  runSetupSkills: vi.fn(),
}));

vi.mock("@pubm/core", () => ({
  detectWorkspace: vi.fn(() => []),
  discoverPackages: vi.fn(async () => []),
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@pubm/runner", () => ({
  prompt: vi.fn(),
}));

vi.mock("../../../src/commands/init-prompts.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/commands/init-prompts.js")
    >();
  return {
    ...actual,
    detectPackages: mockPrompts.detectPackages,
    promptBranch: mockPrompts.promptBranch,
    promptChangelog: mockPrompts.promptChangelog,
    promptChangesets: mockPrompts.promptChangesets,
    promptCI: mockPrompts.promptCI,
    promptGithubRelease: mockPrompts.promptGithubRelease,
    promptOverwriteConfig: mockPrompts.promptOverwriteConfig,
    promptPackages: mockPrompts.promptPackages,
    promptSkills: mockPrompts.promptSkills,
    promptVersioning: mockPrompts.promptVersioning,
  };
});

vi.mock("../../../src/commands/setup-skills.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/commands/setup-skills.js")
    >();
  return {
    ...actual,
    runSetupSkills: mockSetupSkills.runSetupSkills,
  };
});

import { ui } from "@pubm/core";
import { registerInitCommand } from "../../../src/commands/init.js";

const roots: string[] = [];
let originalCwd: string;
let originalIsTty: boolean | undefined;

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pubm-init-contract-"));
  roots.push(root);
  return root;
}

async function runInit(root: string, isTty = true): Promise<void> {
  process.chdir(root);
  process.stdin.isTTY = isTty;
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  await program.parseAsync(["node", "pubm", "init"]);
}

beforeEach(() => {
  originalCwd = process.cwd();
  originalIsTty = process.stdin.isTTY;
  process.exitCode = undefined;
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockPrompts.detectPackages.mockResolvedValue({
    isMonorepo: true,
    workspaces: [{ type: "pnpm", root: "." }],
    packages: [
      { name: "@scope/core", path: "packages/core" },
      { name: "@scope/cli", path: "packages/cli" },
    ],
  });
  mockPrompts.promptPackages.mockResolvedValue([
    "packages/core",
    "packages/cli",
  ]);
  mockPrompts.promptBranch.mockResolvedValue("main");
  mockPrompts.promptVersioning.mockResolvedValue("fixed");
  mockPrompts.promptChangelog.mockResolvedValue(true);
  mockPrompts.promptGithubRelease.mockResolvedValue(true);
  mockPrompts.promptChangesets.mockResolvedValue(true);
  mockPrompts.promptCI.mockResolvedValue(true);
  mockPrompts.promptSkills.mockResolvedValue(true);
  mockPrompts.promptOverwriteConfig.mockResolvedValue(false);
  mockSetupSkills.runSetupSkills.mockResolvedValue({
    agents: ["codex"],
    skillCount: 3,
  });
});

afterEach(() => {
  process.chdir(originalCwd);
  process.stdin.isTTY = originalIsTty;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("init command contract", () => {
  it("creates monorepo config, changesets, workflows, and coding-agent skills from prompt decisions", async () => {
    const root = makeRoot();

    await runInit(root);

    expect(existsSync(path.join(root, ".pubm", "changesets"))).toBe(true);
    expect(readFileSync(path.join(root, ".gitignore"), "utf-8")).toContain(
      "!.pubm/changesets/",
    );
    expect(
      existsSync(
        path.join(root, ".github", "workflows", "pubm-release-pr.yml"),
      ),
    ).toBe(true);
    expect(
      existsSync(path.join(root, ".github", "workflows", "pubm-publish.yml")),
    ).toBe(true);
    expect(
      existsSync(
        path.join(root, ".github", "workflows", "pubm-changeset-check.yml"),
      ),
    ).toBe(true);
    const config = readFileSync(path.join(root, "pubm.config.ts"), "utf-8");
    expect(config).toContain("versioning: {");
    expect(config).toContain('mode: "fixed"');
    expect(mockSetupSkills.runSetupSkills).toHaveBeenCalledWith(
      realpathSync(root),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("fails without mutating the project when init runs outside a TTY", async () => {
    const root = makeRoot();

    await runInit(root, false);

    expect(ui.error).toHaveBeenCalledWith("error.init.requiresTty");
    expect(existsSync(path.join(root, "pubm.config.ts"))).toBe(false);
    expect(existsSync(path.join(root, ".pubm"))).toBe(false);
    expect(mockPrompts.detectPackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
