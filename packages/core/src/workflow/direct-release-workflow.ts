import process from "node:process";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { consoleError } from "../error.js";
import { t } from "../i18n/index.js";
import { registryCatalog } from "../registry/catalog.js";
import { createDryRunTasks } from "../tasks/phases/dry-run.js";
import {
  type CleanupRef,
  runCiPreparePreflight,
  runCiPublishPluginCreds,
  runLocalPreflight,
} from "../tasks/phases/preflight.js";
import { createPublishTasks } from "../tasks/phases/publish.js";
import {
  createPushTask,
  createReleaseTask,
} from "../tasks/phases/push-release.js";
import { createBuildTask, createTestTask } from "../tasks/phases/test-build.js";
import { createVersionTask } from "../tasks/phases/version.js";
import { packageKey } from "../utils/package-key.js";
import { collectRegistries } from "../utils/registries.js";
import { resolvePhases } from "../utils/resolve-phases.js";
import { ui } from "../utils/ui.js";
import type {
  Workflow,
  WorkflowRunResult,
  WorkflowServices,
  WorkflowStep,
} from "./types.js";

function chainCleanup(
  existing: (() => void) | undefined,
  next: () => void,
): () => void {
  return () => {
    existing?.();
    next();
  };
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
): WorkflowStep[] {
  return [
    {
      id: "test",
      tasks: () => [createTestTask(hasPrepare, skipTests)],
    },
    {
      id: "build",
      tasks: () => [createBuildTask(hasPrepare, skipBuild)],
    },
    {
      id: "version",
      tasks: () => [createVersionTask(hasPrepare, dryRun)],
    },
    {
      id: "publish",
      tasks: () => createPublishTasks(hasPublish, dryRun, skipPublish),
    },
    {
      id: "dry-run",
      tasks: () => createDryRunTasks(dryRun, mode, hasPrepare, skipDryRun),
    },
    {
      id: "push",
      tasks: () => [createPushTask(hasPrepare, dryRun)],
    },
    {
      id: "release",
      tasks: () => [
        createReleaseTask(hasPublish, dryRun, mode, skipReleaseDraft),
      ],
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
  );
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
      await services.view.run(ctx, steps);

      const parts = await formatSuccessParts(ctx);

      removeInterruptListener();

      if (mode === "ci" && hasPrepare && !hasPublish) {
        cleanupRef.current?.();
        console.log(`\n\n✅ ${t("output.ciPrepareComplete")}\n`);
      } else if (dryRun) {
        console.log(`\n\n✅ ${t("output.dryRunComplete")}\n`);
      } else {
        console.log(
          `\n\n🚀 ${t("output.publishSuccess", { parts: parts.join(", "), version: ui.chalk.blueBright(formatWorkflowVersionSummary(ctx)) })} 🚀\n`,
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
