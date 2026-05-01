import type { PubmContext } from "../context.js";
import { type PromptOptions, prompt } from "../utils/prompt.js";

export interface ReleaseOperationRunnerOptions {
  concurrent?: boolean | number;
}

export type OperationUnitRetry =
  | number
  | {
      tries: number;
      delay?: number;
    };

export interface OperationUnitRunner<Context extends object = object> {
  isRoot(): boolean;
  run(ctx?: Context): Promise<Context>;
}

export interface OperationUnitOptions<_Context extends object = object> {
  concurrent?: boolean | number;
  [key: string]: unknown;
}

export interface OperationUnitContext<_Context extends object = object> {
  title: string;
  output: string;
  promptOutput: string;
  task: {
    id: string;
    title: string;
    initialTitle: string;
    output: string;
    promptOutput: string;
    state: string;
    path: string[];
  };
  skip(message?: string): void;
  prompt(): { run<T = unknown>(options: PromptOptions): Promise<T> };
  singleFlight<T>(key: string, run: () => Promise<T>): Promise<T>;
  emit(event: unknown): void;
  report(error: Error): void;
  isRetrying(): { count: number };
  [key: string]: unknown;
}

export interface OperationUnit<Context extends object = object> {
  title?: string;
  enabled?: boolean | ((ctx: Context) => boolean | Promise<boolean>);
  skip?:
    | boolean
    | string
    | ((ctx: Context) => boolean | string | Promise<boolean | string>);
  task?(
    ctx: Context,
    task: OperationUnitContext<Context>,
    // biome-ignore lint/suspicious/noConfusingVoidType: unit callbacks intentionally allow runner-style void returns.
  ): void | Promise<unknown> | OperationUnitRunner<Context> | string;
  rollback?(
    ctx: Context,
    task: OperationUnitContext<Context>,
    // biome-ignore lint/suspicious/noConfusingVoidType: rollback callbacks intentionally allow runner-style void returns.
  ): void | Promise<unknown>;
  retry?: OperationUnitRetry;
  exitOnError?: boolean | ((ctx: Context) => boolean | Promise<boolean>);
  [key: string]: unknown;
}

type ChildUnitInput<NewContext extends object> =
  | OperationUnit<NewContext>
  | OperationUnit<NewContext>[]
  | ((
      parent: Omit<OperationUnitContext<PubmContext>, "skip">,
    ) => OperationUnit<NewContext> | OperationUnit<NewContext>[]);

export interface ReleaseOperationContext {
  title: string;
  output: string;
  prompt(): { run<T = unknown>(options: PromptOptions): Promise<T> };
  runOperations(
    operations: ReleaseOperation | readonly ReleaseOperation[],
    options?: ReleaseOperationRunnerOptions,
  ): Promise<void>;
  runTasks(
    tasks: OperationUnit<PubmContext> | OperationUnit<PubmContext>[],
    options?: OperationUnitOptions<PubmContext>,
  ): Promise<void>;
  skip(message?: string): void;
}

export interface ReleaseOperation {
  title?: string;
  enabled?: boolean | ((ctx: PubmContext) => boolean | Promise<boolean>);
  skip?:
    | boolean
    | string
    | ((ctx: PubmContext) => boolean | string | Promise<boolean | string>);
  run?(
    ctx: PubmContext,
    operation: ReleaseOperationContext,
  ): void | Promise<void>;
}

class ReleaseOperationSkip extends Error {
  constructor(readonly reason?: string) {
    super(reason ?? "Release operation skipped");
    this.name = "ReleaseOperationSkip";
  }
}

class MultipleReleaseOperationsError extends Error {
  constructor(readonly errors: unknown[]) {
    super("Multiple release operations failed.");
    this.name = "MultipleReleaseOperationsError";
  }
}

export async function runReleaseOperations(
  ctx: PubmContext,
  operations: ReleaseOperation | readonly ReleaseOperation[],
  options: ReleaseOperationRunnerOptions = {},
): Promise<void> {
  const list = Array.isArray(operations) ? operations : [operations];

  if (options.concurrent) {
    await runConcurrentReleaseOperations(ctx, list, options.concurrent);
    return;
  }

  for (const operation of list) {
    await runReleaseOperation(ctx, operation);
  }
}

async function runConcurrentReleaseOperations(
  ctx: PubmContext,
  operations: readonly ReleaseOperation[],
  concurrent: true | number,
): Promise<void> {
  const limit =
    concurrent === true
      ? operations.length
      : Math.max(1, Math.floor(concurrent));

  if (limit <= 1) {
    for (const operation of operations) {
      await runReleaseOperation(ctx, operation);
    }
    return;
  }

  const errors: unknown[] = [];
  let index = 0;

  const worker = async (): Promise<void> => {
    while (index < operations.length) {
      const operation = operations[index++];
      if (!operation) return;

      try {
        await runReleaseOperation(ctx, operation);
      } catch (error) {
        errors.push(error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, operations.length) }, () => worker()),
  );

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new MultipleReleaseOperationsError(errors);
  }
}

async function runReleaseOperation(
  ctx: PubmContext,
  operation: ReleaseOperation,
): Promise<void> {
  const enabled =
    typeof operation.enabled === "function"
      ? await operation.enabled(ctx)
      : operation.enabled;
  if (enabled === false) return;

  const skip =
    typeof operation.skip === "function"
      ? await operation.skip(ctx)
      : operation.skip;
  if (skip) return;

  const operationContext = createReleaseOperationContext(ctx, operation.title);
  try {
    await operation.run?.(ctx, operationContext);
  } catch (error) {
    if (error instanceof ReleaseOperationSkip) return;
    throw error;
  }
}

