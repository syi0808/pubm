import type { ListrTask } from "listr2";
import { getPackageVersion, type PubmContext } from "../context.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError } from "../error.js";
import {
  CratesConnector,
  type CratesPackageRegistry,
  cratesPackageRegistry,
} from "../registry/crates.js";
import { ui } from "../utils/ui.js";

class CratesError extends AbstractError {
  name = "crates.io Error";

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
    title: `Checking crates.io availability (${packagePath})`,
    task: async (): Promise<void> => {
      const registry = await cratesPackageRegistry(packagePath);
      const connector = new CratesConnector();

      if (!(await connector.isInstalled())) {
        throw new CratesError(
          "cargo is not installed. Please install Rust toolchain to proceed.",
        );
      }

      if (!(await registry.hasPermission())) {
        throw new CratesError(
          "No crates.io credentials found. Run `cargo login` or set CARGO_REGISTRY_TOKEN.",
        );
      }
    },
  };
}

export function createCratesPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: `Publishing to crates.io (${packagePath})`,
    task: async (ctx, task): Promise<void> => {
      const packageName = await getCrateName(packagePath);
      const registry = await cratesPackageRegistry(packagePath);

      const version = getPackageVersion(ctx, packagePath);

      // Pre-check: skip if version already published
      if (await registry.isVersionPublished(version)) {
        task.title = `[SKIPPED] crates.io (${packagePath}): v${version} already published`;
        task.output = `⚠ ${packageName}@${version} is already published on crates.io`;
        return task.skip();
      }

      try {
        task.output = `Publishing ${packageName}@${version} on crates.io...`;
        await registry.publish();
      } catch (error) {
        // Fallback: catch "already uploaded" errors
        if (
          error instanceof Error &&
          error.message.includes("is already uploaded")
        ) {
          task.title = `[SKIPPED] crates.io (${packagePath}): v${version} already published`;
          task.output = `⚠ ${packageName}@${version} is already published on crates.io`;
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

  if (!canYank) {
    ctx.runtime.rollback.add({
      label: `Yank ${packageName}@${version} from crates (skipped — use --dangerously-allow-unpublish to enable)`,
      fn: async () => {},
    });
    return;
  }

  ctx.runtime.rollback.add({
    label: `Yank ${packageName}@${version} from crates (⚠ version will be permanently burned)`,
    fn: async () => {
      await registry.unpublish(packageName, version);
      console.log(
        `    ${ui.chalk.yellow("⚠")} v${version} is permanently reserved on crates.io — this version cannot be reused`,
      );
    },
    confirm: true,
  });
}
