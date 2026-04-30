import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext, VersionPlan } from "../../../src/context.js";
import { DirectReleaseWorkflow } from "../../../src/workflow/direct-release-workflow.js";
import type { WorkflowServices } from "../../../src/workflow/types.js";
import {
  pinWorkflowVersionStepOutput,
  WORKFLOW_VERSION_STEP_OUTPUT_KIND,
  type WorkflowVersionStepOutput,
} from "../../../src/workflow/version-step-output.js";

vi.mock("@pubm/runner", () => ({
  prompt: vi.fn(),
}));

const phaseMocks = vi.hoisted(() => ({
  runCiPreparePreflight: vi.fn(),
  runCiPublishPluginCreds: vi.fn(),
  runLocalPreflight: vi.fn(),
}));

const operationMocks = vi.hoisted(() => ({
  createBuildOperation: vi.fn(() => ({ run: vi.fn() })),
  createDryRunOperations: vi.fn(() => [{ run: vi.fn() }]),
  createGitHubReleaseOperation: vi.fn(() => ({ run: vi.fn() })),
  createPublishOperations: vi.fn(() => [{ run: vi.fn() }]),
  createPushOperation: vi.fn(() => ({ run: vi.fn() })),
  createTestOperation: vi.fn(() => ({ run: vi.fn() })),
  createVersionOperation: vi.fn(() => ({ run: vi.fn() })),
}));

vi.mock("../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn(),
  },
}));

vi.mock("../../../src/workflow/release-phases/preflight.js", () => ({
  runCiPreparePreflight: phaseMocks.runCiPreparePreflight,
  runCiPublishPluginCreds: phaseMocks.runCiPublishPluginCreds,
  runLocalPreflight: phaseMocks.runLocalPreflight,
}));

vi.mock("../../../src/workflow/release-phases/dry-run.js", () => ({
  createDryRunOperations: operationMocks.createDryRunOperations,
}));

vi.mock("../../../src/workflow/release-phases/publish.js", () => ({
  createPublishOperations: operationMocks.createPublishOperations,
}));

vi.mock("../../../src/workflow/release-phases/push-release.js", () => ({
  createGitHubReleaseOperation: operationMocks.createGitHubReleaseOperation,
  createPushOperation: operationMocks.createPushOperation,
}));

vi.mock("../../../src/workflow/release-phases/test-build.js", () => ({
  createBuildOperation: operationMocks.createBuildOperation,
  createTestOperation: operationMocks.createTestOperation,
}));

vi.mock("../../../src/workflow/release-phases/version.js", () => ({
  createVersionOperation: operationMocks.createVersionOperation,
}));

function createMockContext(
  versionPlan: VersionPlan,
  options: Partial<PubmContext["options"]> = {},
): PubmContext {
  return {
    cwd: "/tmp/pubm-workflow-test",
    options: {
      tag: "latest",
      ...options,
    } as PubmContext["options"],
    config: {
      packages: [
        {
          ecosystem: "js",
          name: "pkg-a",
          path: "packages/a",
          registries: [],
        },
        {
          ecosystem: "js",
          name: "pkg-b",
          path: "packages/b",
          registries: [],
        },
      ],
      plugins: [],
    } as PubmContext["config"],
    runtime: {
      cleanWorkingTree: true,
      pluginRunner: {
        runErrorHook: vi.fn(),
        runHook: vi.fn(),
      } as unknown as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: false,
      rollback: {
        execute: vi.fn(),
      } as unknown as PubmContext["runtime"]["rollback"],
      tag: "latest",
      versionPlan,
    },
  };
}

function createMockServices(): WorkflowServices {
  return {
    events: { emit: vi.fn() },
    record: {
      stepCompleted: vi.fn(),
      stepFailed: vi.fn(),
      stepStarted: vi.fn(),
      versionSummary: vi.fn(() => undefined),
      versionStepOutput: vi.fn(() => undefined),
    },
    signals: {
      dispose: vi.fn(),
      onInterrupt: vi.fn(() => vi.fn()),
    },
  };
}

