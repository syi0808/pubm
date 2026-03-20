import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_LABELS,
  type Agent,
  getInstallPath,
  registerSetupSkillsCommand,
  runSetupSkills,
} from "../../../src/commands/setup-skills.js";

vi.mock("enquirer", () => ({
  default: {
    prompt: vi.fn(),
  },
}));

vi.mock("@pubm/core", () => ({
  ui: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const TEST_DIR = path.resolve("tests/unit/commands/.tmp-setup-skills");

let mockFetch: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  vi.clearAllMocks();
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch as typeof fetch;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReleasesResponse(tagName: string) {
  return {
    ok: true,
    json: async () => ({ tag_name: tagName }),
  };
}

function makeTreeResponse(entries: Array<{ path: string; type: string }>) {
  return {
    ok: true,
    json: async () => ({ tree: entries }),
  };
}

function makeDownloadResponse(content: string) {
  return {
    ok: true,
    text: async () => content,
  };
}

function makeErrorResponse(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
  };
}

const SKILL_FILES = [
  {
    path: "plugins/pubm-plugin/skills/publish-setup/SKILL.md",
    type: "blob",
  },
  {
    path: "plugins/pubm-plugin/skills/publish-setup/references/config-examples.md",
    type: "blob",
  },
  {
    path: "plugins/pubm-plugin/skills/create-plugin/SKILL.md",
    type: "blob",
  },
];

async function setupPromptMock(agents: Agent[]): Promise<void> {
  const { default: Enquirer } = await import("enquirer");
  vi.mocked(Enquirer.prompt).mockResolvedValue({ agents });
}

function setupHappyFetch(tagName = "v1.2.3"): void {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/releases/latest")) {
      return Promise.resolve(makeReleasesResponse(tagName));
    }
    if (url.includes("/git/trees/")) {
      return Promise.resolve(makeTreeResponse(SKILL_FILES));
    }
    // Raw file download
    return Promise.resolve(makeDownloadResponse("# Skill content"));
  });
}

// ---------------------------------------------------------------------------
// AGENT_LABELS
// ---------------------------------------------------------------------------

describe("AGENT_LABELS", () => {
  it("contains all three agents", () => {
    expect(AGENT_LABELS).toHaveProperty("claude-code");
    expect(AGENT_LABELS).toHaveProperty("codex");
    expect(AGENT_LABELS).toHaveProperty("gemini");
  });

  it("has correct display names", () => {
    expect(AGENT_LABELS["claude-code"]).toBe("Claude Code");
    expect(AGENT_LABELS.codex).toBe("Codex CLI");
    expect(AGENT_LABELS.gemini).toBe("Gemini CLI");
  });
});

// ---------------------------------------------------------------------------
// getInstallPath
// ---------------------------------------------------------------------------

describe("getInstallPath", () => {
  it("returns correct path for claude-code", () => {
    const result = getInstallPath("claude-code", "/home/user/project");
    expect(result).toBe("/home/user/project/.claude/skills/pubm");
  });

  it("returns correct path for codex", () => {
    const result = getInstallPath("codex", "/home/user/project");
    expect(result).toBe("/home/user/project/.agents/skills/pubm");
  });

  it("returns correct path for gemini", () => {
    const result = getInstallPath("gemini", "/home/user/project");
    expect(result).toBe("/home/user/project/.gemini/skills/pubm");
  });

  it("uses cwd correctly in path construction", () => {
    const cwd = TEST_DIR;
    const result = getInstallPath("claude-code", cwd);
    expect(result).toBe(path.join(cwd, ".claude/skills/pubm"));
  });
});

// ---------------------------------------------------------------------------
// registerSetupSkillsCommand
// ---------------------------------------------------------------------------

describe("registerSetupSkillsCommand", () => {
  it("registers setup-skills command on parent", () => {
    const parent = new Command();
    registerSetupSkillsCommand(parent);
    const cmd = parent.commands.find((c) => c.name() === "setup-skills");
    expect(cmd).toBeDefined();
  });

  it("has correct description", () => {
    const parent = new Command();
    registerSetupSkillsCommand(parent);
    const cmd = parent.commands.find((c) => c.name() === "setup-skills");
    expect(cmd!.description()).toBe("Download and install coding agent skills");
  });

  it("command exists after registration", () => {
    const parent = new Command();
    expect(parent.commands).toHaveLength(0);
    registerSetupSkillsCommand(parent);
    expect(parent.commands).toHaveLength(1);
    expect(parent.commands[0].name()).toBe("setup-skills");
  });
});

