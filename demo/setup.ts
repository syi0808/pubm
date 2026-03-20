/**
 * Sets up an isolated demo environment with fixtures and a local git repo.
 */
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

export interface DemoEnvironment {
  /** Working directory (the demo project) */
  workDir: string;
  /** Bare git repo acting as remote */
  bareDir: string;
  /** Root temp directory (parent of workDir and bareDir) */
  rootDir: string;
  /** Whether this is a monorepo fixture */
  isMonorepo: boolean;
}

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Demo User",
      GIT_AUTHOR_EMAIL: "demo@example.com",
      GIT_COMMITTER_NAME: "Demo User",
      GIT_COMMITTER_EMAIL: "demo@example.com",
    },
  }).trim();
}

export function setup(fixture: "single" | "monorepo"): DemoEnvironment {
  const isMonorepo = fixture === "monorepo";
  const fixtureDir = path.join(import.meta.dirname, "fixtures", fixture);

  if (!existsSync(fixtureDir)) {
    throw new Error(`Fixture directory not found: ${fixtureDir}`);
  }

  // Create temp root
  const rootDir = mkdtempSync(path.join(tmpdir(), "pubm-demo-"));
  const bareDir = path.join(rootDir, "remote.git");
  const workDir = path.join(rootDir, "workspace");

  try {
    // 1. Create bare repo (acts as remote)
    mkdirSync(bareDir);
    git("init --bare", bareDir);

    // 2. Create workspace from fixture
    mkdirSync(workDir, { recursive: true });
    cpSync(fixtureDir, workDir, { recursive: true });

    // 3. Initialize git in workspace
    git("init -b main", workDir);
    git('config user.name "Demo User"', workDir);
    git('config user.email "demo@example.com"', workDir);
    git(`remote add origin ${bareDir}`, workDir);

    // 4. Initial commit
    git("add -A", workDir);
    git('commit -m "chore: initial release v1.0.0"', workDir);

    // 5. Create initial tags
    if (isMonorepo) {
      git("tag @pubm/core@1.0.0", workDir);
      git("tag pubm@1.0.0", workDir);
      git("tag pubm-native@1.0.0", workDir);
    } else {
      git("tag v1.0.0", workDir);
    }

    // 6. Push to bare remote
    git("push -u origin main --tags", workDir);

    // 7. Add a post-initial commit so there's something in the changelog
    const changeFile = isMonorepo
      ? path.join(workDir, "packages/core/src/index.ts")
      : path.join(workDir, "src/index.ts");
    appendFileSync(changeFile, '\nexport const updated = true;\n');
    git("add -A", workDir);
    git('commit -m "feat: add greeting function"', workDir);
    git("push origin main", workDir);

    return { workDir, bareDir, rootDir, isMonorepo };
  } catch (error) {
    // Cleanup on failure
    rmSync(rootDir, { recursive: true, force: true });
    throw error;
  }
}

export function teardown(env: DemoEnvironment): void {
  try {
    rmSync(env.rootDir, { recursive: true, force: true });
  } catch {
    console.warn(`[demo] Failed to clean up temp directory: ${env.rootDir}`);
  }
}
