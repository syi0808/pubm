import type { Listr, ListrTask } from "listr2";
import type { PubmContext } from "../../context.js";
import { t } from "../../i18n/index.js";
import { restoreManifests } from "../../monorepo/resolve-workspace.js";
import { resolveWorkspaceProtocols } from "../runner-utils/manifest-handling.js";
import {
  countPublishTargets,
  formatRegistryGroupSummary,
} from "../runner-utils/output-formatting.js";
import { collectPublishTasks } from "../runner-utils/publish-tasks.js";

export function createPublishTasks(
  hasPublish: boolean,
  dryRun: boolean,
  skipPublish: boolean,
): ListrTask<PubmContext>[] {
  return [
    {
      enabled: hasPublish && !skipPublish && !dryRun,
      title: t("task.publish.title"),
      task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
        parentTask.output = t("task.publish.runningBeforeHooksDetail");
        await ctx.runtime.pluginRunner.runHook("beforePublish", ctx);
        await resolveWorkspaceProtocols(ctx);

        const publishTasks = await collectPublishTasks(ctx);
        parentTask.title = t("task.publish.titleWithTargets", {
          count: countPublishTargets(ctx),
        });
        parentTask.output = formatRegistryGroupSummary(
          t("task.publish.concurrent"),
          ctx,
        );

        return parentTask.newListr(publishTasks, {
          concurrent: true,
        });
      },
    },
    {
      enabled: hasPublish && !skipPublish && !dryRun,
      skip: (ctx) => !ctx.runtime.workspaceBackups?.size,
      title: t("task.publish.restoreProtocols"),
      task: (ctx) => {
        const backups = ctx.runtime.workspaceBackups;
        if (!backups) {
          throw new Error("Workspace backups are required for restore.");
        }
        restoreManifests(backups);
        ctx.runtime.workspaceBackups = undefined;
      },
    },
    {
      enabled: hasPublish && !skipPublish && !dryRun,
      title: t("task.publish.runningAfterHooks"),
      task: async (ctx, task): Promise<void> => {
        task.output = t("task.publish.runningAfterHooksDetail");
        await ctx.runtime.pluginRunner.runHook("afterPublish", ctx);
        task.output = t("task.publish.completedAfterHooks");
      },
    },
  ];
}
