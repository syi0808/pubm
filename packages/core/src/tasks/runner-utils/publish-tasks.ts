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
  packagePath: string,
): ListrTask<PubmContext> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor?.taskFactory?.createPublishTask) {
    throw new Error(
      `No publish task factory registered for registry "${registryKey}". Cannot publish "${packagePath}".`,
    );
  }
  return descriptor.taskFactory.createPublishTask(packagePath);
}

export async function collectPublishTasks(ctx: PubmContext) {
  const groups = collectEcosystemRegistryGroups(ctx.config);

  const ecosystemTasks = await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packagePaths }) => {
          const descriptor = registryCatalog.get(registry);

          const paths = descriptor?.orderPackages
            ? await descriptor.orderPackages(packagePaths)
            : packagePaths;

          const label = descriptor
            ? `Running ${descriptor.label} publish`
            : `Running ${registry} publish`;

          return {
            title: label,
            task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
              task.newListr(
                paths.map((p) => createPublishTaskForPath(registry, p)),
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
  packagePath: string,
  siblingPaths?: string[],
): ListrTask<PubmContext> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor?.taskFactory?.createDryRunTask) {
    throw new Error(
      `No dry-run task factory registered for registry "${registryKey}". Cannot dry-run publish "${packagePath}".`,
    );
  }
  return descriptor.taskFactory.createDryRunTask(packagePath, siblingPaths);
}

export async function collectDryRunPublishTasks(ctx: PubmContext) {
  const groups = collectEcosystemRegistryGroups(ctx.config);

  return await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packagePaths }) => {
          const descriptor = registryCatalog.get(registry);

          const paths = descriptor?.orderPackages
            ? await descriptor.orderPackages(packagePaths)
            : packagePaths;

          // For non-concurrent registries with multiple packages, pass sibling paths
          let siblingPaths: string[] | undefined;
          if (!descriptor?.concurrentPublish && packagePaths.length > 1) {
            siblingPaths = packagePaths;
          }

          const concurrent = descriptor?.concurrentPublish ?? true;
          const label = descriptor
            ? `Dry-run ${descriptor.label} publish${concurrent ? "" : " (sequential)"}`
            : `Dry-run ${registry} publish`;

          return {
            title: label,
            task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
              task.newListr(
                paths.map((p) =>
                  createDryRunTaskForPath(registry, p, siblingPaths),
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
