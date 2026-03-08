import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import { RustEcosystem } from "../ecosystem/rust.js";
import { CratesRegistry } from "../registry/crates.js";
import { jsrRegistry } from "../registry/jsr.js";
import { npmRegistry } from "../registry/npm.js";
import { Db } from "../utils/db.js";
import { TOKEN_CONFIG } from "../utils/token.js";
import type { Ctx } from "./runner.js";

const AUTH_ERROR_PATTERNS = [
  /401/i,
  /403/i,
  /unauthorized/i,
  /forbidden/i,
  /invalid.token/i,
  /eotp/i,
];

function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

async function withTokenRetry(
  registryKey: string,
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
  task: any,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isAuthError(error)) throw error;

    const config = TOKEN_CONFIG[registryKey];
    if (!config) throw error;

    task.output = `Auth failed. Re-enter ${config.promptLabel}`;
    const newToken: string = await task.prompt(ListrEnquirerPromptAdapter).run({
      type: "password",
      message: `Re-enter ${config.promptLabel}`,
    });

    new Db().set(config.dbKey, newToken);
    process.env[config.envVar] = newToken;

    await action();
  }
}

export const npmDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run npm publish",
  task: async (_, task): Promise<void> => {
    task.output = "Running npm publish --dry-run...";
    await withTokenRetry("npm", task, async () => {
      const npm = await npmRegistry();
      await npm.dryRunPublish();
    });
  },
};

export const jsrDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run jsr publish",
  task: async (_, task): Promise<void> => {
    task.output = "Running jsr publish --dry-run...";
    await withTokenRetry("jsr", task, async () => {
      const jsr = await jsrRegistry();
      await jsr.dryRunPublish();
    });
  },
};

async function getCrateName(packagePath?: string): Promise<string> {
  const eco = new RustEcosystem(packagePath ?? process.cwd());
  return await eco.packageName();
}

export function createCratesDryRunPublishTask(
  packagePath?: string,
): ListrTask<Ctx> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Dry-run crates.io publish${label}`,
    task: async (_, task): Promise<void> => {
      task.output = "Running cargo publish --dry-run...";
      await withTokenRetry("crates", task, async () => {
        const packageName = await getCrateName(packagePath);
        const registry = new CratesRegistry(packageName);
        await registry.dryRunPublish(packagePath);
      });
    },
  };
}

export const cratesDryRunPublishTask: ListrTask<Ctx> =
  createCratesDryRunPublishTask();
