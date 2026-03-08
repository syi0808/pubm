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
  task: async (ctx, task): Promise<void> => {
    const npm = await npmRegistry();

    if (await npm.isVersionPublished(ctx.version)) {
      task.title = `[SKIPPED] Dry-run npm publish: v${ctx.version} already published`;
      task.output = `⚠ ${npm.packageName}@${ctx.version} is already published on npm`;
      return task.skip();
    }

    task.output = "Running npm publish --dry-run...";
    await withTokenRetry("npm", task, async () => {
      await npm.dryRunPublish();
    });
  },
};

export const jsrDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run jsr publish",
  task: async (ctx, task): Promise<void> => {
    const jsr = await jsrRegistry();

    if (await jsr.isVersionPublished(ctx.version)) {
      task.title = `[SKIPPED] Dry-run jsr publish: v${ctx.version} already published`;
      task.output = `⚠ ${jsr.packageName}@${ctx.version} is already published on jsr`;
      return task.skip();
    }

    task.output = "Running jsr publish --dry-run...";
    await withTokenRetry("jsr", task, async () => {
      await jsr.dryRunPublish();
    });
  },
};

async function getCrateName(packagePath?: string): Promise<string> {
  const eco = new RustEcosystem(packagePath ?? process.cwd());
  return await eco.packageName();
}

const MISSING_CRATE_PATTERN = /no matching package named `([^`]+)` found/;

async function findUnpublishedSiblingDeps(
  packagePath: string | undefined,
  siblingCrateNames: string[],
): Promise<string[]> {
  const eco = new RustEcosystem(packagePath ?? process.cwd());
  const deps = await eco.dependencies();
  const siblingDeps = deps.filter((d) => siblingCrateNames.includes(d));

  const results = await Promise.all(
    siblingDeps.map(async (name) => {
      const registry = new CratesRegistry(name);
      const published = await registry.isPublished();
      return published ? null : name;
    }),
  );

  return results.filter((name): name is string => name !== null);
}

export function createCratesDryRunPublishTask(
  packagePath?: string,
  siblingCrateNames?: string[],
): ListrTask<Ctx> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Dry-run crates.io publish${label}`,
    task: async (ctx, task): Promise<void> => {
      // Pre-check: skip if version already published
      const packageName = await getCrateName(packagePath);
      const registry = new CratesRegistry(packageName);

      if (await registry.isVersionPublished(ctx.version)) {
        task.title = `[SKIPPED] Dry-run crates.io publish${label}: v${ctx.version} already published`;
        task.output = `⚠ ${packageName}@${ctx.version} is already published on crates.io`;
        return task.skip();
      }

      // Proactive: skip if any sibling dependency is not yet on crates.io
      if (siblingCrateNames?.length) {
        const unpublished = await findUnpublishedSiblingDeps(
          packagePath,
          siblingCrateNames,
        );
        if (unpublished.length > 0) {
          task.title = `Dry-run crates.io publish${label} [skipped: sibling crate \`${unpublished.join("`, `")}\` not yet published]`;
          return;
        }
      }

      task.output = "Running cargo publish --dry-run...";
      try {
        await withTokenRetry("crates", task, async () => {
          const packageName = await getCrateName(packagePath);
          const registry = new CratesRegistry(packageName);
          await registry.dryRunPublish(packagePath);
        });
      } catch (error) {
        // Reactive fallback: catch sibling-related errors
        const message = error instanceof Error ? error.message : String(error);
        const match = message.match(MISSING_CRATE_PATTERN);
        if (match && siblingCrateNames?.includes(match[1])) {
          task.title = `Dry-run crates.io publish${label} [skipped: sibling crate \`${match[1]}\` not yet published]`;
          return;
        }
        throw error;
      }
    },
  };
}

export const cratesDryRunPublishTask: ListrTask<Ctx> =
  createCratesDryRunPublishTask();
