import {
  color,
  normalizeTerminalText,
  terminalFigures,
  terminalSpinnerFrames,
  wrapTerminalLine,
} from "./text.js";
import type {
  RuntimeTaskSnapshot,
  TaskEvent,
  TaskEventSource,
  TaskMessage,
  TaskRenderer,
  TaskRunResult,
} from "./types.js";

type LineOutput = Pick<typeof console, "log" | "error">;
type RawOutput = LineOutput & { write(chunk: string): void };
type OutputOptions = Partial<LineOutput & { write(chunk: string): void }>;

export interface CiRendererOptions {
  output?: OutputOptions;
  logTitleChange?: boolean;
  useColor?: boolean;
  spinnerInterval?: number;
  indentation?: number;
  clearOutput?: boolean;
  collapseSubtasks?: boolean;
  outputBar?: boolean | number;
  persistentOutput?: boolean;
  removeEmptyLines?: boolean;
  lazy?: boolean;
  columns?: number;
}

export class SilentRenderer implements TaskRenderer {
  static nonTTY = true;
  render(): void {}
  end(): void {}
}

export class CiRenderer implements TaskRenderer {
  static nonTTY = true;

  private unsubscribe?: () => void;
  private readonly logTitleChange: boolean;
  private readonly output: Pick<typeof console, "log">;

  constructor(options: CiRendererOptions = {}) {
    this.logTitleChange = options.logTitleChange !== false;
    this.output = { log: options.output?.log ?? console.log };
  }

  render(events: TaskEventSource): void {
    this.unsubscribe = events.subscribe((event) => {
      this.handle(event);
    });
  }

  end(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private handle(event: TaskEvent): void {
    const task = event.task;
    if (!task) return;

    if (event.type === "task.started") {
      this.log("start", label(task));
    } else if (event.type === "task.completed") {
      this.log("done", label(task));
    } else if (event.type === "task.output" && event.output) {
      this.logOutput(task, event.output);
    } else if (event.type === "task.title" && this.logTitleChange) {
      const nextTitle = normalizeTerminalText(event.title ?? "");
      if (!nextTitle) return;
      this.log("title", `${baseLabel(task)} -> ${label(task, nextTitle)}`);
    } else if (event.type === "task.message" && event.message) {
      this.logMessage(task, event.message);
    } else if (event.type === "task.failed") {
      const message =
        event.error instanceof Error
          ? event.error.message
          : String(event.error);
      if (message && message !== "undefined") {
        this.log("failed", `${label(task)}: ${message}`);
      }
    }
  }

  private logOutput(task: RuntimeTaskSnapshot, output: string): void {
    if (!normalizeTerminalText(output)) return;
    for (const line of outputDetailLines(
      [output],
      task.path.length,
      false,
      false,
    )) {
      this.log("output", line);
    }
  }

  private logMessage(task: RuntimeTaskSnapshot, message: TaskMessage): void {
    if (message.retry && typeof message.retry.count === "number") {
      this.log("retry", `${label(task)} (attempt ${message.retry.count})`);
      return;
    }

    if (message.rollback) {
      const rollbackMessage = normalizeTerminalText(message.rollback);
      this.log(
        "rollback",
        rollbackMessage ? `${label(task)}: ${rollbackMessage}` : label(task),
      );
      return;
    }

    if (message.skip) {
      const skipMessage = normalizeTerminalText(message.skip);
      if (skipMessage) this.log("skip", `${label(task)}: ${skipMessage}`);
    }
  }

  private log(level: string, message: string): void {
    const normalized = normalizeTerminalText(message);
    if (!normalized) return;
    const detail = message.startsWith(" ") ? message : normalized;
    this.output.log(`[pubm][${level}] ${detail}`);
  }
}

export class SimpleRenderer implements TaskRenderer {
  static nonTTY = true;

  private unsubscribe?: () => void;
  private readonly output: LineOutput;
  private readonly useColor: boolean;

  constructor(options: CiRendererOptions = {}) {
    this.output = {
      log: options.output?.log ?? console.log,
      error: options.output?.error ?? console.error,
    };
    this.useColor = options.useColor !== false;
  }

