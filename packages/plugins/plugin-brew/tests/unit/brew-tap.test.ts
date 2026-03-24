import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { brewTap } from "../../src/brew-tap.js";

const mockedResolvePhases = vi.mocked(resolvePhases);

const mockedExecSync = vi.mocked(execSync);
const mockedExecFileSync = vi.mocked(execFileSync);
const tmpRoot = join(import.meta.dirname, ".tmp-brew-tap");
const originalCwd = process.cwd();

describe("brewTap", () => {
  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    process.chdir(tmpRoot);
    vi.clearAllMocks();
    mockedExecSync.mockReset();
    mockedExecFileSync.mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(join(tmpdir(), "pubm-brew-tap-123456"), {
      recursive: true,
      force: true,
    });
  });

  it("exposes the brew command and generates a formula from package.json", async () => {
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

    const plugin = brewTap({ formula: "Formula/pubm-cli.rb" });

    expect(plugin.name).toBe("@pubm/plugin-brew-tap");
    expect(plugin.commands[0]?.name).toBe("brew");

    await plugin.commands[0]?.subcommands?.[0]?.action?.();

    const formula = readFileSync(
      resolve(tmpRoot, "Formula/pubm-cli.rb"),
      "utf-8",
    );
    expect(formula).toContain("class PubmCli < Formula");
    expect(formula).toContain('homepage "https://example.com/pubm"');
    expect(formula).toContain('version "1.2.3"');
    expect(logSpy).toHaveBeenCalledWith(
      "Formula generated at Formula/pubm-cli.rb",
    );
  });

  it("falls back to default metadata when package.json is missing during init", async () => {
    const plugin = brewTap({ formula: "Formula/default.rb" });

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

  it("updates an existing formula and pushes directly when the current repo accepts git push", async () => {
    mkdirSync(resolve(tmpRoot, "Formula"), { recursive: true });
    writeFileSync(
      resolve(tmpRoot, "Formula/pubm.rb"),
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
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewTap({ formula: "Formula/pubm.rb" });

    await plugin.hooks?.afterRelease?.(
      {} as never,
      {
        version: "1.0.0",
        assets: [
          {
            name: "pubm-darwin-arm64.tar.gz",
            url: "https://example.com/new-darwin-arm64.tar.gz",
            sha256: "new-darwin-arm64",
            platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
          },
          {
            name: "pubm-linux-x64.tar.gz",
            url: "https://example.com/new-linux-x64.tar.gz",
            sha256: "new-linux-x64",
            platform: { raw: "linux-x64", os: "linux", arch: "x64" },
          },
        ],
      } as never,
    );

    const formula = readFileSync(resolve(tmpRoot, "Formula/pubm.rb"), "utf-8");
    expect(formula).toContain('version "1.0.0"');
    expect(formula).toContain(
      'url "https://example.com/new-darwin-arm64.tar.gz"',
    );
    expect(formula).toContain('url "https://example.com/new-linux-x64.tar.gz"');
    expect(ensureGitIdentityMock).toHaveBeenCalledWith();
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git add ${resolve(tmpRoot, "Formula/pubm.rb")}`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith("git push", {
      stdio: "inherit",
    });
    expect(logSpy).toHaveBeenCalledWith("Formula updated at Formula/pubm.rb");
  });

  it("creates a PR branch when pushing to the current repo fails", async () => {
    writeFileSync(
      resolve(tmpRoot, "package.json"),
      JSON.stringify(
        {
          name: "@scope/pubm",
          description: "Pubm CLI",
          license: "MIT",
        },
        null,
        2,
      ),
    );
    mockedExecSync.mockImplementation((command) => {
      if (command === "git push") {
        throw new Error("no upstream");
      }
      if (typeof command === "string" && command.includes("gh pr create")) {
        return "https://github.com/user/repo/pull/42\n" as never;
      }

      return Buffer.from("");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewTap({ formula: "Formula/pubm.rb" });

    await plugin.hooks?.afterRelease?.(
      { runtime: { rollback: { add: vi.fn() } } } as never,
      {
        version: "2.0.0",
        assets: [],
      } as never,
    );

    const formula = readFileSync(resolve(tmpRoot, "Formula/pubm.rb"), "utf-8");
    expect(formula).toContain('version "2.0.0"');
    expect(formula).toContain('homepage ""');
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git checkout -b pubm/brew-formula-v2.0.0",
      {
        stdio: "inherit",
      },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git push origin pubm/brew-formula-v2.0.0",
      {
        stdio: "inherit",
      },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh pr create --title "chore(brew): update formula to 2.0.0" --body "Automated formula update by pubm"',
      { encoding: "utf-8" },
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Created PR on branch pubm/brew-formula-v2.0.0",
    );
  });

  it("creates a new default formula during release when the workspace has no package.json", async () => {
    const plugin = brewTap({ formula: "Formula/my-tool.rb" });

    await plugin.hooks?.afterRelease?.(
      {} as never,
      {
        version: "0.9.0",
        assets: [],
      } as never,
    );

    const formula = readFileSync(
      resolve(tmpRoot, "Formula/my-tool.rb"),
      "utf-8",
    );
    expect(formula).toContain("class MyTool < Formula");
    expect(formula).toContain('desc "A CLI tool"');
    expect(formula).toContain('homepage ""');
    expect(formula).toContain('license "MIT"');
    expect(formula).toContain('version "0.9.0"');
  });

  it("updates a separate tap repository when repo is configured", async () => {
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
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "https://github.com/example/homebrew-tap.git",
    });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: {} } } as never,
      {
        version: "3.0.0",
        assets: [
          {
            name: "pubm-darwin-arm64.tar.gz",
            url: "https://example.com/pubm-darwin-arm64.tar.gz",
            sha256: "darwin-arm64",
            platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
          },
        ],
      } as never,
    );

    const tapFormulaPath = join(
      tmpdir(),
      "pubm-brew-tap-123456",
      "Formula",
      "pubm.rb",
    );

    expect(readFileSync(tapFormulaPath, "utf-8")).toContain('version "3.0.0"');
    expect(readFileSync(tapFormulaPath, "utf-8")).toContain(
      'url "https://example.com/pubm-darwin-arm64.tar.gz"',
    );
    expect(ensureGitIdentityMock).toHaveBeenCalledWith(
      join(tmpdir(), "pubm-brew-tap-123456"),
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://github.com/example/homebrew-tap.git ${join(tmpdir(), "pubm-brew-tap-123456")}`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git commit -m "Update pubm.rb to 3.0.0"'),
      { stdio: "inherit" },
    );
    const tmpDir = join(tmpdir(), "pubm-brew-tap-123456");
    expect(mockedExecSync).toHaveBeenCalledWith(`cd ${tmpDir} && git push`, {
      stdio: "inherit",
    });
  });

  it("embeds pluginTokens in clone URL when available for tap repo", async () => {
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
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      {
        runtime: {
          pluginTokens: { "brew-github-token": "ghp_test123" },
        },
      } as never,
      {
        version: "5.0.0",
        assets: [],
      } as never,
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://x-access-token:ghp_test123@github.com/syi0808/homebrew-pubm.git ${join(tmpdir(), "pubm-brew-tap-123456")}`,
      { stdio: "inherit" },
    );
  });

  it("uses plain URL when no pluginToken is available for tap repo", async () => {
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
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: {} } } as never,
      {
        version: "5.1.0",
        assets: [],
      } as never,
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://github.com/syi0808/homebrew-pubm.git ${join(tmpdir(), "pubm-brew-tap-123456")}`,
      { stdio: "inherit" },
    );
  });

  it("creates a PR when pushing to tap repo fails", async () => {
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
    vi.spyOn(Date, "now").mockReturnValue(123456);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tmpDir = join(tmpdir(), "pubm-brew-tap-123456");

    mockedExecSync.mockImplementation((command) => {
      if (command === `cd ${tmpDir} && git push`) {
        throw new Error("permission denied");
      }
      if (typeof command === "string" && command.includes("gh pr create")) {
        return "https://github.com/syi0808/homebrew-pubm/pull/50\n" as never;
      }
      return Buffer.from("");
    });

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: {}, rollback: { add: vi.fn() } } } as never,
      {
        version: "6.0.0",
        assets: [],
      } as never,
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `cd ${tmpDir} && git checkout -b pubm/brew-formula-v6.0.0`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `cd ${tmpDir} && git push origin pubm/brew-formula-v6.0.0`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh pr create --repo syi0808/homebrew-pubm --title "chore(brew): update formula to 6.0.0" --body "Automated formula update by pubm"',
      { encoding: "utf-8" },
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Created PR on branch pubm/brew-formula-v6.0.0",
    );
  });

  it("expands owner/repo shorthand to full GitHub URL when cloning tap", async () => {
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
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: {} } } as never,
      {
        version: "4.0.0",
        assets: [
          {
            name: "pubm-darwin-arm64.tar.gz",
            url: "https://example.com/pubm-darwin-arm64.tar.gz",
            sha256: "darwin-arm64",
            platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
          },
        ],
      } as never,
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://github.com/syi0808/homebrew-pubm.git ${join(tmpdir(), "pubm-brew-tap-123456")}`,
      { stdio: "inherit" },
    );
  });

  it("embeds GitHub token in clone URL when available", async () => {
    writeFileSync(
      resolve(tmpRoot, "package.json"),
      JSON.stringify({ name: "pubm" }, null, 2),
    );
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      {
        runtime: {
          pluginTokens: { "brew-github-token": "ghp_test123" },
        },
      } as never,
      { version: "5.0.0", assets: [] } as never,
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://x-access-token:ghp_test123@github.com/syi0808/homebrew-pubm.git ${join(tmpdir(), "pubm-brew-tap-123456")}`,
      { stdio: "inherit" },
    );
  });

  it("uses plain URL when no GitHub token is available", async () => {
    writeFileSync(
      resolve(tmpRoot, "package.json"),
      JSON.stringify({ name: "pubm" }, null, 2),
    );
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: {} } } as never,
      { version: "5.1.0", assets: [] } as never,
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://github.com/syi0808/homebrew-pubm.git ${join(tmpdir(), "pubm-brew-tap-123456")}`,
      { stdio: "inherit" },
    );
  });

  it("falls back to PR when push fails in separate tap repo", async () => {
    writeFileSync(
      resolve(tmpRoot, "package.json"),
      JSON.stringify({ name: "pubm" }, null, 2),
    );
    vi.spyOn(Date, "now").mockReturnValue(123456);
    const tmpDir = join(tmpdir(), "pubm-brew-tap-123456");

    mockedExecSync.mockImplementation((command) => {
      if (command === `cd ${tmpDir} && git push`) {
        throw new Error("permission denied");
      }
      if (typeof command === "string" && command.includes("gh pr create")) {
        return "https://github.com/syi0808/homebrew-pubm/pull/60\n" as never;
      }
      return Buffer.from("");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: {}, rollback: { add: vi.fn() } } } as never,
      { version: "6.0.0", assets: [] } as never,
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `cd ${tmpDir} && git checkout -b pubm/brew-formula-v6.0.0`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `cd ${tmpDir} && git push origin pubm/brew-formula-v6.0.0`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh pr create --repo syi0808/homebrew-pubm --title "chore(brew): update formula to 6.0.0" --body "Automated formula update by pubm"',
      { encoding: "utf-8" },
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Created PR on branch pubm/brew-formula-v6.0.0",
    );
  });

  it("skips release when packageName is set and displayLabel does not match", async () => {
    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      packageName: "my-tool",
    });

    await plugin.hooks?.afterRelease?.(
      {} as never,
      { version: "1.0.0", assets: [], displayLabel: "other-tool" } as never,
    );

    // No formula should be written, no git commands issued
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it("proceeds with release when packageName matches displayLabel", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      packageName: "my-tool",
    });

    await plugin.hooks?.afterRelease?.(
      {} as never,
      { version: "1.0.0", assets: [], displayLabel: "my-tool" } as never,
    );

    expect(logSpy).toHaveBeenCalledWith("Formula updated at Formula/pubm.rb");
  });

  it("uses options.repo as ownerRepo fallback when URL does not match github.com pattern", async () => {
    writeFileSync(
      resolve(tmpRoot, "package.json"),
      JSON.stringify({ name: "pubm" }, null, 2),
    );
    vi.spyOn(Date, "now").mockReturnValue(123456);
    const tmpDir = join(tmpdir(), "pubm-brew-tap-123456");

    mockedExecSync.mockImplementation((command) => {
      if (command === `cd ${tmpDir} && git push`) {
        throw new Error("push failed");
      }
      if (typeof command === "string" && command.includes("gh pr create")) {
        return "https://gitlab.com/mygroup/homebrew-tap/pull/10\n" as never;
      }
      return Buffer.from("");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "https://gitlab.com/mygroup/homebrew-tap.git",
    });

    await plugin.hooks?.afterRelease?.(
      { runtime: { pluginTokens: {}, rollback: { add: vi.fn() } } } as never,
      { version: "10.0.0", assets: [] } as never,
    );

    // The gh pr create should use the raw repo string as ownerRepo fallback
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining(
        "--repo https://gitlab.com/mygroup/homebrew-tap.git",
      ),
      expect.anything(),
    );
  });

  describe("credentials", () => {
    it("returns credential for external repo in CI mode", () => {
      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
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

    it("returns empty for external repo in local mode", () => {
      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
      const ctx = {
        options: { mode: "local", publish: true },
        config: {},
        runtime: { promptEnabled: true },
      } as any;

      const creds = plugin.credentials!(ctx);
      expect(creds).toHaveLength(0);
    });

    it("returns empty for same-repo formula", () => {
      const plugin = brewTap({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const creds = plugin.credentials!(ctx);
      expect(creds).toHaveLength(0);
    });

    it("returns credential in CI mode regardless of phase", () => {
      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const creds = plugin.credentials!(ctx);
      expect(creds).toHaveLength(1);
    });

    it("returns empty in local mode regardless of phase", () => {
      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
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
    it("returns CI PAT check when mode is ci and repo is set", () => {
      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
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
      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
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
      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      const taskCtx = {
        runtime: { pluginTokens: { "brew-github-token": "ghp_abc" } },
      } as any;
      const taskObj = { output: "" } as any;

      await checks[0].task(taskCtx, taskObj);
      expect(taskObj.output).toBe("Homebrew tap token verified");
    });

    it("returns empty checks for CI when repo is not set", () => {
      const plugin = brewTap({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      expect(checks).toHaveLength(0);
    });

    it("returns empty checks for local mode without repo", () => {
      const plugin = brewTap({ formula: "Formula/test.rb" });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      expect(checks).toHaveLength(0);
    });

    it("returns gh auth check for local mode with repo", () => {
      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      expect(checks).toHaveLength(1);
      expect(checks[0].phase).toBe("conditions");
      expect(checks[0].title).toContain("git/gh access");
    });

    it("local check passes when gh auth and repo access succeed", async () => {
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
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
        ["repo", "view", "user/homebrew-test", "--json", "name"],
        { stdio: "pipe" },
      );
      expect(taskObj.output).toContain("Access to user/homebrew-test verified");
    });

    it("local check throws when gh auth fails", async () => {
      mockedExecFileSync.mockImplementation((cmd, args) => {
        if (args?.[0] === "auth") throw new Error("not logged in");
        return Buffer.from("");
      });

      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
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

    it("local check throws when repo access fails", async () => {
      mockedExecFileSync.mockImplementation((cmd, args) => {
        if (args?.[0] === "repo") throw new Error("not found");
        return Buffer.from("");
      });

      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
      const ctx = {
        options: { mode: "local" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      const taskCtx = {} as any;
      const taskObj = { output: "" } as any;

      await expect(checks[0].task(taskCtx, taskObj)).rejects.toThrow(
        "Cannot access tap repository",
      );
    });

    it("local check extracts owner/repo from full GitHub URL", async () => {
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "https://github.com/user/homebrew-test.git",
      });
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
        ["repo", "view", "user/homebrew-test", "--json", "name"],
        { stdio: "pipe" },
      );
    });

    it("local check skips repo view for non-GitHub URL and only verifies gh auth", async () => {
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "https://gitlab.com/group/homebrew-tap.git",
      });
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
      expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
      expect(taskObj.output).toBe("GitHub CLI authenticated");
    });

    it("returns empty checks when local mode and phases do not include publish", () => {
      mockedResolvePhases.mockReturnValueOnce(["prepare"]);

      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
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

      const plugin = brewTap({
        formula: "Formula/test.rb",
        repo: "user/homebrew-test",
      });
      const ctx = {
        options: { mode: "ci" },
        config: {},
        runtime: {},
      } as any;

      const checks = plugin.checks!(ctx);
      expect(checks).toHaveLength(1);
    });
  });

  describe("regression", () => {
    it("separate tap repo push uses authenticated URL in CI", async () => {
      writeFileSync(
        resolve(tmpRoot, "package.json"),
        JSON.stringify({ name: "pubm" }, null, 2),
      );
      vi.spyOn(Date, "now").mockReturnValue(123456);

      const plugin = brewTap({
        formula: "Formula/pubm.rb",
        repo: "syi0808/homebrew-pubm",
      });

      await plugin.hooks?.afterRelease?.(
        {
          runtime: {
            pluginTokens: { "brew-github-token": "ghs_ci_token_abc" },
          },
        } as never,
        { version: "7.0.0", assets: [] } as never,
      );

      const cloneCall = mockedExecSync.mock.calls.find(
        ([cmd]) => typeof cmd === "string" && cmd.startsWith("git clone"),
      );
      expect(cloneCall?.[0]).toContain("x-access-token:ghs_ci_token_abc@");
      expect(cloneCall?.[0]).not.toBe(
        expect.stringContaining("https://github.com/syi0808"),
      );
    });

    it("separate tap repo falls back to PR when push fails", async () => {
      writeFileSync(
        resolve(tmpRoot, "package.json"),
        JSON.stringify({ name: "pubm" }, null, 2),
      );
      vi.spyOn(Date, "now").mockReturnValue(123456);
      const tmpDir = join(tmpdir(), "pubm-brew-tap-123456");

      mockedExecSync.mockImplementation((command) => {
        if (command === `cd ${tmpDir} && git push`) {
          throw new Error(
            "fatal: could not read Username for 'https://github.com': No such device or address",
          );
        }
        if (typeof command === "string" && command.includes("gh pr create")) {
          return "https://github.com/syi0808/homebrew-pubm/pull/80\n" as never;
        }
        return Buffer.from("");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const plugin = brewTap({
        formula: "Formula/pubm.rb",
        repo: "syi0808/homebrew-pubm",
      });

      await plugin.hooks?.afterRelease?.(
        {
          runtime: {
            pluginTokens: { "brew-github-token": "ghs_ci_token" },
            rollback: { add: vi.fn() },
          },
        } as never,
        { version: "8.0.0", assets: [] } as never,
      );

      const calls = mockedExecSync.mock.calls.map(([cmd]) => cmd);
      expect(calls).toContain(
        `cd ${tmpDir} && git checkout -b pubm/brew-formula-v8.0.0`,
      );
      expect(calls).toContain(
        `cd ${tmpDir} && git push origin pubm/brew-formula-v8.0.0`,
      );
      expect(calls).toContain(
        'gh pr create --repo syi0808/homebrew-pubm --title "chore(brew): update formula to 8.0.0" --body "Automated formula update by pubm"',
      );
    });

    it("release does not throw when brew tap push fails and PR fallback succeeds", async () => {
      writeFileSync(
        resolve(tmpRoot, "package.json"),
        JSON.stringify({ name: "pubm" }, null, 2),
      );
      vi.spyOn(Date, "now").mockReturnValue(123456);
      const tmpDir = join(tmpdir(), "pubm-brew-tap-123456");

      mockedExecSync.mockImplementation((command) => {
        if (command === `cd ${tmpDir} && git push`) {
          throw new Error("auth failure");
        }
        if (typeof command === "string" && command.includes("gh pr create")) {
          return "https://github.com/example/homebrew-tap/pull/90\n" as never;
        }
        return Buffer.from("");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const plugin = brewTap({
        formula: "Formula/pubm.rb",
        repo: "example/homebrew-tap",
      });

      await expect(
        plugin.hooks?.afterRelease?.(
          {
            runtime: { pluginTokens: {}, rollback: { add: vi.fn() } },
          } as never,
          { version: "9.0.0", assets: [] } as never,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
