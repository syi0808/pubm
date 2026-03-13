import type { ListrTask } from "listr2";
import type { PubmContext } from "../context.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError } from "../error.js";
import { CratesRegistry } from "../registry/crates.js";

class CratesError extends AbstractError {
  name = "crates.io Error";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.stack = "";
  }
}

async function getCrateName(packagePath?: string): Promise<string> {
  const eco = new RustEcosystem(packagePath ?? process.cwd());
  return await eco.packageName();
}

export function createCratesAvailableCheckTask(
  packagePath?: string,
): ListrTask<PubmContext> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Checking crates.io availability${label}`,
    task: async (): Promise<void> => {
      const packageName = await getCrateName(packagePath);
      const registry = new CratesRegistry(packageName);

      if (!(await registry.isInstalled())) {
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
  packagePath?: string,
): ListrTask<PubmContext> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Publishing to crates.io${label}`,
    task: async (ctx, task): Promise<void> => {
      const packageName = await getCrateName(packagePath);
      const registry = new CratesRegistry(packageName);

      // Pre-check: skip if version already published
      if (await registry.isVersionPublished(ctx.runtime.version!)) {
        task.title = `[SKIPPED] crates.io${label}: v${ctx.runtime.version} already published`;
        task.output = `⚠ ${packageName}@${ctx.runtime.version} is already published on crates.io`;
        return task.skip();
      }

      try {
        task.output = `Publishing ${packageName}@${ctx.runtime.version} on crates.io...`;
        await registry.publish(packagePath);
      } catch (error) {
        // Fallback: catch "already uploaded" errors
        if (
          error instanceof Error &&
          error.message.includes("is already uploaded")
        ) {
          task.title = `[SKIPPED] crates.io${label}: v${ctx.runtime.version} already published`;
          task.output = `⚠ ${packageName}@${ctx.runtime.version} is already published on crates.io`;
          return task.skip();
        }
        throw error;
      }
    },
  };
}

// Backward-compatible static exports (used when no packages config)
export const cratesAvailableCheckTasks: ListrTask<PubmContext> =
  createCratesAvailableCheckTask();
export const cratesPublishTasks: ListrTask<PubmContext> =
  createCratesPublishTask();
