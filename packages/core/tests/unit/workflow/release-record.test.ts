import { describe, expect, it } from "vitest";
import { InMemoryReleaseRecord } from "../../../src/workflow/release-record.js";
import type { WorkflowStep } from "../../../src/workflow/types.js";

function step(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: "version",
    compensation: [{ name: "DeleteLocalTag", target: "version" }],
    emittedFacts: [{ name: "VersionDecisionObserved", target: "version" }],
    input: { dryRun: false },
    run: async () => ({ output: { summary: "v1.2.3" } }),
    ...overrides,
  };
}

describe("InMemoryReleaseRecord", () => {
  it("records step inputs, outputs, facts, compensations, and version summary", () => {
    const record = new InMemoryReleaseRecord();
    const versionStep = step();

    record.stepStarted(versionStep);
    record.stepCompleted(versionStep, {
      facts: [{ name: "ReleaseFilesMaterialized", target: "version" }],
      output: { summary: "v1.2.3" },
    });

    expect(record.versionSummary()).toBe("v1.2.3");
    expect(record.snapshot()).toEqual([
      {
        stepId: "version",
        input: { dryRun: false },
        output: { summary: "v1.2.3" },
        facts: [{ name: "ReleaseFilesMaterialized", target: "version" }],
        compensation: [{ name: "DeleteLocalTag", target: "version" }],
        status: "completed",
      },
    ]);
  });

  it("marks the active step failed without losing declared facts", () => {
    const record = new InMemoryReleaseRecord();
    const publishStep = step({
      id: "publish",
      emittedFacts: [{ name: "PublishAttempted", target: "publish" }],
    });
    const error = new Error("publish failed");

    record.stepStarted(publishStep);
    record.stepFailed(publishStep, error);

    expect(record.snapshot()).toEqual([
      expect.objectContaining({
        error,
        facts: [{ name: "PublishAttempted", target: "publish" }],
        status: "failed",
        stepId: "publish",
      }),
    ]);
  });
});
