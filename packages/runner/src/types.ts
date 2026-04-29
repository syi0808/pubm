export type TaskState =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "blocked"
  | "waiting"
  | "prompting"
  | "retrying"
  | "rolling-back"
  | "rolled-back";

export type TaskMessage = {
  duration?: number;
  error?: string;
  retry?: { count: number; error?: unknown };
  rollback?: string;
  skip?: string;
  [key: string]: unknown;
};

export interface TaskEvent {
  type:
    | "run.started"
    | "run.tasks"
    | "run.completed"
    | "run.failed"
    | "task.enabled"
    | "task.started"
    | "task.completed"
    | "task.failed"
    | "task.skipped"
    | "task.blocked"
    | "task.waiting"
    | "task.prompting"
    | "task.retrying"
    | "task.rolling-back"
    | "task.rolled-back"
    | "task.title"
    | "task.output"
    | "task.prompt-output"
    | "task.message"
    | "task.subtasks"
    | "task.closed"
    | "prompt.started"
    | "prompt.completed"
    | "prompt.failed"
    | "signal.received";
  task?: RuntimeTaskSnapshot;
  tasks?: RuntimeTaskSnapshot[];
  state?: TaskState;
  title?: string;
  output?: string;
  message?: TaskMessage;
  prompt?: PromptOptions;
  signal?: NodeJS.Signals;
  error?: unknown;
}

export interface WorkflowEventSink {
  emit(event: TaskEvent): void;
}

export interface RuntimeTaskSnapshot {
  id: string;
  title?: string;
  initialTitle?: string;
  output?: string;
  promptOutput?: string;
  state: TaskState;
  message?: TaskMessage;
  path: string[];
}

export type TaskPredicate<Context extends object> =
  | boolean
  | string
  | ((ctx: Context) => boolean | string | Promise<boolean | string>);

export type TaskRetry =
  | number
  | {
      tries: number;
      delay?: number;
    };

