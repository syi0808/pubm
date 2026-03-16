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

      // In publish-only mode, the CLI reads versions from manifests.
      // Without a package.json the config has no packages, causing an error.
      expect(stderr.length).toBeGreaterThan(0);
      expect(stderr).toContain("TypeError");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should read version from manifest in --publish-only mode", async () => {
    const tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-ci-manifest-${Date.now()}`,
    );

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    mkdirSync(tmpDir, { recursive: true });

    try {
      execSync("git init", { cwd: tmpDir });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir });
      execSync('git config user.name "test"', { cwd: tmpDir });
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
      );
      execSync("git add -A && git commit -m init", { cwd: tmpDir });

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

      expect(stderr).not.toContain("Cannot find the latest tag");
      expect(stderr).not.toContain("Cannot parse the latest tag");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should support independent versioning in --ci mode", async () => {
    const tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-ci-independent-${Date.now()}`,
    );

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    mkdirSync(path.join(tmpDir, "packages", "a"), { recursive: true });
    mkdirSync(path.join(tmpDir, "packages", "b"), { recursive: true });

    try {
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "monorepo",
          private: true,
          workspaces: ["packages/*"],
        }),
      );
      writeFileSync(
        path.join(tmpDir, "packages", "a", "package.json"),
        JSON.stringify({ name: "@test/a", version: "1.0.0" }),
      );
      writeFileSync(
        path.join(tmpDir, "packages", "b", "package.json"),
        JSON.stringify({ name: "@test/b", version: "2.0.0" }),
      );
      writeFileSync(
        path.join(tmpDir, "pubm.config.ts"),
        `import { defineConfig } from "@pubm/core";
export default defineConfig({
  versioning: "independent",
  packages: [
    { path: "packages/a" },
    { path: "packages/b" },
  ],
});`,
      );

      execSync("git init", { cwd: tmpDir });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir });
      execSync('git config user.name "test"', { cwd: tmpDir });
      execSync("git add -A && git commit -m init", { cwd: tmpDir });

      const { stderr } = await runPubmCli(
        "bun",
        {
          nodeOptions: {
            env: { ...process.env, CI: "true" },
            cwd: tmpDir,
          },
        },
        cliPath,
        "--ci",
      );

      expect(stderr).not.toContain("Cannot find the latest tag");
      expect(stderr).not.toContain("Cannot parse the latest tag");
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