describe("DirectReleaseWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("describes direct release domain steps in execution order", () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });

    const steps = workflow.describe(ctx);

    expect(steps.map((step) => step.id)).toEqual([
      "test",
      "build",
      "version",
      "publish",
      "dry-run",
      "push",
      "release",
    ]);
    expect(steps.every((step) => !("tasks" in step))).toBe(true);
  });

  it.each([
    [
      "single",
      { mode: "single", packageKey: "packages/a::js", version: "1.2.3" },
      "v1.2.3",
    ],
    [
      "fixed",
      {
        mode: "fixed",
        packages: new Map([
          ["packages/a::js", "2.0.0"],
          ["packages/b::js", "2.0.0"],
        ]),
        version: "2.0.0",
      },
      "v2.0.0",
    ],
    [
      "independent",
      {
        mode: "independent",
        packages: new Map([
          ["packages/a::js", "3.1.0"],
          ["packages/b::js", "4.2.0"],
        ]),
      },
      "pkg-a@3.1.0, pkg-b@4.2.0",
    ],
  ] as const)("adds version step metadata for %s version plans", (_mode, versionPlan, summary) => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext(versionPlan);

    const versionStep = workflow
      .describe(ctx)
      .find((step) => step.id === "version");

    expect(versionStep).toMatchObject({
      input: {
        dryRun: false,
        hasPrepare: true,
        versionPlanMode: versionPlan.mode,
      },
      output: {
        kind: WORKFLOW_VERSION_STEP_OUTPUT_KIND,
        summary,
        versionPlanMode: versionPlan.mode,
      },
      emittedFacts: [
        { name: "VersionDecisionObserved", target: "version" },
        { name: "ReleaseFilesMaterialized", target: "version" },
        { name: "ReleaseReferenceLocalTagCreated", target: "version" },
      ],
      compensation: [
        { name: "RestoreManifest", before: "manifest write" },
        { name: "RestoreChangesetFiles", before: "changeset deletion" },
        { name: "RestoreChangelog", before: "changelog write" },
        { name: "ResetGitCommit", after: "commit creation" },
        { name: "DeleteLocalTag", after: "local tag creation" },
      ],
    });
  });

  it("pins version step output as package decisions and tag references", () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "3.1.0"],
        ["packages/b::js", "4.2.0"],
      ]),
    });

    const versionStep = workflow
      .describe(ctx)
      .find((step) => step.id === "version");

    expect(versionStep?.output).toMatchObject({
      kind: WORKFLOW_VERSION_STEP_OUTPUT_KIND,
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
          packageKeys: ["packages/a::js"],
          packageNames: ["pkg-a"],
          tagName: "pkg-a@3.1.0",
          version: "3.1.0",
        },
        {
          packageKeys: ["packages/b::js"],
          packageNames: ["pkg-b"],
          tagName: "pkg-b@4.2.0",
          version: "4.2.0",
        },
      ],
    });
  });

  it("executes workflow release operations through steps in order", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext(
      { mode: "single", packageKey: "packages/a::js", version: "1.2.3" },
      { phase: "publish" },
    );
    const services = createMockServices();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await workflow.run(ctx, services);

    expect(operationMocks.createTestOperation).toHaveBeenCalledWith(
      false,
      false,
    );
    expect(operationMocks.createBuildOperation).toHaveBeenCalledWith(
      false,
      false,
    );
    expect(operationMocks.createVersionOperation).toHaveBeenCalledWith(
      false,
      false,
    );
    expect(operationMocks.createPublishOperations).toHaveBeenCalledWith(
      true,
      false,
      false,
    );
    expect(operationMocks.createDryRunOperations).toHaveBeenCalledWith(
      false,
      false,
      false,
    );
    expect(operationMocks.createPushOperation).toHaveBeenCalledWith(
      false,
      false,
    );
    expect(operationMocks.createGitHubReleaseOperation).toHaveBeenCalledWith(
      true,
      false,
      true,
      false,
    );
    expect(services.events.emit).toHaveBeenCalledWith({
      type: "workflow.step.started",
      stepId: "version",
    });
    expect(services.events.emit).toHaveBeenCalledWith({
      type: "workflow.step.completed",
      stepId: "version",
      detail: {
        facts: [
          "VersionDecisionObserved",
          "ReleaseFilesMaterialized",
          "ReleaseReferenceLocalTagCreated",
        ],
      },
    });
    expect(services.record.stepStarted).toHaveBeenCalledTimes(7);
    expect(services.record.stepCompleted).toHaveBeenCalledTimes(7);
    expect(
      vi
        .mocked(services.record.stepCompleted)
        .mock.calls.map(([step]) => step.id),
    ).toEqual([
      "test",
      "build",
      "version",
      "publish",
      "dry-run",
      "push",
      "release",
    ]);
  });

  it("records the version output pinned by the phase execution", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext(
      { mode: "single", packageKey: "packages/a::js", version: "1.2.3" },
      { phase: "publish" },
    );
    const services = createMockServices();
    const pinnedOutput: WorkflowVersionStepOutput = {
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
    vi.spyOn(console, "log").mockImplementation(() => {});
    operationMocks.createVersionOperation.mockReturnValueOnce({
      run: async () => {
        pinWorkflowVersionStepOutput(ctx, pinnedOutput);
        ctx.runtime.versionPlan = {
          mode: "single",
          packageKey: "packages/a::js",
          version: "9.9.9",
        };
      },
    });

    await workflow.run(ctx, services);

    const versionResult = vi
      .mocked(services.record.stepCompleted)
      .mock.calls.find(([step]) => step.id === "version")?.[1];
    expect(versionResult?.output).toEqual(pinnedOutput);
    expect(versionResult?.facts?.[0]).toMatchObject({
      detail: {
        summary: "v1.2.3",
      },
      name: "VersionDecisionObserved",
    });
  });
});
