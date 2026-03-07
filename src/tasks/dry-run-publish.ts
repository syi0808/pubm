import type { Listr, ListrTask } from "listr2";
import { RustEcosystem } from "../ecosystem/rust.js";
import { CratesRegistry } from "../registry/crates.js";
import { JsrClient, jsrRegistry } from "../registry/jsr.js";
import { npmRegistry } from "../registry/npm.js";
import { collectRegistries } from "../utils/registries.js";
import type { Ctx } from "./runner.js";

const npmDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run npm publish",
  task: async (_, task): Promise<void> => {
    const npm = await npmRegistry();

    task.output = "Running npm publish --dry-run...";
    await npm.dryRunPublish();
  },
};

const jsrDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run jsr publish",
  skip: () => !JsrClient.token,
  task: async (_, task): Promise<void> => {
    const jsr = await jsrRegistry();

    task.output = "Running jsr publish --dry-run...";
    await jsr.dryRunPublish();
  },
};

function createCratesDryRunPublishTask(packagePath?: string): ListrTask<Ctx> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Dry-run cargo publish${label}`,
    task: async (_, task): Promise<void> => {
      const eco = new RustEcosystem(packagePath ?? process.cwd());
      const packageName = await eco.packageName();
      const registry = new CratesRegistry(packageName);

      task.output = "Running cargo publish --dry-run...";
      await registry.dryRunPublish(packagePath);
    },
  };
}

const cratesDryRunPublishTask: ListrTask<Ctx> = createCratesDryRunPublishTask();

function registryDryRunTask(registryKey: string): ListrTask<Ctx> {
  switch (registryKey) {
    case "npm":
      return npmDryRunPublishTask;
    case "jsr":
      return jsrDryRunPublishTask;
    case "crates":
      return cratesDryRunPublishTask;
    default:
      return npmDryRunPublishTask;
  }
}

export const dryRunPublishTask: ListrTask<Ctx> = {
  title: "Validating publish (dry-run)",
  task: (ctx, parentTask): Listr<Ctx> => {
    if (ctx.packages?.length) {
      const tasks = ctx.packages.flatMap((pkg) =>
        pkg.registries.map((registryKey) =>
          registryKey === "crates"
            ? createCratesDryRunPublishTask(pkg.path)
            : registryDryRunTask(registryKey),
        ),
      );
      return parentTask.newListr(tasks, { concurrent: true });
    }
    return parentTask.newListr(collectRegistries(ctx).map(registryDryRunTask), {
      concurrent: true,
    });
  },
};
