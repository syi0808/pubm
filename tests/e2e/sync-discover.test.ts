import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPubmCli } from "../utils/cli.js";

const binPath = path.resolve("bin/cli.js");

describe("pubm sync --discover", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createTmpDir(suffix: string): string {
    tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-sync-test-${suffix}-${Date.now()}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }

  it("should show help when run without --discover flag", async () => {
    const dir = createTmpDir("help");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0" }),
    );

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
    );

    expect(stdout).toContain("--discover");
  });

  it("should show sync help via pubm sync --help", async () => {
    const { stdout } = await runPubmCli("node", {}, binPath, "sync", "--help");

    expect(stdout).toContain("sync");
  });

  it("should discover JSON version references", async () => {
    const dir = createTmpDir("json");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
    );
    writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ version: "1.0.0", name: "app" }),
    );

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
      "--discover",
    );

    expect(stdout).toContain("config.json");
    expect(stdout).toContain("JSON");
    expect(stdout).toContain("version");
  });

  it("should discover pattern-based version references in text files", async () => {
    const dir = createTmpDir("pattern");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "2.5.0" }),
    );
    // Use @version JSDoc tag which matches VERSION_PATTERNS
    writeFileSync(
      path.join(dir, "lib.ts"),
      "/** @version 2.5.0 */\nexport const lib = {};\n",
    );

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
      "--discover",
    );

    expect(stdout).toContain("lib.ts");
    expect(stdout).toContain("2.5.0");
  });

  it("should report no references when none exist", async () => {
    const dir = createTmpDir("none");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
    );
    writeFileSync(path.join(dir, "readme.txt"), "Hello world\n");

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
      "--discover",
    );

    expect(stdout).toContain("No version references found");
  });

  it("should show versionSync config suggestion when references are found", async () => {
    const dir = createTmpDir("config-suggestion");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "3.0.0" }),
    );
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ version: "3.0.0" }),
    );

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
      "--discover",
    );

    expect(stdout).toContain("versionSync");
    expect(stdout).toContain("manifest.json");
  });

  it("should discover references in nested directories", async () => {
    const dir = createTmpDir("nested");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.2.3" }),
    );

    const subDir = path.join(dir, "src");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(subDir, "meta.json"),
      JSON.stringify({ version: "1.2.3" }),
    );

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
      "--discover",
    );

    expect(stdout).toContain(path.join("src", "meta.json"));
    expect(stdout).toContain("JSON");
  });

  it("should skip node_modules directory", async () => {
    const dir = createTmpDir("skip-nodemodules");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
    );

    const nmDir = path.join(dir, "node_modules", "some-pkg");
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(
      path.join(nmDir, "config.json"),
      JSON.stringify({ version: "1.0.0" }),
    );

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
      "--discover",
    );

    expect(stdout).toContain("No version references found");
  });

  it("should show scanning message with current version", async () => {
    const dir = createTmpDir("scanning-msg");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "4.1.0" }),
    );

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
      "--discover",
    );

    expect(stdout).toContain("Scanning");
    expect(stdout).toContain("4.1.0");
  });

  it("should discover nested JSON path references", async () => {
    const dir = createTmpDir("nested-json");
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
    );
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ app: { meta: { version: "1.0.0" } } }),
    );

    const { stdout } = await runPubmCli(
      "node",
      { nodeOptions: { cwd: dir } },
      binPath,
      "sync",
      "--discover",
    );

    expect(stdout).toContain("settings.json");
    expect(stdout).toContain("app.meta.version");
  });
});
