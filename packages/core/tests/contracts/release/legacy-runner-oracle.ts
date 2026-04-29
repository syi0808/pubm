import process from "node:process";
import { isCI } from "std-env";
import type { PubmContext } from "../../../src/context.js";
import { consoleError } from "../../../src/error.js";
import { t } from "../../../src/i18n/index.js";
import { registryCatalog } from "../../../src/registry/catalog.js";
import { createDryRunTasks } from "../../../src/tasks/phases/dry-run.js";
import {
  type CleanupRef,
  runCiPreparePreflight,
  runCiPublishPluginCreds,
  runLocalPreflight,
} from "../../../src/tasks/phases/preflight.js";
import { createPublishTasks } from "../../../src/tasks/phases/publish.js";
import {
  createPushTask,
  createReleaseTask,
} from "../../../src/tasks/phases/push-release.js";
import {
  createBuildTask,
  createTestTask,
} from "../../../src/tasks/phases/test-build.js";
import { createVersionTask } from "../../../src/tasks/phases/version.js";
import { formatVersionSummary } from "../../../src/tasks/runner-utils/output-formatting.js";
import { createCiListrOptions, createListr } from "../../../src/utils/listr.js";
import { collectRegistries } from "../../../src/utils/registries.js";
import { resolvePhases } from "../../../src/utils/resolve-phases.js";
import { ui } from "../../../src/utils/ui.js";

function chainCleanup(
  existing: (() => void) | undefined,
  next: () => void,
): () => void {
  return () => {
    existing?.();
    next();
  };
}

export async function runLegacyRunnerOracle(ctx: PubmContext): Promise<void> {
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
  process.on("SIGINT", onSigint);

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

    const pipelineListrOptions = isCI
      ? createCiListrOptions<PubmContext>()
      : undefined;

    await createListr<PubmContext>(
      [
        createTestTask(hasPrepare, !!ctx.options.skipTests),
        createBuildTask(hasPrepare, !!ctx.options.skipBuild),
        createVersionTask(hasPrepare, dryRun),
        ...createPublishTasks(hasPublish, dryRun, !!ctx.options.skipPublish),
        ...createDryRunTasks(
          dryRun,
          mode,
          hasPrepare,
          !!ctx.options.skipDryRun,
        ),
        createPushTask(hasPrepare, dryRun),
        createReleaseTask(
          hasPublish,
          dryRun,
          mode,
          !!ctx.options.skipReleaseDraft,
        ),
      ],
      pipelineListrOptions,
    ).run(ctx);

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

    process.removeListener("SIGINT", onSigint);

    if (mode === "ci" && hasPrepare && !hasPublish) {
      cleanupRef.current?.();
      console.log(`\n\n✅ ${t("output.ciPrepareComplete")}\n`);
    } else if (dryRun) {
      console.log(`\n\n✅ ${t("output.dryRunComplete")}\n`);
    } else {
      console.log(
        `\n\n🚀 ${t("output.publishSuccess", { parts: parts.join(", "), version: ui.chalk.blueBright(formatVersionSummary(ctx)) })} 🚀\n`,
      );
    }

    await ctx.runtime.pluginRunner.runHook("onSuccess", ctx);
  } catch (error: unknown) {
    process.removeListener("SIGINT", onSigint);
    cleanupRef.current?.();

    await ctx.runtime.pluginRunner.runErrorHook(ctx, error as Error);

    consoleError(error as Error);
    await ctx.runtime.rollback.execute(ctx, {
      interactive: ctx.runtime.promptEnabled,
    });

    process.exit(1);
  }
}
