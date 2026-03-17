import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinaryRunner } from "../../utils/binary-runner.js";

describe("BinaryRunner", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "binary-runner-test-"));
    await writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0" }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should resolve the binary path for current platform", () => {
    const binaryPath = BinaryRunner.resolveBinaryPath();

    const normalized = binaryPath.replace(/\\/g, "/");
    expect(normalized).toContain("platforms/");
    expect(normalized).toContain("/bin/pubm");
  });

  it("should run --help and capture stdout", async () => {
    const runner = new BinaryRunner(tmpDir);
    const { stdout, exitCode } = await runner.run("--help");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage");
    expect(stdout).toContain("pubm");
  });

  it("should pass env variables via runWithEnv", async () => {
    const runner = new BinaryRunner(tmpDir);
    const { stderr } = await runner.runWithEnv(
      { ...process.env, CI: "true" } as Record<string, string>,
      "--publish-only",
    );

    expect(stderr.length).toBeGreaterThan(0);
  });
});
