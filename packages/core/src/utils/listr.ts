import {
  createCiRunnerOptions,
  createTaskRunner,
  type RuntimeTask,
  type Task,
  type TaskRunner,
  type TaskRunnerOptions,
} from "@pubm/runner";

type PubmTask<Context extends object> = Task<Context> | Task<Context>[];
type PubmRunnerOptions<Context extends object> = TaskRunnerOptions<Context>;

export function createCiListrOptions<Context extends object>(
  options: Partial<PubmRunnerOptions<Context>> = {},
): PubmRunnerOptions<Context> {
  return createCiRunnerOptions(options);
}

export function createListr<Context extends object>(
  task: PubmTask<Context>,
  options?: PubmRunnerOptions<Context>,
  parentTask?: RuntimeTask<Context>,
): TaskRunner<Context> {
  return createTaskRunner(task, options, parentTask);
}

export type {
  Task as PubmTask,
  TaskContext as PubmTaskContext,
} from "@pubm/runner";
