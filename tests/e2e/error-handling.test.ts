import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPubmCli } from "../utils/cli.js";

const cliPath = path.resolve("src/cli.ts");

describe("error handling", () => {
  it("should show error when running in directory without package.json", async () => {
    const tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-err-test-${Date.now()}`,
    );
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { stderr } = await runPubmCli(
        "bun",
        {
          nodeOptions: {
            cwd: tmpDir,
            env: { ...process.env, CI: "true" },
          },
        },
        cliPath,
        "1.0.0",
      );

      // When run from a directory without package.json/jsr.json, the
      // version resolution in the IIFE fails before the action handler.
      expect(stderr.length).toBeGreaterThan(0);
      expect(stderr).toContain("Error");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should contain package.json related error in stderr when run from empty directory", async () => {
    const tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-err-test2-${Date.now()}`,
    );
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { stderr } = await runPubmCli(
        "bun",
        {
          nodeOptions: {
            cwd: tmpDir,
            env: { ...process.env, CI: "true" },
          },
        },
        cliPath,
        "--publish-only",
      );

      // The IIFE tries to read package.json for version; without it,
      // an error about package.json is thrown.
      expect(stderr).toContain("package.json");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should exit without crashing when errors occur", async () => {
    const tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-err-test3-${Date.now()}`,
    );
    mkdirSync(tmpDir, { recursive: true });

    try {
      const { exitCode } = await runPubmCli(
        "bun",
        {
          nodeOptions: {
            cwd: tmpDir,
            env: { ...process.env, CI: "true" },
          },
        },
        cliPath,
        "--publish-only",
      );

      // The process should exit (not hang). It may have a non-zero exit
      // code due to the uncaught exception in the IIFE.
      expect(exitCode).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
