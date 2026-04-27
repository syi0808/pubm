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

import { execSync } from "node:child_process";
import { brewTap } from "../../src/brew-tap.js";

const mockedExecSync = vi.mocked(execSync);
const originalCwd = process.cwd();
const tmpRoot = join(import.meta.dirname, ".tmp-external-boundary");
const tapTmpDir = join(tmpdir(), "pubm-brew-tap-777");

describe("Homebrew plugin external boundary contract", () => {
  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(tapTmpDir, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    process.chdir(tmpRoot);
    vi.clearAllMocks();
    mockedExecSync.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(777);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(tapTmpDir, { recursive: true, force: true });
  });

  it("updates the local formula and pushes an external tap clone using the plugin token", async () => {
    writePackageJson();

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "pubm/homebrew-tap",
    });

    await plugin.hooks?.afterRelease?.(
      {
        runtime: {
          pluginTokens: { "brew-github-token": "ghp_contract_token" },
        },
      } as never,
      releaseContext("8.0.0"),
    );

    const localFormulaPath = resolve(tmpRoot, "Formula/pubm.rb");
    const tapFormulaPath = join(tapTmpDir, "Formula", "pubm.rb");

    expect(readFileSync(localFormulaPath, "utf-8")).toContain(
      'version "8.0.0"',
    );
    expect(readFileSync(tapFormulaPath, "utf-8")).toContain(
      'url "https://example.com/pubm-darwin-arm64.tar.gz"',
    );
    expect(ensureGitIdentityMock).toHaveBeenCalledWith();
    expect(ensureGitIdentityMock).toHaveBeenCalledWith(tapTmpDir);
    expect(mockedExecSync).toHaveBeenCalledWith(`git add ${localFormulaPath}`, {
      stdio: "inherit",
    });
    expect(mockedExecSync).toHaveBeenCalledWith(
      'git commit -m "chore(brew): update formula to 8.0.0"',
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith("git push", {
      stdio: "inherit",
    });
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git clone --depth 1 https://x-access-token:ghp_contract_token@github.com/pubm/homebrew-tap.git ${tapTmpDir}`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `cd ${tapTmpDir} && git add Formula/pubm.rb && git commit -m "Update pubm.rb to 8.0.0"`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(`cd ${tapTmpDir} && git push`, {
      stdio: "inherit",
    });
  });

  it("updates and pushes only the local formula when no external tap repo is configured", async () => {
    writePackageJson();

    const plugin = brewTap({
      formula: "Formula/pubm.rb",
    });

    await plugin.hooks?.afterRelease?.(
      {
        runtime: {
          pluginTokens: { "brew-github-token": "ghp_unused_for_local_push" },
        },
      } as never,
      releaseContext("8.0.1"),
    );

    const localFormulaPath = resolve(tmpRoot, "Formula/pubm.rb");

    expect(readFileSync(localFormulaPath, "utf-8")).toContain(
      'version "8.0.1"',
    );
    expect(ensureGitIdentityMock).toHaveBeenCalledOnce();
    expect(ensureGitIdentityMock).toHaveBeenCalledWith();
    expect(mockedExecSync).toHaveBeenCalledWith(`git add ${localFormulaPath}`, {
      stdio: "inherit",
    });
    expect(mockedExecSync).toHaveBeenCalledWith(
      'git commit -m "chore(brew): update formula to 8.0.1"',
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith("git push", {
      stdio: "inherit",
    });

    const commands = mockedExecSync.mock.calls.map(([command]) => command);
    expect(commands).not.toEqual(
      expect.arrayContaining([expect.stringContaining("git clone --depth 1")]),
    );
    expect(commands).not.toEqual(
      expect.arrayContaining([expect.stringContaining("gh pr")]),
    );
    expect(commands).not.toEqual(
      expect.arrayContaining([expect.stringContaining(tapTmpDir)]),
    );
  });

  it("falls back to a PR on external tap push failure and registers rollback PR close", async () => {
    writePackageJson();
    mockedExecSync.mockImplementation((command) => {
      if (
        command === `cd ${tapTmpDir} && git push` ||
        command === `cd ${tapTmpDir} && git pull --rebase`
      ) {
        throw new Error("push rejected");
      }
      if (typeof command === "string" && command.includes("gh pr create")) {
        return "https://github.com/pubm/homebrew-tap/pull/91\n" as never;
      }
      return Buffer.from("");
    });
    const rollbackAdd = vi.fn();
    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "pubm/homebrew-tap",
    });

    await plugin.hooks?.afterRelease?.(
      {
        runtime: {
          pluginTokens: { "brew-github-token": "ghp_contract_token" },
          rollback: { add: rollbackAdd },
        },
      } as never,
      releaseContext("8.1.0"),
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      `cd ${tapTmpDir} && git checkout -b pubm/brew-formula-v8.1.0`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      `cd ${tapTmpDir} && git push origin pubm/brew-formula-v8.1.0`,
      { stdio: "inherit" },
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh pr create --repo pubm/homebrew-tap --title "chore(brew): update formula to 8.1.0" --body "Automated formula update by pubm"',
      expect.objectContaining({
        encoding: "utf-8",
        env: expect.objectContaining({ GH_TOKEN: "ghp_contract_token" }),
      }),
    );
    expect(rollbackAdd).toHaveBeenCalledOnce();

    const rollbackAction = rollbackAdd.mock.calls[0][0];
    expect(rollbackAction).toMatchObject({
      label: "Close Homebrew tap PR #91 (pubm/homebrew-tap)",
      confirm: true,
    });

    mockedExecSync.mockReset();
    mockedExecSync.mockReturnValue(Buffer.from(""));
    await rollbackAction.fn();

    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh pr close 91 --repo pubm/homebrew-tap --comment "Closed by pubm rollback"',
      expect.objectContaining({
        stdio: "inherit",
        env: expect.objectContaining({ GH_TOKEN: "ghp_contract_token" }),
      }),
    );
  });

  it("uses token-free HTTPS clone and does not inject GH_TOKEN into PR rollback when no token is available", async () => {
    writePackageJson();
    mockedExecSync.mockImplementation((command) => {
      if (
        command === `cd ${tapTmpDir} && git push` ||
        command === `cd ${tapTmpDir} && git pull --rebase`
      ) {
        throw new Error("push rejected");
      }
      if (typeof command === "string" && command.includes("gh pr create")) {
        return "https://github.com/pubm/homebrew-tap/pull/92\n" as never;
      }
      return Buffer.from("");
    });
    const rollbackAdd = vi.fn();
    const plugin = brewTap({
      formula: "Formula/pubm.rb",
      repo: "pubm/homebrew-tap",
    });

    await plugin.hooks?.afterRelease?.(
      {
        runtime: {
          pluginTokens: {},
          rollback: { add: rollbackAdd },
        },
      } as never,
      releaseContext("8.1.1"),
    );

    const cloneCall = mockedExecSync.mock.calls.find(
      ([command]) =>
        typeof command === "string" && command.startsWith("git clone"),
    );
    expect(cloneCall).toEqual([
      `git clone --depth 1 https://github.com/pubm/homebrew-tap.git ${tapTmpDir}`,
      { stdio: "inherit" },
    ]);
    expect(cloneCall?.[0]).not.toContain("x-access-token");

    const prCreateCall = mockedExecSync.mock.calls.find(
      ([command]) =>
        typeof command === "string" && command.includes("gh pr create"),
    );
    expect(prCreateCall).toEqual([
      'gh pr create --repo pubm/homebrew-tap --title "chore(brew): update formula to 8.1.1" --body "Automated formula update by pubm"',
      { encoding: "utf-8" },
    ]);
    expect(rollbackAdd).toHaveBeenCalledOnce();

    const rollbackAction = rollbackAdd.mock.calls[0][0];
    expect(rollbackAction).toMatchObject({
      label: "Close Homebrew tap PR #92 (pubm/homebrew-tap)",
      confirm: true,
    });

    mockedExecSync.mockReset();
    mockedExecSync.mockReturnValue(Buffer.from(""));
    await rollbackAction.fn();

    expect(mockedExecSync).toHaveBeenCalledWith(
      'gh pr close 92 --repo pubm/homebrew-tap --comment "Closed by pubm rollback"',
      { stdio: "inherit" },
    );
  });

  it("declares the Homebrew tap token credential only for CI publishing to a separate tap", () => {
    const separateTap = brewTap({
      formula: "Formula/pubm.rb",
      repo: "pubm/homebrew-tap",
    });
    const localOnly = brewTap({
      formula: "Formula/pubm.rb",
    });

    expect(
      separateTap.credentials?.({
        options: { mode: "ci" },
        runtime: {},
      } as never),
    ).toEqual([
      expect.objectContaining({
        key: "brew-github-token",
        env: "PUBM_BREW_GITHUB_TOKEN",
        required: true,
      }),
    ]);
    expect(
      separateTap.credentials?.({
        options: { mode: "local" },
        runtime: {},
      } as never),
    ).toEqual([]);
    expect(
      localOnly.credentials?.({
        options: { mode: "ci" },
        runtime: {},
      } as never),
    ).toEqual([]);
  });
});

function writePackageJson() {
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
}

function releaseContext(version: string) {
  return {
    version,
    assets: [
      {
        name: "pubm-darwin-arm64.tar.gz",
        url: "https://example.com/pubm-darwin-arm64.tar.gz",
        sha256: "darwin-arm64",
        platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
      },
    ],
  } as never;
}
