import { describe, expect, it, vi } from "vitest";
import {
  LegacyTaskState,
  RuntimeTask,
  TaskEventType,
} from "../../src/runtime-task.js";
import type { RuntimeTaskSnapshot, TaskEvent } from "../../src/types.js";

function createRuntimeTask() {
  const sink = { emit: vi.fn<(event: TaskEvent) => void>() };
  const task = new RuntimeTask({ title: "Build" }, ["Release", "Build"], sink);
  return { sink, task };
}

describe("RuntimeTask", () => {
  it("publishes snapshots, legacy events, and task event source notifications", () => {
    const { sink, task } = createRuntimeTask();
    const legacy: unknown[] = [];
    const once = vi.fn();
    const subscribed: TaskEvent[] = [];
    const unsubscribe = task.subscribe((event) => subscribed.push(event));

    task.on(TaskEventType.STATE, (state) => legacy.push(state));
    task.once(TaskEventType.CLOSED, once);
    task.setState("running");
    task.setTitle("Build package");
    task.setOutput("stdout");
    task.setPromptOutput("prompt");
    task.setMessage({ retry: { count: 1, error: new Error("retry") } });
    task.setSubtasks([
      {
        snapshot: (): RuntimeTaskSnapshot => ({
          id: "child",
          title: "Child",
          initialTitle: "Child",
          state: "pending",
          path: ["Release", "Build", "Child"],
        }),
      },
    ]);
    task.close();
    task.close();
    unsubscribe();
    task.setState("success");

    expect(LegacyTaskState.STARTED).toBe("running");
    expect(legacy).toEqual(["running", "success"]);
    expect(once).toHaveBeenCalledTimes(1);
    expect(task.snapshot()).toMatchObject({
      title: "Build package",
      output: "stdout",
      promptOutput: "prompt",
      state: "success",
      path: ["Release", "Build"],
      message: { retry: { count: 1, error: expect.any(Error) } },
    });
    expect(task.retry.count).toBe(1);
    expect(subscribed.map((event) => event.type)).toEqual([
      "task.started",
      "task.title",
      "task.output",
      "task.prompt-output",
      "task.message",
      "task.subtasks",
      "task.closed",
    ]);
    expect(sink.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task.subtasks" }),
    );
  });

  it("supports legacy listener removal and state predicate helpers", () => {
    const { sink, task } = createRuntimeTask();
    const stateListener = vi.fn();
    const allEventListener = vi.fn();

    task.on(TaskEventType.STATE, stateListener);
    task.off(TaskEventType.STATE, stateListener);
    task.emitLegacy(TaskEventType.STATE, "ignored");
    expect(stateListener).not.toHaveBeenCalled();

    task.on("event", allEventListener);
    task.emitLegacy("event");
    task.emitLegacy("event", { noType: true });
    task.off("event");
    task.emitLegacy("event", { type: "task.started" });
    expect(allEventListener).toHaveBeenCalledTimes(2);

    expect(task.isPending()).toBe(true);
    task.setState("running");
    expect(task.isStarted()).toBe(true);
    task.setState("success");
    expect(task.isCompleted()).toBe(true);
    task.setState("failed");
    expect(task.hasFailed()).toBe(true);
    task.setState("skipped");
    expect(task.isSkipped()).toBe(true);
    task.setState("retrying");
    expect(task.isRetrying()).toBe(true);
    task.setState("rolling-back");
    expect(task.isRollingBack()).toBe(true);
    task.setState("rolled-back");
    expect(task.hasRolledBack()).toBe(true);
    task.setState("blocked");
    task.setState("waiting");
    task.setState("prompting");

    expect(
      sink.emit.mock.calls
        .map(([event]) => event.type)
        .filter((type) => type === "task.waiting" || type === "task.prompting"),
    ).toEqual(["task.waiting", "task.prompting"]);
  });
});
