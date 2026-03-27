import type { ListrTask } from "listr2";
import type { PubmContext } from "../context.js";

/**
 * Abstraction layer for listr2 task creation per registry.
 * Separates orchestration concerns (listr2 tasks) from registry metadata
 * and publish operations (PackageRegistry).
 */
export interface RegistryTaskFactory {
  createPublishTask(packagePath: string): ListrTask<PubmContext>;
  createDryRunTask(
    packagePath: string,
    siblingPaths?: string[],
  ): ListrTask<PubmContext>;
}
