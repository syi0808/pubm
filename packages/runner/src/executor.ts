import { EventSource } from "./event-source.js";
import { ClackPromptProvider } from "./prompts.js";
import {
  CiRenderer,
  DefaultRenderer,
  SilentRenderer,
  SimpleRenderer,
  TestRenderer,
  VerboseRenderer,
} from "./renderer.js";
import { RuntimeTask } from "./runtime-task.js";
import { ProcessSignalController } from "./signal.js";
import { InMemorySingleFlightRegistry } from "./single-flight.js";
import { splat } from "./text.js";
import type {
  ObservableLike,
  PromptOptions,
  PromptOutputCapture,
  PromptProvider,
  ReadableLike,
  RendererValue,
  RuntimeTaskSnapshot,
  SignalController,
  SingleFlightRegistry,
  Task,
  TaskContext,
  TaskEvent,
  TaskRenderer,
  TaskRendererFactory,
  TaskRunError,
  TaskRunner,
  TaskRunnerOptions,
  TaskRunResult,
  WorkflowEventSink,
} from "./types.js";

interface ParentTaskRef {
  path: string[];
  setSubtasks(tasks: Array<{ snapshot(): RuntimeTaskSnapshot }>): void;
}

interface SharedRunnerState {
  source: EventSource;
  singleFlight: SingleFlightRegistry;
  promptProvider: PromptProvider;
  promptCoordinator: PromptCoordinator;
  renderer: TaskRenderer;
}

class SkipSignal extends Error {
  constructor() {
    super("Task skipped.");
  }
}

class RunnerSink implements WorkflowEventSink {
  constructor(
    private readonly source: EventSource,
    private readonly sinks: WorkflowEventSink[],
  ) {}

  emit(event: TaskEvent): void {
    this.source.emit(event);
    for (const sink of this.sinks) {
      sink.emit(event);
    }
  }
}

class PromptCoordinator {
  private tail: Promise<unknown> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

class ContextWrapper<Context extends object> implements TaskContext<Context> {
  private promptActive = false;

  constructor(
    private readonly runner: PubmTaskRunner<Context>,
    private readonly runtimeTask: RuntimeTask<Context>,
  ) {}

  get title(): string {
    return this.runtimeTask.title ?? "";
  }

  set title(value: string) {
    this.runtimeTask.setTitle(value);
  }

  get output(): string {
    return this.runtimeTask.output ?? "";
  }

  set output(value: string) {
    this.runtimeTask.setOutput(value);
  }

  get promptOutput(): string {
    return this.runtimeTask.promptOutput ?? "";
  }

  set promptOutput(value: string) {
    this.runtimeTask.setPromptOutput(value);
  }

  get task(): RuntimeTaskSnapshot {
    return this.runtimeTask.snapshot();
  }

  skip(message?: string, ...metadata: unknown[]): void {
    if (message) {
      this.runtimeTask.setMessage({ skip: splat(message, ...metadata) });
    }
    this.runtimeTask.setState("skipped");
    throw new SkipSignal();
  }

  newTaskRunner<NewContext extends object = Context>(
    tasks:
      | Task<NewContext>
      | Task<NewContext>[]
      | ((parent: Omit<this, "skip">) => Task<NewContext> | Task<NewContext>[]),
    options?: TaskRunnerOptions<NewContext>,
  ): TaskRunner<NewContext> {
    const resolvedTasks =
      typeof tasks === "function" ? tasks(this as Omit<this, "skip">) : tasks;
    return this.runner.child(resolvedTasks, options, this.runtimeTask);
  }

  newListr<NewContext extends object = Context>(
    tasks:
      | Task<NewContext>
      | Task<NewContext>[]
      | ((parent: Omit<this, "skip">) => Task<NewContext> | Task<NewContext>[]),
    options?: TaskRunnerOptions<NewContext>,
  ): TaskRunner<NewContext> {
    return this.newTaskRunner(tasks, options);
  }

  prompt(_adapter?: unknown) {
    return {
      run: async <T = unknown>(options: PromptOptions): Promise<T> => {
        if (this.promptActive) {
          throw new Error(
            "There is already an active prompt attached to this task.",
          );
        }

        this.promptActive = true;
        try {
          return await this.runner.runPrompt<T>(this.runtimeTask, options);
        } finally {
          this.promptActive = false;
        }
      },
    };
  }

  singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
    return this.runner.singleFlight.run(key, run);
  }

  emit(event: Omit<TaskEvent, "task">): void {
    this.runner.emit({ ...event, task: this.runtimeTask.snapshot() });
  }

