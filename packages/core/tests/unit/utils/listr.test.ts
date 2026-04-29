import { describe, expect, it, vi } from "vitest";

const runnerMock = vi.hoisted(() => {
  class CiRenderer {}
  class TestRenderer {}

  return {
    CiRenderer,
    TestRenderer,
    createCiRunnerOptions: vi.fn(),
    createTaskRunner: vi.fn(),
    runner: {
      isRoot: vi.fn(),
      run: vi.fn(),
    },
  };
});

vi.mock("@pubm/runner", () => ({
  CiRenderer: runnerMock.CiRenderer,
  TestRenderer: runnerMock.TestRenderer,
  createCiRunnerOptions: runnerMock.createCiRunnerOptions,
  createTaskRunner: runnerMock.createTaskRunner,
}));

import type { RuntimeTask } from "@pubm/runner";
import { TestRenderer } from "@pubm/runner";
import { createCiListrOptions, createListr } from "../../../src/utils/listr.js";
import { PubmCiRenderer } from "../../../src/utils/listr-ci-renderer.js";

describe("createListr", () => {
  it("returns the pubm task runner created by the runner package", () => {
    const tasks = [
      { title: "first", task: vi.fn() },
      { title: "second", task: vi.fn() },
    ];
    const renderer = new TestRenderer();

    runnerMock.createTaskRunner.mockReturnValueOnce(runnerMock.runner);

    const runner = createListr(tasks, { renderer });

    expect(runner).toBe(runnerMock.runner);
    expect(runnerMock.createTaskRunner).toHaveBeenCalledWith(
      tasks,
      {
        renderer,
      },
      undefined,
    );
  });

  it("forwards a parent task to the runner package", () => {
    const task = { title: "child", task: vi.fn() };
    const parentTask = {
      path: ["parent"],
      setSubtasks: vi.fn(),
    } as unknown as RuntimeTask<object>;

    runnerMock.createTaskRunner.mockReturnValueOnce(runnerMock.runner);

    createListr(task, undefined, parentTask);

    expect(runnerMock.createTaskRunner).toHaveBeenCalledWith(
      task,
      undefined,
      parentTask,
    );
  });
});

describe("createCiListrOptions", () => {
  it("configures the pubm CI renderer for primary and fallback output", () => {
    runnerMock.createCiRunnerOptions.mockImplementationOnce((options = {}) => ({
      ...options,
      renderer: options.renderer ?? runnerMock.CiRenderer,
      fallbackRenderer: options.fallbackRenderer ?? runnerMock.CiRenderer,
      rendererOptions: {
        logTitleChange: true,
        ...options.rendererOptions,
      },
      fallbackRendererOptions: {
        logTitleChange: true,
        ...options.fallbackRendererOptions,
      },
    }));

    const options = createCiListrOptions();

    expect(options.renderer).toBe(PubmCiRenderer);
    expect(options.fallbackRenderer).toBe(PubmCiRenderer);
    expect(options.rendererOptions).toEqual({ logTitleChange: true });
    expect(options.fallbackRendererOptions).toEqual({ logTitleChange: true });
  });

  it("merges custom renderer options", () => {
    runnerMock.createCiRunnerOptions.mockImplementationOnce((options = {}) => ({
      ...options,
      renderer: options.renderer ?? runnerMock.CiRenderer,
      fallbackRenderer: options.fallbackRenderer ?? runnerMock.CiRenderer,
      rendererOptions: {
        logTitleChange: true,
        ...options.rendererOptions,
      },
      fallbackRendererOptions: {
        logTitleChange: true,
        ...options.fallbackRendererOptions,
      },
    }));

    const options = createCiListrOptions({
      rendererOptions: { logTitleChange: false },
    });

    expect(options.rendererOptions).toEqual({ logTitleChange: false });
    expect(options.fallbackRendererOptions).toEqual({ logTitleChange: true });
  });
});
