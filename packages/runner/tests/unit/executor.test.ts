import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createCiRunnerOptions, createTaskRunner } from "../../src/executor.js";
import { DefaultRenderer } from "../../src/renderer.js";
import { RuntimeTask } from "../../src/runtime-task.js";
import type {
  ObservableLike,
  PromptOptions,
  PromptOutputCapture,
  PromptProvider,
  PromptWritable,
  ReadableLike,
  RuntimeTaskSnapshot,
  SignalController,
  Task,
  TaskContext,
  TaskEvent,
  TaskEventSource,
  TaskRenderer,
  TaskRunResult,
} from "../../src/types.js";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

class RecordingRenderer implements TaskRenderer {
  readonly events: TaskEvent[] = [];
  result?: TaskRunResult | Error;
  private unsubscribe?: () => void;

  render(source: TaskEventSource): void {
    this.unsubscribe = source.subscribe((event) => {
      this.events.push(event);
    });
  }

  end(result?: TaskRunResult | Error): void {
    this.result = result;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}

class FakePromptOutput implements PromptWritable {
  readonly columns = 80;
  readonly isTTY = true;
  readonly write = vi.fn(() => true);

  on(): this {
    return this;
  }

  off(): this {
    return this;
  }
}

class PromptCapturingRenderer extends RecordingRenderer {
  readonly captures: PromptOutputCapture[] = [];
  readonly createPromptOutput = vi.fn(
    (_task: RuntimeTaskSnapshot): PromptOutputCapture => {
      const capture = {
        output: new FakePromptOutput(),
        close: vi.fn(),
      };
      this.captures.push(capture);
      return capture;
    },
  );
}

class PromptCapturingRendererFactory extends PromptCapturingRenderer {
  static nonTTY = true;
  static instances: PromptCapturingRendererFactory[] = [];

  constructor(_options?: Record<string, unknown>) {
    super();
    PromptCapturingRendererFactory.instances.push(this);
  }
}

class RecordingSignalController implements SignalController {
  readonly interruptHandlers: ((
    signal: NodeJS.Signals,
  ) => void | Promise<void>)[] = [];
  readonly terminateHandlers: ((
    signal: NodeJS.Signals,
  ) => void | Promise<void>)[] = [];
  readonly dispose = vi.fn();

  onInterrupt(handler: (signal: NodeJS.Signals) => void | Promise<void>): void {
    this.interruptHandlers.push(handler);
  }

  onTerminate(handler: (signal: NodeJS.Signals) => void | Promise<void>): void {
    this.terminateHandlers.push(handler);
  }
}

class RecordingPromptProvider implements PromptProvider {
  readonly prompt = vi.fn(
    async <T = unknown>(_options: PromptOptions): Promise<T> => undefined as T,
  );
}

class FakeReadable extends EventEmitter implements ReadableLike {
  readable = true;

