import path from "node:path";
import type { ResolvedPackageConfig } from "../../config/types.js";
import { ecosystemCatalog } from "../../ecosystem/catalog.js";
import { AbstractError } from "../../error.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import { detectWorkspace } from "../../monorepo/workspace.js";
import { wrapTaskContext } from "../../plugin/wrap-task-context.js";
import { registryCatalog } from "../../registry/catalog.js";
import { getConnector } from "../../registry/index.js";
import {
  collectEcosystemRegistryGroups,
  ecosystemLabel,
  registryLabel,
} from "../../tasks/grouping.js";
import { validateEngineVersion } from "../../utils/engine-version.js";
import { pathFromKey } from "../../utils/package-key.js";
import { ui } from "../../utils/ui.js";
import type { ReleaseOperation } from "../release-operation.js";

class PrerequisitesCheckError extends AbstractError {
  name = t("error.prerequisites.name");

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.stack = "";
  }
}

class RequiredConditionCheckError extends AbstractError {
  name = t("error.conditions.name");

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.stack = "";
  }
}

export function createPrerequisitesCheckOperation(
  skip?: ReleaseOperation["skip"],
): ReleaseOperation {
  const git = new Git();

  return {
    skip,
    title: t("task.prerequisites.title"),
    run: async (ctx, operation) => {
      await operation.runOperations([
        {
          skip: (ctx) => !!ctx.options.anyBranch,
          title: t("task.prerequisites.verifyBranch"),
          run: async (ctx, task) => {
            if ((await git.branch()) === ctx.options.branch) return;

            if (!ctx.runtime.promptEnabled) {
              throw new PrerequisitesCheckError(
                t("error.prerequisites.wrongBranch"),
              );
            }

            const switchBranch = await task.prompt().run<boolean>({
              type: "toggle",
              message: t("task.prerequisites.switchBranchPrompt", {
                warning: ui.labels.WARNING,
                branch: ctx.options.branch,
              }),
              enabled: "Yes",
              disabled: "No",
            });

            if (switchBranch) {
              task.output = t("task.prerequisites.switchingBranch", {
                branch: ctx.options.branch,
              });
              await git.switch(ctx.options.branch);
              return;
            }

            throw new PrerequisitesCheckError(
              t("error.prerequisites.wrongBranch"),
            );
          },
        },
        {
          title: t("task.prerequisites.checkRemote"),
          run: async (_ctx, task) => {
            task.output = t("task.prerequisites.checkingFetch");

            if ((await git.dryFetch()).trim()) {
              if (!ctx.runtime.promptEnabled) {
                throw new PrerequisitesCheckError(
                  t("error.prerequisites.outdatedFetch"),
                );
              }

              const fetch = await task.prompt().run<boolean>({
                type: "toggle",
                message: t("task.prerequisites.outdatedFetchPrompt", {
                  warning: ui.labels.WARNING,
                }),
                enabled: "Yes",
                disabled: "No",
              });

              if (fetch) {
                task.output = t("task.prerequisites.executingFetch");
                await git.fetch();
              } else {
                throw new PrerequisitesCheckError(
                  t("error.prerequisites.outdatedFetch"),
                );
              }
            }

            task.output = t("task.prerequisites.checkingPull");
            if (await git.revisionDiffsCount()) {
              if (!ctx.runtime.promptEnabled) {
                throw new PrerequisitesCheckError(
                  t("error.prerequisites.outdatedPull"),
                );
              }

              const pull = await task.prompt().run<boolean>({
                type: "toggle",
                message: t("task.prerequisites.outdatedPullPrompt", {
                  warning: ui.labels.WARNING,
                }),
                enabled: "Yes",
                disabled: "No",
              });

              if (pull) {
                task.output = t("task.prerequisites.executingPull");
                await git.pull();
              } else {
                throw new PrerequisitesCheckError(
                  t("error.prerequisites.outdatedPull"),
                );
              }
            }
          },
        },
        {
          title: t("task.prerequisites.checkWorkingTree"),
          run: async (ctx, task) => {
            if (await git.status()) {
              task.output = t("task.prerequisites.workingTreeDirty");

              if (!ctx.runtime.promptEnabled) {
                throw new PrerequisitesCheckError(
                  t("error.prerequisites.workingTreeDirty"),
                );
              }

              const accepted = await task.prompt().run<boolean>({
                type: "toggle",
                message: t("task.prerequisites.workingTreePrompt", {
                  warning: ui.labels.WARNING,
                }),
                enabled: "Yes",
                disabled: "No",
              });
              if (!accepted) {
                throw new PrerequisitesCheckError(
                  t("error.prerequisites.workingTreeDirty"),
                );
              }

              ctx.runtime.cleanWorkingTree = false;
              return;
            }

            ctx.runtime.cleanWorkingTree = true;
          },
        },
        {
          title: t("task.prerequisites.checkCommits"),
          run: async (_ctx, task) => {
            const latestTag = await git.latestTag();

            if (!latestTag) {
              task.title += t("task.prerequisites.tagNotPushed");
              return;
            }

            if ((await git.commits(latestTag, "HEAD")).length > 0) return;

            if (!ctx.runtime.promptEnabled) {
              throw new PrerequisitesCheckError(
                t("error.prerequisites.noCommits"),
              );
            }

            const accepted = await task.prompt().run<boolean>({
              type: "toggle",
              message: t("task.prerequisites.noCommitsPrompt", {
                warning: ui.labels.WARNING,
              }),
              enabled: "Yes",
              disabled: "No",
            });
            if (!accepted) {
              throw new PrerequisitesCheckError(
                t("error.prerequisites.noCommits"),
              );
            }
          },
        },
        ...ctx.runtime.pluginRunner
          .collectChecks(ctx, "prerequisites")
          .map<ReleaseOperation>((check) => ({
            title: check.title,
            run: async (ctx, task) => {
              await check.task(ctx, wrapTaskContext(task));
            },
          })),
      ]);
    },
  };
}

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

