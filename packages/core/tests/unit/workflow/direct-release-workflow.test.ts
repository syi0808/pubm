import { describe, expect, it, vi } from "vitest";
import type { PubmContext, VersionPlan } from "../../../src/context.js";
import { DirectReleaseWorkflow } from "../../../src/workflow/direct-release-workflow.js";
import type { WorkflowServices } from "../../../src/workflow/types.js";

const phaseMocks = vi.hoisted(() => ({
  runCiPreparePreflight: vi.fn(),
  runCiPublishPluginCreds: vi.fn(),
  runLocalPreflight: vi.fn(),
}));

const releasePhaseServiceMock = vi.hoisted(() => ({
  runBuild: vi.fn(),
  runDryRun: vi.fn(),
  runPublish: vi.fn(),
  runPush: vi.fn(),
  runRelease: vi.fn(),
  runTest: vi.fn(),
  runVersion: vi.fn(),
}));

vi.mock("../../../src/tasks/release-phase-service.js", () => ({
  nativeReleasePhaseService: releasePhaseServiceMock,
}));

vi.mock("../../../src/tasks/phases/preflight.js", () => ({
  runCiPreparePreflight: phaseMocks.runCiPreparePreflight,
  runCiPublishPluginCreds: phaseMocks.runCiPublishPluginCreds,
  runLocalPreflight: phaseMocks.runLocalPreflight,
}));

function createMockContext(
  versionPlan: VersionPlan,
  options: Partial<PubmContext["options"]> = {},
): PubmContext {
  return {
    cwd: "/tmp/pubm-workflow-test",
    options: {
      mode: "local",
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
    },
    signals: {
      dispose: vi.fn(),
      onInterrupt: vi.fn(() => vi.fn()),
    },
  };
}

describe("DirectReleaseWorkflow", () => {
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
      output: { summary },
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

  it("executes release phase services through workflow steps in order", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext(
      { mode: "single", packageKey: "packages/a::js", version: "1.2.3" },
      { publish: true },
    );
    const services = createMockServices();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await workflow.run(ctx, services);

    expect(releasePhaseServiceMock.runTest).toHaveBeenCalledWith(ctx, {
      hasPrepare: false,
      skipTests: false,
    });
    expect(releasePhaseServiceMock.runBuild).toHaveBeenCalledWith(ctx, {
      hasPrepare: false,
      skipBuild: false,
    });
    expect(releasePhaseServiceMock.runVersion).toHaveBeenCalledWith(ctx, {
      dryRun: false,
      hasPrepare: false,
      versionPlanMode: "single",
    });
    expect(releasePhaseServiceMock.runPublish).toHaveBeenCalledWith(ctx, {
      hasPublish: true,
      dryRun: false,
      skipPublish: false,
    });
    expect(releasePhaseServiceMock.runDryRun).toHaveBeenCalledWith(ctx, {
      dryRun: false,
      hasPrepare: false,
      mode: "local",
      skipDryRun: false,
    });
    expect(releasePhaseServiceMock.runPush).toHaveBeenCalledWith(ctx, {
      hasPrepare: false,
      dryRun: false,
    });
    expect(releasePhaseServiceMock.runRelease).toHaveBeenCalledWith(ctx, {
      dryRun: false,
      hasPublish: true,
      mode: "local",
      skipReleaseDraft: false,
    });
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
});
