import { BinaryRunner, type RunResult } from "./binary-runner.js";
import { FixtureManager } from "./fixture-manager.js";
import { GitFixture } from "./git-fixture.js";

export type { RunResult };

export interface E2EContext {
  readonly dir: string;
  readonly git: GitFixture;
  run(...args: string[]): Promise<RunResult>;
  runWithEnv(
    env: Record<string, string>,
    ...args: string[]
  ): Promise<RunResult>;
  cleanup(): Promise<void>;
}

export async function e2e(fixtureName?: string): Promise<E2EContext> {
  const fixture = await FixtureManager.create(fixtureName);
  const runner = new BinaryRunner(fixture.dir);
  const git = new GitFixture(fixture.dir);

  return {
    get dir() {
      return fixture.dir;
    },
    get git() {
      return git;
    },
    run: (...args) => runner.run(...args),
    runWithEnv: (env, ...args) => runner.runWithEnv(env, ...args),
    cleanup: () => fixture.cleanup(),
  };
}