export function createRequiredConditionsCheckOperation(
  skip?: ReleaseOperation["skip"],
): ReleaseOperation {
  return {
    skip,
    title: t("task.conditions.title"),
    run: async (ctx, operation) => {
      await operation.runOperations(
        [
          createRegistryPingOperation(),
          createScriptCheckOperation(),
          createGitVersionCheckOperation(),
          createRegistryAvailabilityOperation(),
          ...ctx.runtime.pluginRunner
            .collectChecks(ctx, "conditions")
            .map<ReleaseOperation>((check) => ({
              title: check.title,
              run: async (ctx, task) => {
                await check.task(ctx, wrapTaskContext(task));
              },
            })),
          createTagCollisionCheckOperation(),
        ],
        { concurrent: true },
      );
    },
  };
}

function createRegistryPingOperation(): ReleaseOperation {
  return {
    title: t("task.conditions.pingRegistries"),
    run: async (ctx, parentTask) => {
      await parentTask.runOperations(
        collectEcosystemRegistryGroups(ctx.config).map<ReleaseOperation>(
          (group) => ({
            title: ecosystemLabel(group.ecosystem),
            run: async (_ctx, ecosystemTask) => {
              await ecosystemTask.runOperations(
                group.registries.map<ReleaseOperation>(({ registry }) => ({
                  title: t("task.conditions.pingRegistry", {
                    registry: registryLabel(registry),
                  }),
                  run: async () => {
                    const connector = getConnector(registry);
                    await connector.ping();
                  },
                })),
                { concurrent: true },
              );
            },
          }),
        ),
        { concurrent: true },
      );
    },
  };
}