  render(events: TaskEventSource): void {
    this.unsubscribe = events.subscribe((event) => {
      this.handle(event);
    });
  }

  end(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  protected handle(event: TaskEvent): void {
    const task = event.task;
    if (!task) return;

    if (event.type === "task.started") {
      this.line("pending", task);
    } else if (event.type === "task.completed") {
      this.line("completed", task);
    } else if (event.type === "task.failed") {
      this.line("failed", task);
    } else if (event.type === "task.skipped") {
      this.line("skipped", task, task.message?.skip);
    } else if (event.type === "task.retrying") {
      this.line("retry", task, task.message?.retry?.count);
    } else if (event.type === "task.rolling-back") {
      this.line("rollback", task);
    } else if (event.type === "task.rolled-back") {
      this.line("rolled-back", task, task.message?.rollback);
    } else if (event.type === "task.output" && event.output) {
      this.outputLines(task, event.output);
    } else if (event.type === "task.message" && event.message?.rollback) {
      this.line("rollback", task, event.message.rollback);
    }
  }

  protected outputLines(task: RuntimeTaskSnapshot, output: string): void {
    const normalized = normalizeTerminalText(output);
    if (!normalized) return;

    for (const line of normalized.split("\n")) {
      this.writeOutput(task, line);
    }
  }

  private line(
    level: StyledLevel,
    task: RuntimeTaskSnapshot,
    suffix?: unknown,
  ): void {
    this.write(level, task, suffix);
  }

  private write(
    level: StyledLevel,
    task: RuntimeTaskSnapshot,
    suffix?: unknown,
  ): void {
    const prefix = " ".repeat(Math.max(task.path.length - 1, 0) * 2);
    const base = normalizeTerminalText(label(task));
    const suffixText =
      suffix === undefined || suffix === null
        ? ""
        : normalizeTerminalText(String(suffix));
    const details = suffixText
      ? level === "retry" && typeof suffix === "number"
        ? ` (attempt ${suffixText})`
        : `: ${suffixText}`
      : "";
    const message = `${prefix}${style(level, this.useColor)} ${base}${details}`;
    const normalized = normalizeTerminalText(message);
    if (!normalized) return;

    const writer = level === "failed" ? this.output.error : this.output.log;
    writer(message);
  }

  private writeOutput(task: RuntimeTaskSnapshot, line: string): void {
    const prefix = " ".repeat(task.path.length * 2);
    const message = `${prefix}${style("output", this.useColor)} ${line}`;
    if (normalizeTerminalText(message)) this.output.log(message);
  }
}

export class DefaultRenderer implements TaskRenderer {
  static nonTTY = false;

  private unsubscribe?: () => void;
  private readonly output: RawOutput;
  private readonly useColor: boolean;
  private readonly spinnerInterval: number;
  private readonly indentation: number;
  private readonly clearOutput: boolean;
  private readonly collapseSubtasks: boolean;
  private readonly outputBar: boolean | number;
  private readonly persistentOutput: boolean;
  private readonly removeEmptyLines: boolean;
  private readonly lazy: boolean;
  private readonly columns?: number;
  private readonly frames = terminalSpinnerFrames();
  private readonly tasks = new Map<string, RuntimeTaskSnapshot>();
  private readonly children = new Map<string, Set<string>>();
  private readonly parents = new Map<string, string>();
  private readonly order = new Map<string, number>();
  private readonly outputBuffers = new Map<string, string[]>();
  private renderedLines = 0;
  private spinnerIndex = 0;
  private nextOrder = 0;
  private timer?: ReturnType<typeof setInterval>;
  private paused = false;

