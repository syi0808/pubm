import path from "node:path";
import process from "node:process";
import type { Task, TaskRunner } from "@pubm/runner";
import type { PubmContext } from "../../context.js";
import { ecosystemCatalog } from "../../ecosystem/catalog.js";
import { t } from "../../i18n/index.js";
import { restoreManifests } from "../../monorepo/resolve-workspace.js";
import {
  collectEcosystemRegistryGroups,
  countRegistryTargets,
} from "../grouping.js";
import {
  applyVersionsForDryRun,
  resolveWorkspaceProtocols,
} from "../runner-utils/manifest-handling.js";
import { formatRegistryGroupSummary } from "../runner-utils/output-formatting.js";
import { collectDryRunPublishTasks } from "../runner-utils/publish-tasks.js";
import { writeVersions } from "../runner-utils/write-versions.js";

export function createDryRunTasks(
  dryRun: boolean,
  mode: string,
  hasPrepare: boolean,
  skipDryRun: boolean,
): Task<PubmContext>[] {
  return [
    {
      enabled: !skipDryRun && (dryRun || (mode === "ci" && hasPrepare)),
      title: t("task.dryRunValidation.title"),
      task: async (ctx, parentTask): Promise<TaskRunner<PubmContext>> => {
        await resolveWorkspaceProtocols(ctx);
        await applyVersionsForDryRun(ctx);

        const dryRunTasks = await collectDryRunPublishTasks(ctx);
        parentTask.title = t("task.dryRunValidation.titleWithTargets", {
          count: countRegistryTargets(
            collectEcosystemRegistryGroups(ctx.config),
          ),
        });
        parentTask.output = formatRegistryGroupSummary(
          t("task.dryRunValidation.concurrent"),
          ctx,
        );

        return parentTask.newListr(dryRunTasks, {
          concurrent: true,
        });
      },
    },
    {
      enabled: !skipDryRun && (dryRun || (mode === "ci" && hasPrepare)),
      skip: (ctx) => !ctx.runtime.workspaceBackups?.size,
      title: t("task.dryRunValidation.restoreProtocols"),
      task: async (ctx) => {
        const backups = ctx.runtime.workspaceBackups;
        if (!backups) {
          throw new Error("Workspace backups are required for restore.");
        }
        restoreManifests(backups);
        ctx.runtime.workspaceBackups = undefined;

        // Re-sync lockfile to reflect restored workspace:* protocols
        for (const pkg of ctx.config.packages) {
          const absPath = path.resolve(ctx.cwd ?? process.cwd(), pkg.path);
          const descriptor = ecosystemCatalog.get(pkg.ecosystem);
          if (!descriptor) continue;
          const eco = new descriptor.ecosystemClass(absPath);
          await eco.syncLockfile(ctx.config.lockfileSync);
        }
      },
    },
    {
      enabled: dryRun,
      skip: (ctx) => !ctx.runtime.dryRunVersionBackup?.size,
      title: t("task.dryRunValidation.restoringVersions"),
      task: async (ctx): Promise<void> => {
        const backupVersions = ctx.runtime.dryRunVersionBackup;
        if (!backupVersions) {
          throw new Error("Dry-run version backup is required for restore.");
        }
        await writeVersions(ctx, backupVersions);
        ctx.runtime.dryRunVersionBackup = undefined;
      },
    },
  ];
}
