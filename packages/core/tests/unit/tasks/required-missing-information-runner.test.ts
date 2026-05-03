import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunnerState = vi.hoisted(() => ({
  events: [] as any[],
  promptAnswers: [] as unknown[],
  promptOptions: [] as any[],
}));

const mockChangesetAnalyze = vi.fn().mockResolvedValue([]);
const mockConventionalAnalyze = vi.fn().mockResolvedValue([]);

vi.mock("std-env", () => ({
  isCI: false,
}));

vi.mock("../../../src/version-source/index.js", () => {
  class MockChangesetSource {
    name = "changeset";
    analyze = mockChangesetAnalyze;
  }

  class MockConventionalCommitSource {
    name = "commit";
    analyze = mockConventionalAnalyze;
  }

  return {
    ChangesetSource: MockChangesetSource,
    ConventionalCommitSource: MockConventionalCommitSource,
    mergeRecommendations: (sourceResults: any[][]) => sourceResults.flat(),
  };
});

vi.mock("../../../src/utils/listr.js", async () => {
  const { createTaskRunner } = await import("@pubm/runner");

  return {
    createListr: vi.fn((task: any, options?: any, parentTask?: any) =>
      createTaskRunner(
        task,
        {
          ...options,
          eventSinks: [
            ...(options?.eventSinks ?? []),
            {
              emit: (event: any) => {
                mockRunnerState.events.push(event);
              },
            },
          ],
          promptProvider: {
            prompt: vi.fn(async (promptOptions: any) => {
              mockRunnerState.promptOptions.push(promptOptions);
              if (mockRunnerState.promptAnswers.length === 0) {
                throw new Error("No queued prompt answer.");
              }
              return mockRunnerState.promptAnswers.shift();
            }),
          },
          registerSignalListeners: false,
          renderer: "silent",
        },
        parentTask,
      ),
    ),
  };
});

import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import { requiredMissingInformationTasks } from "../../../src/tasks/required-missing-information.js";

function makePkg(
  overrides: Partial<ResolvedPackageConfig> & { name: string; version: string },
): ResolvedPackageConfig {
  return {
    path: overrides.path ?? ".",
    registries: overrides.registries ?? ["npm"],
    dependencies: overrides.dependencies ?? [],
    ecosystem: overrides.ecosystem ?? "js",
    ...overrides,
  };
}

describe("requiredMissingInformationTasks real runner integration", () => {
  beforeEach(() => {
    mockRunnerState.events = [];
    mockRunnerState.promptAnswers = [];
    mockRunnerState.promptOptions = [];
    mockChangesetAnalyze.mockResolvedValue([]);
    mockConventionalAnalyze.mockResolvedValue([]);
  });

  it("closes the parent task after a nested prompt and sets runtime.versionPlan", async () => {
    mockRunnerState.promptAnswers.push("1.0.1");

    const ctx: any = {
      cwd: "/tmp/pubm-runner-test",
      runtime: {
        promptEnabled: true,
        tag: "latest",
        versionPlan: undefined,
      },
      config: {
        versioning: "independent",
        packages: [
          makePkg({
            name: "my-pkg",
            version: "1.0.0",
            path: ".",
          }),
        ],
      },
    };

    await requiredMissingInformationTasks().run(ctx);

    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "1.0.1",
      packageKey: ".::js",
    });

    expect(mockRunnerState.promptOptions).toHaveLength(1);

    const parentPath = ["Checking required information"];
    const versionPath = [
      "Checking required information",
      "Checking version information",
    ];
    const eventIndex = (type: string, path: string[]) =>
      mockRunnerState.events.findIndex(
        (event) =>
          event.type === type &&
          JSON.stringify(event.task?.path) === JSON.stringify(path),
      );

    const promptCompletedIndex = eventIndex("prompt.completed", versionPath);
    const parentCompletedIndex = eventIndex("task.completed", parentPath);
    const parentClosedIndex = eventIndex("task.closed", parentPath);

    expect(promptCompletedIndex).toBeGreaterThanOrEqual(0);
    expect(parentCompletedIndex).toBeGreaterThan(promptCompletedIndex);
    expect(parentClosedIndex).toBeGreaterThan(parentCompletedIndex);

    expect(mockRunnerState.events[parentClosedIndex]?.task).toMatchObject({
      path: parentPath,
      state: "success",
      title: "Checking required information",
    });
  });
});
