import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ensureGitIdentityMock } = vi.hoisted(() => ({
  ensureGitIdentityMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("../../src/git-identity.js", () => ({
  ensureGitIdentity: ensureGitIdentityMock,
}));

vi.mock("@pubm/core", () => ({
  resolvePhases: vi.fn().mockReturnValue(["prepare", "publish"]),
}));

import { execFileSync, execSync } from "node:child_process";
import { resolvePhases } from "@pubm/core";
import { brewCore } from "../../src/brew-core.js";

const mockedResolvePhases = vi.mocked(resolvePhases);

const mockedExecSync = vi.mocked(execSync);
const mockedExecFileSync = vi.mocked(execFileSync);
const tmpRoot = join(import.meta.dirname, ".tmp-brew-core");
const originalCwd = process.cwd();

describe("brewCore", () => {
  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    process.chdir(tmpRoot);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(join(tmpdir(), "pubm-brew-core-222222"), {
      recursive: true,
      force: true,
    });
    rmSync(join(tmpdir(), "pubm-brew-core-333333"), {
      recursive: true,
      force: true,
    });
  });

  it("generates a homebrew-core formula from package metadata", async () => {
    writeFileSync(
      resolve(tmpRoot, "package.json"),
      JSON.stringify(
        {
          name: "@scope/pubm-cli",
          description: "Pubm CLI",
          homepage: "https://example.com/pubm",
          license: "Apache-2.0",
          version: "1.2.3",
        },
        null,
        2,
      ),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewCore({ formula: "Formula/pubm-cli.rb" });

    expect(plugin.name).toBe("@pubm/plugin-brew-core");

    await plugin.commands[0]?.subcommands?.[0]?.action?.();

    const formula = readFileSync(
      resolve(tmpRoot, "Formula/pubm-cli.rb"),
      "utf-8",
    );
    expect(formula).toContain("class PubmCli < Formula");
    expect(formula).toContain('version "1.2.3"');
    expect(logSpy).toHaveBeenCalledWith(
      "homebrew-core formula generated at Formula/pubm-cli.rb",
    );
  });

  it("falls back to default metadata when package.json is missing during init", async () => {
    const plugin = brewCore({ formula: "Formula/default.rb" });

    await plugin.commands[0]?.subcommands?.[0]?.action?.();

    const formula = readFileSync(
      resolve(tmpRoot, "Formula/default.rb"),
      "utf-8",
    );
    expect(formula).toContain("class MyTool < Formula");
    expect(formula).toContain('desc "A CLI tool"');
    expect(formula).toContain('homepage "https://github.com/my-tool"');
    expect(formula).toContain('license "MIT"');
    expect(formula).toContain('version "0.0.0"');
  });

  it("updates an existing formula in a forked homebrew-core checkout", async () => {
    vi.spyOn(Date, "now").mockReturnValue(222222);
    const clonedDir = join(tmpdir(), "pubm-brew-core-222222");
    mkdirSync(join(clonedDir, "Formula"), { recursive: true });
    writeFileSync(
      join(clonedDir, "Formula", "pubm.rb"),
      [
        "class Pubm < Formula",
        '  version "0.1.0"',
        "",
        "  on_macos do",
        "    if Hardware::CPU.arm?",
        '      url "https://example.com/old-darwin-arm64.tar.gz"',
        '      sha256 "old-darwin-arm64"',
        "    elsif Hardware::CPU.intel?",
        '      url "https://example.com/old-darwin-x64.tar.gz"',
        '      sha256 "old-darwin-x64"',
        "    end",
        "  end",
        "",
        "  on_linux do",
        "    if Hardware::CPU.arm?",
        '      url "https://example.com/old-linux-arm64.tar.gz"',
        '      sha256 "old-linux-arm64"',
        "    elsif Hardware::CPU.intel?",
        '      url "https://example.com/old-linux-x64.tar.gz"',
        '      sha256 "old-linux-x64"',
        "    end",
        "  end",
        "end",
        "",
      ].join("\n"),
    );
    writeFileSync(
      resolve(tmpRoot, "package.json"),
      JSON.stringify(
        {
          name: "@scope/pubm",
          description: "Pubm CLI",
          homepage: "https://example.com/pubm",
          license: "Apache-2.0",
        },
        null,
        2,
      ),
    );
    mockedExecSync.mockImplementation((command, options) => {
      if (command === "gh repo fork homebrew/homebrew-core --clone=false") {
        throw new Error("already forked");
      }
      if (command === "gh api user --jq .login") {
        expect(options).toMatchObject({ encoding: "utf-8" });
        return "octocat\n" as never;
      }

      return Buffer.from("");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewCore({ formula: "Formula/pubm.rb" });

    await plugin.hooks?.afterRelease?.(
      {
        runtime: {
          pluginTokens: { "brew-github-token": "test-token" },
        },
      } as never,
      {
        version: "1.5.0",
        assets: [
          {
            name: "pubm-darwin-arm64.tar.gz",
            url: "https://example.com/new-darwin-arm64.tar.gz",
            sha256: "new-darwin-arm64",
            platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
          },
        ],
      } as never,
    );

    const formula = readFileSync(
      join(clonedDir, "Formula", "pubm.rb"),
      "utf-8",
    );
    expect(formula).toContain('version "1.5.0"');
    expect(formula).toContain(
      'url "https://example.com/new-darwin-arm64.tar.gz"',
    );
    expect(ensureGitIdentityMock).toHaveBeenCalledWith(clonedDir);
    expect(mockedExecSync).toHaveBeenCalledWith(
      "gh repo fork homebrew/homebrew-core --clone=false",
      { stdio: "pipe", env: { ...process.env, GH_TOKEN: "test-token" } },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://x-access-token:test-token@github.com/octocat/homebrew-core.git ${clonedDir}`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining("git checkout -b pubm-1.5.0"),
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining(
        'gh pr create --repo homebrew/homebrew-core --title "pubm 1.5.0"',
      ),
      {
        stdio: "inherit",
        env: { ...process.env, GH_TOKEN: "test-token" },
      },
    );
    expect(logSpy).toHaveBeenCalledWith(
      "PR created to homebrew/homebrew-core for pubm 1.5.0",
    );
  });

  it("creates a new default formula when the workspace has no package.json", async () => {
    vi.spyOn(Date, "now").mockReturnValue(333333);
    mockedExecSync.mockImplementation((command) => {
      if (command === "gh api user --jq .login") {
        return "octocat\n" as never;
      }

      return Buffer.from("");
    });

    const plugin = brewCore({ formula: "Formula/pubm.rb" });

    await plugin.hooks?.afterRelease?.(
      {
        runtime: {
          pluginTokens: { "brew-github-token": "test-token" },
        },
      } as never,
      {
        version: "4.0.0",
        assets: [],
      } as never,
    );

    const formulaPath = join(
      tmpdir(),
      "pubm-brew-core-333333",
      "Formula",
      "my-tool.rb",
    );
    expect(existsSync(formulaPath)).toBe(true);
    expect(readFileSync(formulaPath, "utf-8")).toContain('version "4.0.0"');
    expect(readFileSync(formulaPath, "utf-8")).toContain(
      "class MyTool < Formula",
    );
    expect(readFileSync(formulaPath, "utf-8")).toContain('desc "A CLI tool"');
    expect(readFileSync(formulaPath, "utf-8")).toContain('homepage ""');
    expect(readFileSync(formulaPath, "utf-8")).toContain('license "MIT"');
  });

  it("skips release when packageName is set and displayLabel does not match", async () => {
    const plugin = brewCore({
      formula: "Formula/test.rb",
      packageName: "my-tool",
    });

    await plugin.hooks?.afterRelease?.(
      {} as never,
      { version: "1.0.0", assets: [], displayLabel: "other-tool" } as never,
    );

    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it("proceeds with release when packageName matches displayLabel", async () => {
    vi.spyOn(Date, "now").mockReturnValue(444444);
    mockedExecSync.mockImplementation((command) => {
      if (command === "gh api user --jq .login") return "octocat\n" as never;
      return Buffer.from("");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewCore({
      formula: "Formula/test.rb",
      packageName: "my-tool",
    });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: { "brew-github-token": "tkn" } } } as never,
      {
        version: "2.0.0",
        assets: [],
        displayLabel: "my-tool",
      } as never,
    );

    expect(logSpy).toHaveBeenCalledWith(
      "PR created to homebrew/homebrew-core for my-tool 2.0.0",
    );
  });

  it("uses plain clone URL and empty ghEnv when no token is available", async () => {
    vi.spyOn(Date, "now").mockReturnValue(555555);
    mockedExecSync.mockImplementation((command) => {
      if (command === "gh api user --jq .login") return "octocat\n" as never;
      return Buffer.from("");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewCore({ formula: "Formula/test.rb" });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: {} } } as never,
      { version: "3.0.0", assets: [] } as never,
    );

    const cloneCall = mockedExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === "string" && cmd.startsWith("git clone"),
    );
    expect(cloneCall?.[0]).toContain(
      "https://github.com/octocat/homebrew-core.git",
    );
    expect(cloneCall?.[0]).not.toContain("x-access-token");

    // gh pr create should have no GH_TOKEN env override
    const prCall = mockedExecSync.mock.calls.find(
      ([cmd]) => typeof cmd === "string" && cmd.includes("gh pr create --repo"),
    );
    expect(prCall?.[1]).not.toHaveProperty("env");
  });

  describe("credentials", () => {
    it("returns credential in CI mode", () => {
      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const creds = plugin.credentials!(ctx);
      expect(creds).toHaveLength(1);
      expect(creds[0].key).toBe("brew-github-token");
      expect(creds[0].env).toBe("PUBM_BREW_GITHUB_TOKEN");
    });

    it("returns empty in local mode", () => {
      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "local", publish: true },
        config: {},
        runtime: { promptEnabled: true },
      } as any;

      const creds = plugin.credentials!(ctx);
      expect(creds).toHaveLength(0);
    });

    it("returns credential in CI mode regardless of phase", () => {
      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const creds = plugin.credentials!(ctx);
      expect(creds).toHaveLength(1);
    });

    it("returns empty in local mode regardless of phase", () => {
      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const creds = plugin.credentials!(ctx);
      expect(creds).toHaveLength(0);
    });
  });

  describe("checks", () => {
    it("returns CI PAT check when mode is ci", () => {
      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      expect(checks).toHaveLength(1);
      expect(checks[0].phase).toBe("conditions");
      expect(checks[0].title).toContain("token");
    });

    it("CI PAT check throws when token is missing", async () => {
      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      const taskCtx = { runtime: { pluginTokens: {} } } as any;
      const taskObj = { output: "" } as any;

      await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
        "PUBM_BREW_GITHUB_TOKEN is required",
      );
    });

    it("CI PAT check succeeds when token is present", async () => {
      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      const taskCtx = {
        runtime: { pluginTokens: { "brew-github-token": "tkn" } },
      } as any;
      const taskObj = { output: "" } as any;

      await checks[0].task(taskCtx, taskObj);
      expect(taskObj.output).toBe("Homebrew core token verified");
    });

    it("returns gh auth + homebrew-core access check in local mode", () => {
      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      expect(checks).toHaveLength(1);
      expect(checks[0].phase).toBe("conditions");
      expect(checks[0].title).toContain("GitHub CLI access");
    });

    it("local check passes when gh auth and homebrew-core access succeed", async () => {
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      const taskCtx = {} as any;
      const taskObj = { output: "" } as any;

      await checks[0].task(taskCtx, taskObj);
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "gh",
        ["auth", "status"],
        { stdio: "pipe" },
      );
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "gh",
        ["repo", "view", "homebrew/homebrew-core", "--json", "name"],
        { stdio: "pipe" },
      );
      expect(taskObj.output).toContain("Access to homebrew/homebrew-core verified");
    });

    it("local check throws when gh auth fails", async () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("not logged in");
      });

      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      const taskCtx = {} as any;
      const taskObj = { output: "" } as any;

      await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
        "GitHub CLI is not authenticated",
      );
    });

    it("local check throws when homebrew-core access fails", async () => {
      mockedExecFileSync.mockImplementation((cmd, args) => {
        if (args?.[0] === "repo") throw new Error("not found");
        return Buffer.from("");
      });

      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      const taskCtx = {} as any;
      const taskObj = { output: "" } as any;

      await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
        "Cannot access homebrew/homebrew-core",
      );
    });

    it("returns empty checks when local mode and phases do not include publish", () => {
      mockedResolvePhases.mockReturnValueOnce(["prepare"]);

      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      expect(checks).toHaveLength(0);
    });

    it("returns checks in CI mode even when phases only include prepare", () => {
      mockedResolvePhases.mockReturnValueOnce(["prepare"]);

      const plugin = brewCore({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      expect(checks).toHaveLength(1);
    });
  });
});
