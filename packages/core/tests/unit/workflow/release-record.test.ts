import { describe, expect, it } from "vitest";
import { InMemoryReleaseRecord } from "../../../src/workflow/release-record.js";
import type { WorkflowStep } from "../../../src/workflow/types.js";
import {
  WORKFLOW_VERSION_STEP_OUTPUT_KIND,
  type WorkflowVersionStepOutput,
} from "../../../src/workflow/version-step-output.js";

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

  it("retains a cloned structured version step output", () => {
    const record = new InMemoryReleaseRecord();
    const versionStep = step();
    const output: WorkflowVersionStepOutput = {
      kind: WORKFLOW_VERSION_STEP_OUTPUT_KIND,
      packageDecisions: [
        {
          packageKey: "packages/a::js",
          packageName: "pkg-a",
          version: "1.2.3",
        },
      ],
      summary: "v1.2.3",
      tagReferences: [
        {
          packageKeys: ["packages/a::js"],
          packageNames: ["pkg-a"],
          tagName: "v1.2.3",
          version: "1.2.3",
        },
      ],
      versionPlanMode: "single",
    };

    record.stepStarted(versionStep);
    record.stepCompleted(versionStep, { output });

    const retained = record.versionStepOutput();
    expect(retained).toEqual(output);
    expect(record.versionSummary()).toBe("v1.2.3");

    (retained?.tagReferences[0]?.packageKeys as string[] | undefined)?.push(
      "mutated",
    );
    expect(record.versionStepOutput()).toEqual(output);
  });

  it("returns cloned snapshot values", () => {
    const record = new InMemoryReleaseRecord();
    const versionStep = step({
      input: { flags: ["dry-run"] },
    });
    const output: WorkflowVersionStepOutput = {
      kind: WORKFLOW_VERSION_STEP_OUTPUT_KIND,
      packageDecisions: [
        {
          packageKey: "packages/a::js",
          packageName: "pkg-a",
          version: "1.2.3",
        },
      ],
      summary: "v1.2.3",
      tagReferences: [
        {
          packageKeys: ["packages/a::js"],
          packageNames: ["pkg-a"],
          tagName: "v1.2.3",
          version: "1.2.3",
        },
      ],
      versionPlanMode: "single",
    };

    record.stepStarted(versionStep);
    record.stepCompleted(versionStep, {
      facts: [
        {
          detail: { packageKeys: ["packages/a::js"] },
          name: "ReleaseReferenceLocalTagCreated",
          target: "version",
        },
      ],
      output,
    });

    const snapshot = record.snapshot();
    ((snapshot[0]?.input as { flags: string[] } | undefined)?.flags ?? []).push(
      "mutated",
    );
    (
      (snapshot[0]?.output as WorkflowVersionStepOutput | undefined)
        ?.tagReferences[0]?.packageKeys as string[] | undefined
    )?.push("mutated");
    (snapshot[0]?.facts[0]?.detail?.packageKeys as string[] | undefined)?.push(
      "mutated",
    );

    expect(record.snapshot()).toEqual([
      expect.objectContaining({
        facts: [
          {
            detail: { packageKeys: ["packages/a::js"] },
            name: "ReleaseReferenceLocalTagCreated",
            target: "version",
          },
        ],
        input: { flags: ["dry-run"] },
        output,
      }),
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

    const snapshot = record.snapshot();
    expect(snapshot).toEqual([
      expect.objectContaining({
        error: expect.any(Error),
        facts: [{ name: "PublishAttempted", target: "publish" }],
        status: "failed",
        stepId: "publish",
      }),
    ]);
    expect((snapshot[0]?.error as Error | undefined)?.message).toBe(
      "publish failed",
    );
  });

  it("returns cloned errors from snapshots", () => {
    const record = new InMemoryReleaseRecord();
    const publishStep = step({ id: "publish" });
    const error = new Error("publish failed");

    record.stepStarted(publishStep);
    record.stepFailed(publishStep, error);

    const snapshotError = record.snapshot()[0]?.error as Error | undefined;
    expect(snapshotError).toBeInstanceOf(Error);
    expect(snapshotError).not.toBe(error);
    expect(snapshotError?.message).toBe("publish failed");
    snapshotError!.message = "mutated";

    expect((record.snapshot()[0]?.error as Error | undefined)?.message).toBe(
      "publish failed",
    );
  });
});