// ---------------------------------------------------------------------------
// runSetupSkills — Happy Path
// ---------------------------------------------------------------------------

describe("runSetupSkills — Happy Path", () => {
  it("prompts user for agent selection", async () => {
    await setupPromptMock(["claude-code"]);
    setupHappyFetch();
    const { default: Enquirer } = await import("enquirer");

    await runSetupSkills(TEST_DIR);

    expect(Enquirer.prompt).toHaveBeenCalledOnce();
    const callArg = vi.mocked(Enquirer.prompt).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArg).toMatchObject({
      type: "multiselect",
      name: "agents",
    });
  });

  it("fetches latest release ref from GitHub API", async () => {
    await setupPromptMock(["claude-code"]);
    setupHappyFetch("v2.0.0");

    await runSetupSkills(TEST_DIR);

    const releaseCall = mockFetch.mock.calls.find(([url]: [string]) =>
      (url as string).includes("/releases/latest"),
    );
    expect(releaseCall).toBeDefined();
    expect(releaseCall![0]).toContain(
      "api.github.com/repos/syi0808/pubm/releases/latest",
    );
  });

  it("fetches skills tree using the resolved ref", async () => {
    await setupPromptMock(["claude-code"]);
    setupHappyFetch("v3.1.0");

    await runSetupSkills(TEST_DIR);

    const treeCall = mockFetch.mock.calls.find(([url]: [string]) =>
      (url as string).includes("/git/trees/"),
    );
    expect(treeCall).toBeDefined();
    expect(treeCall![0]).toContain("v3.1.0");
    expect(treeCall![0]).toContain("recursive=1");
  });

  it("downloads and installs files to correct paths", async () => {
    await setupPromptMock(["claude-code"]);
    setupHappyFetch();

    await runSetupSkills(TEST_DIR);

    const installBase = getInstallPath("claude-code", TEST_DIR);
    const skillPath = path.join(installBase, "publish-setup/SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, "utf8")).toBe("# Skill content");
  });

  it("returns correct agents array", async () => {
    await setupPromptMock(["claude-code"]);
    setupHappyFetch();

    const result = await runSetupSkills(TEST_DIR);

    expect(result.agents).toEqual(["claude-code"]);
  });

  it("returns skillCount as number of SKILL.md files in tree", async () => {
    await setupPromptMock(["claude-code"]);
    setupHappyFetch();

    const result = await runSetupSkills(TEST_DIR);

    // SKILL_FILES has 2 SKILL.md entries
    expect(result.skillCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runSetupSkills — No Agents Selected
// ---------------------------------------------------------------------------

describe("runSetupSkills — No Agents Selected", () => {
  it("returns empty agents array and 0 skillCount", async () => {
    await setupPromptMock([]);

    const result = await runSetupSkills(TEST_DIR);

    expect(result.agents).toEqual([]);
    expect(result.skillCount).toBe(0);
  });

  it("does not make GitHub API calls when no agents selected", async () => {
    await setupPromptMock([]);

    await runSetupSkills(TEST_DIR);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls ui.info about skipping", async () => {
    const { ui } = await import("@pubm/core");
    await setupPromptMock([]);

    await runSetupSkills(TEST_DIR);

    expect(ui.info).toHaveBeenCalledWith(
      "No agents selected. Skipping skills installation.",
    );
  });
});

// ---------------------------------------------------------------------------
// runSetupSkills — Release API Fallback
// ---------------------------------------------------------------------------

describe("runSetupSkills — Release API Fallback", () => {
  it("falls back to 'main' when /releases/latest returns error", async () => {
    await setupPromptMock(["codex"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeErrorResponse(404, "Not Found"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse(SKILL_FILES));
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    await runSetupSkills(TEST_DIR);

    const treeCall = mockFetch.mock.calls.find(([url]: [string]) =>
      (url as string).includes("/git/trees/"),
    );
    expect(treeCall).toBeDefined();
    expect(treeCall![0]).toContain("/git/trees/main");
  });

  it("falls back to 'main' when /releases/latest throws network error", async () => {
    await setupPromptMock(["gemini"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.reject(new Error("Network error"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse(SKILL_FILES));
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    await runSetupSkills(TEST_DIR);

    const treeCall = mockFetch.mock.calls.find(([url]: [string]) =>
      (url as string).includes("/git/trees/"),
    );
    expect(treeCall).toBeDefined();
    expect(treeCall![0]).toContain("/git/trees/main");
  });
});

// ---------------------------------------------------------------------------
// runSetupSkills — Tree API Error
// ---------------------------------------------------------------------------

describe("runSetupSkills — Tree API Error", () => {
  it("throws error when /git/trees returns non-ok response", async () => {
    await setupPromptMock(["claude-code"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeErrorResponse(500, "Internal Server Error"));
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    await expect(runSetupSkills(TEST_DIR)).rejects.toThrow(
      "GitHub API error: 500 Internal Server Error",
    );
  });
});

// ---------------------------------------------------------------------------
// runSetupSkills — No Skill Files Found
// ---------------------------------------------------------------------------

describe("runSetupSkills — No Skill Files Found", () => {
  it("throws error when tree has no files under skills path", async () => {
    await setupPromptMock(["claude-code"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(
          makeTreeResponse([
            { path: "README.md", type: "blob" },
            { path: "src/index.ts", type: "blob" },
          ]),
        );
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    await expect(runSetupSkills(TEST_DIR)).rejects.toThrow(
      "No skill files found in repository.",
    );
  });

  it("throws error when tree is empty", async () => {
    await setupPromptMock(["codex"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse([]));
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    await expect(runSetupSkills(TEST_DIR)).rejects.toThrow(
      "No skill files found in repository.",
    );
  });

  it("ignores tree entries that are not blobs under skills path", async () => {
    await setupPromptMock(["gemini"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(
          makeTreeResponse([
            // directory entries (type=tree) should be ignored
            {
              path: "plugins/pubm-plugin/skills/publish-setup",
              type: "tree",
            },
            // files outside skills path should be ignored
            { path: "src/index.ts", type: "blob" },
          ]),
        );
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    await expect(runSetupSkills(TEST_DIR)).rejects.toThrow(
      "No skill files found in repository.",
    );
  });
});

// ---------------------------------------------------------------------------
// runSetupSkills — Multiple Agents
// ---------------------------------------------------------------------------

describe("runSetupSkills — Multiple Agents", () => {
  it("installs to all agent paths when multiple agents are selected", async () => {
    await setupPromptMock(["claude-code", "codex", "gemini"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse(SKILL_FILES));
      }
      return Promise.resolve(makeDownloadResponse("multi-agent content"));
    });

    const result = await runSetupSkills(TEST_DIR);

    expect(result.agents).toEqual(["claude-code", "codex", "gemini"]);

    for (const agent of ["claude-code", "codex", "gemini"] as Agent[]) {
      const installPath = getInstallPath(agent, TEST_DIR);
      const skillPath = path.join(installPath, "publish-setup/SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
    }
  });

  it("each agent gets its own directory", async () => {
    await setupPromptMock(["claude-code", "gemini"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse(SKILL_FILES));
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    await runSetupSkills(TEST_DIR);

    const claudePath = getInstallPath("claude-code", TEST_DIR);
    const geminiPath = getInstallPath("gemini", TEST_DIR);

    expect(claudePath).not.toBe(geminiPath);
    expect(existsSync(claudePath)).toBe(true);
    expect(existsSync(geminiPath)).toBe(true);
  });

  it("returns all selected agents in result", async () => {
    await setupPromptMock(["claude-code", "codex"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse(SKILL_FILES));
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    const result = await runSetupSkills(TEST_DIR);

    expect(result.agents).toContain("claude-code");
    expect(result.agents).toContain("codex");
    expect(result.agents).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// runSetupSkills — Download Failure
// ---------------------------------------------------------------------------

describe("runSetupSkills — Download Failure", () => {
  it("throws error when a file download fails with non-ok response", async () => {
    await setupPromptMock(["claude-code"]);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse(SKILL_FILES));
      }
      // Raw file download fails
      return Promise.resolve(makeErrorResponse(403, "Forbidden"));
    });

    await expect(runSetupSkills(TEST_DIR)).rejects.toThrow(
      /Failed to download .+: 403/,
    );
  });
});

// ---------------------------------------------------------------------------
// runSetupSkills — skillCount accuracy
// ---------------------------------------------------------------------------

describe("runSetupSkills — skillCount accuracy", () => {
  it("counts only SKILL.md files for skillCount", async () => {
    await setupPromptMock(["claude-code"]);

    const files = [
      {
        path: "plugins/pubm-plugin/skills/publish-setup/SKILL.md",
        type: "blob",
      },
      {
        path: "plugins/pubm-plugin/skills/publish-setup/references/config.md",
        type: "blob",
      },
      {
        path: "plugins/pubm-plugin/skills/create-plugin/SKILL.md",
        type: "blob",
      },
      {
        path: "plugins/pubm-plugin/skills/create-plugin/references/api.md",
        type: "blob",
      },
      {
        path: "plugins/pubm-plugin/skills/other-skill/SKILL.md",
        type: "blob",
      },
    ];

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse(files));
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    const result = await runSetupSkills(TEST_DIR);

    expect(result.skillCount).toBe(3);
  });

  it("returns 0 skillCount when no SKILL.md files but other files exist", async () => {
    await setupPromptMock(["claude-code"]);

    const files = [
      {
        path: "plugins/pubm-plugin/skills/publish-setup/references/config.md",
        type: "blob",
      },
    ];

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve(makeReleasesResponse("v1.0.0"));
      }
      if (url.includes("/git/trees/")) {
        return Promise.resolve(makeTreeResponse(files));
      }
      return Promise.resolve(makeDownloadResponse("content"));
    });

    const result = await runSetupSkills(TEST_DIR);

    expect(result.skillCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// registerSetupSkillsCommand — Non-TTY and action handler
// ---------------------------------------------------------------------------

describe("registerSetupSkillsCommand — action handler", () => {
  it("sets process.exitCode = 1 and calls ui.error when not TTY", async () => {
    const { ui } = await import("@pubm/core");
    const parent = new Command();
    registerSetupSkillsCommand(parent);
    const cmd = parent.commands.find((c) => c.name() === "setup-skills")!;

    const originalIsTTY = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      writable: true,
      configurable: true,
    });

    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      // Invoke the action handler directly
      await (
        cmd as unknown as {
          _actionHandler: (...args: unknown[]) => Promise<void>;
        }
      )._actionHandler([], {}, cmd);
    } finally {
      if (originalIsTTY) {
        Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
      }
    }

    expect(ui.error).toHaveBeenCalledWith(
      "pubm setup-skills requires an interactive terminal.",
    );
    expect(process.exitCode).toBe(1);

    process.exitCode = originalExitCode;
  });

  it("calls ui.info with manual installation link on error", async () => {
    const { ui } = await import("@pubm/core");
    const parent = new Command();
    registerSetupSkillsCommand(parent);
    const cmd = parent.commands.find((c) => c.name() === "setup-skills")!;

    const originalIsTTY = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      writable: true,
      configurable: true,
    });

    const savedExitCode = process.exitCode;

    try {
      await (
        cmd as unknown as {
          _actionHandler: (...args: unknown[]) => Promise<void>;
        }
      )._actionHandler([], {}, cmd);
    } finally {
      if (originalIsTTY) {
        Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
      }
      process.exitCode = savedExitCode;
    }

    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://github.com/syi0808/pubm/tree/main/plugins/pubm-plugin/skills",
      ),
    );
  });

  it("calls ui.success with skills and agents info when TTY and run succeeds", async () => {
    const { ui } = await import("@pubm/core");
    await setupPromptMock(["claude-code"]);
    setupHappyFetch();

    const parent = new Command();
    registerSetupSkillsCommand(parent);
    const cmd = parent.commands.find((c) => c.name() === "setup-skills")!;

    const originalIsTTY = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });

    const originalCwd = process.cwd;
    process.cwd = () => TEST_DIR;

    try {
      await (
        cmd as unknown as {
          _actionHandler: (...args: unknown[]) => Promise<void>;
        }
      )._actionHandler([], {}, cmd);
    } finally {
      if (originalIsTTY) {
        Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
      }
      process.cwd = originalCwd;
    }

    expect(ui.success).toHaveBeenCalledWith(
      expect.stringContaining("Claude Code"),
    );
    expect(ui.success).toHaveBeenCalledWith(
      expect.stringMatching(/\d+ skills installed/),
    );
  });

  it("does not call ui.success when no agents selected", async () => {
    const { ui } = await import("@pubm/core");
    await setupPromptMock([]);

    const parent = new Command();
    registerSetupSkillsCommand(parent);
    const cmd = parent.commands.find((c) => c.name() === "setup-skills")!;

    const originalIsTTY = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });

    const originalCwd = process.cwd;
    process.cwd = () => TEST_DIR;

    try {
      await (
        cmd as unknown as {
          _actionHandler: (...args: unknown[]) => Promise<void>;
        }
      )._actionHandler([], {}, cmd);
    } finally {
      if (originalIsTTY) {
        Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
      }
      process.cwd = originalCwd;
    }

    expect(ui.success).not.toHaveBeenCalled();
  });
});
