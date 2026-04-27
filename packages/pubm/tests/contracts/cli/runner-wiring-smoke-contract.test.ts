import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../../utils/e2e.js";

interface FakeNpm {
  binDir: string;
  logPath: string;
}

async function withFixture(
  fixtureName: string,
  fn: (ctx: E2EContext) => Promise<void>,
): Promise<void> {
  const ctx = await e2e(fixtureName);
  try {
    await fn(ctx);
  } finally {
    await ctx.cleanup();
  }
}

async function installFakeNpm(ctx: E2EContext): Promise<FakeNpm> {
  const binDir = path.join(ctx.dir, ".pubm-test-bin");
  const logPath = path.join(ctx.dir, ".pubm-command-log");
  const npmPath = path.join(binDir, "npm");
  const npmCmdPath = path.join(binDir, "npm.cmd");

  await mkdir(binDir, { recursive: true });
  await writeFile(
    npmPath,
    [
      "#!/usr/bin/env node",
      'const { appendFileSync } = require("node:fs");',
      "const args = process.argv.slice(2);",
      "if (process.env.PUBM_COMMAND_LOG) {",
      '  appendFileSync(process.env.PUBM_COMMAND_LOG, "npm " + args.join(" ") + "\\n");',
      "}",
      'if (args[0] === "--version") {',
      '  console.log("10.0.0");',
      "  process.exit(0);",
      "}",
      'if (args[0] === "publish") {',
      '  console.error("blocked fake npm publish");',
      "  process.exit(1);",
      "}",
      "process.exit(0);",
      "",
    ].join("\n"),
  );
  await chmod(npmPath, 0o755);
  await writeFile(
    npmCmdPath,
    ["@echo off", 'node "%~dp0\\npm" %*', ""].join("\r\n"),
  );

  return { binDir, logPath };
}

function smokeEnv(fakeNpm?: FakeNpm): Record<string, string> {
  return {
    ...process.env,
    CI: "true",
    GITHUB_TOKEN: "",
    NO_COLOR: "1",
    ...(fakeNpm
      ? {
          PATH: `${fakeNpm.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          PUBM_COMMAND_LOG: fakeNpm.logPath,
        }
      : {}),
  } as Record<string, string>;
}

async function readText(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8");
}

async function readCommandLog(logPath: string): Promise<string> {
  try {
    return await readText(logPath);
  } catch {
    return "";
  }
}

async function expectManifestUnchanged(filePath: string, before: string) {
  expect(await readText(filePath)).toBe(before);
}

describe("CLI runner wiring smoke contract", () => {
  it("runs pubm --dry-run against a fixture without changing manifest version", async () => {
    await withFixture("basic", async (ctx) => {
      await ctx.git.init().add(".").commit("init").done();

      const manifestPath = path.join(ctx.dir, "package.json");
      const manifestBefore = await readText(manifestPath);
      const fakeNpm = await installFakeNpm(ctx);

      const result = await ctx.runWithEnv(
        smokeEnv(fakeNpm),
        "1.2.3",
        "--dry-run",
        "--no-dry-run-validation",
        "--no-pre-check",
        "--no-condition-check",
        "--no-tests",
        "--no-build",
      );

      expect(result.exitCode).toBe(0);
      await expectManifestUnchanged(manifestPath, manifestBefore);
      expect(await readCommandLog(fakeNpm.logPath)).not.toContain(
        "npm publish",
      );
    });
  });

  it("runs pubm --mode ci --phase publish from manifest versions without latest tag parsing errors", async () => {
    await withFixture("ci-manifest", async (ctx) => {
      await writeFile(
        path.join(ctx.dir, "pubm.config.ts"),
        [
          "export default {",
          '  packages: [{ path: ".", ecosystem: "js", registries: [] }],',
          "};",
          "",
        ].join("\n"),
      );
      await ctx.git.init().add(".").commit("init").done();
      const fakeNpm = await installFakeNpm(ctx);

      const result = await ctx.runWithEnv(
        smokeEnv(fakeNpm),
        "--mode",
        "ci",
        "--phase",
        "publish",
      );
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.exitCode).toBe(1);
      expect(output).not.toContain("Cannot find the latest tag");
      expect(output).not.toContain("Cannot parse the latest tag");
      expect(output).toContain("v1.0.0");
      expect(await readCommandLog(fakeNpm.logPath)).not.toContain(
        "npm publish",
      );
    });
  });

  it("runs independent monorepo dry-run without changing package manifests", async () => {
    await withFixture("ci-independent", async (ctx) => {
      await writeFile(
        path.join(ctx.dir, "pubm.config.ts"),
        [
          "export default {",
          '  versioning: "independent",',
          "  packages: [",
          '    { path: "packages/a" },',
          '    { path: "packages/b" },',
          "  ],",
          "};",
          "",
        ].join("\n"),
      );

      const packageAPath = path.join(ctx.dir, "packages", "a", "package.json");
      const packageBPath = path.join(ctx.dir, "packages", "b", "package.json");
      const packageABefore = await readText(packageAPath);
      const packageBBefore = await readText(packageBPath);
      const fakeNpm = await installFakeNpm(ctx);

      const result = await ctx.runWithEnv(
        smokeEnv(fakeNpm),
        "--mode",
        "ci",
        "--phase",
        "publish",
        "--dry-run",
        "--no-dry-run-validation",
      );

      expect(result.exitCode).toBe(0);
      await expectManifestUnchanged(packageAPath, packageABefore);
      await expectManifestUnchanged(packageBPath, packageBBefore);
      expect(await readCommandLog(fakeNpm.logPath)).not.toContain(
        "npm publish",
      );
    });
  });

  it("accepts private registry override in dry-run without real publish or push side effects", async () => {
    await withFixture("basic", async (ctx) => {
      await writeFile(
        path.join(ctx.dir, "pubm.config.ts"),
        [
          "export default {",
          "  packages: [",
          "    {",
          '      path: ".",',
          '      ecosystem: "js",',
          "      registries: [",
          "        {",
          '          url: "http://127.0.0.1:9",',
          '          token: { envVar: "PRIVATE_REGISTRY_TOKEN" },',
          "        },",
          "      ],",
          "    },",
          "  ],",
          "};",
          "",
        ].join("\n"),
      );

      const manifestPath = path.join(ctx.dir, "package.json");
      const manifestBefore = await readText(manifestPath);
      const fakeNpm = await installFakeNpm(ctx);

      const result = await ctx.runWithEnv(
        smokeEnv(fakeNpm),
        "--mode",
        "ci",
        "--phase",
        "publish",
        "--dry-run",
        "--no-dry-run-validation",
        "--registry",
        "127.0.0.1:9",
      );

      expect(result.exitCode).toBe(0);
      await expectManifestUnchanged(manifestPath, manifestBefore);
      expect(await readCommandLog(fakeNpm.logPath)).not.toContain(
        "npm publish",
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("git push");
    });
  });
});
