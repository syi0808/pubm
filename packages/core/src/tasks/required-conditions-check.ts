import path from "node:path";
import type { Listr, ListrTask } from "listr2";
import { isCI } from "std-env";
import type { ResolvedPackageConfig } from "../config/types.js";
import type { PubmContext } from "../context.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";
import { t } from "../i18n/index.js";
import { detectWorkspace } from "../monorepo/workspace.js";
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
            skip: (ctx) => !!ctx.options.skipTests && !!ctx.options.skipBuild,
            task: async (ctx): Promise<void> => {
              const errors: string[] = [];
              const JS_WS_TYPES = new Set([
                "pnpm",
                "npm",
                "yarn",
                "bun",
                "deno",
              ]);
              const workspaces = detectWorkspace(ctx.cwd);

              const byEcosystem = new Map<string, ResolvedPackageConfig[]>();
              for (const pkg of ctx.config.packages) {
                const key = pkg.ecosystem ?? "js";
                if (!byEcosystem.has(key)) byEcosystem.set(key, []);
                byEcosystem.get(key)!.push(pkg);
              }

              for (const [ecosystemKey, packages] of byEcosystem) {
                const descriptor = ecosystemCatalog.get(ecosystemKey);
                if (!descriptor) continue;

                const hasWorkspace =
                  ecosystemKey === "js"
                    ? workspaces.some((w) => JS_WS_TYPES.has(w.type))
                    : ecosystemKey === "rust"
                      ? workspaces.some((w) => w.type === "cargo")
                      : false;

                const ecoConfig = ctx.config.ecosystems?.[ecosystemKey];
                let testGroupValidated = false;
                let buildGroupValidated = false;

                for (const pkg of packages) {
                  if (!ctx.options.skipTests) {
                    const hasCommand =
                      pkg.testCommand ?? ecoConfig?.testCommand;
                    if (!hasCommand) {
                      const script =
                        pkg.testScript ??
                        ecoConfig?.testScript ??
                        ctx.options.testScript;
                      const isPackageOverride = !!pkg.testScript;
                      const validateCwd =
                        hasWorkspace && !isPackageOverride
                          ? ctx.cwd
                          : path.resolve(ctx.cwd, pkg.path);

                      if (
                        !hasWorkspace ||
                        isPackageOverride ||
                        !testGroupValidated
                      ) {
                        const instance = new descriptor.ecosystemClass(
                          validateCwd,
                        );
                        const error = await instance.validateScript(
                          script,
                          "test",
                        );
                        if (error) errors.push(error);

                        if (hasWorkspace && !isPackageOverride)
                          testGroupValidated = true;
                      }
                    }
                  }

                  if (!ctx.options.skipBuild) {
                    const hasCommand =
                      pkg.buildCommand ?? ecoConfig?.buildCommand;
                    if (!hasCommand) {
                      const script =
                        pkg.buildScript ??
                        ecoConfig?.buildScript ??
                        ctx.options.buildScript;
                      const isPackageOverride = !!pkg.buildScript;
                      const validateCwd =
                        hasWorkspace && !isPackageOverride
                          ? ctx.cwd
                          : path.resolve(ctx.cwd, pkg.path);

                      if (
                        !hasWorkspace ||
                        isPackageOverride ||
                        !buildGroupValidated
                      ) {
                        const instance = new descriptor.ecosystemClass(
                          validateCwd,
                        );
                        const error = await instance.validateScript(
                          script,
                          "build",
                        );
                        if (error) errors.push(error);

                        if (hasWorkspace && !isPackageOverride)
                          buildGroupValidated = true;
                      }
                    }
                  }
                }
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
