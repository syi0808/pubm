import process from "node:process";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { consoleError } from "../error.js";
import { t } from "../i18n/index.js";
import { registryCatalog } from "../registry/catalog.js";
import { collectRegistries } from "../utils/registries.js";
import { resolvePhases } from "../utils/resolve-phases.js";
import { ui } from "../utils/ui.js";
import type {
  ReleaseOperation,
  ReleaseOperationRunnerOptions,
} from "./release-operation.js";
import { runReleaseOperations } from "./release-operation.js";
import { createDryRunOperations } from "./release-phases/dry-run.js";
import {
  type CleanupRef,
  runCiPreparePreflight,
  runCiPublishPluginCreds,
  runLocalPreflight,
} from "./release-phases/preflight.js";
import { createPublishOperations } from "./release-phases/publish.js";
import {
  createGitHubReleaseOperation,
  createPushOperation,
} from "./release-phases/push-release.js";
import {
  createBuildOperation,
  createTestOperation,
} from "./release-phases/test-build.js";
import { createVersionOperation } from "./release-phases/version.js";
import type {
  Workflow,
  WorkflowCompensationExpectation,
  WorkflowFactDescriptor,
  WorkflowOperationRunner,
  WorkflowRunResult,
  WorkflowServices,
  WorkflowStep,
  WorkflowStepContext,
  WorkflowStepResult,
} from "./types.js";
import {
  createWorkflowVersionStepOutput,
  formatWorkflowVersionSummary,
  readPinnedWorkflowVersionStepOutput,
  type WorkflowVersionStepOutput,
} from "./version-step-output.js";

interface VersionStepInput {
  hasPrepare: boolean;
  dryRun: boolean;
  versionPlanMode:
    | NonNullable<PubmContext["runtime"]["versionPlan"]>["mode"]
    | "unknown";
}

type WorkflowReleaseProfile = "full" | "split-ci";

interface ExecutableWorkflowStepDefinition<I = unknown, O = unknown> {
  id: string;
  title: string;
  input?: I;
  output?: O;
  resolveOutput?: (ctx: PubmContext, input: I) => O;
  resolveFacts?: (
    ctx: PubmContext,
    input: I,
    output: O,
  ) => readonly WorkflowFactDescriptor[];
  emittedFacts?: readonly WorkflowFactDescriptor[];
  compensation?: readonly WorkflowCompensationExpectation[];
  execute(input: I, context: WorkflowStepContext): Promise<void>;
}

function chainCleanup(
  existing: (() => void) | undefined,
  next: () => void,
): () => void {
  return () => {
    existing?.();
    next();
  };
}

function resolveWorkflowProfile(ctx: PubmContext): WorkflowReleaseProfile {
  if (ctx.options.phase !== undefined && isCI) return "split-ci";
  return "full";
}

function createExecutableWorkflowStep<I, O>(
  definition: ExecutableWorkflowStepDefinition<I, O>,
): WorkflowStep<I, O> {
  const step: WorkflowStep<I, O> = {
    id: definition.id,
    title: definition.title,
    emittedFacts: definition.emittedFacts,
    compensation: definition.compensation,
    run: async (
      input: I,
      context: WorkflowStepContext,
    ): Promise<WorkflowStepResult<O>> => {
      await definition.execute(input, context);
      const { ctx } = context;
      const output = resolveStepOutput(definition, ctx, input);
      return {
        output,
        facts:
          definition.resolveFacts?.(ctx, input, output) ??
          definition.emittedFacts,
      };
    },
  };

  if ("input" in definition) step.input = definition.input;
  if ("output" in definition) step.output = definition.output;

  return step;
}

function resolveStepOutput<I, O>(
  definition: ExecutableWorkflowStepDefinition<I, O>,
  ctx: PubmContext,
  input: I,
): O {
  if (definition.resolveOutput) return definition.resolveOutput(ctx, input);
  return definition.output as O;
}

function runWorkflowOperations(
  context: WorkflowStepContext,
  operations: ReleaseOperation | readonly ReleaseOperation[],
  options?: ReleaseOperationRunnerOptions,
): Promise<void> {
  const runner: WorkflowOperationRunner = context.services.operations ?? {
    run: runReleaseOperations,
  };
  return runner.run(context.ctx, operations, options);
}

