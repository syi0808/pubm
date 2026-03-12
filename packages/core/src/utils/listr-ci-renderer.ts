import { stripVTControlCharacters } from "node:util";
import {
  ListrTaskEventType,
  type ListrTaskMessage,
  type ListrTaskObject,
  ListrTaskState,
} from "listr2";

export interface PubmCiRendererOptions {
  logTitleChange?: boolean;
}

type PubmCiRendererTask = ListrTaskObject<unknown>;
const HYPERLINK_OPEN = "\u001B]8;;";
const HYPERLINK_CLOSE = "\u0007";

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const hyperlinkPattern = new RegExp(
  `${escapeForRegExp(HYPERLINK_OPEN)}.*?${escapeForRegExp(HYPERLINK_CLOSE)}(.*?)${escapeForRegExp(HYPERLINK_OPEN)}${escapeForRegExp(HYPERLINK_CLOSE)}`,
  "g",
);

function normalizeLogText(value: string): string {
  return stripVTControlCharacters(value).replace(hyperlinkPattern, "$1").trim();
}

export class PubmCiRenderer {
  static nonTTY = true;
  static rendererOptions: PubmCiRendererOptions = {
    logTitleChange: true,
  };
  static rendererTaskOptions = {};

  private readonly trackedTaskIds = new Set<string>();
  private readonly options: PubmCiRendererOptions;

  constructor(
    private readonly tasks: PubmCiRendererTask[],
    options: PubmCiRendererOptions = {},
    _events?: unknown,
  ) {
    this.options = {
      ...PubmCiRenderer.rendererOptions,
      ...options,
    };
  }

  render = (): void => {
    this.attachTasks(this.tasks);
  };

  end = (): void => {};

  private attachTasks(tasks: PubmCiRendererTask[]): void {
    tasks.forEach((task) => {
      if (this.trackedTaskIds.has(task.id)) {
        return;
      }

      this.trackedTaskIds.add(task.id);

      task.on(ListrTaskEventType.SUBTASK, (subtasks) => {
        this.attachTasks(subtasks as PubmCiRendererTask[]);
      });

      task.on(ListrTaskEventType.STATE, (state) => {
        if (state === ListrTaskState.STARTED) {
          this.log("start", this.currentLabel(task));
        } else if (state === ListrTaskState.COMPLETED) {
          this.log("done", this.currentLabel(task));
        }
      });

      task.on(ListrTaskEventType.OUTPUT, (output) => {
        this.logOutput(task, output);
      });

      if (this.options.logTitleChange !== false) {
        task.on(ListrTaskEventType.TITLE, (title) => {
          const nextTitle = normalizeLogText(title);
          if (!nextTitle) {
            return;
          }

          this.log(
            "title",
            `${this.baseLabel(task)} -> ${this.currentLabel(task, nextTitle)}`,
          );
        });
      }

      task.on(ListrTaskEventType.MESSAGE, (message) => {
        this.logMessage(task, message);
      });
    });
  }

  private logOutput(task: PubmCiRendererTask, output: string): void {
    const normalized = normalizeLogText(output);
    if (!normalized) {
      return;
    }

    for (const line of normalized.split("\n")) {
      this.log("output", `${this.currentLabel(task)}: ${line}`);
    }
  }

  private logMessage(
    task: PubmCiRendererTask,
    message: ListrTaskMessage,
  ): void {
    if (message.retry) {
      this.log(
        "retry",
        `${this.currentLabel(task)} (attempt ${message.retry.count})`,
      );
      return;
    }

    if (message.rollback) {
      const rollbackMessage = normalizeLogText(message.rollback);
      this.log(
        "rollback",
        rollbackMessage
          ? `${this.currentLabel(task)}: ${rollbackMessage}`
          : this.currentLabel(task),
      );
      return;
    }

    if (message.skip) {
      const skipMessage = normalizeLogText(message.skip);
      if (skipMessage) {
        this.log("skip", `${this.currentLabel(task)}: ${skipMessage}`);
      }
    }
  }

  private baseLabel(task: PubmCiRendererTask): string {
    const path = task.path.map(normalizeLogText).filter(Boolean);
    if (path.length > 0) {
      return path.join(" > ");
    }

    return this.currentLabel(task);
  }

  private currentLabel(task: PubmCiRendererTask, nextTitle?: string): string {
    const basePath = task.path
      .slice(0, -1)
      .map(normalizeLogText)
      .filter(Boolean);
    const leaf =
      nextTitle ??
      normalizeLogText(task.title ?? task.initialTitle ?? "background task");

    return [...basePath, leaf].filter(Boolean).join(" > ");
  }

  private log(level: string, message: string): void {
    const normalizedMessage = normalizeLogText(message);
    if (!normalizedMessage) {
      return;
    }

    console.log(`[pubm][${level}] ${normalizedMessage}`);
  }
}
