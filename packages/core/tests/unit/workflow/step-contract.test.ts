import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readWorkflowSources() {
  const root = new URL("../../../src/workflow/", import.meta.url);
  const files: { path: string; source: string }[] = [];

  function walk(directory: URL) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryUrl = new URL(entry.name, directory);

      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory));
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }

      files.push({
        path: entryUrl.pathname,
        source: readFileSync(entryUrl, "utf-8"),
      });
    }
  }

  walk(root);
  return files;
}

describe("workflow step contract", () => {
  it("keeps workflow step types out of the public core export surface", () => {
    const indexSource = readFileSync(
      new URL("../../../src/index.ts", import.meta.url),
      "utf-8",
    );

    expect(indexSource).not.toMatch(
      /\b(WorkflowStep|WorkflowStepResult|WorkflowFactDescriptor|WorkflowCompensationExpectation|WorkflowReleaseRecord|WorkflowVersionStepOutput)\b/,
    );
  });

  it("keeps workflow source independent from the legacy release runner", () => {
    const forbiddenPatterns = [
      /@pubm\/runner/,
      /listr2/,
      /NewListrParentTask/,
      /TaskRunner/,
      /Task</,
      /createTaskRunner/,
      /createCiRunnerOptions/,
      /createListr/,
      /newListr/,
      /release-phase-service/,
      /tasks\/phases/,
      /tasks\/runner/,
      /tasks\/runner-utils/,
      /runner-utils\//,
    ];

    const violations = readWorkflowSources().flatMap(({ path, source }) =>
      forbiddenPatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${path}: ${pattern}`),
    );

    expect(violations).toEqual([]);
  });
});