function createPipelineSteps(
  hasPrepare: boolean,
  hasPublish: boolean,
  dryRun: boolean,
  validatePreparePhase: boolean,
  allowInteractiveReleasePrompt: boolean,
  skipReleaseDraft: boolean,
  skipTests: boolean,
  skipBuild: boolean,
  skipPublish: boolean,
  skipDryRun: boolean,
  ctx: PubmContext,
): WorkflowStep[] {
  return [
    createExecutableWorkflowStep({
      id: "test",
      title: t("task.test.title"),
      input: { hasPrepare, skipTests },
      execute: (input, context) =>
        runWorkflowOperations(context, [
          createTestOperation(input.hasPrepare, input.skipTests),
        ]),
    }),
    createExecutableWorkflowStep({
      id: "build",
      title: t("task.build.title"),
      input: { hasPrepare, skipBuild },
      execute: (input, context) =>
        runWorkflowOperations(context, [
          createBuildOperation(input.hasPrepare, input.skipBuild),
        ]),
    }),
    createExecutableWorkflowStep<VersionStepInput, WorkflowVersionStepOutput>({
      id: "version",
      title: t("task.version.title"),
      input: {
        hasPrepare,
        dryRun,
        versionPlanMode: ctx.runtime.versionPlan?.mode ?? "unknown",
      },
      output: createWorkflowVersionStepOutput(ctx),
      resolveOutput: (ctx) =>
        readPinnedWorkflowVersionStepOutput(ctx) ??
        createWorkflowVersionStepOutput(ctx),
      resolveFacts: (_ctx, input, output) =>
        createVersionStepFacts(input, output),
      emittedFacts: [
        { name: "VersionDecisionObserved", target: "version" },
        { name: "ReleaseFilesMaterialized", target: "version" },
        { name: "ReleaseReferenceLocalTagCreated", target: "version" },
      ],
      compensation: [
        {
          name: "RestoreManifest",
          target: "version",
          before: "manifest write",
        },
        {
          name: "RestoreChangesetFiles",
          target: "version",
          before: "changeset deletion",
        },
        {
          name: "RestoreChangelog",
          target: "version",
          before: "changelog write",
        },
        {
          name: "ResetGitCommit",
          target: "version",
          after: "commit creation",
        },
        {
          name: "DeleteLocalTag",
          target: "version",
          after: "local tag creation",
        },
      ],
      execute: (input, context) =>
        runWorkflowOperations(context, [
          createVersionOperation(input.hasPrepare, input.dryRun),
        ]),
    }),
    createExecutableWorkflowStep({
      id: "publish",
      title: t("task.publish.title"),
      input: { hasPublish, dryRun, skipPublish },
      execute: (input, context) =>
        runWorkflowOperations(
          context,
          createPublishOperations(
            input.hasPublish,
            input.dryRun,
            input.skipPublish,
          ),
        ),
    }),
    createExecutableWorkflowStep({
      id: "dry-run",
      title: t("task.dryRunValidation.title"),
      input: { dryRun, validatePreparePhase, skipDryRun },
      execute: (input, context) =>
        runWorkflowOperations(
          context,
          createDryRunOperations(
            input.dryRun,
            input.validatePreparePhase,
            input.skipDryRun,
          ),
        ),
    }),
    createExecutableWorkflowStep({
      id: "push",
      title: t("task.push.title"),
      input: { hasPrepare, dryRun },
      execute: (input, context) =>
        runWorkflowOperations(context, [
          createPushOperation(input.hasPrepare, input.dryRun),
        ]),
    }),
    createExecutableWorkflowStep({
      id: "release",
      title: t("task.release.title"),
      input: {
        allowInteractiveReleasePrompt,
        dryRun,
        hasPublish,
        skipReleaseDraft,
      },
      execute: (input, context) =>
        runWorkflowOperations(context, [
          createGitHubReleaseOperation(
            input.hasPublish,
            input.dryRun,
            input.allowInteractiveReleasePrompt,
            input.skipReleaseDraft,
          ),
        ]),
    }),
  ];
}

function createVersionStepFacts(
  input: VersionStepInput,
  output: WorkflowVersionStepOutput,
): readonly WorkflowFactDescriptor[] {
  return [
    {
      name: "VersionDecisionObserved",
      target: "version",
      detail: {
        mode: output.versionPlanMode,
        packageKeys: output.packageDecisions.map(
          (decision) => decision.packageKey,
        ),
        summary: output.summary,
      },
    },
    {
      name: "ReleaseFilesMaterialized",
      target: "version",
      detail: {
        dryRun: input.dryRun,
        packageKeys: output.packageDecisions.map(
          (decision) => decision.packageKey,
        ),
      },
    },
    {
      name: "ReleaseReferenceLocalTagCreated",
      target: "version",
      detail: {
        dryRun: input.dryRun,
        tags: output.tagReferences.map((reference) => reference.tagName),
      },
    },
  ];
}

async function formatSuccessParts(ctx: PubmContext): Promise<string[]> {
  const registries = collectRegistries(ctx.config);
  const parts: string[] = [];

  for (const registryKey of registries) {
    const descriptor = registryCatalog.get(registryKey);
    if (!descriptor?.resolveDisplayName) continue;
    const names = await descriptor.resolveDisplayName(ctx.config);
    for (const name of names) {
      parts.push(`${ui.chalk.bold(name)} on ${descriptor.label}`);
    }
  }

  return parts;
}

function createRenderablePipeline(
  hasPrepare: boolean,
  hasPublish: boolean,
  dryRun: boolean,
  validatePreparePhase: boolean,
  allowInteractiveReleasePrompt: boolean,
  skipReleaseDraft: boolean,
  ctx: PubmContext,
): WorkflowStep[] {
  return createPipelineSteps(
    hasPrepare,
    hasPublish,
    dryRun,
    validatePreparePhase,
    allowInteractiveReleasePrompt,
    skipReleaseDraft,
    !!ctx.options.skipTests,
    !!ctx.options.skipBuild,
    !!ctx.options.skipPublish,
    !!ctx.options.skipDryRun,
    ctx,
  );
}