  constructor(options: CiRendererOptions = {}) {
    this.output = {
      log: options.output?.log ?? console.log,
      error: options.output?.error ?? console.error,
      write:
        options.output?.write ??
        ((chunk: string) => {
          process.stderr.write(chunk);
        }),
    };
    this.useColor = options.useColor !== false;
    this.spinnerInterval = options.spinnerInterval ?? 80;
    this.indentation = options.indentation ?? 2;
    this.clearOutput = options.clearOutput === true;
    this.collapseSubtasks = options.collapseSubtasks !== false;
    this.outputBar = options.outputBar ?? true;
    this.persistentOutput = options.persistentOutput === true;
    this.removeEmptyLines = options.removeEmptyLines !== false;
    this.lazy = options.lazy === true;
    this.columns = options.columns;
  }

  render(events: TaskEventSource): void {
    this.output.write("\u001b[?25l");
    this.unsubscribe = events.subscribe((event) => {
      this.handle(event);
    });
    if (this.lazy) return;

    this.timer = setInterval(() => {
      if (!this.paused && this.hasActiveTasks()) {
        this.spinnerIndex += 1;
        this.redraw();
      }
    }, this.spinnerInterval);
    this.timer.unref?.();
  }

  end(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.clearFrame();
    if (!this.clearOutput) this.writeFrame(this.frameLines());
    this.output.write("\u001b[?25h");
  }

  private handle(event: TaskEvent): void {
    if (event.task) this.upsert(event.task);
    if (event.type === "task.output" && event.task && event.output) {
      this.pushOutput(event.task.id, event.output);
    }

    if (event.type === "prompt.started") {
      this.paused = true;
      this.clearFrame();
      this.writeStaticFrame(this.frameLines());
      this.output.write("\u001b[?25h");
      return;
    }

    if (event.type === "prompt.completed" || event.type === "prompt.failed") {
      if (event.task && !this.persistentOutput) {
        this.outputBuffers.delete(event.task.id);
      }
      this.paused = false;
      this.output.write("\u001b[?25l");
      this.redraw();
      return;
    }

    if (event.type === "task.subtasks" && event.task && event.tasks) {
      this.upsert(event.task);
      const childIds = this.children.get(event.task.id) ?? new Set<string>();
      for (const child of event.tasks) {
        this.upsert(child);
        childIds.add(child.id);
        this.parents.set(child.id, event.task.id);
      }
      this.children.set(event.task.id, childIds);
    }

    if (event.task && isFinalized(event.task.state) && !this.persistentOutput) {
      this.outputBuffers.delete(event.task.id);
    }

    if (!this.paused) this.redraw();
  }

  private upsert(task: RuntimeTaskSnapshot): void {
    if (!this.order.has(task.id)) {
      this.order.set(task.id, this.nextOrder);
      this.nextOrder += 1;
    }
    this.tasks.set(task.id, task);
    if (!this.parents.has(task.id) && task.path.length > 1) {
      const parentPath = task.path.slice(0, -1).join("\0");
      const parent = [...this.tasks.values()].find(
        (candidate) => candidate.path.join("\0") === parentPath,
      );
      if (parent) {
        this.parents.set(task.id, parent.id);
        const childIds = this.children.get(parent.id) ?? new Set<string>();
        childIds.add(task.id);
        this.children.set(parent.id, childIds);
      }
    }
  }

  private redraw(): void {
    this.clearFrame();
    this.writeFrame(this.frameLines());
  }

  private clearFrame(): void {
    for (let i = 0; i < this.renderedLines; i += 1) {
      this.output.write("\u001b[1A\r\u001b[2K");
    }
    this.renderedLines = 0;
  }

  private writeFrame(lines: string[]): void {
    const formattedLines = this.formatFrameLines(lines);
    if (formattedLines.length === 0) return;
    this.output.write(`${formattedLines.join("\n")}\n`);
    this.renderedLines = formattedLines.length;
  }

  private writeStaticFrame(lines: string[]): void {
    const formattedLines = this.formatFrameLines(lines);
    if (formattedLines.length === 0) return;
    this.output.write(`${formattedLines.join("\n")}\n`);
  }

  private formatFrameLines(lines: string[]): string[] {
    const columns = this.terminalColumns();
    if (!columns) return lines;
    return lines.flatMap((line) => wrapTerminalLine(line, columns));
  }

