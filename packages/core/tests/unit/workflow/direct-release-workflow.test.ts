import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const envMocks = vi.hoisted(() => ({
  isCI: false,
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

const originalStdinIsTTY = process.stdin.isTTY;

function setStdinTTY(isTTY: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: isTTY,
  });
}

vi.mock("../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn(),
  },
}));

vi.mock("std-env", () => ({
  get isCI() {
    return envMocks.isCI;
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
    envMocks.isCI = false;
    setStdinTTY(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setStdinTTY(originalStdinIsTTY);
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
    expect(
      Object.fromEntries(steps.map((step) => [step.id, step.enabled])),
    ).toEqual({
      build: true,
      "dry-run": false,
      publish: true,
      push: true,
      release: true,
      test: true,
      version: true,
    });
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

  it("runs local preflight for Direct Release without phase", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });
    const services = createMockServices();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await workflow.run(ctx, services);

    expect(phaseMocks.runLocalPreflight).toHaveBeenCalledTimes(1);
    expect(phaseMocks.runCiPreparePreflight).not.toHaveBeenCalled();
    expect(phaseMocks.runCiPublishPluginCreds).not.toHaveBeenCalled();
    expect(operationMocks.createGitHubReleaseOperation).toHaveBeenCalledWith(
      true,
      false,
      true,
      false,
    );
  });

  it("runs preflight cleanup after a successful direct release", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });
    const cleanup = vi.fn();
    phaseMocks.runLocalPreflight.mockImplementationOnce(
      async (_ctx, _chainCleanup, cleanupRef) => {
        cleanupRef.current = cleanup;
      },
    );
    const services = createMockServices();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await workflow.run(ctx, services);

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("runs SIGINT rollback at most once", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });
    let handler: (() => void | Promise<void>) | undefined;
    const removeInterruptListener = vi.fn();
    const services = createMockServices();
    vi.mocked(services.signals.onInterrupt).mockImplementationOnce(
      (onInterrupt) => {
        handler = onInterrupt;
        return removeInterruptListener;
      },
    );
    vi.spyOn(process, "exit").mockImplementation(((
      code?: number | string | null,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    operationMocks.createTestOperation.mockReturnValueOnce({
      run: async () => {
        const first = handler?.();
        const second = handler?.();
        await Promise.allSettled([first, second]);
      },
    });

    await workflow.run(ctx, services);

    expect(ctx.runtime.rollback.execute).toHaveBeenCalledTimes(1);
    expect(ctx.runtime.rollback.execute).toHaveBeenCalledWith(ctx, {
      interactive: false,
      sigint: true,
    });
    expect(process.exit).toHaveBeenCalledWith(130);
  });

  it("runs split prepare preflight whenever phase prepare is explicit in local environment", async () => {
    envMocks.isCI = false;
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext(
      {
        mode: "single",
        packageKey: "packages/a::js",
        version: "1.2.3",
      },
      { phase: "prepare" },
    );
    const services = createMockServices();
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(
      Object.fromEntries(
        workflow.describe(ctx).map((step) => [step.id, step.enabled]),
      ),
    ).toEqual({
      build: true,
      "dry-run": true,
      publish: false,
      push: true,
      release: false,
      test: true,
      version: true,
    });

    await workflow.run(ctx, services);

    expect(phaseMocks.runCiPreparePreflight).toHaveBeenCalledTimes(1);
    expect(phaseMocks.runLocalPreflight).not.toHaveBeenCalled();
    expect(phaseMocks.runCiPublishPluginCreds).not.toHaveBeenCalled();
    expect(operationMocks.createDryRunOperations).toHaveBeenCalledWith(
      false,
      true,
      false,
    );
    expect(operationMocks.createGitHubReleaseOperation).not.toHaveBeenCalled();
  });

  it("executes only active publish phase workflow steps in order", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext(
      { mode: "single", packageKey: "packages/a::js", version: "1.2.3" },
      { phase: "publish" },
    );
    const services = createMockServices();
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(
      Object.fromEntries(
        workflow.describe(ctx).map((step) => [step.id, step.enabled]),
      ),
    ).toEqual({
      build: false,
      "dry-run": false,
      publish: true,
      push: false,
      release: true,
      test: false,
      version: false,
    });

    await workflow.run(ctx, services);

    expect(operationMocks.createTestOperation).not.toHaveBeenCalled();
    expect(operationMocks.createBuildOperation).not.toHaveBeenCalled();
    expect(operationMocks.createVersionOperation).not.toHaveBeenCalled();
    expect(operationMocks.createPublishOperations).toHaveBeenCalledWith(
      true,
      false,
      false,
    );
    expect(operationMocks.createDryRunOperations).not.toHaveBeenCalled();
    expect(operationMocks.createPushOperation).not.toHaveBeenCalled();
    expect(phaseMocks.runCiPublishPluginCreds).toHaveBeenCalledTimes(1);
    expect(phaseMocks.runLocalPreflight).not.toHaveBeenCalled();
    expect(operationMocks.createGitHubReleaseOperation).toHaveBeenCalledWith(
      true,
      false,
      false,
      false,
    );
    expect(services.events.emit).toHaveBeenCalledWith({
      type: "workflow.step.started",
      stepId: "publish",
    });
    expect(services.events.emit).toHaveBeenCalledWith({
      type: "workflow.step.completed",
      stepId: "publish",
      detail: {
        facts: [],
      },
    });
    expect(services.record.stepStarted).toHaveBeenCalledTimes(2);
    expect(services.record.stepCompleted).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(services.record.stepCompleted)
        .mock.calls.map(([step]) => step.id),
    ).toEqual(["publish", "release"]);
  });

  it("keeps release token prompts disabled for CI publish phase", async () => {
    envMocks.isCI = true;
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext(
      { mode: "single", packageKey: "packages/a::js", version: "1.2.3" },
      { phase: "publish" },
    );
    const services = createMockServices();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await workflow.run(ctx, services);

    expect(operationMocks.createGitHubReleaseOperation).toHaveBeenCalledWith(
      true,
      false,
      false,
      false,
    );
  });

  it("keeps release token prompts disabled for local non-TTY direct release", async () => {
    setStdinTTY(false);
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });
    const services = createMockServices();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await workflow.run(ctx, services);

    expect(ctx.runtime.promptEnabled).toBe(false);
    expect(operationMocks.createGitHubReleaseOperation).toHaveBeenCalledWith(
      true,
      false,
      false,
      false,
    );
  });

  it("rolls back the original failure when an error hook throws", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });
    const originalError = new Error("release failed");
    const hookError = new Error("hook failed");
    vi.mocked(ctx.runtime.pluginRunner.runErrorHook).mockRejectedValueOnce(
      hookError,
    );
    operationMocks.createTestOperation.mockReturnValueOnce({
      run: async () => {
        throw originalError;
      },
    });
    const services = createMockServices();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((
      code?: number | string | null,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);

    await expect(workflow.run(ctx, services)).rejects.toThrow("exit 1");

    expect(ctx.runtime.pluginRunner.runErrorHook).toHaveBeenCalledWith(
      ctx,
      originalError,
    );
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(ctx.runtime.rollback.execute).toHaveBeenCalledWith(ctx, {
      interactive: true,
    });
  });

  it("records the version output pinned by workflow execution", async () => {
    const workflow = new DirectReleaseWorkflow();
    const ctx = createMockContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    });
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
