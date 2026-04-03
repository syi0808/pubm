import type { ListrTask } from "listr2";
import type { PubmContext } from "../../context.js";
import { AbstractError } from "../../error.js";
import { t } from "../../i18n/index.js";
import { exec } from "../../utils/exec.js";
import { getPackageManager } from "../../utils/package-manager.js";
import {
  createLiveCommandOutput,
  shouldRenderLiveCommandOutput,
} from "../runner-utils/output-formatting.js";

export function createTestTask(
  hasPrepare: boolean,
  skipTests: boolean,
): ListrTask<PubmContext> {
  return {
    enabled: hasPrepare && !skipTests,
    title: t("task.test.title"),
    task: async (ctx, task): Promise<void> => {
      task.output = t("task.test.runningBeforeHooks");
      await ctx.runtime.pluginRunner.runHook("beforeTest", ctx);
      const packageManager = await getPackageManager();
      const command = `${packageManager} run ${ctx.options.testScript}`;
      task.title = t("task.test.titleWithCommand", { command });
      const liveOutput = shouldRenderLiveCommandOutput(ctx)
        ? createLiveCommandOutput(task, command)
        : undefined;
      task.output = `Executing \`${command}\``;

      try {
        await exec(packageManager, ["run", ctx.options.testScript], {
          onStdout: liveOutput?.onStdout,
          onStderr: liveOutput?.onStderr,
          throwOnError: true,
        });
      } catch (error) {
        liveOutput?.finish();
        throw new AbstractError(
          t("error.test.failedWithHint", {
            script: ctx.options.testScript,
            command,
          }),
          { cause: error },
        );
      }
      liveOutput?.finish();
      task.output = t("task.test.runningAfterHooks");
      await ctx.runtime.pluginRunner.runHook("afterTest", ctx);
      task.output = t("task.test.completed", { command });
    },
  };
}

export function createBuildTask(
  hasPrepare: boolean,
  skipBuild: boolean,
): ListrTask<PubmContext> {
  return {
    enabled: hasPrepare && !skipBuild,
    title: t("task.build.title"),
    task: async (ctx, task): Promise<void> => {
      task.output = t("task.build.runningBeforeHooks");
      await ctx.runtime.pluginRunner.runHook("beforeBuild", ctx);
      const packageManager = await getPackageManager();
      const command = `${packageManager} run ${ctx.options.buildScript}`;
      task.title = t("task.build.titleWithCommand", { command });
      const liveOutput = shouldRenderLiveCommandOutput(ctx)
        ? createLiveCommandOutput(task, command)
        : undefined;
      task.output = `Executing \`${command}\``;

      try {
        await exec(packageManager, ["run", ctx.options.buildScript], {
          onStdout: liveOutput?.onStdout,
          onStderr: liveOutput?.onStderr,
          throwOnError: true,
        });
      } catch (error) {
        liveOutput?.finish();
        throw new AbstractError(
          t("error.build.failedWithHint", {
            script: ctx.options.buildScript,
            command,
          }),
          { cause: error },
        );
      }
      liveOutput?.finish();
      task.output = t("task.build.runningAfterHooks");
      await ctx.runtime.pluginRunner.runHook("afterBuild", ctx);
      task.output = t("task.build.completed", { command });
    },
  };
}
