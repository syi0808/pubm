import { randomUUID } from "node:crypto";
import type {
  RuntimeTaskSnapshot,
  Task,
  TaskEvent,
  TaskEventSource,
  TaskMessage,
  TaskState,
  WorkflowEventSink,
} from "./types.js";

type Listener = (data?: unknown) => void;

export const TaskEventType = {
  TITLE: "TITLE",
  STATE: "STATE",
  ENABLED: "ENABLED",
  SUBTASK: "SUBTASK",
  OUTPUT: "OUTPUT",
  PROMPT: "PROMPT",
  MESSAGE: "MESSAGE",
  CLOSED: "CLOSED",
} as const;

export const LegacyTaskState = {
  WAITING: "pending",
  STARTED: "running",
  COMPLETED: "success",
  FAILED: "failed",
  SKIPPED: "skipped",
  PROMPT: "prompting",
  PROMPT_COMPLETED: "running",
  PROMPT_FAILED: "failed",
  RETRY: "retrying",
  ROLLING_BACK: "rolling-back",
  ROLLED_BACK: "rolled-back",
} as const;

export class RuntimeTask<Context extends object = object>
  implements TaskEventSource
{
  readonly id = randomUUID();
  readonly initialTitle?: string;
  readonly task: Task<Context>;
  readonly path: string[];
  state: TaskState = "pending";
  title?: string;
  output?: string;
  promptOutput?: string;
  message?: TaskMessage;
  retry: { count: number; error?: unknown } = { count: 0 };
  enabled = true;
  closed = false;

  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    task: Task<Context>,
    path: string[],
    private readonly sink: WorkflowEventSink,
  ) {
    this.task = task;
    this.title = task.title;
    this.initialTitle = task.title;
    this.path = path;
  }

  subscribe(listener: (event: TaskEvent) => void): () => void {
    const wrapped = (event?: unknown) => {
      if (event && typeof event === "object" && "type" in event) {
        listener(event as TaskEvent);
      }
    };
    this.on("event", wrapped);
    return () => this.off("event", wrapped);
  }

  on(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  once(type: string, listener: Listener): void {
    const wrapped = (data?: unknown) => {
      this.off(type, wrapped);
      listener(data);
    };
    this.on(type, wrapped);
  }

  off(type: string, listener?: Listener): void {
    if (!listener) {
      this.listeners.delete(type);
      return;
    }
    this.listeners.get(type)?.delete(listener);
  }

  emitLegacy(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(data);
    }
  }

  snapshot(): RuntimeTaskSnapshot {
    return {
      id: this.id,
      title: this.title,
      initialTitle: this.initialTitle,
      output: this.output,
      promptOutput: this.promptOutput,
      state: this.state,
      message: this.message,
      path: this.path,
    };
  }

  setState(
    state: TaskState,
    details: Omit<TaskEvent, "type" | "state" | "task"> = {},
  ): void {
    this.state = state;
    this.emitLegacy(TaskEventType.STATE, state);
    this.publish({
      type: stateEventType(state),
      state,
      task: this.snapshot(),
      ...details,
    });
  }

  setTitle(title: string): void {
    this.title = title;
    this.emitLegacy(TaskEventType.TITLE, title);
    this.publish({ type: "task.title", title, task: this.snapshot() });
  }

  setOutput(output: string): void {
    this.output = output;
    this.emitLegacy(TaskEventType.OUTPUT, output);
    this.publish({ type: "task.output", output, task: this.snapshot() });
  }

  setPromptOutput(output: string): void {
    this.promptOutput = output;
    this.emitLegacy(TaskEventType.PROMPT, output);
    this.publish({
      type: "task.prompt-output",
      output,
      task: this.snapshot(),
    });
  }

  setMessage(message: TaskMessage): void {
    this.message = { ...this.message, ...message };
    if (message.retry) this.retry = message.retry;
    this.emitLegacy(TaskEventType.MESSAGE, message);
    this.publish({ type: "task.message", message, task: this.snapshot() });
  }

  setSubtasks(tasks: Array<{ snapshot(): RuntimeTaskSnapshot }>): void {
    this.emitLegacy(TaskEventType.SUBTASK, tasks);
    this.publish({
      type: "task.subtasks",
      tasks: tasks.map((task) => task.snapshot()),
      task: this.snapshot(),
    });
  }

  isPending(): boolean {
    return this.state === "pending";
  }

  isStarted(): boolean {
    return this.state === "running";
  }

  isCompleted(): boolean {
    return this.state === "success";
  }

  hasFailed(): boolean {
    return this.state === "failed";
  }

  isSkipped(): boolean {
    return this.state === "skipped";
  }

  isRetrying(): boolean {
    return this.state === "retrying";
  }

  isRollingBack(): boolean {
    return this.state === "rolling-back";
  }

  hasRolledBack(): boolean {
    return this.state === "rolled-back";
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emitLegacy(TaskEventType.CLOSED);
    this.publish({ type: "task.closed", task: this.snapshot() });
  }

  private publish(event: TaskEvent): void {
    this.emitLegacy("event", event);
    this.sink.emit(event);
  }
}

function stateEventType(state: TaskState): TaskEvent["type"] {
  if (state === "running") return "task.started";
  if (state === "success") return "task.completed";
  if (state === "failed") return "task.failed";
  if (state === "skipped") return "task.skipped";
  if (state === "blocked") return "task.blocked";
  if (state === "waiting") return "task.waiting";
  if (state === "prompting") return "task.prompting";
  if (state === "retrying") return "task.retrying";
  if (state === "rolling-back") return "task.rolling-back";
  if (state === "rolled-back") return "task.rolled-back";
  return "task.enabled";
}