function createScriptCheckOperation(): ReleaseOperation {
  return {
    title: t("task.conditions.checkScripts"),
    skip: (ctx) => !!ctx.options.skipTests && !!ctx.options.skipBuild,
    run: async (ctx) => {
      const errors: string[] = [];
      const jsWorkspaceTypes = new Set(["pnpm", "npm", "yarn", "bun", "deno"]);
      const workspaces = detectWorkspace(ctx.cwd);
      const byEcosystem = new Map<string, ResolvedPackageConfig[]>();

      for (const pkg of ctx.config.packages) {
        const key = pkg.ecosystem ?? "js";
        const packages = byEcosystem.get(key) ?? [];
        packages.push(pkg);
        byEcosystem.set(key, packages);
      }

      for (const [ecosystemKey, packages] of byEcosystem) {
        const descriptor = ecosystemCatalog.get(ecosystemKey);
        if (!descriptor) continue;

        const hasWorkspace =
          ecosystemKey === "js"
            ? workspaces.some((workspace) =>
                jsWorkspaceTypes.has(workspace.type),
              )
            : ecosystemKey === "rust"
              ? workspaces.some((workspace) => workspace.type === "cargo")
              : false;
        const ecoConfig = ctx.config.ecosystems?.[ecosystemKey];
        let testGroupValidated = false;
        let buildGroupValidated = false;

        for (const pkg of packages) {
          if (!ctx.options.skipTests) {
            const hasCommand = pkg.testCommand ?? ecoConfig?.testCommand;
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

              if (!hasWorkspace || isPackageOverride || !testGroupValidated) {
                const instance = new descriptor.ecosystemClass(validateCwd);
                const error = await instance.validateScript(script, "test");
                if (error) errors.push(error);
                if (hasWorkspace && !isPackageOverride)
                  testGroupValidated = true;
              }
            }
          }

          if (!ctx.options.skipBuild) {
            const hasCommand = pkg.buildCommand ?? ecoConfig?.buildCommand;
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

              if (!hasWorkspace || isPackageOverride || !buildGroupValidated) {
                const instance = new descriptor.ecosystemClass(validateCwd);
                const error = await instance.validateScript(script, "build");
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
  };
}

function createGitVersionCheckOperation(): ReleaseOperation {
  return {
    title: t("task.conditions.checkGitVersion"),
    run: async () => {
      const git = new Git();
      validateEngineVersion("git", `${await git.version()}`);
    },
  };
}

function createRegistryAvailabilityOperation(): ReleaseOperation {
  return {
    title: t("task.conditions.checkRegistries"),
    run: async (ctx, parentTask) => {
      await parentTask.runOperations(
        collectEcosystemRegistryGroups(ctx.config).map<ReleaseOperation>(
          (group) => ({
            title: ecosystemLabel(group.ecosystem),
            run: async (_ctx, ecosystemTask) => {
              await ecosystemTask.runOperations(
                group.registries.map(({ registry, packageKeys }) =>
                  createAvailabilityOperation(registry, packageKeys),
                ),
                { concurrent: true },
              );
            },
          }),
        ),
        { concurrent: true },
      );
    },
  };
}

function createAvailabilityOperation(
  registryKey: string,
  packageKeys: string[],
): ReleaseOperation {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) {
    return {
      title: registryKey,
      run: async () => {
        throw new RequiredConditionCheckError(
          `No registry descriptor registered for ${registryKey}`,
        );
      },
    };
  }

  if (packageKeys.length <= 1) {
    return {
      title: t("task.conditions.checkAvailability", {
        label: descriptor.label,
      }),
      run: async (ctx, task) => {
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
    run: async (_ctx, parentTask) => {
      await parentTask.runOperations(
        packageKeys.map<ReleaseOperation>((key) => ({
          title: pathFromKey(key),
          run: async (ctx, task) => {
            const registry = await descriptor.factory(pathFromKey(key));
            await registry.checkAvailability(task, ctx);
          },
        })),
        { concurrent: true },
      );
    },
  };
}

function createTagCollisionCheckOperation(): ReleaseOperation {
  return {
    title: t("task.conditions.checkTagCollisions"),
    skip: (ctx) =>
      ctx.config.versioning !== "independent" ||
      !!ctx.config.registryQualifiedTags,
    run: async (ctx, task) => {
      const collisions = detectTagNameCollisions(ctx.config.packages);
      if (collisions.length === 0) return;

      const names = collisions.join(", ");
      if (ctx.runtime.promptEnabled) {
        const useQualified = await task.prompt().run<boolean>({
          type: "toggle",
          message: t("task.conditions.tagCollisionPrompt", { names }),
          enabled: "Yes",
          disabled: "No",
        });
        if (useQualified) {
          ctx.runtime.registryQualifiedTags = true;
          return;
        }
      }

      throw new RequiredConditionCheckError(
        t("error.conditions.tagCollision", { names }),
      );
    },
  };
}
