import process from "node:process";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { consoleError } from "../error.js";
import { t } from "../i18n/index.js";
import { registryCatalog } from "../registry/catalog.js";
import {
  type CleanupRef,
  runCiPreparePreflight,
  runCiPublishPluginCreds,
  runLocalPreflight,
} from "../tasks/phases/preflight.js";
import {
  nativeReleasePhaseService,
  type ReleasePhaseService,
} from "../tasks/release-phase-service.js";
import { packageKey } from "../utils/package-key.js";
import { collectRegistries } from "../utils/registries.js";
import { resolvePhases } from "../utils/resolve-phases.js";
import { ui } from "../utils/ui.js";
import type {
  Workflow,
  WorkflowCompensationExpectation,
  WorkflowFactDescriptor,
  WorkflowRunResult,
  WorkflowServices,
  WorkflowStep,
  WorkflowStepContext,
  WorkflowStepResult,
} from "./types.js";

const releasePhaseService = nativeReleasePhaseService;

interface VersionStepInput {
  hasPrepare: boolean;
  dryRun: boolean;
  versionPlanMode:
    | NonNullable<PubmContext["runtime"]["versionPlan"]>["mode"]
    | "unknown";
}

interface VersionStepOutput {
  summary: string;
}

interface ExecutableWorkflowStepDefinition<I = unknown, O = unknown> {
  id: string;
  input?: I;
  output?: O;
  resolveOutput?: (ctx: PubmContext) => O;
  emittedFacts?: readonly WorkflowFactDescriptor[];
  compensation?: readonly WorkflowCompensationExpectation[];
  execute(
    input: I,
    ctx: PubmContext,
    phases: ReleasePhaseService,
  ): Promise<void>;
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

function createExecutableWorkflowStep<I, O>(
  definition: ExecutableWorkflowStepDefinition<I, O>,
): WorkflowStep<I, O> {
  const step: WorkflowStep<I, O> = {
    id: definition.id,
    emittedFacts: definition.emittedFacts,
    compensation: definition.compensation,
    run: async (
      input: I,
      { ctx }: WorkflowStepContext,
    ): Promise<WorkflowStepResult<O>> => {
      await definition.execute(input, ctx, releasePhaseService);
      return {
        output: resolveStepOutput(definition, ctx),
        facts: definition.emittedFacts,
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
): O {
  if (definition.resolveOutput) return definition.resolveOutput(ctx);
  return definition.output as O;
}

function createPipelineSteps(
  hasPrepare: boolean,
  hasPublish: boolean,
  dryRun: boolean,
  mode: string,
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
      input: { hasPrepare, skipTests },
      execute: (input, ctx, phases) => phases.runTest(ctx, input),
    }),
    createExecutableWorkflowStep({
      id: "build",
      input: { hasPrepare, skipBuild },
      execute: (input, ctx, phases) => phases.runBuild(ctx, input),
    }),
    createExecutableWorkflowStep<VersionStepInput, VersionStepOutput>({
      id: "version",
      input: {
        hasPrepare,
        dryRun,
        versionPlanMode: ctx.runtime.versionPlan?.mode ?? "unknown",
      },
      output: {
        summary: formatWorkflowVersionSummary(ctx),
      },
      resolveOutput: (ctx) => ({
        summary: formatWorkflowVersionSummary(ctx),
      }),
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
      execute: (input, ctx, phases) => phases.runVersion(ctx, input),
    }),
    createExecutableWorkflowStep({
      id: "publish",
      input: { hasPublish, dryRun, skipPublish },
      execute: (input, ctx, phases) => phases.runPublish(ctx, input),
    }),
    createExecutableWorkflowStep({
      id: "dry-run",
      input: { dryRun, mode, hasPrepare, skipDryRun },
      execute: (input, ctx, phases) => phases.runDryRun(ctx, input),
    }),
    createExecutableWorkflowStep({
      id: "push",
      input: { hasPrepare, dryRun },
      execute: (input, ctx, phases) => phases.runPush(ctx, input),
    }),
    createExecutableWorkflowStep({
      id: "release",
      input: { hasPublish, dryRun, mode, skipReleaseDraft },
      execute: (input, ctx, phases) => phases.runRelease(ctx, input),
    }),
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

function packageNameForKey(ctx: PubmContext, key: string): string {
  return (
    ctx.config.packages.find((pkg) => packageKey(pkg) === key)?.name ?? key
  );
}

function formatWorkflowVersionSummary(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (!plan) return "";
  if (plan.mode === "independent") {
    return [...plan.packages]
      .map(([key, version]) => `${packageNameForKey(ctx, key)}@${version}`)
      .join(", ");
  }
  return `v${plan.version}`;
}

function createRenderablePipeline(
  hasPrepare: boolean,
  hasPublish: boolean,
  dryRun: boolean,
  mode: string,
  skipReleaseDraft: boolean,
  ctx: PubmContext,
): WorkflowStep[] {
  return createPipelineSteps(
    hasPrepare,
    hasPublish,
    dryRun,
    mode,
    skipReleaseDraft,
    !!ctx.options.skipTests,
    !!ctx.options.skipBuild,
    !!ctx.options.skipPublish,
    !!ctx.options.skipDryRun,
    ctx,
  );
}

async function runWorkflowStep<I, O>(
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
  const stepContext: WorkflowStepContext = { ctx, services };
  for (const step of steps) {
    await runWorkflowStep(step, stepContext);
  }
}

export class DirectReleaseWorkflow implements Workflow {
  readonly name = "direct-release";

  describe(ctx: PubmContext): readonly WorkflowStep[] {
    const mode = ctx.options.mode ?? "local";
    const phases = resolvePhases(ctx.options);
    const dryRun = !!ctx.options.dryRun;

    return createRenderablePipeline(
      phases.includes("prepare"),
      phases.includes("publish"),
      dryRun,
      mode,
      !!ctx.options.skipReleaseDraft,
      ctx,
    );
  }

  async run(
    ctx: PubmContext,
    services: WorkflowServices,
  ): Promise<WorkflowRunResult> {
    ctx.runtime.promptEnabled = !isCI && process.stdin.isTTY;

    const mode = ctx.options.mode ?? "local";
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

    try {
      if (ctx.options.contents) process.chdir(ctx.options.contents);

      if (mode === "ci" && hasPrepare) {
        await runCiPreparePreflight(ctx, chainCleanup, cleanupRef);
      }
      if (mode === "local" && hasPrepare) {
        await runLocalPreflight(ctx, chainCleanup, cleanupRef);
      }
      if (mode === "ci" && hasPublish && !hasPrepare) {
        await runCiPublishPluginCreds(ctx, chainCleanup, cleanupRef);
      }

      const steps = createRenderablePipeline(
        hasPrepare,
        hasPublish,
        dryRun,
        mode,
        !!ctx.options.skipReleaseDraft,
        ctx,
      );
      await runWorkflowSteps(steps, ctx, services);

      const parts = await formatSuccessParts(ctx);

      removeInterruptListener();

      if (mode === "ci" && hasPrepare && !hasPublish) {
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
