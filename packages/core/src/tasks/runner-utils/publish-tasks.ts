import type { ListrRenderer, ListrTask, ListrTaskWrapper } from "listr2";
import type { PubmContext } from "../../context.js";
import { registryCatalog } from "../../registry/catalog.js";
import { collectEcosystemRegistryGroups, ecosystemLabel } from "../grouping.js";

export type NewListrParentTask<Context extends object> = ListrTaskWrapper<
  Context,
  typeof ListrRenderer,
  typeof ListrRenderer
>;

export function createPublishTaskForPath(
  registryKey: string,
  packageKey: string,
): ListrTask<PubmContext> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor?.taskFactory?.createPublishTask) {
    throw new Error(
      `No publish task factory registered for registry "${registryKey}". Cannot publish "${packageKey}".`,
    );
  }
  return descriptor.taskFactory.createPublishTask(packageKey);
}

export async function collectPublishTasks(ctx: PubmContext) {
  const groups = collectEcosystemRegistryGroups(ctx.config);

  const ecosystemTasks = await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
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
            task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
              task.newListr(
                keys.map((k) => createPublishTaskForPath(registry, k)),
                { concurrent: descriptor?.concurrentPublish ?? true },
              ),
          };
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
          task.newListr(registryTasks, { concurrent: true }),
      };
    }),
  );

  return ecosystemTasks;
}

export function createDryRunTaskForPath(
  registryKey: string,
  packageKey: string,
  siblingKeys?: string[],
): ListrTask<PubmContext> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor?.taskFactory?.createDryRunTask) {
    throw new Error(
      `No dry-run task factory registered for registry "${registryKey}". Cannot dry-run publish "${packageKey}".`,
    );
  }
  return descriptor.taskFactory.createDryRunTask(packageKey, siblingKeys);
}

export async function collectDryRunPublishTasks(ctx: PubmContext) {
  const groups = collectEcosystemRegistryGroups(ctx.config);

  return await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packageKeys }) => {
          const descriptor = registryCatalog.get(registry);

          const keys = descriptor?.orderPackages
            ? await descriptor.orderPackages(packageKeys)
            : packageKeys;

          // For non-concurrent registries with multiple packages, pass sibling keys
          let siblingKeys: string[] | undefined;
          if (!descriptor?.concurrentPublish && packageKeys.length > 1) {
            siblingKeys = packageKeys;
          }

          const concurrent = descriptor?.concurrentPublish ?? true;
          const label = descriptor
            ? `Dry-run ${descriptor.label} publish${concurrent ? "" : " (sequential)"}`
            : `Dry-run ${registry} publish`;

          return {
            title: label,
            task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
              task.newListr(
                keys.map((k) =>
                  createDryRunTaskForPath(registry, k, siblingKeys),
                ),
                { concurrent },
              ),
          };
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
          task.newListr(registryTasks, { concurrent: true }),
      };
    }),
  );
}
