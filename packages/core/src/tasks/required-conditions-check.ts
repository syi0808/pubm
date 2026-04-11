import path from "node:path";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
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
import { pathFromKey } from "../utils/package-key.js";
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

/**
 * Detect package names that appear across different ecosystems,
 * which would cause tag collisions in independent versioning mode.
 * Returns an array of colliding package names.
 */
export function detectTagNameCollisions(
  packages: ResolvedPackageConfig[],
): string[] {
  const nameToEcosystems = new Map<string, Set<string>>();
  for (const pkg of packages) {
    const ecosystem = pkg.ecosystem ?? "js";
    const ecosystems = nameToEcosystems.get(pkg.name);
    if (ecosystems) {
      ecosystems.add(ecosystem);
    } else {
      nameToEcosystems.set(pkg.name, new Set([ecosystem]));
    }
  }
  const collisions: string[] = [];
  for (const [name, ecosystems] of nameToEcosystems) {
    if (ecosystems.size > 1) collisions.push(name);
  }
  return collisions;
}

export const requiredConditionsCheckTask = (
  options?: Omit<ListrTask<PubmContext>, "title" | "task">,
): Listr<PubmContext> => {
  const createAvailabilityTask = (
    registryKey: string,
    packageKeys: string[],
  ): ListrTask<PubmContext> => {
    const descriptor = registryCatalog.get(registryKey);
    if (!descriptor) return { title: registryKey, task: async () => {} };

    if (packageKeys.length <= 1) {
      return {
        title: t("task.conditions.checkAvailability", {
          label: descriptor.label,
        }),
        task: async (ctx, task): Promise<void> => {
          const registry = await descriptor.factory(
            pathFromKey(packageKeys[0] ?? ""),
          );
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
          packageKeys.map((key) => ({
            title: pathFromKey(key),
            task: async (ctx, task): Promise<void> => {
              const registry = await descriptor.factory(pathFromKey(key));
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
                const key = pkg.ecosystem;
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
                      group.registries.map(({ registry, packageKeys }) =>
                        createAvailabilityTask(registry, packageKeys),
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
          // Tag name collision check (independent mode only)
          {
            title: t("task.conditions.checkTagCollisions"),
            skip: (ctx) =>
              ctx.config.versioning !== "independent" ||
              !!ctx.config.registryQualifiedTags,
            task: async (ctx, task): Promise<void> => {
              const collisions = detectTagNameCollisions(ctx.config.packages);
              if (collisions.length === 0) return;

              const names = collisions.join(", ");

              if (ctx.runtime.promptEnabled) {
                const useQualified = await task
                  .prompt(ListrEnquirerPromptAdapter)
                  .run<boolean>({
                    type: "toggle",
                    message: t("task.conditions.tagCollisionPrompt", { names }),
                    enabled: "Yes",
                    disabled: "No",
                  });
                if (useQualified) {
                  ctx.runtime.registryQualifiedTags = true;
                } else {
                  throw new RequiredConditionCheckError(
                    t("error.conditions.tagCollision", { names }),
                  );
                }
              } else {
                throw new RequiredConditionCheckError(
                  t("error.conditions.tagCollision", { names }),
                );
              }
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
