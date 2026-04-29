import { EventSource } from "@pubm/runner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PubmCiRenderer } from "../../../src/utils/listr-ci-renderer.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PubmCiRenderer", () => {
  it("re-exports the pubm runner CI renderer", () => {
    const source = new EventSource();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const renderer = new PubmCiRenderer();

    renderer.render(source);
    source.emit({
      type: "task.started",
      task: {
        id: "task-1",
        title: "Running tests",
        initialTitle: "Running tests",
        state: "running",
        path: ["Release", "Running tests"],
      },
    });
    renderer.end();

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      "[pubm][start] Release > Running tests",
    ]);
  });
});
