import type { Task, TaskRunner } from "@pubm/runner";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";
import { t } from "../i18n/index.js";
import { wrapTaskContext } from "../plugin/wrap-task-context.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { ui } from "../utils/ui.js";

class PrerequisitesCheckError extends AbstractError {
  name = t("error.prerequisites.name");

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export const prerequisitesCheckTask = (
  options?: Omit<Task<PubmContext>, "title" | "task">,
): TaskRunner<PubmContext> => {
  const git = new Git();
  const taskDef: Task<PubmContext> = {
    ...options,
    exitOnError: true,
    title: t("task.prerequisites.title"),
    task: (ctx, parentTask) =>
      parentTask.newListr([
        {
          skip: (ctx) => !!ctx.options.anyBranch,
          title: t("task.prerequisites.verifyBranch"),
          task: async (ctx, task): Promise<void> => {
            if ((await git.branch()) !== ctx.options.branch) {
              const swtichBranch = await task.prompt().run<boolean>({
                type: "toggle",
                message: t("task.prerequisites.switchBranchPrompt", {
                  warning: ui.labels.WARNING,
                  branch: ctx.options.branch,
                }),
                enabled: "Yes",
                disabled: "No",
              });

              if (swtichBranch) {
                task.output = t("task.prerequisites.switchingBranch", {
                  branch: ctx.options.branch,
                });
                await git.switch(ctx.options.branch);
              } else {
                throw new PrerequisitesCheckError(
                  t("error.prerequisites.wrongBranch"),
                );
              }
            }
          },
        },
        {
          title: t("task.prerequisites.checkRemote"),
          task: async (_, task): Promise<void> => {
            task.output = t("task.prerequisites.checkingFetch");

            if ((await git.dryFetch()).trim()) {
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
          task: async (ctx, task): Promise<void> => {
            if (await git.status()) {
              task.output = t("task.prerequisites.workingTreeDirty");

              if (
                !(await task.prompt().run<boolean>({
                  type: "toggle",
                  message: t("task.prerequisites.workingTreePrompt", {
                    warning: ui.labels.WARNING,
                  }),
                  enabled: "Yes",
                  disabled: "No",
                }))
              ) {
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
          task: async (_, task) => {
            const latestTag = await git.latestTag();

            if (!latestTag) {
              task.title += t("task.prerequisites.tagNotPushed");
              return void 0;
            }

            if ((await git.commits(latestTag, "HEAD")).length <= 0) {
              if (
                !(await task.prompt().run<boolean>({
                  type: "toggle",
                  message: t("task.prerequisites.noCommitsPrompt", {
                    warning: ui.labels.WARNING,
                  }),
                  enabled: "Yes",
                  disabled: "No",
                }))
              ) {
                throw new PrerequisitesCheckError(
                  t("error.prerequisites.noCommits"),
                );
              }
            }
          },
        },
        // Append plugin prerequisite checks
        ...ctx.runtime.pluginRunner
          .collectChecks(ctx, "prerequisites")
          .map((check) => ({
            title: check.title,
            // biome-ignore lint/suspicious/noExplicitAny: runner task context type is complex
            task: async (ctx: PubmContext, task: any) => {
              await check.task(ctx, wrapTaskContext(task));
            },
          })),
      ]),
  };

  if (isCI) {
    return createListr(taskDef, createCiListrOptions<PubmContext>());
  }

  return createListr(taskDef);
};
