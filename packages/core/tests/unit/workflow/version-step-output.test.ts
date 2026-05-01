import { describe, expect, it } from "vitest";
import type { PubmContext, VersionPlan } from "../../../src/context.js";
import {
  createWorkflowVersionMap,
  createWorkflowVersionStepOutput,
  createWorkflowVersionTagReferences,
  formatWorkflowReleaseTag,
  pinWorkflowVersionStepOutput,
  readPinnedWorkflowVersionStepOutput,
  WORKFLOW_VERSION_STEP_OUTPUT_KIND,
} from "../../../src/workflow/version-step-output.js";

function context(
  versionPlan: VersionPlan,
  config: Partial<PubmContext["config"]> = {},
): PubmContext {
  return {
    cwd: "/tmp/pubm-version-output-test",
    options: { tag: "latest" } as PubmContext["options"],
    config: {
      excludeRelease: [],
      packages: [
        {
          ecosystem: "js",
          name: "pkg-a",
          path: "packages/a",
          registries: ["npm"],
        },
        {
          ecosystem: "js",
          name: "pkg-b",
          path: "packages/b",
          registries: ["jsr"],
        },
      ],
      plugins: [],
      ...config,
    } as PubmContext["config"],
    runtime: {
      cleanWorkingTree: true,
      pluginRunner: {} as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: false,
      rollback: {} as PubmContext["runtime"]["rollback"],
      tag: "latest",
      versionPlan,
    },
  };
}

describe("workflow version step output", () => {
  it("pins single-version package writes and shared tag reference", () => {
    const ctx = context({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });

    expect(createWorkflowVersionMap(ctx, ctx.runtime.versionPlan!)).toEqual([
      ["packages/a::js", "1.2.3"],
      ["packages/b::js", "1.2.3"],
    ]);
    expect(createWorkflowVersionStepOutput(ctx)).toMatchObject({
      summary: "v1.2.3",
      versionPlanMode: "single",
      packageDecisions: [
        {
          packageKey: "packages/a::js",
          packageName: "pkg-a",
          version: "1.2.3",
        },
        {
          packageKey: "packages/b::js",
          packageName: "pkg-b",
          version: "1.2.3",
        },
      ],
      tagReferences: [
        {
          packageKeys: ["packages/a::js", "packages/b::js"],
          packageNames: ["pkg-a", "pkg-b"],
          tagName: "v1.2.3",
          version: "1.2.3",
        },
      ],
    });
  });

  it("pins fixed-version package writes and shared tag reference", () => {
    const ctx = context({
      mode: "fixed",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
      version: "2.0.0",
    });

    expect(createWorkflowVersionStepOutput(ctx)).toMatchObject({
      summary: "v2.0.0",
      versionPlanMode: "fixed",
      packageDecisions: [
        {
          packageKey: "packages/a::js",
          packageName: "pkg-a",
          version: "2.0.0",
        },
        {
          packageKey: "packages/b::js",
          packageName: "pkg-b",
          version: "2.0.0",
        },
      ],
      tagReferences: [
        {
          packageKeys: ["packages/a::js", "packages/b::js"],
          packageNames: ["pkg-a", "pkg-b"],
          tagName: "v2.0.0",
          version: "2.0.0",
        },
      ],
    });
  });

  it("pins independent package decisions and skips excluded release tags", () => {
    const ctx = context(
      {
        mode: "independent",
        packages: new Map([
          ["packages/a::js", "3.1.0"],
          ["packages/b::js", "4.2.0"],
        ]),
      },
      { excludeRelease: ["packages/a"] },
    );

    expect(createWorkflowVersionStepOutput(ctx)).toMatchObject({
      summary: "pkg-a@3.1.0, pkg-b@4.2.0",
      versionPlanMode: "independent",
      packageDecisions: [
        {
          packageKey: "packages/a::js",
          packageName: "pkg-a",
          version: "3.1.0",
        },
        {
          packageKey: "packages/b::js",
          packageName: "pkg-b",
          version: "4.2.0",
        },
      ],
      tagReferences: [
        {
          packageKeys: ["packages/b::js"],
          packageNames: ["pkg-b"],
          tagName: "pkg-b@4.2.0",
          version: "4.2.0",
        },
      ],
    });
  });

  it("uses registry-qualified independent tags when configured", () => {
    const ctx = context(
      {
        mode: "independent",
        packages: new Map([["packages/a::js", "3.1.0"]]),
      },
      { registryQualifiedTags: true },
    );

    expect(formatWorkflowReleaseTag(ctx, "packages/a::js", "3.1.0")).toBe(
      "npm/pkg-a@3.1.0",
    );
    expect(
      createWorkflowVersionTagReferences(ctx, ctx.runtime.versionPlan!),
    ).toEqual([
      {
        packageKeys: ["packages/a::js"],
        packageNames: ["pkg-a"],
        tagName: "npm/pkg-a@3.1.0",
        version: "3.1.0",
      },
    ]);
  });

  it("does not throw descriptive output for unresolved registry-qualified tags", () => {
    const ctx = context(
      {
        mode: "independent",
        packages: new Map([["packages/a::js", "3.1.0"]]),
      },
      {
        registryQualifiedTags: true,
        packages: [
          {
            ecosystem: "js",
            name: "pkg-a",
            path: "packages/a",
            registries: [],
          },
        ],
      },
    );

    expect(createWorkflowVersionStepOutput(ctx).tagReferences).toEqual([]);
    expect(() =>
      createWorkflowVersionTagReferences(ctx, ctx.runtime.versionPlan!, {
        strictQualifiedTags: true,
      }),
    ).toThrow(
      'Package "pkg-a" has no registries defined but registryQualifiedTags is enabled',
    );
  });

  it("pins cloned output for workflow recording after the phase mutates runtime", () => {
    const ctx = context({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });
    const output = createWorkflowVersionStepOutput(ctx);

    pinWorkflowVersionStepOutput(ctx, output);
    ctx.runtime.versionPlan = {
      mode: "single",
      packageKey: "packages/a::js",
      version: "9.9.9",
    };

    const pinned = readPinnedWorkflowVersionStepOutput(ctx);
    expect(pinned).toEqual(output);

    (pinned?.tagReferences[0]?.packageKeys as string[] | undefined)?.push(
      "mutated",
    );
    expect(readPinnedWorkflowVersionStepOutput(ctx)).toEqual(output);
  });

  it("ignores malformed pinned output before cloning nested references", () => {
    const ctx = context({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });
    (
      ctx.runtime as { workflowVersionStepOutput?: unknown }
    ).workflowVersionStepOutput = {
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
          packageKeys: "packages/a::js",
          packageNames: ["pkg-a"],
          tagName: "v1.2.3",
          version: "1.2.3",
        },
      ],
      versionPlanMode: "single",
    };

    expect(readPinnedWorkflowVersionStepOutput(ctx)).toBeUndefined();
  });
});
