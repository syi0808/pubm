import type { Task } from "@pubm/runner";
import type { PubmContext } from "../context.js";

/**
 * Abstraction layer for runner task creation per registry.
 * Separates orchestration concerns (runner tasks) from registry metadata
 * and publish operations (PackageRegistry).
 */
export interface RegistryTaskFactory {
  createPublishTask(packagePath: string): Task<PubmContext>;
  createDryRunTask(
    packagePath: string,
    siblingPaths?: string[],
  ): Task<PubmContext>;
}
