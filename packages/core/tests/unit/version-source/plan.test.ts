import { describe, expect, it } from "vitest";
import type { ResolvedPubmConfig } from "../../../src/config/types.js";
import { createVersionPlanFromRecommendations } from "../../../src/version-source/plan.js";

function makeConfig(): ResolvedPubmConfig {
  return {
    packages: [
      {
        path: "packages/tool",
        name: "@acme/tool",
        version: "1.0.0",
        dependencies: [],
        registries: ["npm"],
        ecosystem: "js",
      },
      {
        path: "packages/tool",
        name: "tool",
        version: "2.0.0",
        dependencies: [],
        registries: ["crates"],
        ecosystem: "rust",
      },
    ],
    release: {
      versioning: {
        mode: "independent",
        fixed: [],
        linked: [["packages/tool"]],
        updateInternalDependencies: "patch",
      },
    },
  } as ResolvedPubmConfig;
}

describe("createVersionPlanFromRecommendations", () => {
  it("preserves every ecosystem key for unqualified path recommendations before linked grouping", () => {
    const plan = createVersionPlanFromRecommendations(makeConfig(), [
      {
        packagePath: "packages/tool",
        bumpType: "patch",
        source: "changeset",
        entries: [{ summary: "Update shared package" }],
      },
    ]);

    expect(plan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/tool::js", "1.0.1"],
        ["packages/tool::rust", "2.0.1"],
      ]),
    });
  });
});
