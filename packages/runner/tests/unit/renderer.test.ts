import { describe, expect, it, vi } from "vitest";
import { EventSource } from "../../src/event-source.js";
import {
  CiRenderer,
  DefaultRenderer,
  SilentRenderer,
  SimpleRenderer,
  TestRenderer,
} from "../../src/renderer.js";
import { normalizeTerminalText } from "../../src/text.js";
import type { RuntimeTaskSnapshot } from "../../src/types.js";

function taskSnapshot(
  overrides: Partial<RuntimeTaskSnapshot> = {},
): RuntimeTaskSnapshot {
  return {
    id: "task-1",
    title: "Build",
    initialTitle: "Build",
    output: undefined,
    promptOutput: undefined,
    state: "running",
    message: undefined,
    path: ["Release", "Build"],
    ...overrides,
  };
}

function lastChunkContaining(chunks: readonly string[], ...needles: string[]) {
  return (
    chunks
      .filter((chunk) => needles.every((needle) => chunk.includes(needle)))
      .at(-1) ?? ""
  );
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function setColumns(stream: NodeJS.WriteStream, columns: number): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, "columns");
  Object.defineProperty(stream, "columns", {
    configurable: true,
    writable: true,
    value: columns,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(stream, "columns", descriptor);
    } else {
      delete (stream as NodeJS.WriteStream & { columns?: number }).columns;
    }
  };
}