  report(error: Error, type?: string): void {
    this.runtimeTask.setMessage({
      error: error.message,
      ...(type ? { type } : {}),
    });
  }

  isRetrying(): { count: number; error?: unknown } {
    return this.runtimeTask.retry;
  }
}

export class PubmTaskRunner<Context extends object = object>
  implements TaskRunner<Context>
{
  readonly promptProvider: PromptProvider;
  readonly singleFlight: SingleFlightRegistry;
  readonly tasks: RuntimeTask<Context>[];
  externalSignalHandler?: (ctx: Context) => void | Promise<void>;

  private readonly source: EventSource;
  private readonly sink: RunnerSink;
  private readonly renderer: TaskRenderer;
  private readonly signalController?: SignalController;
  private readonly promptCoordinator: PromptCoordinator;
  private readonly concurrent: number;
  private interrupted = false;
  private interruptionError?: Error;

  constructor(
    task: Task<Context> | Task<Context>[],
    private readonly options: TaskRunnerOptions<Context> = {},
    private readonly parentTask?: ParentTaskRef,
    shared?: SharedRunnerState,
  ) {
    applyEnvironmentOptions(options);
    this.source = shared?.source ?? new EventSource();
    this.sink = new RunnerSink(this.source, options.eventSinks ?? []);
    this.promptProvider =
      options.promptProvider ??
      shared?.promptProvider ??
      new ClackPromptProvider();
    this.singleFlight =
      options.singleFlight ??
      shared?.singleFlight ??
      new InMemorySingleFlightRegistry();
    this.promptCoordinator =
      shared?.promptCoordinator ?? new PromptCoordinator();
    this.concurrent = normalizeConcurrency(options.concurrent);
    this.renderer = shared?.renderer ?? instantiateRenderer(options);
    this.signalController =
      options.signalController ??
      (options.registerSignalListeners !== true
        ? undefined
        : new ProcessSignalController());
    const taskList = Array.isArray(task) ? task : [task];
    this.tasks = taskList.map((item, index) =>
      this.createRuntimeTask(item, index),
    );
  }

  isRoot(): boolean {
    return !this.parentTask;
  }

  isSubtask(): boolean {
    return !!this.parentTask;
  }

  child<NewContext extends object>(
    tasks: Task<NewContext> | Task<NewContext>[],
    options?: TaskRunnerOptions<NewContext>,
    parentTask?: RuntimeTask<Context>,
  ): PubmTaskRunner<NewContext> {
    return new PubmTaskRunner(
      tasks,
      {
        ...(this.options as unknown as TaskRunnerOptions<NewContext>),
        ...options,
      },
      parentTask,
      {
        source: this.source,
        singleFlight: this.singleFlight,
        promptProvider: this.promptProvider,
        promptCoordinator: this.promptCoordinator,
        renderer: this.renderer,
      },
    );
  }

  add(tasks: Task<Context> | Task<Context>[]): void {
    const taskList = Array.isArray(tasks) ? tasks : [tasks];
    const baseOrder = this.tasks.length;
    this.tasks.push(
      ...taskList.map((item, index) =>
        this.createRuntimeTask(item, baseOrder + index),
      ),
    );
  }

  emit(event: TaskEvent): void {
    this.sink.emit(event);
  }

  async runPrompt<T>(
    runtimeTask: RuntimeTask<Context>,
    options: PromptOptions,
  ): Promise<T> {
    return await this.promptCoordinator.run(async () => {
      const priorState = runtimeTask.state;
      const promptCapture = this.createPromptCapture(runtimeTask, options);
      const providerOptions = promptCapture
        ? { ...options, output: promptCapture.output }
        : options;
      this.emit({
        type: "prompt.started",
        task: runtimeTask.snapshot(),
        prompt: options,
      });
      runtimeTask.setState("prompting");
      try {
        const value = await this.promptProvider.prompt<T>(providerOptions);
        promptCapture?.close();
        runtimeTask.promptOutput = undefined;
        runtimeTask.setState(priorState);
        this.emit({
          type: "prompt.completed",
          task: runtimeTask.snapshot(),
          prompt: options,
        });
        return value;
      } catch (error) {
        promptCapture?.close();
        runtimeTask.promptOutput = undefined;
        runtimeTask.setState("failed");
        this.emit({
          type: "prompt.failed",
          task: runtimeTask.snapshot(),
          prompt: options,
          error,
        });
        throw error;
      }
    });
  }

  private createRuntimeTask(
    task: Task<Context>,
    sortOrder: number,
  ): RuntimeTask<Context> {
    const title = task.title ?? "background task";
    const path = this.parentTask ? [...this.parentTask.path, title] : [title];
    return new RuntimeTask(task, path, this.sink, sortOrder);
  }

  private initialVisibleTasks(): RuntimeTask<Context>[] {
    return this.tasks.filter((task) => {
      const enabled = task.task.enabled;
      return enabled === undefined || enabled === true;
    });
  }

  private createPromptCapture(
    runtimeTask: RuntimeTask<Context>,
    options: PromptOptions,
  ): PromptOutputCapture | undefined {
    if (options.output !== undefined) return undefined;
    return this.renderer.createPromptOutput?.(runtimeTask.snapshot());
  }

  async run(context?: Context): Promise<Context> {
    const ctx = this.options.ctx ?? context ?? ({} as Context);
    const errors: TaskRunError[] = [];

    if (this.isRoot()) {
      await this.renderer.render(this.source);
      this.emit({ type: "run.started" });
      this.emitInitialTasks();
      this.registerSignals(ctx);
    } else if (this.parentTask) {
      this.parentTask.setSubtasks(this.initialVisibleTasks());
    }

    try {
      await this.runTasks(ctx, errors);
      const fatalErrors = errors.filter((error) => !error.nonFatal);
      if (fatalErrors.length > 0 || this.interruptionError) {
        const error =
          fatalErrors[0]?.error ??
          this.interruptionError ??
          new Error("Task run failed.");
        const result: TaskRunResult = { status: "failed", errors };
        this.emit({ type: "run.failed", error });
        if (this.isRoot()) await this.renderer.end(result);
        throw error;
      }
      const result: TaskRunResult = { status: "success", errors };
      if (this.isRoot()) {
        this.emit({ type: "run.completed" });
        await this.renderer.end(result);
      }
      return ctx;
    } finally {
      if (this.isRoot()) this.signalController?.dispose();
    }
  }

  private async runTasks(ctx: Context, errors: TaskRunError[]): Promise<void> {
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(this.concurrent, this.tasks.length) },
      async () => {
        while (
          cursor < this.tasks.length &&
          !this.interrupted &&
          !hasFatalErrors(errors)
        ) {
          const task = this.tasks[cursor++];
          await this.runOne(task, ctx, errors);
        }
      },
    );
    await Promise.all(workers);
  }

  private emitInitialTasks(): void {
    this.emit({
      type: "run.tasks",
      tasks: this.initialVisibleTasks().map((task) => task.snapshot()),
    });
  }

  private async runOne(
    runtimeTask: RuntimeTask<Context>,
    ctx: Context,
    errors: TaskRunError[],
  ): Promise<void> {
    if (hasFatalErrors(errors)) return;

    try {
      const enabled = await valueOrCall(runtimeTask.task.enabled ?? true, ctx);
      runtimeTask.enabled = enabled !== false;
      runtimeTask.emitLegacy("ENABLED", runtimeTask.enabled);
      if (!runtimeTask.enabled) {
        runtimeTask.state = "blocked";
        this.emit({
          type: "task.enabled",
          state: "blocked",
          task: runtimeTask.snapshot(),
        });
        runtimeTask.setState("blocked");
        runtimeTask.close();
        return;
      }

      this.emit({
        type: "task.enabled",
        state: "pending",
        task: runtimeTask.snapshot(),
      });

      runtimeTask.setState("running");

      const skip = await valueOrCall(runtimeTask.task.skip ?? false, ctx);
      if (skip) {
        runtimeTask.setMessage({
          skip:
            typeof skip === "string"
              ? skip
              : (runtimeTask.title ?? "Skipped task without a title."),
        });
        runtimeTask.setState("skipped");
        runtimeTask.close();
        return;
      }

      const wrapper = new ContextWrapper(this, runtimeTask);
      await this.runWithRetry(runtimeTask, ctx, wrapper);

      if (
        runtimeTask.state !== "skipped" &&
        runtimeTask.state !== "failed" &&
        runtimeTask.state !== "rolled-back"
      ) {
        runtimeTask.setState("success");
      }
      runtimeTask.close();
    } catch (error) {
      if (error instanceof SkipSignal) {
        runtimeTask.close();
        return;
      }

      const wrapper = new ContextWrapper(this, runtimeTask);
      try {
        const handled = await this.handleFailure(
          runtimeTask,
          ctx,
          wrapper,
          error,
        );
        runtimeTask.close();
        if (handled === "nonfatal") {
          errors.push({ task: runtimeTask.snapshot(), error, nonFatal: true });
          return;
        }
        errors.push({ task: runtimeTask.snapshot(), error });
      } catch (failureError) {
        runtimeTask.close();
        errors.push({ task: runtimeTask.snapshot(), error: failureError });
      }
    }
  }

  private async runWithRetry(
    runtimeTask: RuntimeTask<Context>,
    ctx: Context,
    wrapper: ContextWrapper<Context>,
  ): Promise<void> {
    const { attempts, delay } = retryOptions(runtimeTask.task.retry);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = runtimeTask.task.task
          ? await runtimeTask.task.task(ctx, wrapper)
          : undefined;
        await handleResult(result, ctx, wrapper);
        return;
      } catch (error) {
        if (error instanceof SkipSignal) throw error;
        if (attempt >= attempts) throw error;
        runtimeTask.retry = { count: attempt, error };
        runtimeTask.setMessage({ retry: runtimeTask.retry });
        runtimeTask.setTitle(
          runtimeTask.initialTitle ?? runtimeTask.title ?? "",
        );
        runtimeTask.output = undefined;
        runtimeTask.setState("retrying");
        if (delay > 0) await sleep(delay);
        runtimeTask.setState("running");
      }
    }
  }

  private async handleFailure(
    runtimeTask: RuntimeTask<Context>,
    ctx: Context,
    wrapper: ContextWrapper<Context>,
    error: unknown,
  ): Promise<"fatal" | "nonfatal"> {
    runtimeTask.setMessage({
      error: error instanceof Error ? error.message : String(error),
    });

    if (runtimeTask.task.rollback) {
      runtimeTask.setState("rolling-back");
      try {
        await runtimeTask.task.rollback(ctx, wrapper);
        runtimeTask.setMessage({
          rollback: runtimeTask.title ?? runtimeTask.initialTitle ?? "rollback",
        });
        runtimeTask.setState("rolled-back");
      } catch (rollbackError) {
        runtimeTask.setMessage({
          error:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        });
        runtimeTask.setState("failed", { error: rollbackError });
        throw rollbackError;
      }

      if (this.options.exitAfterRollback !== false) return "fatal";
      return "nonfatal";
    }

    const exitOnError = await valueOrCall(
      runtimeTask.task.exitOnError ?? this.options.exitOnError ?? true,
      ctx,
    );
    runtimeTask.setState("failed", { error });
    return exitOnError === false ? "nonfatal" : "fatal";
  }

  private registerSignals(ctx: Context): void {
    if (
      this.options.registerSignalListeners === false ||
      !this.signalController
    ) {
      return;
    }
    const handle = async (signal: NodeJS.Signals) => {
      this.interrupted = true;
      this.interruptionError = new Error(`Task run interrupted by ${signal}.`);
      for (const task of this.tasks) {
        if (task.isPending()) task.setState("failed");
      }
      this.emit({ type: "signal.received", signal });
      await this.externalSignalHandler?.(ctx);
    };
    this.signalController.onInterrupt(handle);
    this.signalController.onTerminate(handle);
  }
}