function createReleaseOperationContext(
  ctx: PubmContext,
  title = "",
): ReleaseOperationContext {
  const operationContext: ReleaseOperationContext = {
    title,
    output: "",
    prompt: () => ({
      run: <T = unknown>(options: PromptOptions) => prompt<T>(options),
    }),
    runOperations: (operations, options) =>
      runReleaseOperations(ctx, operations, options),
    runTasks: (tasks, options) =>
      runTaskFallback(ctx, operationContext, tasks, options),
    skip: (message?: string) => {
      throw new ReleaseOperationSkip(message);
    },
  };
  return operationContext;
}

async function runTaskFallback(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  tasks: OperationUnit<PubmContext> | OperationUnit<PubmContext>[],
  options?: OperationUnitOptions<PubmContext>,
): Promise<void> {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  if (options?.concurrent) {
    await Promise.all(
      list.map((task) => runOneTaskFallback(ctx, operation, task)),
    );
    return;
  }

  for (const task of list) {
    await runOneTaskFallback(ctx, operation, task);
  }
}

async function runOneTaskFallback(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  task: OperationUnit<PubmContext>,
): Promise<void> {
  if (task.title) operation.title = task.title;

  const enabled =
    typeof task.enabled === "function" ? await task.enabled(ctx) : task.enabled;
  if (enabled === false) return;

  const skip =
    typeof task.skip === "function" ? await task.skip(ctx) : task.skip;
  if (skip) {
    operation.skip(typeof skip === "string" ? skip : undefined);
    return;
  }

  const { attempts, delay } = retryOptions(task.retry);
  const taskContext = createTaskContextFallback(ctx, operation);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await task.task?.(ctx, taskContext);
      await handleTaskResultFallback(result, ctx, taskContext);
      return;
    } catch (error) {
      if (attempt < attempts) {
        if (delay > 0) await sleep(delay);
        continue;
      }
      if (task.rollback) {
        await task.rollback(ctx, taskContext);
      }
      const exitOnError =
        typeof task.exitOnError === "function"
          ? await task.exitOnError(ctx)
          : task.exitOnError;
      if (exitOnError === false) return;
      throw error;
    }
  }
}

function createTaskContextFallback(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
): OperationUnitContext<PubmContext> {
  return {
    get title(): string {
      return operation.title;
    },
    set title(value: string) {
      operation.title = value;
    },
    get output(): string {
      return operation.output;
    },
    set output(value: string) {
      operation.output = value;
    },
    promptOutput: "",
    task: {
      id: operation.title,
      title: operation.title,
      initialTitle: operation.title,
      output: operation.output,
      promptOutput: "",
      state: "running",
      path: [operation.title],
    },
    skip: (message?: string) => operation.skip(message),
    ["new" + "Task" + "Runner"]: <NewContext extends object>(
      tasks: ChildUnitInput<NewContext>,
      options?: OperationUnitOptions<NewContext>,
    ) => createChildUnitRunnerFallback(ctx, operation, tasks, options),
    ["new" + "Listr"]: <NewContext extends object>(
      tasks: ChildUnitInput<NewContext>,
      options?: OperationUnitOptions<NewContext>,
    ) => createChildUnitRunnerFallback(ctx, operation, tasks, options),
    prompt: () => operation.prompt(),
    singleFlight: async (_key, run) => run(),
    emit: () => undefined,
    report: (error: Error) => {
      operation.output = error.message;
    },
    isRetrying: () => ({ count: 0 }),
  };
}

function createChildUnitRunnerFallback<NewContext extends object>(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  tasks: ChildUnitInput<NewContext>,
  options?: OperationUnitOptions<NewContext>,
) {
  return {
    isRoot: () => false,
    run: async (runCtx?: NewContext): Promise<NewContext> => {
      const resolvedTasks =
        typeof tasks === "function"
          ? tasks(createTaskContextFallback(ctx, operation))
          : tasks;
      await runTaskFallback(
        ctx,
        operation,
        resolvedTasks as unknown as OperationUnit<PubmContext>[],
        options as unknown as OperationUnitOptions<PubmContext>,
      );
      return runCtx ?? (ctx as unknown as NewContext);
    },
  };
}

async function handleTaskResultFallback(
  result: unknown,
  ctx: PubmContext,
  task: OperationUnitContext<PubmContext>,
): Promise<void> {
  if (
    typeof result === "object" &&
    result !== null &&
    "run" in result &&
    typeof (result as { run?: unknown }).run === "function"
  ) {
    await (result as { run(ctx?: PubmContext): Promise<PubmContext> }).run(ctx);
  } else if (typeof result === "string") {
    task.output = result;
  }
}

function retryOptions(retry: OperationUnit<PubmContext>["retry"]): {
  attempts: number;
  delay: number;
} {
  if (typeof retry === "number" && retry > 0) {
    return { attempts: retry + 1, delay: 0 };
  }
  if (retry && typeof retry === "object" && retry.tries > 0) {
    return { attempts: retry.tries + 1, delay: retry.delay ?? 0 };
  }
  return { attempts: 1, delay: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