  private terminalColumns(): number | undefined {
    const columns =
      this.columns ?? process.stderr.columns ?? process.stdout.columns;
    return typeof columns === "number" && columns > 0 ? columns : undefined;
  }

  private frameLines(): string[] {
    const lines: string[] = [];
    for (const root of this.rootTasks()) {
      this.addTaskLines(lines, root, 0);
    }
    return lines;
  }

  private rootTasks(): RuntimeTaskSnapshot[] {
    return [...this.tasks.values()]
      .filter((task) => !this.parents.has(task.id))
      .sort((left, right) => this.compareTasks(left, right));
  }

  private addTaskLines(
    lines: string[],
    task: RuntimeTaskSnapshot,
    depth: number,
  ): void {
    lines.push(this.taskLine(task, depth));
    if (this.shouldRenderOutput(task)) {
      for (const outputLine of outputDetailLines(
        this.outputBuffers.get(task.id),
        depth + 1,
        this.useColor,
        this.removeEmptyLines,
        this.indentation,
      )) {
        lines.push(outputLine);
      }
    }

    if (!this.shouldRenderSubtasks(task)) return;

    const childIds = [...(this.children.get(task.id) ?? [])];
    const childTasks = childIds
      .map((id) => this.tasks.get(id))
      .filter((child): child is RuntimeTaskSnapshot => !!child)
      .sort((left, right) => this.compareTasks(left, right));
    for (const child of childTasks) {
      this.addTaskLines(lines, child, depth + 1);
    }
  }

  private taskLine(task: RuntimeTaskSnapshot, depth: number): string {
    const prefix = " ".repeat(depth * this.indentation);
    const title = leafLabel(task);
    const suffix = stateSuffix(task);
    return `${prefix}${this.stateIcon(task)} ${title}${suffix}`;
  }

  private stateIcon(task: RuntimeTaskSnapshot): string {
    if (isActive(task.state)) {
      const frame = this.frames[this.spinnerIndex % this.frames.length] ?? ">";
      return paint(frame, "cyan", this.useColor);
    }
    if (task.state === "success") return style("completed", this.useColor);
    if (task.state === "failed") return style("failed", this.useColor);
    if (task.state === "skipped") return style("skipped", this.useColor);
    if (task.state === "rolled-back")
      return style("rolled-back", this.useColor);
    if (task.state === "blocked") return style("retry", this.useColor);
    return style("pending", this.useColor);
  }

  private hasActiveTasks(): boolean {
    return [...this.tasks.values()].some((task) => isActive(task.state));
  }

  private compareTasks(
    left: RuntimeTaskSnapshot,
    right: RuntimeTaskSnapshot,
  ): number {
    return (this.order.get(left.id) ?? 0) - (this.order.get(right.id) ?? 0);
  }

  private pushOutput(taskId: string, output: string): void {
    const limit = outputLimit(this.outputBar);
    if (limit <= 0) return;

    const entries = this.outputBuffers.get(taskId) ?? [];
    entries.push(output);
    if (Number.isFinite(limit) && entries.length > limit) {
      entries.splice(0, entries.length - limit);
    }
    this.outputBuffers.set(taskId, entries);
  }

  private shouldRenderOutput(task: RuntimeTaskSnapshot): boolean {
    return (
      this.outputBuffers.has(task.id) &&
      (this.persistentOutput || isPendingForOutput(task.state))
    );
  }

  private shouldRenderSubtasks(task: RuntimeTaskSnapshot): boolean {
    const childIds = this.children.get(task.id);
    if (!childIds || childIds.size === 0) return false;
    if (!this.collapseSubtasks) return true;
    if (isPendingForOutput(task.state)) return true;

    const childTasks = [...childIds]
      .map((id) => this.tasks.get(id))
      .filter((child): child is RuntimeTaskSnapshot => !!child);
    return childTasks.some(
      (child) => child.state === "failed" || child.state === "rolled-back",
    );
  }
}

export class VerboseRenderer extends SimpleRenderer {
  static nonTTY = true;
}

export class TestRenderer implements TaskRenderer {
  static nonTTY = true;

