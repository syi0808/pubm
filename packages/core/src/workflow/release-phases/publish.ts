import type { PubmContext } from "../../context.js";
import { t } from "../../i18n/index.js";
import { restoreManifests } from "../../monorepo/resolve-workspace.js";
import { registryCatalog } from "../../registry/catalog.js";
import {
  collectEcosystemRegistryGroups,
  ecosystemLabel,
} from "../../tasks/grouping.js";
import { createRegistryPublishOperation } from "../registry-operations.js";
import type { ReleaseOperation } from "../release-operation.js";
import { resolveWorkspaceProtocols } from "../release-utils/manifest-handling.js";
import {
  countPublishTargets,
  formatRegistryGroupSummary,
} from "../release-utils/output-formatting.js";

export function createPublishOperations(
  hasPublish: boolean,
  dryRun: boolean,
  skipPublish: boolean,
): ReleaseOperation[] {
  return [
    {
      enabled: hasPublish && !skipPublish && !dryRun,
      title: t("task.publish.title"),
      run: async (ctx, parentTask): Promise<void> => {
        parentTask.output = t("task.publish.runningBeforeHooksDetail");
        await ctx.runtime.pluginRunner.runHook("beforePublish", ctx);
        await resolveWorkspaceProtocols(ctx);

        const publishOperations = await collectPublishOperations(ctx);
        parentTask.title = t("task.publish.titleWithTargets", {
          count: countPublishTargets(ctx),
        });
        parentTask.output = formatRegistryGroupSummary(
          t("task.publish.concurrent"),
          ctx,
        );

        await parentTask.runOperations(publishOperations, {
          concurrent: true,
        });
      },
    },
    {
      enabled: hasPublish && !skipPublish && !dryRun,
      skip: (ctx) => !ctx.runtime.workspaceBackups?.size,
      title: t("task.publish.restoreProtocols"),
      run: (ctx) => {
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
      run: async (ctx, task): Promise<void> => {
        task.output = t("task.publish.runningAfterHooksDetail");
        await ctx.runtime.pluginRunner.runHook("afterPublish", ctx);
        task.output = t("task.publish.completedAfterHooks");
      },
    },
  ];
}

export async function collectPublishOperations(
  ctx: PubmContext,
): Promise<ReleaseOperation[]> {
  const groups = collectEcosystemRegistryGroups(ctx.config);

  return await Promise.all(
    groups.map(async (group) => {
      const registryOperations = await Promise.all(
        group.registries.map(async ({ registry, packageKeys }) => {
          const descriptor = registryCatalog.get(registry);

          const keys = descriptor?.orderPackages
            ? await descriptor.orderPackages(packageKeys)
            : packageKeys;

          const label = descriptor
            ? `Running ${descriptor.label} publish`
            : `Running ${registry} publish`;

          return {
            title: label,
            run: async (_ctx, operation) => {
              await operation.runOperations(
                keys.map((key) =>
                  createRegistryPublishOperation(registry, key),
                ),
                { concurrent: descriptor?.concurrentPublish ?? true },
              );
            },
          } satisfies ReleaseOperation;
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        run: async (_ctx, operation) => {
          await operation.runOperations(registryOperations, {
            concurrent: true,
          });
        },
      } satisfies ReleaseOperation;
    }),
  );
}
