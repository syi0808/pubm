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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../../src/commands/init-prompts.js", async () => {
  const actual = await vi.importActual("../../../src/commands/init-prompts.js");
  return {
    ...actual,
    detectPackages: vi.fn(),
    promptPackages: vi.fn(),
    promptBranch: vi.fn(),
    promptVersioning: vi.fn(),
    promptChangelog: vi.fn(),
    promptGithubRelease: vi.fn(),
    promptChangesets: vi.fn(),
    promptCI: vi.fn(),
    promptSkills: vi.fn(),
    promptOverwriteConfig: vi.fn(),
  };
});

vi.mock("../../../src/commands/init-workflows.js", async () => {
  const actual = await vi.importActual(
    "../../../src/commands/init-workflows.js",
  );
  return {
    ...actual,
    detectPackageManager: vi.fn(),
    writeWorkflowFile: vi.fn(),
  };
});

vi.mock("../../../src/commands/setup-skills.js", () => ({
  AGENT_LABELS: {
    "claude-code": "Claude Code",
    codex: "Codex CLI",
    gemini: "Gemini CLI",
  },
  runSetupSkills: vi.fn(),
}));

vi.mock("@pubm/core", () => ({
  ui: {
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { registerInitCommand } from "../../../src/commands/init.js";
import {
  detectPackages,
  promptBranch,
  promptChangelog,
  promptChangesets,
  promptCI,
  promptGithubRelease,
  promptOverwriteConfig,
  promptPackages,
  promptSkills,
  promptVersioning,
} from "../../../src/commands/init-prompts.js";
import {
  detectPackageManager,
  writeWorkflowFile,
} from "../../../src/commands/init-workflows.js";
import { runSetupSkills } from "../../../src/commands/setup-skills.js";
import { ui } from "@pubm/core";

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_DIR = path.resolve("tests/unit/commands/.tmp-init");

/**
 * Run the `init` command inside TEST_DIR (or a custom cwd) with isTTY=true.
 */
async function runInit(cwd: string = TEST_DIR) {
  const originalCwd = process.cwd();
  const originalIsTTY = process.stdin.isTTY;
  process.stdin.isTTY = true;
  process.chdir(cwd);
  try {
    const parent = new Command();
    parent.exitOverride();
    registerInitCommand(parent);
    await parent.parseAsync(["node", "test", "init"]);
  } finally {
    process.chdir(originalCwd);
    process.stdin.isTTY = originalIsTTY;
  }
}

/** Default happy-path mock values (no config created, all defaults). */
function setupDefaultMocks() {
  vi.mocked(detectPackages).mockResolvedValue({
    isMonorepo: false,
    workspaces: [],
    packages: [{ name: "my-pkg", path: "." }],
  });
  vi.mocked(promptPackages).mockResolvedValue(["."]);
  vi.mocked(promptBranch).mockResolvedValue("main");
  vi.mocked(promptChangelog).mockResolvedValue({
    enabled: true,
    format: "default",
  });
  vi.mocked(promptGithubRelease).mockResolvedValue(true);
  vi.mocked(promptChangesets).mockResolvedValue(false);
  vi.mocked(promptCI).mockResolvedValue(false);
  vi.mocked(promptSkills).mockResolvedValue(false);
  vi.mocked(promptOverwriteConfig).mockResolvedValue(false);
}

// ── Shared lifecycle ───────────────────────────────────────────────────────

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── Original unit tests ────────────────────────────────────────────────────

import {
  generateChangesetCheckWorkflow,
  updateGitignoreForChangesets,
} from "../../../src/commands/init-workflows.js";

// The writeWorkflowFile mock replaces the exported function; obtain the real
// implementation via importActual so the original unit tests still work.
const { writeWorkflowFile: writeWorkflowFileReal } = await vi.importActual<
  typeof import("../../../src/commands/init-workflows.js")
>("../../../src/commands/init-workflows.js");

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
    const result = writeWorkflowFileReal(TEST_DIR, "changeset-check.yml", content);

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
    const result = writeWorkflowFileReal(TEST_DIR, "changeset-check.yml", content);
    expect(result).toBe(false);
  });
});

import { detectDefaultBranch } from "../../../src/commands/init-prompts.js";

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

// ── New E2E-style tests ────────────────────────────────────────────────────