  read(): unknown {
    return undefined;
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setTTY(stream: NodeJS.WriteStream, value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, "isTTY");
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(stream, "isTTY", descriptor);
    } else {
      delete (stream as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    }
  };
}

async function withTTY(
  value: boolean,
  run: () => Promise<void>,
): Promise<void> {
  const restoreStdout = setTTY(process.stdout, value);
  const restoreStderr = setTTY(process.stderr, value);
  try {
    await run();
  } finally {
    restoreStderr();
    restoreStdout();
  }
}

function lastChunkContaining(chunks: readonly string[], ...needles: string[]) {
  return (
    chunks
      .filter((chunk) => needles.every((needle) => chunk.includes(needle)))
      .at(-1) ?? ""
  );
}

describe("PubmTaskRunner execution", () => {
  it("runs tasks sequentially by default", async () => {
    const order: string[] = [];

    await createTaskRunner(
      [
        {
          title: "first",
          task: async () => {
            order.push("first:start");
            await Promise.resolve();
            order.push("first:end");
          },
        },
        {
          title: "second",
          task: () => {
            order.push("second");
          },
        },
      ],
      { renderer: new RecordingRenderer(), registerSignalListeners: false },
    ).run({});

    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("runs tasks concurrently when concurrency is enabled", async () => {
    const releaseFirst = deferred();
    const order: string[] = [];

    await createTaskRunner(
      [
        {
          title: "first",
          task: async () => {
            order.push("first:start");
            await releaseFirst.promise;
            order.push("first:end");
          },
        },
        {
          title: "second",
          task: () => {
            order.push("second:start");
            releaseFirst.resolve(undefined);
            order.push("second:end");
          },
        },
      ],
      {
        concurrent: true,
        renderer: new RecordingRenderer(),
        registerSignalListeners: false,
      },
    ).run({});

    expect(order).toEqual([
      "first:start",
      "second:start",
      "second:end",
      "first:end",
    ]);
  });

  it("stops scheduling new tasks after a fatal concurrent failure", async () => {
    const renderer = new RecordingRenderer();
    const releaseSlow = deferred();
    const order: string[] = [];

    const run = createTaskRunner(
      [
        {
          title: "fail",
          task: () => {
            order.push("fail");
            throw new Error("fatal");
          },
        },
        {
          title: "slow",
          task: async () => {
            order.push("slow:start");
            await releaseSlow.promise;
            order.push("slow:end");
          },
        },
        {
          title: "after",
          task: () => {
            order.push("after");
          },
        },
      ],
      {
        concurrent: 2,
        renderer,
        registerSignalListeners: false,
      },
    ).run({});

    await vi.waitFor(() =>
      expect(
        renderer.events.some(
          (event) =>
            event.type === "task.failed" &&
            event.task?.path.join("/") === "fail",
        ),
      ).toBe(true),
    );
    releaseSlow.resolve(undefined);

    await expect(run).rejects.toThrow("fatal");
    expect(order).toEqual(["fail", "slow:start", "slow:end"]);
  });

  it("runs nested newListr tasks with parent paths and shared context", async () => {
    interface NestedContext {
      steps: string[];
    }

    const renderer = new RecordingRenderer();
    const ctx: NestedContext = { steps: [] };
    const nestedTasks = vi.fn(
      (
        parent: Omit<TaskContext<NestedContext>, "skip">,
      ): Task<NestedContext>[] => {
        ctx.steps.push(`factory:${parent.title}`);
        return [
          {
            title: "child",
            task: (context, task) => {
              context.steps.push(`child:${task.task.path.join("/")}`);
              task.output = "nested output";
            },
          },
        ];
      },
    );

    await createTaskRunner<NestedContext>(
      {
        title: "parent",
        task: (context, task) => {
          context.steps.push("parent");
          return task.newListr(nestedTasks);
        },
      },
      { renderer, registerSignalListeners: false },
    ).run(ctx);

    const subtaskEvent = renderer.events.find(
      (event) => event.type === "task.subtasks",
    );
    const outputEvent = renderer.events.find(
      (event) =>
        event.type === "task.output" &&
        event.output === "nested output" &&
        event.task?.path.join("/") === "parent/child",
    );

    expect(ctx.steps).toEqual([
      "parent",
      "factory:parent",
      "child:parent/child",
    ]);
    expect(nestedTasks).toHaveBeenCalledTimes(1);
    expect(subtaskEvent?.task?.path).toEqual(["parent"]);
    expect(subtaskEvent?.tasks?.map((task) => task.path)).toEqual([
      ["parent", "child"],
    ]);
    expect(outputEvent).toBeDefined();
  });

  it("creates child task paths when a parent task is passed to createTaskRunner", async () => {
    const paths: string[] = [];
    const parentTask = new RuntimeTask({ title: "parent" }, ["parent"], {
      emit: vi.fn(),
    });
    const runner = createTaskRunner(
      {
        title: "child",
        task: (_context, task) => {
          paths.push(task.task.path.join("/"));
        },
      },
      { registerSignalListeners: false },
      parentTask,
    );

    expect(runner.isRoot()).toBe(false);
    await runner.run({});

    expect(paths).toEqual(["parent/child"]);
  });

  it("emits renderer lifecycle events and passes the final result to end", async () => {
    const renderer = new RecordingRenderer();

    await createTaskRunner(
      {
        title: "build",
        task: (_context, task) => {
          task.title = "build (bun test)";
          task.output = "done";
        },
      },
      { renderer, registerSignalListeners: false },
    ).run({});

    expect(renderer.events.map((event) => event.type)).toEqual([
      "run.started",
      "run.tasks",
      "task.enabled",
      "task.started",
      "task.title",
      "task.output",
      "task.completed",
      "task.closed",
      "run.completed",
    ]);
    expect(renderer.result).toEqual({ status: "success", errors: [] });
  });

  it("adds tasks after construction and forwards events to external sinks", async () => {
    const renderer = new RecordingRenderer();
    const sink = { emit: vi.fn() };
    const order: string[] = [];
    const runner = createTaskRunner(
      {
        task: () => {
          order.push("initial");
        },
      },
      { renderer, eventSinks: [sink], registerSignalListeners: false },
    );

    runner.add({
      title: "second",
      task: () => {
        order.push("second");
      },
    });
    runner.add([
      {
        task: () => {
          order.push("third");
        },
      },
    ]);

    await runner.run({});

    expect(order).toEqual(["initial", "second", "third"]);
    expect(
      renderer.events
        .filter((event) => event.type === "task.started")
        .map((event) => event.task?.path),
    ).toEqual([["background task"], ["second"], ["background task"]]);
    expect(sink.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run.started" }),
    );
    expect(sink.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ path: ["second"] }),
        type: "task.completed",
      }),
    );
  });

  it("adds child-runner tasks with parent-prefixed paths", async () => {
    const renderer = new RecordingRenderer();
    const paths: string[] = [];

    await createTaskRunner(
      {
        title: "parent",
        task: async (context, task) => {
          const child = task.newTaskRunner([
            {
              title: "initial",
              task: (_childContext, childTask) => {
                paths.push(childTask.task.path.join("/"));
              },
            },
          ]) as {
            add(tasks: Task<object> | Task<object>[]): void;
            run(ctx: object): Promise<object>;
          };
          child.add({
            title: "dynamic",
            task: (_childContext, childTask) => {
              paths.push(childTask.task.path.join("/"));
            },
          });

          await child.run(context);
        },
      },
      { renderer, registerSignalListeners: false },
    ).run({});

    expect(paths).toEqual(["parent/initial", "parent/dynamic"]);
    expect(
      renderer.events
        .filter((event) => event.type === "task.subtasks")
        .map((event) => event.tasks?.map((task) => task.path.join("/"))),
    ).toEqual([["parent/initial", "parent/dynamic"]]);
  });

