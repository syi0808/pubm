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
});