function hasFatalErrors(errors: TaskRunError[]): boolean {
  return errors.some((error) => !error.nonFatal);
}

function normalizeConcurrency(value: boolean | number | undefined): number {
  if (value === true) return Number.POSITIVE_INFINITY;
  if (typeof value === "number" && value > 0) return value;
  return 1;
}

function instantiateRenderer(options: TaskRunnerOptions): TaskRenderer {
  const selection = selectRenderer(options);
  if (isRendererInstance(selection.value)) return selection.value;
  return new selection.value(selection.options);
}

function selectRenderer(options: TaskRunnerOptions): {
  value: TaskRendererFactory | TaskRenderer;
  options?: Record<string, unknown>;
} {
  if (assertBooleanOrCall(options.silentRendererCondition)) {
    return { value: SilentRenderer, options: options.rendererOptions };
  }

  const renderer = rendererClass(options.renderer ?? "default");
  const fallbackRenderer = rendererClass(options.fallbackRenderer ?? "simple");
  if (
    !isRendererSupported(renderer) ||
    assertBooleanOrCall(options.fallbackRendererCondition)
  ) {
    return {
      value: fallbackRenderer,
      options: options.fallbackRendererOptions,
    };
  }

  return { value: renderer, options: options.rendererOptions };
}

function rendererClass(
  value: RendererValue,
): TaskRendererFactory | TaskRenderer {
  if (typeof value !== "string") return value;
  if (value === "silent") return SilentRenderer;
  if (value === "simple") return SimpleRenderer;
  if (value === "verbose") return VerboseRenderer;
  if (value === "test") return TestRenderer;
  return DefaultRenderer;
}

