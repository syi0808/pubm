import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { Listr, ListrTask } from "listr2";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";
import { wrapTaskContext } from "../plugin/wrap-task-context.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { ui } from "../utils/ui.js";

class PrerequisitesCheckError extends AbstractError {
  name = "Failed prerequisite check";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export const prerequisitesCheckTask = (
  options?: Omit<ListrTask<PubmContext>, "title" | "task">,
): Listr<PubmContext> => {
  const git = new Git();
  const taskDef: ListrTask<PubmContext> = {
    ...options,
    exitOnError: true,
    title: "Prerequisites check (for deployment reliability)",
    task: (ctx, parentTask) =>
      parentTask.newListr([
        {
          skip: (ctx) => !!ctx.options.anyBranch,
          title: "Verifying current branch is a release branch",
          task: async (ctx, task): Promise<void> => {
            if ((await git.branch()) !== ctx.options.branch) {
              const swtichBranch = await task
                .prompt(ListrEnquirerPromptAdapter)
                .run<boolean>({
                  type: "toggle",
                  message: `${ui.labels.WARNING} The current HEAD branch is not the release target branch. Do you want to switch branch to ${ctx.options.branch}?`,
                  enabled: "Yes",
                  disabled: "No",
                });

              if (swtichBranch) {
                task.output = `Switching branch to ${ctx.options.branch}...`;
                await git.switch(ctx.options.branch);
              } else {
                throw new PrerequisitesCheckError(
                  "The current HEAD branch is not the release target branch. Please switch to the correct branch before proceeding.",
                );
              }
            }
          },
        },
        {
          title: "Checking if remote history is clean",
          task: async (_, task): Promise<void> => {
            task.output = "Checking for updates with `git fetch`";

            if ((await git.dryFetch()).trim()) {
              const fetch = await task
                .prompt(ListrEnquirerPromptAdapter)
                .run<boolean>({
                  type: "toggle",
                  message: `${ui.labels.WARNING} Local history is outdated. Do you want to run \`git fetch\`?`,
                  enabled: "Yes",
                  disabled: "No",
                });

              if (fetch) {
                task.output = "Executing `git fetch` command...";
                await git.fetch();
              } else {
                throw new PrerequisitesCheckError(
                  "Local history is outdated. Please run `git fetch` to update.",
                );
              }
            }

            task.output = "Checking for updates with `git pull`";
            if (await git.revisionDiffsCount()) {
              const pull = await task
                .prompt(ListrEnquirerPromptAdapter)
                .run<boolean>({
                  type: "toggle",
                  message: `${ui.labels.WARNING} Local history is outdated. Do you want to run \`git pull\`?`,
                  enabled: "Yes",
                  disabled: "No",
                });

              if (pull) {
                task.output = "Executing `git pull` command...";
                await git.pull();
              } else {
                throw new PrerequisitesCheckError(
                  "Local history is outdated. Please run `git pull` to synchronize with the remote repository.",
                );
              }
            }
          },
        },
        {
          title: "Checking if the local working tree is clean",
          task: async (ctx, task): Promise<void> => {
            if (await git.status()) {
              task.output = "Local working tree is not clean.";

              if (
                !(await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
                  type: "toggle",
                  message: `${ui.labels.WARNING} Local working tree is not clean. Do you want to skip?`,
                  enabled: "Yes",
                  disabled: "No",
                }))
              ) {
                throw new PrerequisitesCheckError(
                  "Local working tree is not clean. Please commit or stash your changes before proceeding.",
                );
              }

              ctx.runtime.cleanWorkingTree = false;
              return;
            }

            ctx.runtime.cleanWorkingTree = true;
          },
        },
        {
          title: "Checking if commits exist since the last release",
          task: async (_, task) => {
            const latestTag = await git.latestTag();

            if (!latestTag) {
              task.title += " (Tag has not been pushed to GitHub)";
              return void 0;
            }

            if ((await git.commits(latestTag, "HEAD")).length <= 0) {
              if (
                !(await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
                  type: "toggle",
                  message: `${ui.labels.WARNING} No commits exist from the latest tag. Do you want to skip?`,
                  enabled: "Yes",
                  disabled: "No",
                }))
              ) {
                throw new PrerequisitesCheckError(
                  "No commits exist from the latest tag. Please ensure there are new changes before publishing.",
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
            // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
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
