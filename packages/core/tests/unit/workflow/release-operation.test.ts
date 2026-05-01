import { describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../src/context.js";
import {
  type ReleaseOperation,
  runReleaseOperations,
} from "../../../src/workflow/release-operation.js";

vi.mock("@pubm/runner", () => ({
  prompt: vi.fn(),
}));

const ctx = {} as PubmContext;

describe("runReleaseOperations", () => {
  it("runs enabled operations sequentially and skips disabled operations", async () => {
    const calls: string[] = [];

    await runReleaseOperations(ctx, [
      { title: "first", run: () => calls.push("first") },
      { title: "disabled", enabled: false, run: () => calls.push("disabled") },
      {
        title: "enabled-fn",
        enabled: () => true,
        run: () => calls.push("enabled-fn"),
      },
    ]);

    expect(calls).toEqual(["first", "enabled-fn"]);
  });

  it("honors static, functional, and in-body skips", async () => {
    const calls: string[] = [];

    await runReleaseOperations(ctx, [
      { title: "static-skip", skip: true, run: () => calls.push("static") },
      {
        title: "function-skip",
        skip: () => "reason",
        run: () => calls.push("function"),
      },
      {
        title: "body-skip",
        run: (_ctx, operation) => {
          operation.skip("skip from body");
        },
      },
      { title: "after", run: () => calls.push("after") },
    ]);

    expect(calls).toEqual(["after"]);
  });

  it("lets nested operations share the same context", async () => {
    const calls: string[] = [];

    await runReleaseOperations(ctx, {
      title: "parent",
      run: (_ctx, operation) =>
        operation.runOperations([
          { title: "child-a", run: () => calls.push("child-a") },
          { title: "child-b", run: () => calls.push("child-b") },
        ]),
    });

    expect(calls).toEqual(["child-a", "child-b"]);
  });

  it("runs runner tasks with retry and rollback semantics", async () => {
    let retryAttempts = 0;
    const rollback = vi.fn();

    await expect(
      runReleaseOperations(ctx, [
        {
          title: "retry-task",
          run: (_ctx, operation) =>
            operation.runTasks({
              title: "legacy retry",
              retry: 1,
              task: () => {
                retryAttempts += 1;
                if (retryAttempts === 1) throw new Error("retry once");
              },
            }),
        },
        {
          title: "rollback-task",
          run: (_ctx, operation) =>
            operation.runTasks({
              title: "legacy rollback",
              task: () => {
                throw new Error("publish failed");
              },
              rollback,
            }),
        },
      ]),
    ).rejects.toThrow("publish failed");

    expect(retryAttempts).toBe(2);
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("runs fallback task helpers, child task runners, and task runner returns", async () => {
    const calls: string[] = [];

    await runReleaseOperations(ctx, {
      title: "parent",
      run: async (_ctx, operation) => {
        await operation.runTasks([
          {
            title: "disabled",
            enabled: () => false,
            task: () => calls.push("disabled"),
          },
          {
            title: "string-output",
            task: (_ctx, task) => {
              expect(task.title).toBe("string-output");
              task.title = "string-renamed";
              task.output = "manual output";
              task.report(new Error("reported output"));
              return "final output";
            },
          },
          {
            title: "child-runners",
            task: async (_ctx, task) => {
              const childTask = task as typeof task & {
                newTaskRunner: (tasks: unknown) => {
                  run(runCtx?: PubmContext): Promise<PubmContext>;
                };
                newListr: (tasks: unknown) => {
                  run(runCtx?: PubmContext): Promise<PubmContext>;
                };
              };

              expect(task.task.path).toEqual(["child-runners"]);
              expect(task.promptOutput).toBe("");
              expect(task.isRetrying()).toEqual({ count: 0 });
              await task.singleFlight("once", async () => {
                calls.push("single-flight");
              });
              task.emit({ type: "ignored" });

              await childTask
                .newTaskRunner({
                  title: "sub-runner",
                  task: () => calls.push("sub-runner"),
                })
                .run();
              await childTask
                .newListr({
                  title: "sub-listr",
                  task: () => calls.push("sub-listr"),
                })
                .run(ctx);

              return {
                run: async () => {
                  calls.push("returned-runner");
                  return ctx;
                },
              };
            },
          },
        ]);
      },
    });

    expect(calls).toEqual([
      "single-flight",
      "sub-runner",
      "sub-listr",
      "returned-runner",
    ]);
  });

  it("honors fallback task skips without running the skipped task", async () => {
    const task = vi.fn();

    await runReleaseOperations(ctx, {
      title: "parent",
      run: (_ctx, operation) =>
        operation.runTasks({
          title: "skip-task",
          skip: "not needed",
          task,
        }),
    });

    expect(task).not.toHaveBeenCalled();
  });

  it("keeps running fallback tasks after non-fatal task failures", async () => {
    const rollback = vi.fn();
    const after = vi.fn();

    await runReleaseOperations(ctx, {
      title: "parent",
      run: (_ctx, operation) =>
        operation.runTasks([
          {
            title: "soft-failure",
            exitOnError: () => false,
            task: () => {
              throw new Error("soft failure");
            },
            rollback,
          },
          {
            title: "after",
            task: after,
          },
        ]),
    });

    expect(rollback).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });

  it("uses object retry options and concurrent fallback tasks", async () => {
    let attempts = 0;
    const calls: string[] = [];

    await runReleaseOperations(ctx, {
      title: "parent",
      run: async (_ctx, operation) => {
        await operation.runTasks({
          title: "retry-object",
          retry: { tries: 1, delay: 1 },
          task: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("retry with delay");
          },
        });
        await operation.runTasks(
          [
            { title: "a", task: () => calls.push("a") },
            { title: "b", task: () => calls.push("b") },
          ],
          { concurrent: true },
        );
      },
    });

    expect(attempts).toBe(2);
    expect(calls.sort()).toEqual(["a", "b"]);
  });

  it("waits for every concurrent operation before surfacing failures", async () => {
    const completed: string[] = [];
    const operations: ReleaseOperation[] = [
      {
        title: "fail-a",
        run: async () => {
          throw new Error("a");
        },
      },
      {
        title: "finish",
        run: async () => {
          completed.push("finish");
        },
      },
      {
        title: "fail-b",
        run: async () => {
          throw new Error("b");
        },
      },
    ];

    await expect(
      runReleaseOperations(ctx, operations, { concurrent: true }),
    ).rejects.toMatchObject({
      name: "MultipleReleaseOperationsError",
      errors: [expect.any(Error), expect.any(Error)],
    });
    expect(completed).toEqual(["finish"]);
  });

  it("uses numeric concurrency limits and preserves single-error identity", async () => {
    let active = 0;
    let maxActive = 0;
    const error = new Error("boom");
    const release = vi.fn<() => void>();

    const operations: ReleaseOperation[] = Array.from(
      { length: 3 },
      (_, i) => ({
        title: `op-${i}`,
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          active -= 1;
          release();
          if (i === 2) throw error;
        },
      }),
    );

    await expect(
      runReleaseOperations(ctx, operations, { concurrent: 2 }),
    ).rejects.toBe(error);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(release).toHaveBeenCalledTimes(3);
  });

  it("treats concurrency limits below two as sequential execution", async () => {
    const calls: string[] = [];

    await runReleaseOperations(
      ctx,
      [
        { title: "first", run: () => calls.push("first") },
        { title: "second", run: () => calls.push("second") },
      ],
      { concurrent: 1 },
    );

    expect(calls).toEqual(["first", "second"]);
  });
});