export async function runWorkflowStep<I, O>(
  step: WorkflowStep<I, O>,
  context: WorkflowStepContext,
): Promise<WorkflowStepResult<O>> {
  context.services.record.stepStarted(step);
  await context.services.events.emit({
    type: "workflow.step.started",
    stepId: step.id,
  });
  try {
    const result = await step.run(step.input as I, context);
    context.services.record.stepCompleted(step, result);
    await context.services.events.emit({
      type: "workflow.step.completed",
      stepId: step.id,
      detail: {
        facts: result.facts?.map((fact) => fact.name) ?? [],
      },
    });
    return result;
  } catch (error) {
    context.services.record.stepFailed(step, error);
    await context.services.events.emit({
      type: "workflow.step.failed",
      stepId: step.id,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function runWorkflowSteps(
  steps: readonly WorkflowStep[],
  ctx: PubmContext,
  services: WorkflowServices,
): Promise<void> {
  if (services.steps) {
    await services.steps.run(steps, ctx, services);
    return;
  }

  const stepContext: WorkflowStepContext = { ctx, services };
  for (const step of steps) {
    await runWorkflowStep(step, stepContext);
  }
}

export class DirectReleaseWorkflow implements Workflow {
  readonly name = "direct-release";

  describe(ctx: PubmContext): readonly WorkflowStep[] {
    const profile = resolveWorkflowProfile(ctx);
    const phases = resolvePhases(ctx.options);
    const dryRun = !!ctx.options.dryRun;
    const hasPrepare = phases.includes("prepare");
    const hasPublish = phases.includes("publish");

    return createRenderablePipeline(
      hasPrepare,
      hasPublish,
      dryRun,
      profile === "split-ci" && hasPrepare,
      profile === "full",
      !!ctx.options.skipReleaseDraft,
      ctx,
    );
  }

  async run(
    ctx: PubmContext,
    services: WorkflowServices,
  ): Promise<WorkflowRunResult> {
    ctx.runtime.promptEnabled = !isCI && process.stdin.isTTY;

    const profile = resolveWorkflowProfile(ctx);
    const phases = resolvePhases(ctx.options);
    const dryRun = !!ctx.options.dryRun;
    const hasPrepare = phases.includes("prepare");
    const hasPublish = phases.includes("publish");

    const cleanupRef: CleanupRef = {
      current: undefined,
    };

    const onSigint = async () => {
      cleanupRef.current?.();
      await ctx.runtime.rollback.execute(ctx, {
        interactive: false,
        sigint: true,
      });
      process.exit(130);
    };
    const removeInterruptListener = services.signals.onInterrupt(onSigint);
    const executeOperations = services.operations?.run ?? runReleaseOperations;

    try {
      if (ctx.options.contents) process.chdir(ctx.options.contents);

      if (profile === "split-ci" && hasPrepare) {
        await runCiPreparePreflight(
          ctx,
          chainCleanup,
          cleanupRef,
          executeOperations,
        );
      }
      if (profile === "full" && hasPrepare) {
        await runLocalPreflight(
          ctx,
          chainCleanup,
          cleanupRef,
          executeOperations,
        );
      }
      if (profile === "split-ci" && hasPublish && !hasPrepare) {
        await runCiPublishPluginCreds(
          ctx,
          chainCleanup,
          cleanupRef,
          executeOperations,
        );
      }

      const steps = createRenderablePipeline(
        hasPrepare,
        hasPublish,
        dryRun,
        profile === "split-ci" && hasPrepare,
        profile === "full",
        !!ctx.options.skipReleaseDraft,
        ctx,
      );
      await runWorkflowSteps(steps, ctx, services);

      const parts = await formatSuccessParts(ctx);

      removeInterruptListener();

      if (profile === "split-ci" && hasPrepare && !hasPublish) {
        cleanupRef.current?.();
        console.log(`\n\n✅ ${t("output.ciPrepareComplete")}\n`);
      } else if (dryRun) {
        console.log(`\n\n✅ ${t("output.dryRunComplete")}\n`);
      } else {
        const versionSummary =
          services.record.versionSummary() ?? formatWorkflowVersionSummary(ctx);
        console.log(
          `\n\n🚀 ${t("output.publishSuccess", { parts: parts.join(", "), version: ui.chalk.blueBright(versionSummary) })} 🚀\n`,
        );
      }

      await ctx.runtime.pluginRunner.runHook("onSuccess", ctx);
      return { status: "success" };
    } catch (error: unknown) {
      removeInterruptListener();
      cleanupRef.current?.();

      await ctx.runtime.pluginRunner.runErrorHook(ctx, error as Error);

      consoleError(error as Error);
      await ctx.runtime.rollback.execute(ctx, {
        interactive: ctx.runtime.promptEnabled,
      });

      process.exit(1);
    } finally {
      services.signals.dispose();
    }
  }
}
