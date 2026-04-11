import process from "node:process";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { consoleError } from "../error.js";
import { t } from "../i18n/index.js";
import { registryCatalog } from "../registry/catalog.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { collectRegistries } from "../utils/registries.js";
import { resolvePhases } from "../utils/resolve-phases.js";
import { ui } from "../utils/ui.js";
import { createDryRunTasks } from "./phases/dry-run.js";
import {
  type CleanupRef,
  runCiPreparePreflight,
  runCiPublishPluginCreds,
  runLocalPreflight,
} from "./phases/preflight.js";
import { createPublishTasks } from "./phases/publish.js";
import { createPushTask, createReleaseTask } from "./phases/push-release.js";
import { createBuildTask, createTestTask } from "./phases/test-build.js";
import { createVersionTask } from "./phases/version.js";
import { formatVersionSummary } from "./runner-utils/output-formatting.js";

export { collectPublishTasks } from "./runner-utils/publish-tasks.js";
export { writeVersions } from "./runner-utils/write-versions.js";

function chainCleanup(
  existing: (() => void) | undefined,
  next: () => void,
): () => void {
  return () => {
    existing?.();
    next();
  };
}

export async function run(ctx: PubmContext): Promise<void> {
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

    if (mode === "ci" && hasPrepare)
      await runCiPreparePreflight(ctx, chainCleanup, cleanupRef);
    if (mode === "local" && hasPrepare)
      await runLocalPreflight(ctx, chainCleanup, cleanupRef);
    if (mode === "ci" && hasPublish && !hasPrepare)
      await runCiPublishPluginCreds(ctx, chainCleanup, cleanupRef);

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
  } catch (e: unknown) {
    process.removeListener("SIGINT", onSigint);
    cleanupRef.current?.();

    await ctx.runtime.pluginRunner.runErrorHook(ctx, e as Error);

    consoleError(e as Error);
    await ctx.runtime.rollback.execute(ctx, {
      interactive: ctx.runtime.promptEnabled,
    });

    process.exit(1);
  }
}
