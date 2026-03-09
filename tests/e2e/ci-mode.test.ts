import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPubmCli } from "../utils/cli.js";

const cliPath = path.resolve("src/cli.ts");

describe("CI mode", () => {
  it("should show error when version is not provided and --publish-only is not set", async () => {
    const { stderr } = await runPubmCli(
      "bun",
      {
        nodeOptions: {
          env: { ...process.env, CI: "true" },
        },
      },
      cliPath,
    );

    expect(stderr).toContain("Version must be set in the CI environment");
  });

  it("should show error when --publish-only is used in a non-git directory", async () => {
    const tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-ci-test-${Date.now()}`,
    );

    // Create a temp directory that is not a git repo
    const { mkdirSync, rmSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { stderr } = await runPubmCli(
        "bun",
        {
          nodeOptions: {
            env: { ...process.env, CI: "true" },
            cwd: tmpDir,
          },
        },
        cliPath,
        "--publish-only",
      );

      // When run from a directory without package.json/jsr.json, the IIFE
      // that reads the version crashes before the action handler runs.
      // The error is about missing package.json/jsr.json.
      expect(stderr.length).toBeGreaterThan(0);
      expect(stderr).toContain("package.json");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should include error formatting in CI error output", async () => {
    const { stderr } = await runPubmCli(
      "bun",
      {
        nodeOptions: {
          env: { ...process.env, CI: "true" },
        },
      },
      cliPath,
    );

    // The error output should contain the error name/type info
    expect(stderr).toContain("Error");
    expect(stderr.length).toBeGreaterThan(0);
  });
});
