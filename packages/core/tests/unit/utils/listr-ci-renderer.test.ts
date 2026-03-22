import { EventEmitter } from "node:events";
import { ListrTaskState } from "listr2";
import { describe, expect, it, vi } from "vitest";
import { PubmCiRenderer } from "../../../src/utils/listr-ci-renderer.js";

class MockTask extends EventEmitter {
  id = "task-1";
  title = "Running tests";
  initialTitle = "Running tests";
  path = ["Release", "Running tests"];
}

describe("PubmCiRenderer", () => {
  it("logs start, title, output, and completion events once", () => {
    const task = new MockTask();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer([task as never]);

    renderer.render();

    task.emit("STATE", ListrTaskState.STARTED);
    task.title = "Running tests (pnpm run test)";
    task.emit("TITLE", task.title);
    task.emit("OUTPUT", "Executing `pnpm run test`\nDone");
    task.emit("STATE", ListrTaskState.COMPLETED);

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      "[pubm][start] Release > Running tests",
      "[pubm][title] Release > Running tests -> Release > Running tests (pnpm run test)",
      "[pubm][output] Release > Running tests (pnpm run test): Executing `pnpm run test`",
      "[pubm][output] Release > Running tests (pnpm run test): Done",
      "[pubm][done] Release > Running tests (pnpm run test)",
    ]);
  });

  it("logs skip and retry messages", () => {
    const task = new MockTask();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer([task as never]);

    renderer.render();

    task.emit("MESSAGE", { retry: { count: 2 } });
    task.emit("MESSAGE", { skip: "Already published" });

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      "[pubm][retry] Release > Running tests (attempt 2)",
      "[pubm][skip] Release > Running tests: Already published",
    ]);
  });

  it("logs rollback messages, nested subtasks, and suppresses blank skip messages", () => {
    const parent = new MockTask();
    const child = new MockTask();
    child.id = "task-2";
    child.title = "Nested task";
    child.initialTitle = "Nested task";
    child.path = ["Release", "Nested task"];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer([parent as never], {
      logTitleChange: false,
    });

    renderer.render();
    parent.emit("SUBTASK", [child]);
    parent.emit("MESSAGE", { rollback: "Rolling back files" });
    parent.emit("MESSAGE", { skip: "   " });
    child.emit("STATE", ListrTaskState.STARTED);
    child.emit(
      "OUTPUT",
      "\u001B]8;;https://example.com\u0007Link\u001B]8;;\u0007",
    );
    child.emit("STATE", ListrTaskState.COMPLETED);

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      "[pubm][rollback] Release > Running tests: Rolling back files",
      "[pubm][start] Release > Nested task",
      "[pubm][output] Release > Nested task: Link",
      "[pubm][done] Release > Nested task",
    ]);
  });

  it("logs rollback without message text", () => {
    const task = new MockTask();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer([task as never]);

    renderer.render();

    task.emit("MESSAGE", { rollback: "   " });

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      "[pubm][rollback] Release > Running tests",
    ]);
  });

  it("end() is a no-op", () => {
    const renderer = new PubmCiRenderer([], {});
    expect(() => renderer.end()).not.toThrow();
  });

  it("strips multiple hyperlink sequences from output", () => {
    const task = new MockTask();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer([task as never]);

    renderer.render();

    task.emit(
      "OUTPUT",
      "\u001B]8;;https://a.com\u0007A\u001B]8;;\u0007 and \u001B]8;;https://b.com\u0007B\u001B]8;;\u0007",
    );

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      "[pubm][output] Release > Running tests: A and B",
    ]);
  });

  it("baseLabel falls back to currentLabel when task.path is empty (line 149)", () => {
    const task = new MockTask();
    task.path = [];
    task.title = "My task";
    task.initialTitle = "My task";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer([task as never]);

    renderer.render();

    // TITLE event triggers baseLabel(task) which should fall through to
    // currentLabel when path normalizes to empty (line 149).
    // Note: task.title is already updated by listr before the event fires,
    // so baseLabel and currentLabel both use the new title.
    task.title = "Updated task";
    task.emit("TITLE", "Updated task");

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      "[pubm][title] Updated task -> Updated task",
    ]);
  });

  it("suppresses log when assembled message normalizes to empty (line 167)", () => {
    const task = new MockTask();
    task.path = [];
    task.title = "\u001b[31m\u001b[39m";
    task.initialTitle = "\u001b[31m\u001b[39m";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer([task as never]);

    renderer.render();

    // STATE event calls log("start", currentLabel(task)).
    // currentLabel produces "" because leaf is VT-only and basePath is empty.
    // log() then normalizes to "" and returns early (line 167).
    task.emit("STATE", ListrTaskState.STARTED);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("avoids duplicate listeners and ignores blank title or output updates", () => {
    const task = new MockTask();
    task.path = [];
    task.title = undefined as any;
    task.initialTitle = undefined as any;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer([task as never]);

    renderer.render();
    renderer.render();

    task.emit("TITLE", "   ");
    task.emit("OUTPUT", "   ");
    task.emit("MESSAGE", { rollback: "\u001b[31m\u001b[39m" });
    task.emit("STATE", ListrTaskState.COMPLETED);

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      "[pubm][rollback] background task",
      "[pubm][done] background task",
    ]);
  });
});
