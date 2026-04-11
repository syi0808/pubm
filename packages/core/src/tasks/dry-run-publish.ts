import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import { getPackageVersion, type PubmContext } from "../context.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { t } from "../i18n/index.js";
import { registryCatalog } from "../registry/catalog.js";
import { cratesPackageRegistry } from "../registry/crates.js";
import { jsrPackageRegistry } from "../registry/jsr.js";
import { npmPackageRegistry } from "../registry/npm.js";
import { pathFromKey } from "../utils/package-key.js";
import { SecureStore } from "../utils/secure-store.js";

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
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isAuthError(error)) throw error;

    const descriptor = registryCatalog.get(registryKey);
    if (!descriptor) throw error;
    const config = descriptor.tokenConfig;

    // Shared promise: first task prompts, others await
    const retryPromises = ctx.runtime.tokenRetryPromises ?? {};
    ctx.runtime.tokenRetryPromises = retryPromises;
    if (!retryPromises[registryKey]) {
      retryPromises[registryKey] = (async () => {
        task.output = t("task.preflight.authFailed", {
          label: config.promptLabel,
        });
        const newToken: string = await task
          .prompt(ListrEnquirerPromptAdapter)
          .run({
            type: "password",
            message: t("prompt.preflight.reenter", {
              label: config.promptLabel,
            }),
          });
        new SecureStore().set(config.dbKey, newToken);
        process.env[config.envVar] = newToken;
        return newToken;
      })();
    }

    await retryPromises[registryKey];
    await action();
  }
}

export function createNpmDryRunPublishTask(
  key: string,
): ListrTask<PubmContext> {
  return {
    title: key,
    task: async (ctx, task): Promise<void> => {
      const npm = await npmPackageRegistry(pathFromKey(key));
      task.title = npm.packageName;
      const version = getPackageVersion(ctx, key);

      if (await npm.isVersionPublished(version)) {
        task.title = t("task.dryRun.npm.skipped", { version });
        task.output = t("task.npm.alreadyPublished", {
          name: npm.packageName,
          version,
        });
        return task.skip();
      }

      task.output = t("task.dryRun.npm.running");
      await withTokenRetry("npm", ctx, task, async () => {
        await npm.dryRunPublish(ctx.runtime.tag);
      });
    },
  };
}

export function createJsrDryRunPublishTask(
  key: string,
): ListrTask<PubmContext> {
  return {
    title: key,
    task: async (ctx, task): Promise<void> => {
      const jsr = await jsrPackageRegistry(pathFromKey(key));
      task.title = jsr.packageName;
      const version = getPackageVersion(ctx, key);

      if (await jsr.isVersionPublished(version)) {
        task.title = t("task.dryRun.jsr.skipped", { version });
        task.output = t("task.jsr.alreadyPublished", {
          name: jsr.packageName,
          version,
        });
        return task.skip();
      }

      task.output = t("task.dryRun.jsr.running");
      await withTokenRetry("jsr", ctx, task, async () => {
        await jsr.dryRunPublish();
      });
    },
  };
}

async function getCrateName(packagePath: string): Promise<string> {
  const eco = new RustEcosystem(packagePath);
  return await eco.packageName();
}

const MISSING_CRATE_PATTERN = /no matching package named `([^`]+)` found/;
const VERSION_MISMATCH_PATTERN =
  /failed to select a version for the requirement `([^=`\s]+)/;

async function findUnpublishedSiblingDeps(
  packagePath: string,
  siblingKeys: string[],
  ctx: PubmContext,
): Promise<string[]> {
  const eco = new RustEcosystem(packagePath);
  const deps = await eco.dependencies();

  const siblingNameToKey = new Map<string, string>();
  await Promise.all(
    siblingKeys.map(async (k) => {
      const name = await getCrateName(pathFromKey(k));
      siblingNameToKey.set(name, k);
    }),
  );

  const siblingDeps = deps.filter((d) => siblingNameToKey.has(d));

  const results = await Promise.all(
    siblingDeps.map(async (name) => {
      const siblingKey = siblingNameToKey.get(name);
      if (!siblingKey) {
        throw new Error(`Missing sibling crate key for dependency: ${name}`);
      }
      const siblingPath = pathFromKey(siblingKey);
      const registry = await cratesPackageRegistry(siblingPath);
      const version = getPackageVersion(ctx, siblingKey);
      if (version) {
        const versionPublished = await registry.isVersionPublished(version);
        return versionPublished ? null : name;
      }
      // Fallback: check if the crate exists at all
      const published = await registry.isPublished();
      return published ? null : name;
    }),
  );

  return results.filter((name): name is string => name !== null);
}

export function createCratesDryRunPublishTask(
  key: string,
  siblingKeys?: string[],
): ListrTask<PubmContext> {
  const packagePath = pathFromKey(key);
  return {
    title: t("task.dryRun.crates.title", { path: packagePath }),
    task: async (ctx, task): Promise<void> => {
      // Pre-check: skip if version already published
      const registry = await cratesPackageRegistry(packagePath);
      const packageName = registry.packageName;
      const version = getPackageVersion(ctx, key);

      if (await registry.isVersionPublished(version)) {
        task.title = t("task.dryRun.crates.skipped", {
          path: packagePath,
          version,
        });
        task.output = t("task.crates.alreadyPublished", {
          name: packageName,
          version,
        });
        return task.skip();
      }

      // Proactive: skip if any sibling dependency's new version is not yet on crates.io
      if (siblingKeys?.length) {
        const unpublished = await findUnpublishedSiblingDeps(
          packagePath,
          siblingKeys,
          ctx,
        );
        if (unpublished.length > 0) {
          task.title = t("task.dryRun.crates.skippedSibling", {
            path: packagePath,
            crate: unpublished.join("`, `"),
          });
          return;
        }
      }

      task.output = t("task.dryRun.crates.running");
      try {
        await withTokenRetry("crates", ctx, task, async () => {
          const reg = await cratesPackageRegistry(packagePath);
          await reg.dryRunPublish();
        });
      } catch (error) {
        // Reactive fallback: catch sibling-related errors
        const message = error instanceof Error ? error.message : String(error);
        const missingMatch = message.match(MISSING_CRATE_PATTERN);
        const versionMatch = message.match(VERSION_MISMATCH_PATTERN);
        const crateName = missingMatch?.[1] ?? versionMatch?.[1]?.trim();

        if (crateName && siblingKeys) {
          const siblingNames = await Promise.all(
            siblingKeys.map((k) => getCrateName(pathFromKey(k))),
          );
          if (siblingNames.includes(crateName)) {
            task.title = t("task.dryRun.crates.skippedSibling", {
              path: packagePath,
              crate: crateName,
            });
            return;
          }
        }
        throw error;
      }
    },
  };
}
