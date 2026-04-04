import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Listr, ListrTask } from "listr2";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";
import { t } from "../i18n/index.js";
import { wrapTaskContext } from "../plugin/wrap-task-context.js";
import { registryCatalog } from "../registry/catalog.js";
import { getConnector } from "../registry/index.js";
import { validateEngineVersion } from "../utils/engine-version.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import {
  collectEcosystemRegistryGroups,
  ecosystemLabel,
  registryLabel,
} from "./grouping.js";

class RequiredConditionCheckError extends AbstractError {
  name = t("error.conditions.name");

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
        title: t("task.conditions.checkAvailability", {
          label: descriptor.label,
        }),
        task: async (ctx, task): Promise<void> => {
          const registry = await descriptor.factory(packagePaths[0]);
          await registry.checkAvailability(task, ctx);
        },
      };
    }

    return {
      title: t("task.conditions.checkAvailability", {
        label: descriptor.label,
      }),
      task: (_ctx, parentTask): Listr<PubmContext> =>
        parentTask.newListr(
          packagePaths.map((packagePath) => ({
            title: packagePath,
            task: async (ctx, task): Promise<void> => {
              const registry = await descriptor.factory(packagePath);
              await registry.checkAvailability(task, ctx);
            },
          })),
          { concurrent: true },
        ),
    };
  };

  const taskDef: ListrTask<PubmContext> = {
    ...options,
    title: t("task.conditions.title"),
    task: (ctx, parentTask): Listr<PubmContext> =>
      parentTask.newListr(
        [
          {
            title: t("task.conditions.pingRegistries"),
            task: (ctx, parentTask): Listr<PubmContext> =>
              parentTask.newListr(
                collectEcosystemRegistryGroups(ctx.config).map((group) => ({
                  title: ecosystemLabel(group.ecosystem),
                  task: (_ctx, ecosystemTask): Listr<PubmContext> =>
                    ecosystemTask.newListr(
                      group.registries.map(({ registry }) => ({
                        title: t("task.conditions.pingRegistry", {
                          registry: registryLabel(registry),
                        }),
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
            title: t("task.conditions.checkScripts"),
            skip: (ctx) =>
              !ctx.config.packages.some(
                (pkg) => (pkg.ecosystem ?? "js") === "js",
              ),
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
                  t("error.conditions.testScriptMissing", {
                    script: ctx.options.testScript,
                  }),
                );
              }

              if (
                !ctx.options.skipBuild &&
                !scripts?.[ctx.options.buildScript]
              ) {
                errors.push(
                  t("error.conditions.buildScriptMissing", {
                    script: ctx.options.buildScript,
                  }),
                );
              }

              if (errors.length) {
                throw new RequiredConditionCheckError(
                  t("error.conditions.scriptsMissing", {
                    errors: errors.join(" and "),
                  }),
                );
              }
            },
          },
          {
            title: t("task.conditions.checkGitVersion"),
            task: async (): Promise<void> => {
              const git = new Git();

              validateEngineVersion("git", `${await git.version()}`);
            },
          },
          {
            title: t("task.conditions.checkRegistries"),
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
          // Append plugin condition checks
          ...ctx.runtime.pluginRunner
            .collectChecks(ctx, "conditions")
            .map((check) => ({
              title: check.title,
              // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
              task: async (ctx: PubmContext, task: any) => {
                await check.task(ctx, wrapTaskContext(task));
              },
            })),
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
