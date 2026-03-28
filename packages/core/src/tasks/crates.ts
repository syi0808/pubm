import type { ListrTask } from "listr2";
import { getPackageVersion, type PubmContext } from "../context.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError } from "../error.js";
import { t } from "../i18n/index.js";
import { registryCatalog } from "../registry/catalog.js";
import {
  CratesConnector,
  type CratesPackageRegistry,
  cratesPackageRegistry,
} from "../registry/crates.js";
import { ui } from "../utils/ui.js";

class CratesError extends AbstractError {
  name = t("error.crates.name");

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.stack = "";
  }
}

async function getCrateName(packagePath: string): Promise<string> {
  const eco = new RustEcosystem(packagePath);
  return await eco.packageName();
}

export function createCratesAvailableCheckTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: t("task.crates.checkAvailability", { path: packagePath }),
    task: async (): Promise<void> => {
      const registry = await cratesPackageRegistry(packagePath);
      const connector = new CratesConnector();

      if (!(await connector.isInstalled())) {
        throw new CratesError(t("error.crates.cargoNotInstalled"));
      }

      if (!(await registry.hasPermission())) {
        throw new CratesError(t("error.crates.noCredentials"));
      }
    },
  };
}

export function createCratesPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: t("task.crates.publishing", { path: packagePath }),
    task: async (ctx, task): Promise<void> => {
      const packageName = await getCrateName(packagePath);
      const registry = await cratesPackageRegistry(packagePath);

      const version = getPackageVersion(ctx, packagePath);

      // Pre-check: skip if version already published
      if (await registry.isVersionPublished(version)) {
        task.title = t("task.crates.skipped", { path: packagePath, version });
        task.output = t("task.crates.alreadyPublished", {
          name: packageName,
          version,
        });
        return task.skip();
      }

      try {
        task.output = t("task.crates.publishingVersion", {
          name: packageName,
          version,
        });
        await registry.publish();
      } catch (error) {
        // Fallback: catch "already uploaded" errors
        if (
          error instanceof Error &&
          error.message.includes("is already uploaded")
        ) {
          task.title = t("task.crates.skipped", { path: packagePath, version });
          task.output = t("task.crates.alreadyPublished", {
            name: packageName,
            version,
          });
          return task.skip();
        }
        throw error;
      }

      registerYankRollback(ctx, registry, packageName, version);
    },
  };
}

function registerYankRollback(
  ctx: PubmContext,
  registry: CratesPackageRegistry,
  packageName: string,
  version: string,
): void {
  if (!registry.supportsUnpublish) return;

  const canYank =
    ctx.runtime.promptEnabled || ctx.config.rollback.dangerouslyAllowUnpublish;

  const verb = registryCatalog.get("crates")?.unpublishLabel ?? "Yank";

  if (!canYank) {
    ctx.runtime.rollback.add({
      label: t("task.crates.rollbackSkipped", {
        verb,
        name: packageName,
        version,
      }),
      fn: async () => {},
    });
    return;
  }

  ctx.runtime.rollback.add({
    label: t("task.crates.rollbackBurned", {
      verb,
      name: packageName,
      version,
    }),
    fn: async () => {
      await registry.unpublish(packageName, version);
      console.log(
        `    ${ui.chalk.yellow("⚠")} ${t("task.crates.versionReserved", { version })}`,
      );
    },
    confirm: true,
  });
}