function isRendererSupported(
  value: TaskRendererFactory | TaskRenderer,
): boolean {
  if (isRendererInstance(value)) return true;
  return (
    process.stdout.isTTY === true ||
    process.stderr.isTTY === true ||
    value.nonTTY === true
  );
}

function isRendererInstance(value: unknown): value is TaskRenderer {
  return (
    !!value &&
    typeof value === "object" &&
    "render" in value &&
    typeof value.render === "function" &&
    "end" in value &&
    typeof value.end === "function"
  );
}

function applyEnvironmentOptions(options: TaskRunnerOptions): void {
  if (options.forceUnicode) process.env.FORCE_UNICODE = "1";
  if (
    !options.forceTTY &&
    !truthyEnv(process.env.PUBM_FORCE_TTY) &&
    !truthyEnv(process.env.LISTR_FORCE_TTY)
  ) {
    return;
  }

  try {
    process.stdout.isTTY = true;
    process.stderr.isTTY = true;
  } catch {
    // Some test/runtime streams expose readonly isTTY. Renderer selection simply falls back.
  }
}

function truthyEnv(value: string | undefined): boolean {
  return !!value && value !== "0" && value.toLowerCase() !== "false";
}

function assertBooleanOrCall(
  value: boolean | (() => boolean) | undefined,
): boolean {
  return typeof value === "function" ? value() : value === true;
}