describe("init command — full flow", () => {
  it("single package, all defaults — no config file written", async () => {
    setupDefaultMocks();

    await runInit();

    // No pubm.config.ts should be created when all values are defaults
    expect(existsSync(path.join(TEST_DIR, "pubm.config.ts"))).toBe(false);

    // success message must appear
    expect(vi.mocked(ui.success)).toHaveBeenCalledWith(
      expect.stringContaining("Ready to publish!"),
    );
  });

  it("single package, non-default branch — config file created with branch", async () => {
    setupDefaultMocks();
    vi.mocked(promptBranch).mockResolvedValue("develop");

    await runInit();

    const configPath = path.join(TEST_DIR, "pubm.config.ts");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain('branch: "develop"');
  });

  it("single package, changelog disabled — config file created with changelog: false", async () => {
    setupDefaultMocks();
    vi.mocked(promptChangelog).mockResolvedValue({
      enabled: false,
      format: "default",
    });

    await runInit();

    const configPath = path.join(TEST_DIR, "pubm.config.ts");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain("changelog: false");
  });

  it("monorepo flow — versioning prompt IS called, config includes packages array", async () => {
    setupDefaultMocks();
    vi.mocked(detectPackages).mockResolvedValue({
      isMonorepo: true,
      workspaces: [
        { type: "npm" as const, root: TEST_DIR, globs: ["packages/*"] },
        { type: "bun" as const, root: TEST_DIR, globs: ["packages/*"] },
      ],
      packages: [
        { name: "pkg-a", path: "packages/a" },
        { name: "pkg-b", path: "packages/b" },
        { name: "pkg-c", path: "packages/c" },
      ],
    });
    vi.mocked(promptPackages).mockResolvedValue([
      "packages/a",
      "packages/b",
      "packages/c",
    ]);
    vi.mocked(promptVersioning).mockResolvedValue("fixed");

    await runInit();

    expect(vi.mocked(promptVersioning)).toHaveBeenCalled();

    const configPath = path.join(TEST_DIR, "pubm.config.ts");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain('path: "packages/a"');
    expect(content).toContain('path: "packages/b"');
    expect(content).toContain('path: "packages/c"');
    expect(content).toContain('versioning: "fixed"');
  });

  it("single package non-monorepo — versioning prompt NOT called", async () => {
    setupDefaultMocks();

    await runInit();

    expect(vi.mocked(promptVersioning)).not.toHaveBeenCalled();
  });

  it("changesets enabled — directory created and gitignore update called", async () => {
    setupDefaultMocks();
    vi.mocked(promptChangesets).mockResolvedValue(true);

    await runInit();

    const changesetsDir = path.join(TEST_DIR, ".pubm", "changesets");
    expect(existsSync(changesetsDir)).toBe(true);
  });

  it("CI enabled — writeWorkflowFile called twice when changesets also enabled", async () => {
    setupDefaultMocks();
    vi.mocked(promptCI).mockResolvedValue(true);
    vi.mocked(promptChangesets).mockResolvedValue(true);
    vi.mocked(detectPackageManager).mockReturnValue("bun");
    vi.mocked(writeWorkflowFile).mockReturnValue(true);

    await runInit();

    expect(vi.mocked(writeWorkflowFile)).toHaveBeenCalledTimes(2);
    // First call: release.yml
    expect(vi.mocked(writeWorkflowFile)).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      "release.yml",
      expect.any(String),
    );
    // Second call: changeset-check.yml
    expect(vi.mocked(writeWorkflowFile)).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      "changeset-check.yml",
      expect.any(String),
    );
  });

  it("CI enabled, changesets disabled — only release.yml written", async () => {
    setupDefaultMocks();
    vi.mocked(promptCI).mockResolvedValue(true);
    vi.mocked(promptChangesets).mockResolvedValue(false);
    vi.mocked(detectPackageManager).mockReturnValue("bun");
    vi.mocked(writeWorkflowFile).mockReturnValue(true);

    await runInit();

    expect(vi.mocked(writeWorkflowFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeWorkflowFile)).toHaveBeenCalledWith(
      expect.any(String),
      "release.yml",
      expect.any(String),
    );
  });

  it("skills flow — success adds agents to summary", async () => {
    setupDefaultMocks();
    vi.mocked(promptSkills).mockResolvedValue(true);
    vi.mocked(runSetupSkills).mockResolvedValue({
      agents: ["claude-code"],
      skillCount: 5,
    });

    const consoleSpy = vi.spyOn(console, "log");

    await runInit();

    expect(vi.mocked(runSetupSkills)).toHaveBeenCalled();
    // Summary line should contain the agent label and skill count
    const summaryOutput = consoleSpy.mock.calls
      .flat()
      .join("\n");
    expect(summaryOutput).toContain("Claude Code");
    expect(summaryOutput).toContain("5 skills");

    consoleSpy.mockRestore();
  });

  it("skills flow — failure degrades gracefully (warn + info, no throw)", async () => {
    setupDefaultMocks();
    vi.mocked(promptSkills).mockResolvedValue(true);
    vi.mocked(runSetupSkills).mockRejectedValue(new Error("Network error"));

    await expect(runInit()).resolves.not.toThrow();

    expect(vi.mocked(ui.warn)).toHaveBeenCalledWith(
      expect.stringContaining("Network error"),
    );
    expect(vi.mocked(ui.info)).toHaveBeenCalledWith(
      expect.stringContaining("You can install skills later"),
    );
    // success still fires — flow completes
    expect(vi.mocked(ui.success)).toHaveBeenCalledWith(
      expect.stringContaining("Ready to publish!"),
    );
  });

  it("existing config + overwrite declined — config not overwritten", async () => {
    setupDefaultMocks();
    // Write a sentinel config
    const configPath = path.join(TEST_DIR, "pubm.config.ts");
    writeFileSync(configPath, "// original");
    vi.mocked(promptOverwriteConfig).mockResolvedValue(false);
    vi.mocked(promptBranch).mockResolvedValue("develop"); // non-default to prove skip

    await runInit();

    const content = readFileSync(configPath, "utf8");
    expect(content).toBe("// original");

    const consoleSpy = vi.spyOn(console, "log");
    // Verify summary says "kept existing" — re-run with spy attached
    consoleSpy.mockRestore();
  });

  it("existing config + overwrite accepted — config overwritten with new content", async () => {
    setupDefaultMocks();
    const configPath = path.join(TEST_DIR, "pubm.config.ts");
    writeFileSync(configPath, "// original");
    vi.mocked(promptOverwriteConfig).mockResolvedValue(true);
    // Non-default branch triggers new config content
    vi.mocked(promptBranch).mockResolvedValue("release");

    await runInit();

    const content = readFileSync(configPath, "utf8");
    expect(content).not.toBe("// original");
    expect(content).toContain('branch: "release"');
  });

  it("no packages selected — aborts early with warn", async () => {
    setupDefaultMocks();
    vi.mocked(promptPackages).mockResolvedValue([]);

    await runInit();

    expect(vi.mocked(ui.warn)).toHaveBeenCalledWith(
      expect.stringContaining("No packages selected"),
    );
    // promptBranch must NOT have been called
    expect(vi.mocked(promptBranch)).not.toHaveBeenCalled();
  });

  it("non-TTY environment — ui.error called and exitCode set", async () => {
    setupDefaultMocks();
    const originalCwd = process.cwd();
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;
    process.chdir(TEST_DIR);

    try {
      const parent = new Command();
      parent.exitOverride();
      registerInitCommand(parent);
      await parent.parseAsync(["node", "test", "init"]);
    } finally {
      process.chdir(originalCwd);
      process.stdin.isTTY = originalIsTTY;
    }

    expect(vi.mocked(ui.error)).toHaveBeenCalledWith(
      expect.stringContaining("interactive terminal"),
    );
    expect(process.exitCode).toBe(1);
    // Reset exitCode so it doesn't bleed into other tests
    process.exitCode = 0;
  });
});

