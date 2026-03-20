#!/usr/bin/env bun
/**
 * pubm Demo Runner
 *
 * Runs the full pubm CLI in an isolated environment with mocked
 * registries, CLI tools, and keyring. Git operations are real
 * but push to a local bare repo.
 *
 * Usage:
 *   bun demo/run.ts              # Monorepo demo (default)
 *   bun demo/run.ts --single     # Single package demo
 *   bun demo/run.ts --keep       # Preserve temp dir after demo
 */

import path from "node:path";
import process from "node:process";
import { setup, teardown, type DemoEnvironment } from "./setup.js";

// ── Parse args ─────────────────────────────────────────────────
const isSingle = process.argv.includes("--single");
const keepEnv = process.argv.includes("--keep");
const fixture = isSingle ? "single" : "monorepo";

// Forward extra CLI args to pubm (e.g., --dry-run, patch, minor, etc.)
const pubmArgs = process.argv
  .slice(2)
  .filter((arg) => arg !== "--single" && arg !== "--keep");

console.log(`\n  pubm Demo Environment`);
console.log(`  ─────────────────────`);
console.log(`  Fixture: ${fixture}`);
console.log(`  Mode:    interactive (local)`);
if (pubmArgs.length > 0) {
  console.log(`  Args:    ${pubmArgs.join(" ")}`);
}
console.log();

// ── Setup ──────────────────────────────────────────────────────
console.log("  Setting up isolated environment...");
let env: DemoEnvironment;

try {
  env = setup(fixture as "single" | "monorepo");
} catch (error) {
  console.error("Failed to set up demo environment:", error);
  process.exit(1);
}

console.log(`  Workspace: ${env.workDir}`);
console.log(`  Remote:    ${env.bareDir}\n`);

// ── Build environment for the CLI process ──────────────────────
const demoBinDir = path.join(import.meta.dirname, "bin");
const preloadScript = path.join(import.meta.dirname, "preload.ts");
const cliEntryPoint = path.resolve(
  import.meta.dirname,
  "../packages/pubm/src/cli.ts",
);

const childEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  // Prepend mock CLI scripts to PATH
  PATH: `${demoBinDir}:${process.env.PATH}`,
  // Token env vars (prevents keyring/SecureStore access)
  GITHUB_TOKEN: "ghp_demo_000000000000000000000000000000000000",
  NODE_AUTH_TOKEN: "npm_demo_000000000000000000000000",
  JSR_TOKEN: "jsrtoken_demo_000000000000000000000000",
  CARGO_REGISTRY_TOKEN: "cio_demo_000000000000000000000000000000000000",
  // npm auth config
  "npm_config_//registry.npmjs.org/:_authToken": "npm_demo_000000000000000000000000",
};

// ── Spawn the CLI ──────────────────────────────────────────────
console.log("  Launching pubm CLI...\n");

const child = Bun.spawn(
  ["bun", "--preload", preloadScript, cliEntryPoint, ...pubmArgs],
  {
    cwd: env.workDir,
    env: childEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

const exitCode = await child.exited;

// ── Cleanup ────────────────────────────────────────────────────
if (keepEnv) {
  console.log(`\n  Demo workspace preserved at: ${env.workDir}`);
  console.log(
    `  Inspect: git -C ${env.workDir} log --oneline --all --graph\n`,
  );
} else {
  teardown(env);
}

process.exit(exitCode);
