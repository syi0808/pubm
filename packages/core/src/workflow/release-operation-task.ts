import type { Task, TaskContext, TaskRunnerOptions } from "@pubm/runner";
import type { PubmContext } from "../context.js";
import type {
  ReleaseOperation,
  ReleaseOperationContext,
  ReleaseOperationRunnerOptions,
} from "./release-operation.js";
import type { WorkflowOperationRunner } from "./types.js";

function operationList(
  operations: ReleaseOperation | readonly ReleaseOperation[],
): ReleaseOperation[] {
  return Array.isArray(operations)
    ? [...(operations as readonly ReleaseOperation[])]
    : [operations as ReleaseOperation];
}

function createRunnerOperationContext(
  ctx: PubmContext,
  task: TaskContext<PubmContext>,
): ReleaseOperationContext {
  return {
    get title(): string {
      return task.title;
    },
    set title(value: string) {
      task.title = value;
    },
    get output(): string {
      return task.output;
    },
    set output(value: string) {
      task.output = value;
    },
    prompt: () => task.prompt(),
    runOperations: async (operations, options) => {
      await task
        .newListr(createReleaseOperationTasks(operations), {
          concurrent: options?.concurrent,
        })
        .run(ctx);
    },
    runTasks: async (tasks, options) => {
      await task
        .newListr(
          tasks as unknown as Task<PubmContext> | Task<PubmContext>[],
          options as TaskRunnerOptions<PubmContext>,
        )
        .run(ctx);
    },
    skip: (message?: string) => {
      task.skip(message);
    },
  };
}

export async function runReleaseOperationWithTask(
  ctx: PubmContext,
  operation: ReleaseOperation,
  task: TaskContext<PubmContext>,
): Promise<void> {
  await operation.run?.(ctx, createRunnerOperationContext(ctx, task));
}

export function createReleaseOperationTasks(
  operations: ReleaseOperation | readonly ReleaseOperation[],
): Task<PubmContext>[] {
  return operationList(operations).map((operation) => ({
    title: operation.title,
    enabled: operation.enabled,
    skip: operation.skip,
    task: async (ctx, task) => {
      await runReleaseOperationWithTask(ctx, operation, task);
    },
  }));
}

export function createReleaseOperationRunner(
  task: TaskContext<PubmContext>,
): WorkflowOperationRunner {
  return {
    run: async (ctx, operations, options) => {
      await task
        .newListr(createReleaseOperationTasks(operations), {
          concurrent: options?.concurrent,
        })
        .run(ctx);
    },
  };
}

export function createRootReleaseOperationRunner(
  runTasks: (
    tasks: Task<PubmContext>[],
    options?: ReleaseOperationRunnerOptions,
  ) => Promise<void>,
): WorkflowOperationRunner {
  return {
    run: async (_ctx, operations, options) => {
      await runTasks(createReleaseOperationTasks(operations), options);
    },
  };
}