export interface Task<Context extends object = object> {
  title?: string;
  enabled?: boolean | ((ctx: Context) => boolean | Promise<boolean>);
  skip?: TaskPredicate<Context>;
  task?: (
    ctx: Context,
    task: TaskContext<Context>,
    // biome-ignore lint/suspicious/noConfusingVoidType: task callbacks intentionally allow listr-style void returns.
  ) => void | TaskRunReturn<Context>;
  rollback?: (
    ctx: Context,
    task: TaskContext<Context>,
    // biome-ignore lint/suspicious/noConfusingVoidType: rollback callbacks intentionally allow listr-style void returns.
  ) => void | Promise<unknown>;
  retry?: TaskRetry;
  exitOnError?: boolean | ((ctx: Context) => boolean | Promise<boolean>);
  rendererOptions?: Record<string, unknown>;
  fallbackRendererOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

export type TaskRunReturn<Context extends object> =
  | Promise<unknown>
  | TaskRunner<Context>
  // biome-ignore lint/suspicious/noConfusingVoidType: task functions may complete by returning nothing.
  | void
  | string
  | ReadableLike
  | ObservableLike<unknown>;

export interface ReadableLike {
  readable: boolean;
  read(): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface ObservableLike<T> {
  subscribe(observer: {
    next(value: T): void;
    error(error: unknown): void;
    complete(): void;
  }): unknown;
}

export interface TaskRunResult {
  status: "success" | "failed";
  errors: TaskRunError[];
}

export interface TaskRunError {
  task: RuntimeTaskSnapshot;
  error: unknown;
  nonFatal?: boolean;
}

export interface TaskRunnerOptions<Context extends object = object> {
  concurrent?: boolean | number;
  renderer?: RendererValue;
  rendererOptions?: Record<string, unknown>;
  fallbackRenderer?: RendererValue;
  fallbackRendererOptions?: Record<string, unknown>;
  fallbackRendererCondition?: boolean | (() => boolean);
  silentRendererCondition?: boolean | (() => boolean);
  promptProvider?: PromptProvider;
  signalController?: SignalController;
  eventSinks?: WorkflowEventSink[];
  singleFlight?: SingleFlightRegistry;
  registerSignalListeners?: boolean;
  ctx?: Context;
  exitOnError?: boolean;
  exitAfterRollback?: boolean;
  collectErrors?: boolean;
  forceTTY?: boolean;
  forceUnicode?: boolean;
}

export interface TaskRenderer {
  render(events: TaskEventSource): void | Promise<void>;
  end(result?: TaskRunResult | Error): void | Promise<void>;
  createPromptOutput?(task: RuntimeTaskSnapshot): PromptOutputCapture;
}

export interface PromptOutputCapture {
  output: PromptWritable;
  close(): void;
}

export interface PromptWritable {
  readonly columns?: number;
  readonly rows?: number;
  readonly isTTY?: boolean;
  write(chunk: unknown): unknown;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener?: (...args: unknown[]) => void): this;
}

export type TaskRendererFactory = {
  nonTTY?: boolean;
  new (options?: Record<string, unknown>): TaskRenderer;
};

export type RendererValue =
  | "default"
  | "simple"
  | "verbose"
  | "test"
  | "silent"
  | TaskRendererFactory
  | TaskRenderer;

export interface TaskEventSource {
  subscribe(listener: (event: TaskEvent) => void): () => void;
}

export interface TaskContext<Context extends object = object> {
  title: string;
  output: string;
  promptOutput: string;
  readonly task: RuntimeTaskSnapshot;
  skip(message?: string, ...metadata: unknown[]): void;
  newTaskRunner<NewContext extends object = Context>(
    tasks:
      | Task<NewContext>
      | Task<NewContext>[]
      | ((parent: Omit<this, "skip">) => Task<NewContext> | Task<NewContext>[]),
    options?: TaskRunnerOptions<NewContext>,
  ): TaskRunner<NewContext>;
  newListr<NewContext extends object = Context>(
    tasks:
      | Task<NewContext>
      | Task<NewContext>[]
      | ((parent: Omit<this, "skip">) => Task<NewContext> | Task<NewContext>[]),
    options?: TaskRunnerOptions<NewContext>,
  ): TaskRunner<NewContext>;
  prompt(adapter?: unknown): PromptSession;
  singleFlight<T>(key: string, run: () => Promise<T>): Promise<T>;
  emit(event: Omit<TaskEvent, "task">): void;
  report(error: Error, type?: string): void;
  isRetrying(): { count: number; error?: unknown };
}

export interface PromptSession {
  run<T = unknown>(options: PromptOptions): Promise<T>;
}

export type PromptOptionValue = string | number | boolean;

export interface PromptChoice<T = PromptOptionValue> {
  name?: T;
  value?: T;
  message?: string;
  label?: string;
  hint?: string;
  disabled?: boolean | string;
}

export interface PromptOptions {
  type: string;
  message: string;
  choices?: PromptChoice[];
  options?: PromptChoice[];
  initial?: unknown;
  initialValue?: unknown;
  initialValues?: unknown[];
  placeholder?: string;
  footer?: string;
  enabled?: string;
  disabled?: string;
  required?: boolean;
  withGuide?: boolean;
  input?: unknown;
  output?: unknown;
  signal?: AbortSignal;
  validate?: (value: unknown) => string | Error | undefined | boolean;
  [key: string]: unknown;
}

export interface PromptProvider {
  prompt<T = unknown>(options: PromptOptions): Promise<T>;
}

export interface SignalController {
  onInterrupt(handler: (signal: NodeJS.Signals) => void | Promise<void>): void;
  onTerminate(handler: (signal: NodeJS.Signals) => void | Promise<void>): void;
  dispose(): void;
}

export interface SingleFlightRegistry {
  run<T>(key: string, run: () => Promise<T>): Promise<T>;
  clear(key?: string): void;
}

export interface TaskRunner<Context extends object = object> {
  isRoot(): boolean;
  run(context?: Context): Promise<Context>;
}