  it("uses option context, blocks disabled tasks, and skips predicate-only tasks", async () => {
    interface Context {
      ran: string[];
    }

    const renderer = new RecordingRenderer();
    const ctx: Context = { ran: [] };

    await createTaskRunner<Context>(
      [
        {
          title: "disabled",
          enabled: (context) => {
            context.ran.push("enabled-check");
            return false;
          },
          task: (context) => {
            context.ran.push("disabled-task");
          },
        },
        {
          skip: true,
          task: (context) => {
            context.ran.push("skipped-task");
          },
        },
        {
          title: "after",
          task: (context) => {
            context.ran.push("after");
          },
        },
      ],
      {
        ctx,
        renderer,
        registerSignalListeners: false,
      },
    ).run();

    const blocked = renderer.events.find(
      (event) => event.type === "task.blocked",
    );
    const skipped = renderer.events.find(
      (event) => event.type === "task.skipped",
    );

    expect(ctx.ran).toEqual(["enabled-check", "after"]);
    expect(blocked?.task?.path).toEqual(["disabled"]);
    expect(skipped?.task?.message?.skip).toBe("Skipped task without a title.");
  });

  it("supports context snapshots, prompt output, custom events, reports, and skip without a message", async () => {
    const renderer = new RecordingRenderer();

    await createTaskRunner(
      {
        title: "inspect",
        task: (_context, task) => {
          expect(task.title).toBe("inspect");
          expect(task.output).toBe("");
          expect(task.promptOutput).toBe("");
          expect(task.task).toMatchObject({
            initialTitle: "inspect",
            path: ["inspect"],
            state: "running",
            title: "inspect",
          });

          task.promptOutput = "answering";
          task.report(new Error("typed failure"), "validation");
          task.emit({ type: "task.output", output: "custom event" });
          task.skip();
        },
      },
      { renderer, registerSignalListeners: false },
    ).run({});

    expect(
      renderer.events.map((event) => [
        event.type,
        event.task?.message,
        event.output,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["task.prompt-output", undefined, "answering"],
        [
          "task.message",
          { error: "typed failure", type: "validation" },
          undefined,
        ],
        [
          "task.output",
          { error: "typed failure", type: "validation" },
          "custom event",
        ],
        [
          "task.skipped",
          { error: "typed failure", type: "validation" },
          undefined,
        ],
      ]),
    );
  });

  it("runs nested newTaskRunner tasks and exposes child runner identity", async () => {
    const renderer = new RecordingRenderer();
    const paths: string[] = [];

    await createTaskRunner(
      {
        title: "parent",
        task: async (context, task) => {
          const child = task.newTaskRunner([
            {
              title: "child",
              task: (_childContext, childTask) => {
                paths.push(childTask.task.path.join("/"));
              },
            },
          ]) as {
            isRoot(): boolean;
            isSubtask(): boolean;
            run(ctx: object): Promise<object>;
          };

          expect(child.isRoot()).toBe(false);
          expect(child.isSubtask()).toBe(true);
          await child.run(context);
        },
      },
      { renderer, registerSignalListeners: false },
    ).run({});

    expect(paths).toEqual(["parent/child"]);
    expect(
      renderer.events
        .filter((event) => event.type === "task.subtasks")
        .map((event) => event.tasks?.map((task) => task.path.join("/"))),
    ).toEqual([[["parent/child"][0]]]);
  });

  it("serializes prompt state events and rejects overlapping task prompts", async () => {
    interface Context {
      answer?: string;
      overlap?: string;
    }

    const renderer = new RecordingRenderer();
    const provider = new RecordingPromptProvider();
    const prompt = deferred<string>();
    provider.prompt.mockImplementationOnce(async () => prompt.promise);
    const ctx: Context = {};

    await createTaskRunner<Context>(
      {
        title: "ask",
        task: async (context, task) => {
          const first = task.prompt().run<string>({
            type: "text",
            message: "Name",
          });

          await vi.waitFor(() =>
            expect(provider.prompt).toHaveBeenCalledTimes(1),
          );
          await expect(
            task.prompt().run({ type: "text", message: "Again" }),
          ).rejects.toThrow("already an active prompt");

          prompt.resolve("pubm");
          context.answer = await first;
          context.overlap = "rejected";
        },
      },
      { promptProvider: provider, renderer, registerSignalListeners: false },
    ).run(ctx);

    expect(ctx).toEqual({ answer: "pubm", overlap: "rejected" });
    expect(
      renderer.events
        .filter((event) => event.type.startsWith("prompt."))
        .map((event) => event.type),
    ).toEqual(["prompt.started", "prompt.completed"]);
  });

