/**
 * E2E regression test: cross-registry name mismatch in CI mode.
 *
 * When a package has different names in package.json and jsr.json,
 * the versionPlan must use packagePath as key (not packageName) so
 * that both npm and jsr publish tasks resolve the correct version.
 *
 * Before the fix, independent-mode versionPlan was keyed by package.json name,
 * causing JSR publish to look up by jsr.json name and get "" → skip.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPubmCli } from "../utils/cli.js";

const cliPath = path.resolve("src/cli.ts");

describe("cross-registry name mismatch", () => {
  it("should create path-keyed versionPlan for package with different jsr.json name", async () => {
    const tmpDir = path.join(
      process.env.TMPDIR || "/tmp",
      `pubm-cross-registry-${Date.now()}`,
    );

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    mkdirSync(path.join(tmpDir, "packages", "core"), { recursive: true });

    try {
      // Root package.json (monorepo)
      writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "monorepo",
          private: true,
          workspaces: ["packages/*"],
        }),
      );

      // packages/core/package.json — npm name
      writeFileSync(
        path.join(tmpDir, "packages", "core", "package.json"),
        JSON.stringify({ name: "@test/core", version: "1.0.0" }),
      );

      // packages/core/jsr.json — different JSR name
      writeFileSync(
        path.join(tmpDir, "packages", "core", "jsr.json"),
        JSON.stringify({
          name: "@test/different-jsr-name",
          version: "1.0.0",
          exports: "./src/index.ts",
        }),
      );

      // Config specifying registries
      writeFileSync(
        path.join(tmpDir, "pubm.config.ts"),
        `import { defineConfig } from "@pubm/core";
export default defineConfig({
  packages: [
    { path: "packages/core", registries: ["npm", "jsr"] },
  ],
});`,
      );

      execSync("git init", { cwd: tmpDir });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir });
      execSync('git config user.name "test"', { cwd: tmpDir });
      execSync("git add -A && git commit -m init", { cwd: tmpDir });

      // Run in CI --publish-only mode — this reads version from manifest
      // and creates a versionPlan. The test verifies that the pipeline
      // doesn't crash due to name mismatch.
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
        "--no-pre-check",
        "--no-condition-check",
      );

      // The pipeline should proceed past version resolution.
      // It will fail at actual publish (no registry credentials) but
      // should NOT fail with empty version or "already published" skip.
      expect(stderr).not.toContain("already published");
      expect(stderr).not.toContain("v already published"); // empty version symptom
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
