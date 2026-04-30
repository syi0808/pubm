import { createTaskRunner, type PromptOptions } from "@pubm/runner";
import { describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../src/context.js";
import type { ReleaseOperation } from "../../../src/workflow/release-operation.js";
import { createReleaseOperationTasks } from "../../../src/workflow/release-operation-task.js";

function runOperations(operations: ReleaseOperation[]) {
  const events: any[] = [];
  const prompt = vi.fn(async () => "confirmed");

  const run = createTaskRunner(createReleaseOperationTasks(operations), {
    eventSinks: [{ emit: (event) => events.push(event) }],
    promptProvider: {
      prompt: prompt as unknown as <T = unknown>(
        options: PromptOptions,
      ) => Promise<T>,
    },
    registerSignalListeners: false,
    renderer: "silent",
  }).run({} as PubmContext);

  return { events, prompt, run };
}

describe("release operation runner task adapter", () => {
  it("maps operation title, output, prompt, and nested operations onto runner tasks", async () => {
    const operations: ReleaseOperation[] = [
      {
        title: "parent",
        run: async (_ctx, operation) => {
          operation.title = "parent renamed";
          operation.output = "parent output";
          await operation.prompt().run({
            type: "text",
            message: "Continue?",
          });
          await operation.runOperations([
            {
              title: "child",
              run: async (_ctx, child) => {
                child.output = "child output";
              },
            },
          ]);
        },
      },
    ];

    const { events, prompt, run } = runOperations(operations);
    await run;

    expect(prompt).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task.title",
        title: "parent renamed",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task.output",
        output: "parent output",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "prompt.completed",
        task: expect.objectContaining({
          path: ["parent"],
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task.completed",
        task: expect.objectContaining({
          path: ["parent", "child"],
          state: "success",
        }),
      }),
    );
  });

  it("maps in-body operation skips onto runner skipped tasks", async () => {
    const operations: ReleaseOperation[] = [
      {
        title: "skip-me",
        run: async (_ctx, operation) => {
          operation.skip("not needed");
        },
      },
    ];

    const { events, run } = runOperations(operations);
    await run;

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task.skipped",
        task: expect.objectContaining({
          path: ["skip-me"],
          state: "skipped",
        }),
      }),
    );
  });
});