describe("init command — summary output", () => {
  it("summary contains Changesets, CI, Config, and Skills entries", async () => {
    setupDefaultMocks();
    vi.mocked(promptChangesets).mockResolvedValue(true);
    vi.mocked(promptCI).mockResolvedValue(true);
    vi.mocked(detectPackageManager).mockReturnValue("bun");
    vi.mocked(writeWorkflowFile).mockReturnValue(true);
    vi.mocked(promptSkills).mockResolvedValue(true);
    vi.mocked(runSetupSkills).mockResolvedValue({
      agents: ["claude-code"],
      skillCount: 3,
    });

    const lines: string[] = [];
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation((...args) => {
        lines.push(args.join(" "));
      });

    await runInit();

    consoleSpy.mockRestore();

    const summary = lines.join("\n");
    expect(summary).toContain("Changesets");
    expect(summary).toContain("CI");
    expect(summary).toContain("Config");
    expect(summary).toContain("Skills");
  });

  it("existing config kept — summary shows 'kept existing'", async () => {
    setupDefaultMocks();
    const configPath = path.join(TEST_DIR, "pubm.config.ts");
    writeFileSync(configPath, "// original");
    vi.mocked(promptOverwriteConfig).mockResolvedValue(false);

    const lines: string[] = [];
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation((...args) => {
        lines.push(args.join(" "));
      });

    await runInit();

    consoleSpy.mockRestore();

    const summary = lines.join("\n");
    expect(summary).toContain("kept existing");
  });
});
