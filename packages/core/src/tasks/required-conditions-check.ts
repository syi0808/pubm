import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Listr, ListrTask } from "listr2";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";
import { registryCatalog } from "../registry/catalog.js";
import { getConnector } from "../registry/index.js";
import { validateEngineVersion } from "../utils/engine-version.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { collectRegistries } from "../utils/registries.js";
import {
  collectEcosystemRegistryGroups,
  ecosystemLabel,
  registryLabel,
} from "./grouping.js";

function needsPackageScripts(registries: string[]): boolean {
  return registries.some(
    (r) => registryCatalog.get(r)?.needsPackageScripts ?? true,
  );
}

class RequiredConditionCheckError extends AbstractError {
  name = "Failed required condition check";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export const requiredConditionsCheckTask = (
  options?: Omit<ListrTask<PubmContext>, "title" | "task">,
): Listr<PubmContext> => {
  const createAvailabilityTask = (
    registryKey: string,
    packagePaths: string[],
  ): ListrTask<PubmContext> => {
    const descriptor = registryCatalog.get(registryKey);
    if (!descriptor) return { title: registryKey, task: async () => {} };

    if (packagePaths.length <= 1) {
      return {
        title: `Checking ${descriptor.label} availability`,
        task: async (_ctx, task): Promise<void> => {
          const registry = await descriptor.factory(packagePaths[0]);
          await registry.checkAvailability(task);
        },
      };
    }

    return {
      title: `Checking ${descriptor.label} availability`,
      task: (_ctx, parentTask): Listr<PubmContext> =>
        parentTask.newListr(
          packagePaths.map((packagePath) => ({
            title: packagePath,
            task: async (_ctx, task): Promise<void> => {
              const registry = await descriptor.factory(packagePath);
              await registry.checkAvailability(task);
            },
          })),
          { concurrent: true },
        ),
    };
  };

  const taskDef: ListrTask<PubmContext> = {
    ...options,
    title: "Required conditions check (for pubm tasks)",
    task: (_, parentTask): Listr<PubmContext> =>
      parentTask.newListr(
        [
          {
            title: "Ping registries",
            task: (ctx, parentTask): Listr<PubmContext> =>
              parentTask.newListr(
                collectEcosystemRegistryGroups(ctx.config).map((group) => ({
                  title: ecosystemLabel(group.ecosystem),
                  task: (_ctx, ecosystemTask): Listr<PubmContext> =>
                    ecosystemTask.newListr(
                      group.registries.map(({ registry }) => ({
                        title: `Ping ${registryLabel(registry)}`,
                        task: async (): Promise<void> => {
                          const connector = getConnector(registry);

                          await connector.ping();
                        },
                      })),
                      {
                        concurrent: true,
                      },
                    ),
                })),
                {
                  concurrent: true,
                },
              ),
          },
          {
            title: "Checking if test and build scripts exist",
            skip: (ctx) => !needsPackageScripts(collectRegistries(ctx.config)),
            task: async (ctx): Promise<void> => {
              const raw = await readFile(
                join(ctx.cwd, "package.json"),
                "utf-8",
              );
              const { scripts } = JSON.parse(raw);

              const errors: string[] = [];

              if (
                !ctx.options.skipTests &&
                !scripts?.[ctx.options.testScript]
              ) {
                errors.push(
                  `Test script '${ctx.options.testScript}' does not exist.`,
                );
              }

              if (
                !ctx.options.skipBuild &&
                !scripts?.[ctx.options.buildScript]
              ) {
                errors.push(
                  `Build script '${ctx.options.buildScript}' does not exist.`,
                );
              }

              if (errors.length) {
                throw new RequiredConditionCheckError(
                  `${errors.join(" and ")} Please check your configuration.`,
                );
              }
            },
          },
          {
            title: "Checking git version",
            task: async (): Promise<void> => {
              const git = new Git();

              validateEngineVersion("git", `${await git.version()}`);
            },
          },
          {
            title: "Checking available registries for publishing",
            task: (ctx, parentTask): Listr<PubmContext> => {
              return parentTask.newListr(
                collectEcosystemRegistryGroups(ctx.config).map((group) => ({
                  title: ecosystemLabel(group.ecosystem),
                  task: (_ctx, ecosystemTask): Listr<PubmContext> =>
                    ecosystemTask.newListr(
                      group.registries.map(({ registry, packagePaths }) =>
                        createAvailabilityTask(registry, packagePaths),
                      ),
                      { concurrent: true },
                    ),
                })),
                {
                  concurrent: true,
                },
              );
            },
          },
        ],
        {
          concurrent: true,
        },
      ),
  };

  if (isCI) {
    return createListr(taskDef, createCiListrOptions<PubmContext>());
  }

  return createListr(taskDef);
};