async function flushPromptFrame(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("terminal text normalization", () => {
  it("preserves OSC hyperlink labels while removing ANSI controls and bells", () => {
    const value =
      "\u001B]8;id=artifact;https://example.com\u0007Artifact\u001B]8;;\u0007 " +
      "\u001b[31mready\u001b[39m\u0007";

    expect(normalizeTerminalText(value)).toBe("Artifact ready");
  });

  it("removes clear-line controls without dropping following visible text", () => {
    expect(normalizeTerminalText("\u001b[2Kready")).toBe("ready");
    expect(normalizeTerminalText("\u001b[2K")).toBe("");
  });
});

describe("CiRenderer", () => {
  it("uses default output streams and skips empty normalized messages", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const source = new EventSource();
    const renderer = new CiRenderer();

    try {
      renderer.render(source);
      source.emit({
        type: "task.started",
        task: taskSnapshot({
          title: "\u001b[2K",
          initialTitle: "\u001b[2K",
          path: [],
        }),
      });
      source.emit({
        type: "task.title",
        title: "\u001b[2K",
        task: taskSnapshot(),
      });
      source.emit({
        type: "task.message",
        message: { skip: "\u001b[2K" },
        task: taskSnapshot(),
      });
      source.emit({
        type: "task.failed",
        error: undefined,
        task: taskSnapshot(),
      });
      renderer.end();

      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("logs listr-style CI events with normalized titles and output", () => {
    const logs: string[] = [];
    const source = new EventSource();
    const renderer = new CiRenderer({
      output: {
        log: (line) => logs.push(line),
      },
    });
    const task = taskSnapshot();

    renderer.render(source);
    source.emit({ type: "task.started", task });
    source.emit({
      type: "task.title",
      title: "\u001b[32mBuild red\u001b[39m",
      task: taskSnapshot({ title: "Build red" }),
    });
    source.emit({
      type: "task.output",
      output:
        "\u001B]8;;https://example.com\u0007Artifact\u001B]8;;\u0007\n" +
        "\u001b[31mready\u001b[39m",
      task: taskSnapshot({ title: "Build red" }),
    });
    source.emit({
      type: "task.message",
      message: { retry: { count: 2 } },
      task,
    });
    source.emit({ type: "task.completed", task });
    renderer.end();
    source.emit({ type: "task.completed", task });

    expect(logs).toEqual([
      "[pubm][start] Release > Build",
      "[pubm][title] Release > Build -> Release > Build red",
      "[pubm][output]     › Artifact",
      "[pubm][output]     › ready",
      "[pubm][retry] Release > Build (attempt 2)",
      "[pubm][done] Release > Build",
    ]);
  });

  it("handles failure, skip, rollback, empty, and disabled title-change paths", () => {
    const logs: string[] = [];
    const source = new EventSource();
    const renderer = new CiRenderer({
      logTitleChange: false,
      output: {
        log: (line) => logs.push(line),
      },
    });
    const task = taskSnapshot();

    renderer.render(source);
    source.emit({ type: "run.started" });
    source.emit({ type: "task.title", title: "Ignored", task });
    source.emit({ type: "task.output", output: "\u001b[2K", task });
    source.emit({
      type: "task.message",
      message: { skip: "Already done" },
      task,
    });
    source.emit({
      type: "task.message",
      message: { rollback: "\u001b[2K" },
      task,
    });
    source.emit({
      type: "task.message",
      message: { rollback: "Restored files" },
      task,
    });
    source.emit({ type: "task.failed", error: new Error("failed"), task });
    source.emit({ type: "task.failed", error: "plain failed", task });
    source.emit({ type: "task.failed", error: undefined, task });

    expect(logs).toEqual([
      "[pubm][skip] Release > Build: Already done",
      "[pubm][rollback] Release > Build",
      "[pubm][rollback] Release > Build: Restored files",
      "[pubm][failed] Release > Build: failed",
      "[pubm][failed] Release > Build: plain failed",
    ]);
  });
});

describe("SimpleRenderer", () => {
  it("uses default line outputs and ignores unrelated message events", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const source = new EventSource();
    const renderer = new SimpleRenderer();

    try {
      renderer.render(source);
      source.emit({
        type: "task.message",
        message: { skip: "skip is handled by task.skipped" },
        task: taskSnapshot(),
      });
      renderer.end();

      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("prints stable simple-renderer symbols, indentation, and failure stream output", () => {
    const previousForceUnicode = process.env.FORCE_UNICODE;
    process.env.FORCE_UNICODE = "1";
    try {
      const logs: string[] = [];
      const errors: string[] = [];
      const source = new EventSource();
      const renderer = new SimpleRenderer({
        output: {
          log: (line) => logs.push(line),
          error: (line) => errors.push(line),
        },
        useColor: false,
      });
      const task = taskSnapshot();

      renderer.render(source);
      source.emit({ type: "task.started", task });
      source.emit({ type: "task.completed", task });
      source.emit({ type: "task.output", output: "line one\nline two", task });
      source.emit({
        type: "task.retrying",
        task: taskSnapshot({ message: { retry: { count: 2 } } }),
      });
      source.emit({ type: "task.rolling-back", task });
      source.emit({
        type: "task.rolled-back",
        task: taskSnapshot({ message: { rollback: "Restored files" } }),
      });
      source.emit({
        type: "task.skipped",
        task: taskSnapshot({ message: { skip: "Already done" } }),
      });
      source.emit({ type: "task.failed", task });

      expect(logs).toEqual([
        "  ❯ Release > Build",
        "  ✔ Release > Build",
        "    › line one",
        "    › line two",
        "  ⚠ Release > Build (attempt 2)",
        "  ⚠ Release > Build",
        "  ← Release > Build: Restored files",
        "  ↓ Release > Build: Already done",
      ]);
      expect(errors).toEqual(["  ✖ Release > Build"]);
    } finally {
      if (previousForceUnicode === undefined) {
        delete process.env.FORCE_UNICODE;
      } else {
        process.env.FORCE_UNICODE = previousForceUnicode;
      }
    }
  });

  it("ignores empty normalized output and handles root fallback labels and null suffixes", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const source = new EventSource();
    const renderer = new SimpleRenderer({
      output: {
        log: (line) => logs.push(line),
        error: (line) => errors.push(line),
      },
      useColor: true,
    });

    renderer.render(source);
    source.emit({
      type: "task.output",
      output: "\u001b[2K",
      task: taskSnapshot({
        path: [],
        title: undefined,
        initialTitle: undefined,
      }),
    });
    source.emit({
      type: "task.started",
      task: taskSnapshot({
        path: [],
        title: undefined,
        initialTitle: undefined,
      }),
    });
    source.emit({
      type: "task.retrying",
      task: taskSnapshot({ message: { retry: { count: 0 } } }),
    });
    source.emit({
      type: "task.rolled-back",
      task: taskSnapshot({ message: { rollback: null as never } }),
    });
    renderer.end();
    source.emit({
      type: "task.started",
      task: taskSnapshot({ title: "late" }),
    });

    expect(logs.map(normalizeTerminalText)).toEqual([
      "❯ background task",
      "⚠ Release > Build (attempt 0)",
      "← Release > Build",
    ]);
    expect(errors).toEqual([]);
  });
});

describe("DefaultRenderer", () => {
  it("renders a live spinner frame and task output as nested detail lines", () => {
    const previousForceUnicode = process.env.FORCE_UNICODE;
    process.env.FORCE_UNICODE = "1";
    vi.useFakeTimers();

    try {
      const chunks: string[] = [];
      const source = new EventSource();
      const renderer = new DefaultRenderer({
        output: {
          write: (chunk) => chunks.push(chunk),
        },
        spinnerInterval: 10,
        useColor: false,
      });

      renderer.render(source);
      source.emit({
        type: "task.started",
        task: taskSnapshot({
          path: ["Build"],
          state: "running",
        }),
      });
      vi.advanceTimersByTime(10);
      source.emit({
        type: "task.output",
        output: "line one\nline two",
        task: taskSnapshot({
          path: ["Build"],
          state: "running",
          output: "line one\nline two",
        }),
      });
      source.emit({
        type: "task.completed",
        task: taskSnapshot({
          path: ["Build"],
          state: "success",
          output: "line one\nline two",
        }),
      });
      renderer.end();

      const output = chunks.join("");
      expect(output).toContain("⠋ Build");
      expect(output).toContain("⠙ Build");
      expect(output).toContain("  › line one");
      expect(output).toContain("  › line two");
      expect(output).not.toContain("Build: line one");
      expect(output).toContain("✔ Build");

      const finalBuildFrame = lastChunkContaining(chunks, "✔ Build");
      expect(finalBuildFrame).not.toContain("line one");
      expect(finalBuildFrame).not.toContain("line two");
    } finally {
      vi.useRealTimers();
      if (previousForceUnicode === undefined) {
        delete process.env.FORCE_UNICODE;
      } else {
        process.env.FORCE_UNICODE = previousForceUnicode;
      }
    }
  });

  it("keeps live redraws in-place without pushing intermediate frames into scrollback", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });

    renderer.render(source);
    source.emit({
      type: "task.started",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    const firstLiveFrame = chunks.at(-1) ?? "";
    expect(firstLiveFrame).toContain("Build");
    expect(firstLiveFrame.endsWith("\n")).toBe(false);

    source.emit({
      type: "task.output",
      output: "line one",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    const liveRedraw = chunks.at(-1) ?? "";
    expect(liveRedraw).toContain("\r\u001b[2K");
    expect(liveRedraw).toContain("  › line one");
    expect(liveRedraw.endsWith("\n")).toBe(false);

    source.emit({
      type: "task.completed",
      task: taskSnapshot({ path: ["Build"], state: "success" }),
    });
    renderer.end();

    expect(lastChunkContaining(chunks, "✔ Build").endsWith("\n")).toBe(true);
  });

  it("clips oversized live frames while leaving terminal headroom", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      rows: 3,
      useColor: false,
    });

    renderer.render(source);
    for (let index = 1; index <= 5; index += 1) {
      source.emit({
        type: "task.started",
        task: taskSnapshot({
          id: `task-${index}`,
          title: `Task ${index}`,
          initialTitle: `Task ${index}`,
          path: [`Task ${index}`],
          state: "running",
        }),
      });
    }

    const liveFrame = chunks.at(-1) ?? "";
    expect(liveFrame.split("\n")).toHaveLength(2);
    expect(liveFrame).not.toContain("Task 1");
    expect(liveFrame).toContain("Task 5");
    expect(liveFrame.endsWith("\n")).toBe(false);

    renderer.end();
    expect(lastChunkContaining(chunks, "Task 1", "Task 5")).toContain("Task 1");
  });

  it("trims live output details before dropping the active task line", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      rows: 5,
      useColor: false,
    });

    renderer.render(source);
    source.emit({
      type: "task.started",
      task: taskSnapshot({
        title: "Running tests (bun run test)",
        initialTitle: "Running tests",
        path: ["Running tests"],
        state: "running",
      }),
    });
    source.emit({
      type: "task.output",
      output: "Executing `bun run test`\nline 1\nline 2\nline 3\nline 4",
      task: taskSnapshot({
        title: "Running tests (bun run test)",
        initialTitle: "Running tests",
        path: ["Running tests"],
        state: "running",
      }),
    });

    const liveFrame = chunks.at(-1) ?? "";
    expect(liveFrame.split("\n")).toHaveLength(3);
    expect(liveFrame).toContain("Running tests (bun run test)");
    expect(liveFrame).toContain("  › Executing `bun run test`");
    expect(liveFrame).toContain("  › line 4");
    expect(liveFrame).not.toContain("  › line 1");
    expect(liveFrame.endsWith("\n")).toBe(false);

    renderer.end();
  });

  it("keeps live task output away from the terminal top edge", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      rows: 7,
      useColor: false,
    });

    renderer.render(source);
    for (let index = 1; index <= 4; index += 1) {
      source.emit({
        type: "task.completed",
        task: taskSnapshot({
          id: `done-${index}`,
          title: `Done ${index}`,
          initialTitle: `Done ${index}`,
          path: [`Done ${index}`],
          state: "success",
        }),
      });
    }
    source.emit({
      type: "task.started",
      task: taskSnapshot({
        id: "test",
        title: "Running tests (bun run test)",
        initialTitle: "Running tests",
        path: ["Running tests"],
        state: "running",
      }),
    });
    source.emit({
      type: "task.output",
      output: "Executing `bun run test`\nline 1\nline 2\nline 3\nline 4",
      task: taskSnapshot({
        id: "test",
        title: "Running tests (bun run test)",
        initialTitle: "Running tests",
        path: ["Running tests"],
        state: "running",
      }),
    });

    const liveFrame = chunks.at(-1) ?? "";
    expect(liveFrame.split("\n")).toHaveLength(5);
    expect(liveFrame).toContain("Running tests (bun run test)");
    expect(liveFrame).toContain("  › Executing `bun run test`");
    expect(liveFrame).toContain("  › line 4");
    expect(liveFrame).not.toContain("Done 1");
    expect(liveFrame.endsWith("\n")).toBe(false);

    renderer.end();
  });

  it("keeps completed task output only when persistent output is enabled", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      persistentOutput: true,
      useColor: false,
    });

    renderer.render(source);
    source.emit({
      type: "task.started",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    source.emit({
      type: "task.output",
      output: "artifact ready",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    source.emit({
      type: "task.completed",
      task: taskSnapshot({ path: ["Build"], state: "success" }),
    });
    renderer.end();

    expect(lastChunkContaining(chunks, "✔ Build")).toContain(
      "  › artifact ready",
    );
  });

  it("renders prompt output in the live frame and clears transient output after completion", async () => {
    vi.useFakeTimers();

    try {
      const chunks: string[] = [];
      const source = new EventSource();
      const renderer = new DefaultRenderer({
        output: {
          write: (chunk) => chunks.push(chunk),
        },
        spinnerInterval: 10,
        useColor: false,
      });
      const promptTask = taskSnapshot({
        title: "Checking version information",
        initialTitle: "Checking version information",
        path: ["Checking required information", "Checking version information"],
        state: "running",
      });
      const promptCapture = renderer.createPromptOutput(promptTask);

      renderer.render(source);
      source.emit({
        type: "task.started",
        task: taskSnapshot({
          title: "Checking version information",
          initialTitle: "Checking version information",
          path: [
            "Checking required information",
            "Checking version information",
          ],
          state: "running",
        }),
      });
      source.emit({
        type: "task.output",
        output: "Version Recommendations",
        task: taskSnapshot({
          title: "Checking version information",
          initialTitle: "Checking version information",
          path: [
            "Checking required information",
            "Checking version information",
          ],
          state: "running",
        }),
      });

      source.emit({
        type: "prompt.started",
        task: promptTask,
        prompt: { type: "select", message: "Enter npm access token" },
      });
      promptCapture.output.write("◆  Select version\n│  Recommended: patch");
      await flushPromptFrame();
      const promptFrame = lastChunkContaining(
        chunks,
        "Select version",
        "Version Recommendations",
      );
      const afterPromptFrame = chunks.length;
      vi.advanceTimersByTime(50);

      expect(promptFrame).toContain("Checking version information");
      expect(promptFrame).toContain("  › Version Recommendations");
      expect(promptFrame).toContain("◆  Select version");
      expect(chunks.length).toBeGreaterThan(afterPromptFrame);

      source.emit({
        type: "prompt.completed",
        task: taskSnapshot({
          title: "Checking version information",
          initialTitle: "Checking version information",
          path: [
            "Checking required information",
            "Checking version information",
          ],
          state: "running",
        }),
        prompt: { type: "select", message: "Enter npm access token" },
      });
      promptCapture.close();
      source.emit({
        type: "task.completed",
        task: taskSnapshot({
          title: "Checking version information",
          initialTitle: "Checking version information",
          path: [
            "Checking required information",
            "Checking version information",
          ],
          state: "success",
        }),
      });
      renderer.end();

      expect(
        lastChunkContaining(chunks, "✔ Checking version information"),
      ).not.toContain("Version Recommendations");
      expect(
        lastChunkContaining(chunks, "✔ Checking version information"),
      ).not.toContain("Select version");
    } finally {
      vi.useRealTimers();
    }
  });

  it("limits live task output to the latest entry by default", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });

    renderer.render(source);
    source.emit({
      type: "task.started",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    source.emit({
      type: "task.output",
      output: "first",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    source.emit({
      type: "task.output",
      output: "second",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    renderer.end();

    const latestFrame = lastChunkContaining(chunks, "Build", "second");
    expect(latestFrame).toContain("  › second");
    expect(latestFrame).not.toContain("  › first");
  });

  it("supports disabled, numeric, and infinite output bars", () => {
    const disabledChunks: string[] = [];
    const disabledSource = new EventSource();
    const disabledRenderer = new DefaultRenderer({
      output: {
        write: (chunk) => disabledChunks.push(chunk),
      },
      outputBar: false,
      useColor: false,
    });

    disabledRenderer.render(disabledSource);
    disabledSource.emit({
      type: "task.started",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    disabledSource.emit({
      type: "task.output",
      output: "suppressed",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    disabledRenderer.end();

    expect(disabledChunks.join("")).not.toContain("suppressed");

    const limitedChunks: string[] = [];
    const limitedSource = new EventSource();
    const limitedRenderer = new DefaultRenderer({
      output: {
        write: (chunk) => limitedChunks.push(chunk),
      },
      outputBar: 2,
      useColor: false,
    });

    limitedRenderer.render(limitedSource);
    limitedSource.emit({
      type: "task.started",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    for (const output of ["first", "second", "third"]) {
      limitedSource.emit({
        type: "task.output",
        output,
        task: taskSnapshot({ path: ["Build"], state: "running" }),
      });
    }
    limitedRenderer.end();

    const limitedFrame = lastChunkContaining(limitedChunks, "second", "third");
    expect(limitedFrame).not.toContain("first");

    const infiniteChunks: string[] = [];
    const infiniteSource = new EventSource();
    const infiniteRenderer = new DefaultRenderer({
      output: {
        write: (chunk) => infiniteChunks.push(chunk),
      },
      outputBar: Number.POSITIVE_INFINITY,
      useColor: false,
    });

    infiniteRenderer.render(infiniteSource);
    infiniteSource.emit({
      type: "task.started",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    for (const output of ["first", "second"]) {
      infiniteSource.emit({
        type: "task.output",
        output,
        task: taskSnapshot({ path: ["Build"], state: "running" }),
      });
    }
    infiniteRenderer.end();

    expect(lastChunkContaining(infiniteChunks, "first", "second")).toContain(
      "first",
    );
  });

  it("removes empty output lines in the live renderer by default", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });

    renderer.render(source);
    source.emit({
      type: "task.started",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    source.emit({
      type: "task.output",
      output: "line one\n\nline two",
      task: taskSnapshot({ path: ["Build"], state: "running" }),
    });
    renderer.end();

    const latestFrame = lastChunkContaining(chunks, "line one", "line two");
    expect(latestFrame).toContain("  › line one");
    expect(latestFrame).toContain("  › line two");
    expect(latestFrame).not.toContain("  › \n");
  });

  it("collapses successful completed subtasks by default", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });
    const parent = taskSnapshot({
      id: "parent",
      title: "Parent",
      initialTitle: "Parent",
      path: ["Parent"],
      state: "success",
    });

    renderer.render(source);
    source.emit({
      type: "task.subtasks",
      task: parent,
      tasks: [
        taskSnapshot({
          id: "child",
          title: "Child",
          initialTitle: "Child",
          path: ["Parent", "Child"],
          state: "success",
        }),
      ],
    });
    renderer.end();

    const finalFrame = lastChunkContaining(chunks, "✔ Parent");
    expect(finalFrame).not.toContain("Child");
  });

  it("supports lazy rendering, final clearing, and terminal-column wrapping", () => {
    vi.useFakeTimers();

    try {
      const chunks: string[] = [];
      const source = new EventSource();
      const renderer = new DefaultRenderer({
        output: {
          write: (chunk) => chunks.push(chunk),
        },
        clearOutput: true,
        columns: 4,
        lazy: true,
        spinnerInterval: 10,
        useColor: false,
      });

      renderer.render(source);
      source.emit({
        type: "task.started",
        task: taskSnapshot({
          title: "LongTitle",
          initialTitle: "LongTitle",
          path: ["LongTitle"],
          state: "running",
        }),
      });
      const afterStart = chunks.join("");
      vi.advanceTimersByTime(50);
      expect(chunks.join("")).toBe(afterStart);
      renderer.end();

      expect(afterStart).toContain("⠋ Lo\nngTi\ntle");
      expect(chunks.join("")).toContain("\u001b[?25h");
      expect(chunks.join("")).not.toContain("✔ LongTitle");
      expect(chunks.join("").split("\u001b[1A")).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues spinner redraws while prompts are active", async () => {
    vi.useFakeTimers();

    try {
      const chunks: string[] = [];
      const source = new EventSource();
      const renderer = new DefaultRenderer({
        output: {
          write: (chunk) => chunks.push(chunk),
        },
        spinnerInterval: 10,
        useColor: false,
      });
      const promptTask = taskSnapshot({
        title: "Prompt",
        initialTitle: "Prompt",
        path: ["Prompt"],
        state: "prompting",
      });
      const promptCapture = renderer.createPromptOutput(promptTask);

      renderer.render(source);
      source.emit({
        type: "task.started",
        task: taskSnapshot({
          title: "Prompt",
          initialTitle: "Prompt",
          path: ["Prompt"],
          state: "running",
        }),
      });
      const beforePrompt = chunks.length;
      source.emit({
        type: "prompt.started",
        task: promptTask,
        prompt: { type: "text", message: "Name" },
      });
      promptCapture.output.write("◇  Name\n│  pubm");
      await flushPromptFrame();
      const afterPromptStarted = chunks.length;
      vi.advanceTimersByTime(50);
      expect(chunks.length).toBeGreaterThan(afterPromptStarted);
      expect(chunks.join("")).toContain("◇  Name");
      source.emit({
        type: "prompt.completed",
        task: taskSnapshot({
          title: "Prompt",
          initialTitle: "Prompt",
          path: ["Prompt"],
          state: "running",
        }),
        prompt: { type: "text", message: "Name" },
      });
      promptCapture.close();
      vi.advanceTimersByTime(10);
      renderer.end();

      expect(beforePrompt).toBeGreaterThan(0);
      expect(chunks.join("")).toContain("⠙ Prompt");
      expect(chunks.join("")).toContain("Prompt");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps spinner redraws flowing during rapid prompt updates", async () => {
    vi.useFakeTimers();

    try {
      const chunks: string[] = [];
      const source = new EventSource();
      const renderer = new DefaultRenderer({
        output: {
          write: (chunk) => chunks.push(chunk),
        },
        spinnerInterval: 10,
        useColor: false,
      });
      const promptTask = taskSnapshot({
        title: "Prompt",
        initialTitle: "Prompt",
        path: ["Prompt"],
        state: "prompting",
      });
      const promptCapture = renderer.createPromptOutput(promptTask);

      renderer.render(source);
      source.emit({
        type: "task.started",
        task: taskSnapshot({
          title: "Prompt",
          initialTitle: "Prompt",
          path: ["Prompt"],
          state: "running",
        }),
      });
      source.emit({
        type: "prompt.started",
        task: promptTask,
        prompt: { type: "select", message: "Choice" },
      });
      promptCapture.output.write("◆  Choice\n│  one");
      await flushPromptFrame();
      const afterPromptFrame = chunks.length;

      for (const option of ["two", "three", "four", "five"]) {
        promptCapture.output.write(`◆  Choice\n│  ${option}`);
        await flushPromptFrame();
        vi.advanceTimersByTime(10);
      }

      expect(chunks.length).toBeGreaterThan(afterPromptFrame + 4);
      expect(chunks.join("")).toContain("⠙ Prompt");
      expect(chunks.join("")).toContain("⠹ Prompt");
      expect(chunks.join("")).toContain("◆  Choice");

      promptCapture.close();
      renderer.end();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears reflowed frame lines after terminal resize", () => {
    const restoreColumns = setColumns(process.stderr, 80);
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });

    try {
      renderer.render(source);
      source.emit({
        type: "task.started",
        task: taskSnapshot({ path: ["Build"], state: "running" }),
      });
      source.emit({
        type: "task.output",
        output: "x".repeat(70),
        task: taskSnapshot({ path: ["Build"], state: "running" }),
      });

      process.stderr.columns = 20;
      const beforeResize = chunks.length;
      process.stderr.emit("resize");
      const resizeOutput = chunks.slice(beforeResize).join("");

      expect(
        countOccurrences(resizeOutput, "\r\u001b[2K"),
      ).toBeGreaterThanOrEqual(5);
      expect(lastChunkContaining(chunks, "Build", "xxxxxxxx")).toContain("\n");
      renderer.end();
    } finally {
      restoreColumns();
    }
  });

  it("forwards terminal resize events to active prompt outputs only", () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });
    const promptTask = taskSnapshot({
      title: "Prompt",
      initialTitle: "Prompt",
      path: ["Prompt"],
      state: "prompting",
    });
    const promptCapture = renderer.createPromptOutput(promptTask);
    const listener = vi.fn();

    promptCapture.output.on("resize", listener);
    renderer.render(source);
    source.emit({ type: "task.started", task: promptTask });

    process.stderr.emit("resize");
    expect(listener).toHaveBeenCalledOnce();

    promptCapture.close();
    process.stderr.emit("resize");
    expect(listener).toHaveBeenCalledOnce();

    renderer.end();
    process.stderr.emit("resize");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("batches prompt frame writes so partial prompt redraws do not flicker", async () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });
    const promptTask = taskSnapshot({
      title: "Prompt",
      initialTitle: "Prompt",
      path: ["Prompt"],
      state: "prompting",
    });
    const promptCapture = renderer.createPromptOutput(promptTask);

    renderer.render(source);
    source.emit({ type: "task.started", task: promptTask });
    promptCapture.output.write("Old prompt\nold option");
    await flushPromptFrame();

    const beforeReplacement = chunks.length;
    promptCapture.output.write("\u001b[1A\r\u001b[J");
    promptCapture.output.write("New prompt\nnew option");
    expect(chunks).toHaveLength(beforeReplacement);
    await flushPromptFrame();
    renderer.end();

    const latestPromptFrame = lastChunkContaining(chunks, "New prompt");
    expect(latestPromptFrame).toContain("new option");
    expect(latestPromptFrame).not.toContain("Old prompt");
    expect(latestPromptFrame).not.toContain("old option");
  });

  it("ignores pending prompt frame flushes after capture close", async () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });
    const promptTask = taskSnapshot({
      title: "Prompt",
      initialTitle: "Prompt",
      path: ["Prompt"],
      state: "prompting",
    });
    const promptCapture = renderer.createPromptOutput(promptTask);

    renderer.render(source);
    source.emit({ type: "task.started", task: promptTask });
    promptCapture.output.write("Hidden prompt");
    promptCapture.close();
    await flushPromptFrame();
    renderer.end();

    expect(chunks.join("")).not.toContain("Hidden prompt");
  });

  it("does not move the prompt cursor when erasing the current line", async () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });
    const promptTask = taskSnapshot({
      title: "Prompt",
      initialTitle: "Prompt",
      path: ["Prompt"],
      state: "prompting",
    });
    const promptCapture = renderer.createPromptOutput(promptTask);

    renderer.render(source);
    source.emit({ type: "task.started", task: promptTask });
    promptCapture.output.write("abc\u001b[2KX");
    await flushPromptFrame();
    renderer.end();

    const latestPromptFrame = lastChunkContaining(chunks, "X");
    expect(latestPromptFrame).toContain("   X");
  });

  it("erases from line start through the cursor cell for CSI 1 K", async () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });
    const promptTask = taskSnapshot({
      title: "Prompt",
      initialTitle: "Prompt",
      path: ["Prompt"],
      state: "prompting",
    });
    const promptCapture = renderer.createPromptOutput(promptTask);

    renderer.render(source);
    source.emit({ type: "task.started", task: promptTask });
    promptCapture.output.write("abcde\u001b[3G\u001b[1K");
    await flushPromptFrame();
    renderer.end();

    const latestPromptFrame = lastChunkContaining(chunks, "de");
    expect(latestPromptFrame).toContain("   de");
    expect(latestPromptFrame).not.toContain("cde");
  });

  it("preserves the prompt cursor position for CSI 1 J", async () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      useColor: false,
    });
    const promptTask = taskSnapshot({
      title: "Prompt",
      initialTitle: "Prompt",
      path: ["Prompt"],
      state: "prompting",
    });
    const promptCapture = renderer.createPromptOutput(promptTask);

    renderer.render(source);
    source.emit({ type: "task.started", task: promptTask });
    promptCapture.output.write("first\nsecond\u001b[1JX");
    await flushPromptFrame();
    renderer.end();

    const latestPromptFrame = lastChunkContaining(chunks, "X");
    expect(latestPromptFrame).toContain("      X");
    expect(latestPromptFrame).not.toContain("first");
    expect(latestPromptFrame).not.toContain("second");
  });

  it("applies prompt cursor movement, erase controls, and output listeners", async () => {
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      columns: 12,
      rows: 6,
      useColor: false,
    });
    const promptTask = taskSnapshot({
      title: "Prompt",
      initialTitle: "Prompt",
      path: ["Prompt"],
      state: "prompting",
    });
    const promptCapture = renderer.createPromptOutput(promptTask);
    const listener = vi.fn();

    expect(promptCapture.output.columns).toBe(12);
    expect(promptCapture.output.rows).toBe(6);
    promptCapture.output.on("resize", listener);
    promptCapture.output.off("resize", listener);
    promptCapture.output.off("resize");

    renderer.render(source);
    source.emit({ type: "task.started", task: promptTask });
    promptCapture.output.write("abcd\nwxyz");
    promptCapture.output.write("\u001b[1A!\u001b[1B?\u001b[1Dq\u001b[1Eend");
    promptCapture.output.write("\u001b[1Frow\u001b[3Gro");
    promptCapture.output.write("\u001b[1;2Hh\u001b[2;1ff");
    promptCapture.output.write("\u001b[Jj");
    promptCapture.output.write("\u001b[2Jreset\nsecond\u001b[1Jtop");
    await flushPromptFrame();
    promptCapture.output.write("abcde\u001b[3G\u001b[1K\u001b[Kz");
    promptCapture.output.write("\u001b]0;title\u0007\u001b]0;title\u001b\\");
    promptCapture.output.write("\u001bxvisible\u001b[12\u001b]0;unterminated");
    await flushPromptFrame();
    renderer.end();

    const output = chunks.join("");
    expect(output).toContain("top");
    expect(output).toContain("zvisible");
    expect(normalizeTerminalText(output)).not.toContain("title");
  });

  it("renders nested task states, suffixes, and child output", () => {
    const previousForceUnicode = process.env.FORCE_UNICODE;
    process.env.FORCE_UNICODE = "1";
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      collapseSubtasks: false,
      useColor: false,
    });

    try {
      const parent = taskSnapshot({
        id: "parent",
        title: "Release",
        initialTitle: "Release",
        path: ["Release"],
        state: "running",
      });
      const autoChild = taskSnapshot({
        id: "auto-child",
        title: "Auto child",
        initialTitle: "Auto child",
        path: ["Release", "Auto child"],
        state: "waiting",
      });
      const child = (
        id: string,
        title: string,
        state: RuntimeTaskSnapshot["state"],
        message?: RuntimeTaskSnapshot["message"],
      ) =>
        taskSnapshot({
          id,
          title,
          initialTitle: title,
          path: ["Release", title],
          state,
          message,
        });

      renderer.render(source);
      source.emit({ type: "task.started", task: parent });
      source.emit({ type: "task.started", task: autoChild });
      source.emit({
        type: "task.subtasks",
        task: { ...parent, state: "success" },
        tasks: [
          child("blocked", "Blocked", "blocked"),
          child("failed", "Failed", "failed", { error: "broken" }),
          child("retrying", "Retrying", "retrying", { retry: { count: 3 } }),
          child("rollback", "Rollback", "rolled-back", {
            rollback: "Restored files",
          }),
          child("skipped", "Skipped", "skipped", { skip: "Already done" }),
          child("success", "Success", "success"),
          child("rolling-back", "Undo", "rolling-back"),
          child("prompting", "Waiting input", "prompting"),
        ],
      });
      renderer.end();

      const output = chunks.join("");
      expect(output).toContain("✔ Release");
      expect(output).toContain("  ❯ Auto child");
      expect(output).not.toContain("Blocked");
      expect(output).toContain("  ✖ Failed: broken");
      expect(output).toContain("  ⠋ Retrying (attempt 3)");
      expect(output).toContain("  ← Rollback: Restored files");
      expect(output).toContain("  ↓ Skipped: Already done");
      expect(output).toContain("  ✔ Success");
      expect(output).toContain("Undo");
      expect(output).toContain("Waiting input");
      expect(output.indexOf("Auto child")).toBeLessThan(
        output.indexOf("Failed"),
      );
    } finally {
      if (previousForceUnicode === undefined) {
        delete process.env.FORCE_UNICODE;
      } else {
        process.env.FORCE_UNICODE = previousForceUnicode;
      }
    }
  });

  it("does not render blocked tasks in the live task list", () => {
    const previousForceUnicode = process.env.FORCE_UNICODE;
    process.env.FORCE_UNICODE = "1";
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      collapseSubtasks: false,
      useColor: false,
    });

    try {
      const blockedRoot = taskSnapshot({
        id: "blocked-root",
        title: "Publishing",
        initialTitle: "Publishing",
        path: ["Publishing"],
        state: "blocked",
      });
      const runningRoot = taskSnapshot({
        id: "running-root",
        title: "Validating publish (dry-run)",
        initialTitle: "Validating publish (dry-run)",
        path: ["Validating publish (dry-run)"],
        state: "running",
      });

      renderer.render(source);
      source.emit({ type: "task.blocked", task: blockedRoot });
      source.emit({ type: "task.started", task: runningRoot });
      renderer.end();

      const output = chunks.join("");
      expect(output).not.toContain("Publishing");
      expect(output).toContain("Validating publish (dry-run)");
    } finally {
      if (previousForceUnicode === undefined) {
        delete process.env.FORCE_UNICODE;
      } else {
        process.env.FORCE_UNICODE = previousForceUnicode;
      }
    }
  });

  it("preserves task event order instead of sorting task titles", () => {
    const previousForceUnicode = process.env.FORCE_UNICODE;
    process.env.FORCE_UNICODE = "1";
    const chunks: string[] = [];
    const source = new EventSource();
    const renderer = new DefaultRenderer({
      output: {
        write: (chunk) => chunks.push(chunk),
      },
      collapseSubtasks: false,
      useColor: false,
    });

    try {
      const root = (
        id: string,
        title: string,
        path: string[] = [title],
      ): RuntimeTaskSnapshot =>
        taskSnapshot({
          id,
          title,
          initialTitle: title,
          path,
          state: "success",
        });

      renderer.render(source);
      source.emit({ type: "task.completed", task: root("test", "Test") });
      source.emit({ type: "task.completed", task: root("build", "Build") });
      source.emit({
        type: "task.subtasks",
        task: root("parent", "Parent"),
        tasks: [
          root("zebra", "Zebra", ["Parent", "Zebra"]),
          root("alpha", "Alpha", ["Parent", "Alpha"]),
        ],
      });
      renderer.end();

      const finalFrame = chunks
        .filter(
          (chunk) =>
            chunk.includes("Test") &&
            chunk.includes("Build") &&
            chunk.includes("Zebra") &&
            chunk.includes("Alpha"),
        )
        .at(-1);

      expect(finalFrame).toBeDefined();
      const frame = finalFrame ?? "";
      expect(frame.indexOf("Test")).toBeLessThan(frame.indexOf("Build"));
      expect(frame.indexOf("Zebra")).toBeLessThan(frame.indexOf("Alpha"));
    } finally {
      if (previousForceUnicode === undefined) {
        delete process.env.FORCE_UNICODE;
      } else {
        process.env.FORCE_UNICODE = previousForceUnicode;
      }
    }
  });

  it("uses stderr as the default raw writer", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const source = new EventSource();
    const renderer = new DefaultRenderer({ useColor: false });

    try {
      renderer.render(source);
      renderer.end();

      expect(write).toHaveBeenCalledWith("\u001b[?25l");
      expect(write).toHaveBeenCalledWith("\u001b[?25h");
    } finally {
      write.mockRestore();
    }
  });
});

describe("SilentRenderer and TestRenderer", () => {
  it("silently ignores events and records test renderer results until end", () => {
    const source = new EventSource();
    const silent = new SilentRenderer();
    const test = new TestRenderer();

    silent.render(source);
    test.render(source);
    source.emit({ type: "task.started", task: taskSnapshot() });
    test.end({ status: "success", errors: [] });
    source.emit({ type: "task.completed", task: taskSnapshot() });
    silent.end();

    expect(test.events).toHaveLength(1);
    expect(test.result).toEqual({ status: "success", errors: [] });
  });
});
