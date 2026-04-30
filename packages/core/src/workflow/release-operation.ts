import type { PubmContext } from "../context.js";
import { type PromptOptions, prompt } from "../utils/prompt.js";

export interface ReleaseOperationRunnerOptions {
  concurrent?: boolean | number;
}

export interface ReleaseOperationContext {
  title: string;
  output: string;
  prompt(): { run<T = unknown>(options: PromptOptions): Promise<T> };
  runOperations(
    operations: ReleaseOperation | readonly ReleaseOperation[],
    options?: ReleaseOperationRunnerOptions,
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
  return {
    title,
    output: "",
    prompt: () => ({
      run: <T = unknown>(options: PromptOptions) => prompt<T>(options),
    }),
    runOperations: (operations, options) =>
      runReleaseOperations(ctx, operations, options),
    skip: (message?: string) => {
      throw new ReleaseOperationSkip(message);
    },
  };
}
