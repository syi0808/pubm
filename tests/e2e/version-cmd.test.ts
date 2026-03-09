import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPubmCli } from "../utils/cli.js";

const cliPath = path.resolve("src/cli.ts");

describe("pubm version --dry-run", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createTmpDir(suffix: string): string {
    tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-version-test-${suffix}-${Date.now()}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }

  function createChangeset(
    dir: string,
    id: string,
    packageName: string,
    bumpType: string,
    summary: string,
  ): void {
    const changesetsDir = path.join(dir, ".pubm", "changesets");
    mkdirSync(changesetsDir, { recursive: true });
    writeFileSync(
      path.join(changesetsDir, `${id}.md`),
      `---\n"${packageName}": ${bumpType}\n---\n\n${summary}\n`,
    );
  }

  it("should show help for version command", async () => {
    const { stdout } = await runPubmCli(
      "bun",
      {},
      cliPath,
      "version",
      "--help",
    );

    expect(stdout).toContain("version");
  });

  it("should report no changesets when none exist", async () => {
    const dir = createTmpDir("no-changesets");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
    );

    const { stdout } = await runPubmCli(
      "bun",
      { nodeOptions: { cwd: dir } },
      cliPath,
      "version",
      "--dry-run",
    );

    expect(stdout).toContain("No changesets found");
  });

  it("should show dry-run output with version bump for a patch changeset", async () => {
    const dir = createTmpDir("patch-bump");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    createChangeset(dir, "add-feature", "my-pkg", "patch", "Fix a small bug");

    const { stdout } = await runPubmCli(
      "bun",
      { nodeOptions: { cwd: dir } },
      cliPath,
      "version",
      "--dry-run",
    );

    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("my-pkg");
    expect(stdout).toContain("1.0.1");
    expect(stdout).toContain("patch");
  });

  it("should show dry-run output with version bump for a minor changeset", async () => {
    const dir = createTmpDir("minor-bump");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "2.3.0" }),
    );
    createChangeset(dir, "new-feature", "my-pkg", "minor", "Add new feature");

    const { stdout } = await runPubmCli(
      "bun",
      { nodeOptions: { cwd: dir } },
      cliPath,
      "version",
      "--dry-run",
    );

    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("my-pkg");
    expect(stdout).toContain("2.4.0");
    expect(stdout).toContain("minor");
  });

  it("should show dry-run output with version bump for a major changeset", async () => {
    const dir = createTmpDir("major-bump");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.5.3" }),
    );
    createChangeset(
      dir,
      "breaking-change",
      "my-pkg",
      "major",
      "Breaking API change",
    );

    const { stdout } = await runPubmCli(
      "bun",
      { nodeOptions: { cwd: dir } },
      cliPath,
      "version",
      "--dry-run",
    );

    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("my-pkg");
    expect(stdout).toContain("2.0.0");
    expect(stdout).toContain("major");
  });

  it("should include changelog preview in dry-run output", async () => {
    const dir = createTmpDir("changelog-preview");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    createChangeset(
      dir,
      "cool-feature",
      "my-pkg",
      "minor",
      "Added a cool feature",
    );

    const { stdout } = await runPubmCli(
      "bun",
      { nodeOptions: { cwd: dir } },
      cliPath,
      "version",
      "--dry-run",
    );

    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("Changelog");
    expect(stdout).toContain("Added a cool feature");
  });
});