  it("injects renderer prompt output capture without exposing it in lifecycle events", async () => {
    const renderer = new PromptCapturingRenderer();
    const provider = new RecordingPromptProvider();
    provider.prompt.mockResolvedValueOnce("pubm");

    await createTaskRunner(
      {
        title: "ask",
        task: async (_context, task) => {
          await task.prompt().run({ type: "text", message: "Name" });
        },
      },
      { promptProvider: provider, renderer, registerSignalListeners: false },
    ).run({});

    expect(renderer.createPromptOutput).toHaveBeenCalledOnce();
    expect(provider.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ output: renderer.captures[0]?.output }),
    );
    expect(renderer.captures[0]?.close).toHaveBeenCalledOnce();
    expect(
      renderer.events
        .filter((event) => event.type.startsWith("prompt."))
        .map((event) => event.prompt?.output),
    ).toEqual([undefined, undefined]);
  });

  it("uses the root renderer prompt capture for nested task runners", async () => {
    PromptCapturingRendererFactory.instances = [];
    const provider = new RecordingPromptProvider();
    provider.prompt.mockResolvedValueOnce("pubm");

    await createTaskRunner(
      {
        title: "parent",
        task: async (_context, task) => {
          await task
            .newListr([
              {
                title: "child",
                task: async (_childContext, childTask) => {
                  await childTask.prompt().run({
                    type: "text",
                    message: "Name",
                  });
                },
              },
            ])
            .run(_context);
        },
      },
      {
        promptProvider: provider,
        renderer: PromptCapturingRendererFactory,
        registerSignalListeners: false,
      },
    ).run({});

    expect(PromptCapturingRendererFactory.instances).toHaveLength(1);
    expect(PromptCapturingRendererFactory.instances[0]?.captures).toHaveLength(
      1,
    );
  });

  it("keeps nested prompt output inside root live redraws", async () => {
    vi.useFakeTimers();

    try {
      await withTTY(true, async () => {
        const chunks: string[] = [];
        const provider = new RecordingPromptProvider();
        const answer = deferred<string>();
        provider.prompt.mockImplementationOnce(
          async <T = unknown>(options: PromptOptions): Promise<T> => {
            (options.output as PromptWritable).write(
              "◆  Select version\n● Accept\n○ Skip",
            );
            return (await answer.promise) as T;
          },
        );

        const run = createTaskRunner(
          {
            title: "Checking required information",
            task: async (context, task) => {
              await task
                .newListr([
                  {
                    title: "Checking version information",
                    task: async (_childContext, childTask) => {
                      childTask.output =
                        "Version Recommendations\nchangeset packages/core minor";
                      await childTask.prompt().run({
                        type: "select",
                        message: "Select version",
                        choices: [
                          { name: "accept", message: "Accept" },
                          { name: "skip", message: "Skip" },
                        ],
                      });
                    },
                  },
                ])
                .run(context);
            },
          },
          {
            promptProvider: provider,
            renderer: DefaultRenderer,
            rendererOptions: {
              output: {
                write: (chunk: string) => {
                  chunks.push(chunk);
                },
              },
              spinnerInterval: 10,
              useColor: false,
            },
            registerSignalListeners: false,
          },
        ).run({});

        await vi.waitFor(() => expect(provider.prompt).toHaveBeenCalledOnce());
        expect(
          lastChunkContaining(
            chunks,
            "Select version",
            "Version Recommendations",
          ),
        ).toContain("Accept");

        vi.advanceTimersByTime(30);

        expect(
          lastChunkContaining(
            chunks,
            "Checking required information",
            "Select version",
          ),
        ).toContain("Accept");

        answer.resolve("accept");
        await run;
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects explicit prompt output and skips renderer prompt capture", async () => {
    const renderer = new PromptCapturingRenderer();
    const provider = new RecordingPromptProvider();
    const output = new FakePromptOutput();
    provider.prompt.mockResolvedValueOnce("pubm");

    await createTaskRunner(
      {
        title: "ask",
        task: async (_context, task) => {
          await task.prompt().run({ type: "text", message: "Name", output });
        },
      },
      { promptProvider: provider, renderer, registerSignalListeners: false },
    ).run({});

    expect(renderer.createPromptOutput).not.toHaveBeenCalled();
    expect(provider.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ output }),
    );
  });

  it("leaves prompt output untouched for renderers without prompt capture", async () => {
    const renderer = new RecordingRenderer();
    const provider = new RecordingPromptProvider();
    provider.prompt.mockResolvedValueOnce("pubm");

    await createTaskRunner(
      {
        title: "ask",
        task: async (_context, task) => {
          await task.prompt().run({ type: "text", message: "Name" });
        },
      },
      { promptProvider: provider, renderer, registerSignalListeners: false },
    ).run({});

    expect(provider.prompt).toHaveBeenCalledWith(
      expect.not.objectContaining({ output: expect.anything() }),
    );
  });

  it("emits queued prompt lifecycle only after acquiring the shared prompt coordinator", async () => {
    interface Context {
      answers: string[];
    }

    const renderer = new RecordingRenderer();
    const provider = new RecordingPromptProvider();
    const firstPrompt = deferred<string>();
    const secondPrompt = deferred<string>();
    const secondQueued = deferred();
    provider.prompt
      .mockImplementationOnce(async () => firstPrompt.promise)
      .mockImplementationOnce(async () => secondPrompt.promise);
    const ctx: Context = { answers: [] };

    const run = createTaskRunner<Context>(
      [
        {
          title: "first",
          task: async (context, task) => {
            const answer = await task.prompt().run<string>({
              type: "text",
              message: "First",
            });
            context.answers.push(`first:${answer}`);
          },
        },
        {
          title: "second",
          task: async (context, task) => {
            secondQueued.resolve(undefined);
            const answer = await task.prompt().run<string>({
              type: "text",
              message: "Second",
            });
            context.answers.push(`second:${answer}`);
          },
        },
      ],
      {
        concurrent: true,
        promptProvider: provider,
        renderer,
        registerSignalListeners: false,
      },
    ).run(ctx);

    await vi.waitFor(() => expect(provider.prompt).toHaveBeenCalledTimes(1));
    await secondQueued.promise;
    expect(
      renderer.events
        .filter((event) => event.type === "prompt.started")
        .map((event) => event.task?.path.join("/")),
    ).toEqual(["first"]);

    firstPrompt.resolve("one");
    await vi.waitFor(() => expect(provider.prompt).toHaveBeenCalledTimes(2));
    expect(
      renderer.events
        .filter((event) => event.type === "prompt.started")
        .map((event) => event.task?.path.join("/")),
    ).toEqual(["first", "second"]);

    secondPrompt.resolve("two");
    await run;

    expect(ctx.answers).toEqual(["first:one", "second:two"]);
  });

  it("marks prompts failed when the prompt provider rejects", async () => {
    const renderer = new RecordingRenderer();
    const provider = new RecordingPromptProvider();
    provider.prompt.mockRejectedValueOnce(new Error("cancelled"));

    await expect(
      createTaskRunner(
        {
          title: "ask",
          task: (_context, task) =>
            task.prompt().run({ type: "confirm", message: "Continue?" }),
        },
        { promptProvider: provider, renderer, registerSignalListeners: false },
      ).run({}),
    ).rejects.toThrow("cancelled");

    expect(
      renderer.events
        .filter((event) => event.type.startsWith("prompt."))
        .map((event) => [event.type, event.task?.state]),
    ).toEqual([
      ["prompt.started", "running"],
      ["prompt.failed", "failed"],
    ]);
  });

  it("handles string, readable, and observable task returns as output", async () => {
    const renderer = new RecordingRenderer();
    const readable = new FakeReadable();
    const observable: ObservableLike<string> = {
      subscribe(observer) {
        observer.next("observable one");
        observer.next("observable two");
        observer.complete();
        return undefined;
      },
    };

    await createTaskRunner(
      [
        {
          title: "string",
          task: () => "string output",
        },
        {
          title: "readable",
          task: () => {
            setTimeout(() => {
              readable.emit("data", "readable one");
              readable.emit("data", "readable two");
              readable.emit("end");
            }, 0);
            return readable;
          },
        },
        {
          title: "observable",
          task: () => observable,
        },
        {
          title: "empty",
        },
      ],
      { renderer, registerSignalListeners: false },
    ).run({});

    expect(
      renderer.events
        .filter((event) => event.type === "task.output")
        .map((event) => [event.task?.path.join("/"), event.output]),
    ).toEqual([
      ["string", "string output"],
      ["readable", "readable one"],
      ["readable", "readable two"],
      ["observable", "observable one"],
      ["observable", "observable two"],
    ]);
  });

  it("completes readable task returns that close without end", async () => {
    const renderer = new RecordingRenderer();
    const readable = new FakeReadable();

    const run = createTaskRunner(
      {
        title: "readable",
        task: () => {
          setTimeout(() => {
            readable.emit("data", "closing");
            readable.emit("close");
          }, 0);
          return readable;
        },
      },
      { renderer, registerSignalListeners: false },
    ).run({});

    await expect(
      Promise.race([
        run,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("timed out waiting for readable close")),
            50,
          ),
        ),
      ]),
    ).resolves.toEqual({});

    expect(
      renderer.events
        .filter((event) => event.type === "task.output")
        .map((event) => event.output),
    ).toEqual(["closing"]);
  });

  it("fails tasks when readable or observable returns error", async () => {
    const readable = new FakeReadable();
    const observable: ObservableLike<string> = {
      subscribe(observer) {
        observer.error(new Error("observable failed"));
        return undefined;
      },
    };

    await expect(
      createTaskRunner(
        {
          title: "readable",
          task: () => {
            setTimeout(() => {
              readable.emit("error", new Error("readable failed"));
            }, 0);
            return readable;
          },
        },
        { renderer: new RecordingRenderer(), registerSignalListeners: false },
      ).run({}),
    ).rejects.toThrow("readable failed");

    await expect(
      createTaskRunner(
        {
          title: "observable",
          task: () => observable,
        },
        { renderer: new RecordingRenderer(), registerSignalListeners: false },
      ).run({}),
    ).rejects.toThrow("observable failed");
  });

  it("shares single-flight work with nested runners", async () => {
    interface ShareContext {
      childValue?: string;
      parentValue?: string;
    }

    const releaseBuild = deferred<string>();
    const build = vi.fn(() => releaseBuild.promise);
    let childRequested = false;
    const ctx: ShareContext = {};

    await createTaskRunner<ShareContext>(
      {
        title: "parent",
        task: async (context, task) => {
          const parentValue = task.singleFlight("asset", build);
          const nested = task
            .newListr([
              {
                title: "child",
                task: async (childContext, childTask) => {
                  childRequested = true;
                  childContext.childValue = await childTask.singleFlight(
                    "asset",
                    build,
                  );
                },
              },
            ])
            .run(context);

          await vi.waitFor(() => expect(childRequested).toBe(true));
          expect(build).toHaveBeenCalledTimes(1);

          releaseBuild.resolve("artifact");
          context.parentValue = await parentValue;
          await nested;
        },
      },
      { renderer: new RecordingRenderer(), registerSignalListeners: false },
    ).run(ctx);

    expect(build).toHaveBeenCalledTimes(1);
    expect(ctx).toEqual({ childValue: "artifact", parentValue: "artifact" });
  });

  it("registers and disposes signal handlers for root runs", async () => {
    const signalController = new RecordingSignalController();

    await createTaskRunner(
      { title: "ok", task: () => undefined },
      { renderer: new RecordingRenderer(), signalController },
    ).run({});

    expect(signalController.interruptHandlers).toHaveLength(1);
    expect(signalController.terminateHandlers).toHaveLength(1);
    expect(signalController.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not register signal handlers when registration is disabled", async () => {
    const signalController = new RecordingSignalController();

    await createTaskRunner(
      { title: "ok", task: () => undefined },
      {
        renderer: new RecordingRenderer(),
        registerSignalListeners: false,
        signalController,
      },
    ).run({});

    expect(signalController.interruptHandlers).toHaveLength(0);
    expect(signalController.terminateHandlers).toHaveLength(0);
    expect(signalController.dispose).toHaveBeenCalledTimes(1);
  });

  it("installs process signal listeners only when explicitly requested", async () => {
    await createTaskRunner(
      { title: "ok", task: () => undefined },
      {
        registerSignalListeners: true,
        renderer: new RecordingRenderer(),
      },
    ).run({});
  });

  it("handles a received signal by failing pending tasks and running the external hook", async () => {
    interface Context {
      interrupted?: NodeJS.Signals;
    }

    const signalController = new RecordingSignalController();
    const renderer = new RecordingRenderer();
    const release = deferred();
    const started = deferred();
    const runner = createTaskRunner<Context>(
      [
        {
          title: "running",
          task: async () => {
            started.resolve(undefined);
            await release.promise;
          },
        },
        {
          title: "pending",
          task: () => {
            throw new Error("should not run");
          },
        },
      ],
      {
        renderer,
        signalController,
      },
    );
    const ctx: Context = {};
    runner.externalSignalHandler = (context) => {
      context.interrupted = "SIGINT";
    };

    const run = runner.run(ctx);
    await started.promise;
    await signalController.interruptHandlers[0]?.("SIGINT");
    release.resolve(undefined);
    await expect(run).rejects.toThrow("Task run interrupted by SIGINT.");

    expect(ctx.interrupted).toBe("SIGINT");
    expect((renderer.result as TaskRunResult).status).toBe("failed");
    expect(
      renderer.events
        .filter((event) =>
          ["signal.received", "task.failed", "task.started"].includes(
            event.type,
          ),
        )
        .map((event) => [event.type, event.task?.path.join("/"), event.signal]),
    ).toEqual([
      ["task.started", "running", undefined],
      ["task.failed", "pending", undefined],
      ["signal.received", undefined, "SIGINT"],
    ]);
  });

  it("disposes signal handlers after failed root runs", async () => {
    const signalController = new RecordingSignalController();

    await expect(
      createTaskRunner(
        {
          title: "fail",
          task: () => {
            throw new Error("boom");
          },
        },
        { renderer: new RecordingRenderer(), signalController },
      ).run({}),
    ).rejects.toThrow("boom");

    expect(signalController.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("PubmTaskRunner failure behavior", () => {
  it("retries failed tasks and exposes the current retry count", async () => {
    const renderer = new RecordingRenderer();
    const seenRetryCounts: number[] = [];
    let attempts = 0;

    await createTaskRunner(
      {
        title: "publish",
        retry: { tries: 2 },
        task: (_context, task) => {
          attempts += 1;
          seenRetryCounts.push(task.isRetrying().count);
          if (attempts < 3) {
            throw new Error(`attempt ${attempts}`);
          }
        },
      },
      { renderer, registerSignalListeners: false },
    ).run({});

    const retryEvents = renderer.events.filter(
      (event) => event.type === "task.retrying",
    );

    expect(attempts).toBe(3);
    expect(seenRetryCounts).toEqual([0, 1, 2]);
    expect(
      retryEvents.map((event) => event.task?.message?.retry?.count),
    ).toEqual([1, 2]);
  });

  it("supports numeric retry with delay and resets title/output between attempts", async () => {
    const renderer = new RecordingRenderer();
    let attempts = 0;

    await createTaskRunner(
      {
        title: "publish",
        retry: { tries: 1, delay: 1 },
        task: (_context, task) => {
          attempts += 1;
          task.title = `publish attempt ${attempts}`;
          task.output = `output ${attempts}`;
          if (attempts === 1) {
            throw new Error("first failed");
          }
        },
      },
      { renderer, registerSignalListeners: false },
    ).run({});

    expect(attempts).toBe(2);
    expect(
      renderer.events
        .filter((event) =>
          ["task.title", "task.output", "task.retrying"].includes(event.type),
        )
        .map((event) => [
          event.type,
          event.title,
          event.output,
          event.task?.title,
        ]),
    ).toEqual([
      ["task.title", "publish attempt 1", undefined, "publish attempt 1"],
      ["task.output", undefined, "output 1", "publish attempt 1"],
      ["task.title", "publish", undefined, "publish"],
      ["task.retrying", undefined, undefined, "publish"],
      ["task.title", "publish attempt 2", undefined, "publish attempt 2"],
      ["task.output", undefined, "output 2", "publish attempt 2"],
    ]);
  });

  it("supports shorthand numeric retry counts", async () => {
    let attempts = 0;

    await createTaskRunner(
      {
        title: "retry",
        retry: 1,
        task: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("again");
        },
      },
      { renderer: new RecordingRenderer(), registerSignalListeners: false },
    ).run({});

    expect(attempts).toBe(2);
  });

  it("does not retry tasks that skip during execution", async () => {
    const renderer = new RecordingRenderer();
    let attempts = 0;

    await createTaskRunner(
      {
        title: "optional",
        retry: 2,
        task: (_context, task) => {
          attempts += 1;
          task.skip("not needed");
        },
      },
      { renderer, registerSignalListeners: false },
    ).run({});

    expect(attempts).toBe(1);
    expect(
      renderer.events
        .filter((event) =>
          ["task.skipped", "task.retrying"].includes(event.type),
        )
        .map((event) => event.type),
    ).toEqual(["task.skipped"]);
  });

  it("continues after nonfatal exitOnError failures", async () => {
    const renderer = new RecordingRenderer();
    const order: string[] = [];

    await createTaskRunner(
      [
        {
          title: "optional",
          exitOnError: false,
          task: () => {
            order.push("optional");
            throw new Error("optional failed");
          },
        },
        {
          title: "after",
          task: () => {
            order.push("after");
          },
        },
      ],
      { renderer, registerSignalListeners: false },
    ).run({});

    const result = renderer.result as TaskRunResult;

    expect(order).toEqual(["optional", "after"]);
    expect(result.status).toBe("success");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.nonFatal).toBe(true);
    expect(result.errors[0]?.task.state).toBe("failed");
  });

  it("continues after failures when the runner exitOnError function returns false", async () => {
    const renderer = new RecordingRenderer();
    const order: string[] = [];

    await createTaskRunner(
      [
        {
          title: "optional",
          task: () => {
            order.push("optional");
            throw "optional failed";
          },
        },
        {
          title: "after",
          task: () => {
            order.push("after");
          },
        },
      ],
      {
        exitOnError: () => false,
        renderer,
        registerSignalListeners: false,
      },
    ).run({});

    const result = renderer.result as TaskRunResult;

    expect(order).toEqual(["optional", "after"]);
    expect(result.errors[0]?.error).toBe("optional failed");
    expect(result.errors[0]?.task.message?.error).toBe("optional failed");
    expect(result.errors[0]?.nonFatal).toBe(true);
  });

  it("rolls back failed tasks and stops by default", async () => {
    const renderer = new RecordingRenderer();
    const order: string[] = [];

    await expect(
      createTaskRunner(
        [
          {
            title: "publish",
            task: () => {
              order.push("publish");
              throw new Error("publish failed");
            },
            rollback: () => {
              order.push("rollback");
            },
          },
          {
            title: "after",
            task: () => {
              order.push("after");
            },
          },
        ],
        { renderer, registerSignalListeners: false },
      ).run({}),
    ).rejects.toThrow("publish failed");

    const result = renderer.result as TaskRunResult;

    expect(order).toEqual(["publish", "rollback"]);
    expect(result.status).toBe("failed");
    expect(result.errors[0]?.task.state).toBe("rolled-back");
  });

  it("can continue after rollback when exitAfterRollback is disabled", async () => {
    const renderer = new RecordingRenderer();
    const order: string[] = [];

    await createTaskRunner(
      [
        {
          title: "publish",
          task: () => {
            order.push("publish");
            throw new Error("publish failed");
          },
          rollback: () => {
            order.push("rollback");
          },
        },
        {
          title: "after",
          task: () => {
            order.push("after");
          },
        },
      ],
      {
        exitAfterRollback: false,
        renderer,
        registerSignalListeners: false,
      },
    ).run({});

    const result = renderer.result as TaskRunResult;

    expect(order).toEqual(["publish", "rollback", "after"]);
    expect(result.status).toBe("success");
    expect(result.errors[0]?.nonFatal).toBe(true);
    expect(
      renderer.events
        .filter((event) =>
          ["task.rolling-back", "task.rolled-back"].includes(event.type),
        )
        .map((event) => event.type),
    ).toEqual(["task.rolling-back", "task.rolled-back"]);
  });

  it("fails with rollback errors when rollback itself rejects", async () => {
    const renderer = new RecordingRenderer();

    await expect(
      createTaskRunner(
        {
          title: "publish",
          task: () => {
            throw new Error("publish failed");
          },
          rollback: () => {
            throw new Error("rollback failed");
          },
        },
        { renderer, registerSignalListeners: false },
      ).run({}),
    ).rejects.toThrow("rollback failed");

    const result = renderer.result as TaskRunResult;

    expect(result.status).toBe("failed");
    expect(result.errors[0]?.error).toEqual(new Error("rollback failed"));
    expect(
      renderer.events
        .filter((event) =>
          ["task.rolling-back", "task.failed", "task.message"].includes(
            event.type,
          ),
        )
        .map((event) => [event.type, event.task?.message]),
    ).toEqual(
      expect.arrayContaining([
        ["task.rolling-back", { error: "publish failed" }],
        ["task.failed", { error: "rollback failed" }],
      ]),
    );
  });
});

describe("PubmTaskRunner renderer selection", () => {
  it("uses silent, simple, verbose, test, and CI renderer selections", async () => {
    const simpleLogs: string[] = [];
    const verboseLogs: string[] = [];
    const ciLogs: string[] = [];

    await createTaskRunner(
      { title: "silent", task: () => undefined },
      { renderer: "silent", registerSignalListeners: false },
    ).run({});
    await createTaskRunner(
      { title: "simple", task: () => undefined },
      {
        renderer: "simple",
        rendererOptions: {
          output: { log: (line: string) => simpleLogs.push(line) },
          useColor: false,
        },
        registerSignalListeners: false,
      },
    ).run({});
    await createTaskRunner(
      { title: "verbose", task: () => undefined },
      {
        renderer: "verbose",
        rendererOptions: {
          output: { log: (line: string) => verboseLogs.push(line) },
          useColor: false,
        },
        registerSignalListeners: false,
      },
    ).run({});
    await createTaskRunner(
      { title: "test", task: () => undefined },
      { renderer: "test", registerSignalListeners: false },
    ).run({});
    await createTaskRunner(
      {
        title: "ci",
        task: (_context, task) => {
          task.title = "ci renamed";
        },
      },
      createCiRunnerOptions({
        rendererOptions: {
          output: { log: (line: string) => ciLogs.push(line) },
        },
        registerSignalListeners: false,
      }),
    ).run({});

    expect(simpleLogs).toEqual(["❯ simple", "✔ simple"]);
    expect(verboseLogs).toEqual(["❯ verbose", "✔ verbose"]);
    expect(ciLogs).toEqual([
      "[pubm][start] ci",
      "[pubm][title] ci -> ci renamed",
      "[pubm][done] ci renamed",
    ]);
  });

  it("logs actual executor failure details through the CI renderer", async () => {
    const ciLogs: string[] = [];

    await expect(
      createTaskRunner(
        {
          title: "publish",
          task: () => {
            throw new Error("registry rejected");
          },
        },
        createCiRunnerOptions({
          rendererOptions: {
            output: { log: (line: string) => ciLogs.push(line) },
          },
          registerSignalListeners: false,
        }),
      ).run({}),
    ).rejects.toThrow("registry rejected");

    expect(ciLogs).toContain("[pubm][failed] publish: registry rejected");
  });

  it("falls back when default renderer is unsupported or fallback condition is true", async () => {
    const unsupportedFallbackLogs: string[] = [];
    const conditionFallbackLogs: string[] = [];

    await withTTY(false, async () => {
      await createTaskRunner(
        { title: "fallback", task: () => undefined },
        {
          renderer: "default",
          fallbackRenderer: "simple",
          fallbackRendererOptions: {
            output: {
              log: (line: string) => unsupportedFallbackLogs.push(line),
            },
            useColor: false,
          },
          registerSignalListeners: false,
        },
      ).run({});
    });

    await createTaskRunner(
      { title: "condition", task: () => undefined },
      {
        renderer: "silent",
        fallbackRenderer: "simple",
        fallbackRendererCondition: () => true,
        fallbackRendererOptions: {
          output: { log: (line: string) => conditionFallbackLogs.push(line) },
          useColor: false,
        },
        registerSignalListeners: false,
      },
    ).run({});

    expect(unsupportedFallbackLogs).toEqual(["❯ fallback", "✔ fallback"]);
    expect(conditionFallbackLogs).toEqual(["❯ condition", "✔ condition"]);
  });

  it("uses the default renderer on TTY streams and can force terminal options", async () => {
    const chunks: string[] = [];
    const previousForceUnicode = process.env.FORCE_UNICODE;

    await withTTY(false, async () => {
      await createTaskRunner(
        { title: "default", task: () => undefined },
        {
          forceTTY: true,
          forceUnicode: true,
          renderer: "default",
          rendererOptions: {
            output: { write: (chunk: string) => chunks.push(chunk) },
            useColor: false,
          },
          registerSignalListeners: false,
        },
      ).run({});
    });

    if (previousForceUnicode === undefined) {
      delete process.env.FORCE_UNICODE;
    } else {
      process.env.FORCE_UNICODE = previousForceUnicode;
    }

    expect(chunks.join("")).toContain("✔ default");
  });

  it("honors listr and pubm force-TTY environment aliases", async () => {
    const listrChunks: string[] = [];
    const pubmChunks: string[] = [];
    const previousListrForceTty = process.env.LISTR_FORCE_TTY;
    const previousPubmForceTty = process.env.PUBM_FORCE_TTY;

    try {
      await withTTY(false, async () => {
        process.env.LISTR_FORCE_TTY = "1";
        await createTaskRunner(
          { title: "env tty", task: () => undefined },
          {
            renderer: "default",
            rendererOptions: {
              output: { write: (chunk: string) => listrChunks.push(chunk) },
              useColor: false,
            },
            registerSignalListeners: false,
          },
        ).run({});
      });

      await withTTY(false, async () => {
        delete process.env.LISTR_FORCE_TTY;
        process.env.PUBM_FORCE_TTY = "1";
        await createTaskRunner(
          { title: "pubm env tty", task: () => undefined },
          {
            renderer: "default",
            rendererOptions: {
              output: { write: (chunk: string) => pubmChunks.push(chunk) },
              useColor: false,
            },
            registerSignalListeners: false,
          },
        ).run({});
      });
    } finally {
      if (previousListrForceTty === undefined) {
        delete process.env.LISTR_FORCE_TTY;
      } else {
        process.env.LISTR_FORCE_TTY = previousListrForceTty;
      }
      if (previousPubmForceTty === undefined) {
        delete process.env.PUBM_FORCE_TTY;
      } else {
        process.env.PUBM_FORCE_TTY = previousPubmForceTty;
      }
    }

    expect(listrChunks.join("")).toContain("✔ env tty");
    expect(pubmChunks.join("")).toContain("✔ pubm env tty");
  });

  it("uses the default renderer when stderr is TTY even if stdout is piped", async () => {
    const chunks: string[] = [];
    const restoreStdout = setTTY(process.stdout, false);
    const restoreStderr = setTTY(process.stderr, true);

    try {
      await createTaskRunner(
        { title: "stderr tty", task: () => undefined },
        {
          renderer: "default",
          rendererOptions: {
            output: { write: (chunk: string) => chunks.push(chunk) },
            useColor: false,
          },
          registerSignalListeners: false,
        },
      ).run({});
    } finally {
      restoreStderr();
      restoreStdout();
    }

    expect(chunks.join("")).toContain("stderr tty");
  });
});