async function valueOrCall<Context extends object, T>(
  value: T | ((ctx: Context) => T | Promise<T>),
  ctx: Context,
): Promise<T> {
  if (typeof value === "function") {
    return await (value as (ctx: Context) => T | Promise<T>)(ctx);
  }
  return value;
}

function retryOptions(retry: Task<never>["retry"]): {
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

async function handleResult<Context extends object>(
  result: unknown,
  ctx: Context,
  wrapper: ContextWrapper<Context>,
): Promise<void> {
  if (isTaskRunner<Context>(result)) {
    await result.run(ctx);
  } else if (typeof result === "string") {
    wrapper.output = result;
  } else if (isReadable(result)) {
    await handleReadable(result, wrapper);
  } else if (isObservable(result)) {
    await handleObservable(result, wrapper);
  }
}

function isTaskRunner<Context extends object>(
  value: unknown,
): value is TaskRunner<Context> {
  return (
    !!value &&
    typeof value === "object" &&
    "run" in value &&
    typeof value.run === "function"
  );
}

function isReadable(value: unknown): value is ReadableLike {
  return (
    !!value &&
    typeof value === "object" &&
    "readable" in value &&
    value.readable === true &&
    "on" in value &&
    typeof value.on === "function"
  );
}

function isObservable(value: unknown): value is ObservableLike<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    "subscribe" in value &&
    typeof value.subscribe === "function"
  );
}

function handleReadable<Context extends object>(
  readable: ReadableLike,
  wrapper: ContextWrapper<Context>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    readable.on("data", (chunk) => {
      wrapper.output = String(chunk);
    });
    readable.on("error", fail);
    readable.on("end", finish);
    readable.on("close", finish);
  });
}

function handleObservable<Context extends object>(
  observable: ObservableLike<unknown>,
  wrapper: ContextWrapper<Context>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    observable.subscribe({
      next(value) {
        wrapper.output = String(value);
      },
      error: reject,
      complete: resolve,
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTaskRunner<Context extends object>(
  task: Task<Context> | Task<Context>[],
  options?: TaskRunnerOptions<Context>,
  parentTask?: ParentTaskRef,
): PubmTaskRunner<Context> {
  return new PubmTaskRunner(task, options, parentTask);
}

export function createCiRunnerOptions<Context extends object>(
  options: Partial<TaskRunnerOptions<Context>> = {},
): TaskRunnerOptions<Context> {
  return {
    ...options,
    renderer: options.renderer ?? CiRenderer,
    fallbackRenderer: options.fallbackRenderer ?? CiRenderer,
    rendererOptions: {
      logTitleChange: true,
      ...options.rendererOptions,
    },
    fallbackRendererOptions: {
      logTitleChange: true,
      ...options.fallbackRendererOptions,
    },
  };
}
