import path from "node:path";
import process from "node:process";
import type { PubmContext } from "../../context.js";
import { ecosystemCatalog } from "../../ecosystem/catalog.js";
import { t } from "../../i18n/index.js";
import { restoreManifests } from "../../monorepo/resolve-workspace.js";
import { registryCatalog } from "../../registry/catalog.js";
import {
  collectEcosystemRegistryGroups,
  countRegistryTargets,
  ecosystemLabel,
} from "../../tasks/grouping.js";
import { createRegistryDryRunOperation } from "../registry-operations.js";
import type { ReleaseOperation } from "../release-operation.js";
import {
  applyVersionsForDryRun,
  resolveWorkspaceProtocols,
} from "../release-utils/manifest-handling.js";
import { formatRegistryGroupSummary } from "../release-utils/output-formatting.js";
import { writeVersions } from "../release-utils/write-versions.js";

export function createDryRunOperations(
  dryRun: boolean,
  validatePreparePhase: boolean,
  skipDryRun: boolean,
): ReleaseOperation[] {
  const shouldValidatePublishability = dryRun || validatePreparePhase;

  return [
    {
      enabled: !skipDryRun && shouldValidatePublishability,
      title: t("task.dryRunValidation.title"),
      run: async (ctx, parentTask): Promise<void> => {
        await resolveWorkspaceProtocols(ctx);
        await applyVersionsForDryRun(ctx);

        const dryRunOperations = await collectDryRunPublishOperations(ctx);
        parentTask.title = t("task.dryRunValidation.titleWithTargets", {
          count: countRegistryTargets(
            collectEcosystemRegistryGroups(ctx.config),
          ),
        });
        parentTask.output = formatRegistryGroupSummary(
          t("task.dryRunValidation.concurrent"),
          ctx,
        );

        await parentTask.runOperations(dryRunOperations, {
          concurrent: true,
        });
      },
    },
    {
      enabled: !skipDryRun && shouldValidatePublishability,
      skip: (ctx) => !ctx.runtime.workspaceBackups?.size,
      title: t("task.dryRunValidation.restoreProtocols"),
      run: async (ctx) => {
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
      enabled: !skipDryRun && dryRun,
      skip: (ctx) => !ctx.runtime.dryRunVersionBackup?.size,
      title: t("task.dryRunValidation.restoringVersions"),
      run: async (ctx): Promise<void> => {
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

async function collectDryRunPublishOperations(
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

          const siblingKeys =
            !descriptor?.concurrentPublish && packageKeys.length > 1
              ? packageKeys
              : undefined;
          const concurrent = descriptor?.concurrentPublish ?? true;
          const label = descriptor
            ? `Dry-run ${descriptor.label} publish${concurrent ? "" : " (sequential)"}`
            : `Dry-run ${registry} publish`;

          return {
            title: label,
            run: async (_ctx, operation) => {
              await operation.runOperations(
                keys.map((key) =>
                  createRegistryDryRunOperation(registry, key, siblingKeys),
                ),
                { concurrent },
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
