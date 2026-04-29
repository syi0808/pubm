import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workflow step contract", () => {
  it("keeps workflow step types out of the public core export surface", () => {
    const indexSource = readFileSync(
      new URL("../../../src/index.ts", import.meta.url),
      "utf-8",
    );

    expect(indexSource).not.toMatch(
      /\b(WorkflowStep|WorkflowStepResult|WorkflowFactDescriptor|WorkflowCompensationExpectation|WorkflowReleaseRecord)\b/,
    );
  });
});
