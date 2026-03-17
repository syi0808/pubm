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
}));

vi.mock("../../src/git-identity.js", () => ({
  ensureGitIdentity: ensureGitIdentityMock,
}));

import { execSync } from "node:child_process";
import { brewCore } from "../../src/brew-core.js";

const mockedExecSync = vi.mocked(execSync);
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
      {} as never,
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
      { stdio: "pipe" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://github.com/octocat/homebrew-core.git ${clonedDir}`,
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
      { stdio: "inherit" },
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
      {} as never,
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
});
