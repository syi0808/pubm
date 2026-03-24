import { describe, expect, it, vi } from "vitest";
import { wrapTaskContext } from "../../../src/plugin/wrap-task-context.js";

function makeMockListrTask() {
  const promptRun = vi.fn();
  return {
    _output: "",
    get output() {
      return this._output;
    },
    set output(v: string) {
      this._output = v;
    },
    _title: "Original title",
    get title() {
      return this._title;
    },
    set title(v: string) {
      this._title = v;
    },
    prompt: vi.fn().mockReturnValue({ run: promptRun }),
    _promptRun: promptRun,
  };
}

describe("wrapTaskContext", () => {
  it("proxies output getter/setter", () => {
    const mock = makeMockListrTask();
    const ctx = wrapTaskContext(mock as any);

    ctx.output = "hello";
    expect(mock.output).toBe("hello");
    expect(ctx.output).toBe("hello");
  });

  it("proxies title getter/setter", () => {
    const mock = makeMockListrTask();
    const ctx = wrapTaskContext(mock as any);

    ctx.title = "New title";
    expect(mock.title).toBe("New title");
    expect(ctx.title).toBe("New title");
  });

  it("delegates prompt to listr2 prompt adapter", async () => {
    const mock = makeMockListrTask();
    mock._promptRun.mockResolvedValue("user-input");
    const ctx = wrapTaskContext(mock as any);

    const result = await ctx.prompt({
      type: "password",
      message: "Enter token",
    });

    expect(mock.prompt).toHaveBeenCalled();
    expect(mock._promptRun).toHaveBeenCalledWith({
      type: "password",
      message: "Enter token",
    });
    expect(result).toBe("user-input");
  });
});