  readonly events: TaskEvent[] = [];
  result?: TaskRunResult | Error;
  private unsubscribe?: () => void;

  render(events: TaskEventSource): void {
    this.unsubscribe = events.subscribe((event) => {
      this.events.push(event);
    });
  }

  end(result?: TaskRunResult | Error): void {
    this.result = result;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}

type StyledLevel =
  | "pending"
  | "completed"
  | "failed"
  | "skipped"
  | "retry"
  | "rollback"
  | "rolled-back"
  | "output";

function style(level: StyledLevel, useColor: boolean): string {
  const f = terminalFigures();
  const [icon, colorName] =
    level === "completed"
      ? [f.tick, "green" as const]
      : level === "failed"
        ? [f.cross, "red" as const]
        : level === "skipped"
          ? [f.arrowDown, "yellow" as const]
          : level === "retry"
            ? [f.warning, "yellowBright" as const]
            : level === "rollback" || level === "rolled-back"
              ? [
                  level === "rollback" ? f.warning : f.arrowLeft,
                  "redBright" as const,
                ]
              : level === "output"
                ? [f.pointerSmall, "dim" as const]
                : [f.pointer, "yellow" as const];
  return paint(icon, colorName, useColor);
}

function paint(
  value: string,
  colorName: keyof typeof color,
  useColor: boolean,
): string {
  return useColor ? (color[colorName]?.(value) ?? value) : value;
}

function outputDetailLines(
  entries: readonly string[] | undefined,
  depth: number,
  useColor: boolean,
  removeEmptyLines: boolean,
  indentation = 2,
): string[] {
  if (!entries || entries.length === 0) return [];
  const prefix = " ".repeat(depth * indentation);
  const lines: string[] = [];
  for (const entry of entries) {
    for (const line of String(entry).split("\n")) {
      const normalized = normalizeTerminalText(line);
      if (!normalized && removeEmptyLines) continue;
      lines.push(`${prefix}${style("output", useColor)} ${normalized}`);
    }
  }
  return lines;
}

function leafLabel(task: RuntimeTaskSnapshot): string {
  return normalizeTerminalText(
    task.title ?? task.initialTitle ?? "background task",
  );
}

function stateSuffix(task: RuntimeTaskSnapshot): string {
  if (task.state === "retrying" && task.message?.retry) {
    return ` (attempt ${task.message.retry.count})`;
  }
  if (task.state === "skipped" && task.message?.skip) {
    return `: ${normalizeTerminalText(task.message.skip)}`;
  }
  if (task.state === "rolled-back" && task.message?.rollback) {
    return `: ${normalizeTerminalText(task.message.rollback)}`;
  }
  if (task.state === "failed" && task.message?.error) {
    return `: ${normalizeTerminalText(task.message.error)}`;
  }
  return "";
}

function isActive(state: RuntimeTaskSnapshot["state"]): boolean {
  return (
    state === "running" ||
    state === "prompting" ||
    state === "retrying" ||
    state === "rolling-back"
  );
}

function isPendingForOutput(state: RuntimeTaskSnapshot["state"]): boolean {
  return isActive(state);
}

function isFinalized(state: RuntimeTaskSnapshot["state"]): boolean {
  return (
    state === "success" ||
    state === "failed" ||
    state === "skipped" ||
    state === "rolled-back"
  );
}

function outputLimit(value: boolean | number): number {
  if (value === false) return 0;
  if (value === true) return 1;
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  return 1;
}

function baseLabel(task: RuntimeTaskSnapshot): string {
  const path = task.path.map(normalizeTerminalText).filter(Boolean);
  if (path.length > 0) return path.join(" > ");
  return label(task);
}

function label(task: RuntimeTaskSnapshot, nextTitle?: string): string {
  const basePath = task.path
    .slice(0, -1)
    .map(normalizeTerminalText)
    .filter(Boolean);
  const leaf =
    nextTitle ??
    normalizeTerminalText(task.title ?? task.initialTitle ?? "background task");
  return [...basePath, leaf].filter(Boolean).join(" > ");
}
