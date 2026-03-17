import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../utils/git-fixture.js";

function exec(cmd: string, cwd: string): string {
  const { execSync } = require("node:child_process");
  return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
}

describe("GitFixture", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "git-fixture-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should init a git repo with default branch main", async () => {
    await new GitFixture(tmpDir).init().done();

    expect(existsSync(path.join(tmpDir, ".git"))).toBe(true);
    const branch = exec("git branch --show-current", tmpDir);
    expect(branch).toBe("main");
  });

  it("should set user.name and user.email automatically on init", async () => {
    await new GitFixture(tmpDir).init().done();

    const name = exec("git config user.name", tmpDir);
    const email = exec("git config user.email", tmpDir);
    expect(name).toBe("test");
    expect(email).toBe("test@test.com");
  });

  it("should init with custom branch name", async () => {
    await new GitFixture(tmpDir).init("develop").done();

    const branch = exec("git branch --show-current", tmpDir);
    expect(branch).toBe("develop");
  });

  it("should add, commit, and tag", async () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "file.txt"), "hello");

    await new GitFixture(tmpDir)
      .init()
      .add(".")
      .commit("initial commit")
      .tag("v1.0.0")
      .done();

    const log = exec("git log --oneline", tmpDir);
    expect(log).toContain("initial commit");

    const tags = exec("git tag", tmpDir);
    expect(tags).toContain("v1.0.0");
  });

  it("should create and checkout branches", async () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "file.txt"), "hello");

    await new GitFixture(tmpDir)
      .init()
      .add()
      .commit("initial")
      .branch("feature")
      .done();

    const branch = exec("git branch --show-current", tmpDir);
    expect(branch).toBe("feature");
  });

  it("should allow custom git config", async () => {
    await new GitFixture(tmpDir)
      .init()
      .config("user.name", "custom-user")
      .done();

    const name = exec("git config user.name", tmpDir);
    expect(name).toBe("custom-user");
  });

  it("should clear queue after done() for reuse", async () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "a.txt"), "a");

    const git = new GitFixture(tmpDir);
    await git.init().add().commit("first").done();

    writeFileSync(path.join(tmpDir, "b.txt"), "b");
    await git.add().commit("second").done();

    const log = exec("git log --oneline", tmpDir);
    expect(log).toContain("first");
    expect(log).toContain("second");
  });

  it("should throw on command failure with stderr details", async () => {
    // commit without init should fail
    await expect(
      new GitFixture(tmpDir).commit("no repo").done(),
    ).rejects.toThrow();
  });
});
