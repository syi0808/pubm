import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ensureGitIdentityMock, resolveGitHubTokenMock } = vi.hoisted(() => ({
  ensureGitIdentityMock: vi.fn(),
  resolveGitHubTokenMock: vi.fn().mockReturnValue(null),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../../src/git-identity.js", () => ({
  ensureGitIdentity: ensureGitIdentityMock,
}));

vi.mock("@pubm/core", () => ({
  resolveGitHubToken: resolveGitHubTokenMock,
}));

import { execSync } from "node:child_process";
import { brewTap } from "../../src/brew-tap.js";

const mockedExecSync = vi.mocked(execSync);
const tmpRoot = join(import.meta.dirname, ".tmp-brew-tap");
const originalCwd = process.cwd();

describe("brewTap", () => {
  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    process.chdir(tmpRoot);
    vi.clearAllMocks();
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

      return Buffer.from("");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewTap({ formula: "Formula/pubm.rb" });

    await plugin.hooks?.afterRelease?.(
      {} as never,
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
      { stdio: "inherit" },
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
      {} as never,
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
    const tmpDir = join(tmpdir(), "pubm-brew-tap-123456");
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git commit -m "Update pubm.rb to 3.0.0"'),
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git -C ${tmpDir} push`,
      { stdio: "inherit" },
    );
  });

  it("includes GITHUB_TOKEN in clone URL when available for tap repo", async () => {
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
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "ghp_test123";

    try {
      const plugin = brewTap({
        formula: "Formula/pubm.rb",
        repo: "syi0808/homebrew-pubm",
      });

      await plugin.hooks?.afterRelease?.(
        {} as never,
        {
          version: "5.0.0",
          assets: [],
        } as never,
      );

      expect(mockedExecSync).toHaveBeenCalledWith(
        `git clone --depth 1 https://x-access-token:ghp_test123@github.com/syi0808/homebrew-pubm.git ${join(tmpdir(), "pubm-brew-tap-123456")}`,
        { stdio: "inherit" },
      );
    } finally {
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
  });

  it("uses plain URL when GITHUB_TOKEN is not set for tap repo", async () => {
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
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    try {
      const plugin = brewTap({
        formula: "Formula/pubm.rb",
        repo: "syi0808/homebrew-pubm",
      });

      await plugin.hooks?.afterRelease?.(
        {} as never,
        {
          version: "5.1.0",
          assets: [],
        } as never,
      );

      expect(mockedExecSync).toHaveBeenCalledWith(
        `git clone --depth 1 https://github.com/syi0808/homebrew-pubm.git ${join(tmpdir(), "pubm-brew-tap-123456")}`,
        { stdio: "inherit" },
      );
    } finally {
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
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
      if (command === `git -C ${tmpDir} push`) {
        throw new Error("permission denied");
      }
      return Buffer.from("");
    });

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      {} as never,
      {
        version: "6.0.0",
        assets: [],
      } as never,
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `git -C ${tmpDir} checkout -b pubm/brew-formula-v6.0.0`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git -C ${tmpDir} push origin pubm/brew-formula-v6.0.0`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh pr create --repo syi0808/homebrew-pubm --title "Update pubm.rb to 6.0.0" --body "Automated formula update by pubm"',
      { stdio: "inherit", cwd: tmpDir },
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
      {} as never,
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
    resolveGitHubTokenMock.mockReturnValue({
      token: "ghp_test123",
      source: "env",
    });

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      {} as never,
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
    resolveGitHubTokenMock.mockReturnValue(null);

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      {} as never,
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
      return Buffer.from("");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "syi0808/homebrew-pubm",
    });

    await plugin.hooks?.afterRelease?.(
      {} as never,
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
      { stdio: "inherit" },
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Created PR on branch pubm/brew-formula-v6.0.0",
    );
  });

  describe("regression", () => {
    it("separate tap repo push uses authenticated URL in CI", async () => {
      writeFileSync(
        resolve(tmpRoot, "package.json"),
        JSON.stringify({ name: "pubm" }, null, 2),
      );
      vi.spyOn(Date, "now").mockReturnValue(123456);
      resolveGitHubTokenMock.mockReturnValue({
        token: "ghs_ci_token_abc",
        source: "env",
      });

      const plugin = brewTap({
        formula: "Formula/pubm.rb",
        repo: "syi0808/homebrew-pubm",
      });

      await plugin.hooks?.afterRelease?.(
        {} as never,
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
      resolveGitHubTokenMock.mockReturnValue({
        token: "ghs_ci_token",
        source: "env",
      });
      const tmpDir = join(tmpdir(), "pubm-brew-tap-123456");

      mockedExecSync.mockImplementation((command) => {
        if (command === `cd ${tmpDir} && git push`) {
          throw new Error(
            "fatal: could not read Username for 'https://github.com': No such device or address",
          );
        }
        return Buffer.from("");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const plugin = brewTap({
        formula: "Formula/pubm.rb",
        repo: "syi0808/homebrew-pubm",
      });

      await plugin.hooks?.afterRelease?.(
        {} as never,
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
        return Buffer.from("");
      });
      vi.spyOn(console, "log").mockImplementation(() => {});

      const plugin = brewTap({
        formula: "Formula/pubm.rb",
        repo: "example/homebrew-tap",
      });

      await expect(
        plugin.hooks?.afterRelease?.(
          {} as never,
          { version: "9.0.0", assets: [] } as never,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
