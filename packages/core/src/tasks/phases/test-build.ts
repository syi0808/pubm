import type { ListrTask } from "listr2";
import type { PubmContext } from "../../context.js";
import { ecosystemCatalog } from "../../ecosystem/catalog.js";
import { AbstractError } from "../../error.js";
import { t } from "../../i18n/index.js";
import { exec } from "../../utils/exec.js";
import {
  createLiveCommandOutput,
  shouldRenderLiveCommandOutput,
} from "../runner-utils/output-formatting.js";

function collectUniqueEcosystems(ctx: PubmContext): string[] {
  const seen = new Set<string>();
  for (const pkg of ctx.config.packages) {
    seen.add(pkg.ecosystem ?? "js");
  }
  return [...seen];
}

async function execEcosystemCommand(
  ctx: PubmContext,
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
  task: any,
  command: string,
): Promise<void> {
  const parts = command.split(/\s+/);
  const [cmd, ...args] = parts;
  const liveOutput = shouldRenderLiveCommandOutput(ctx)
    ? createLiveCommandOutput(task, command)
    : undefined;
  task.output = `Executing \`${command}\``;

  try {
    await exec(cmd, args, {
      onStdout: liveOutput?.onStdout,
      onStderr: liveOutput?.onStderr,
      throwOnError: true,
    });
  } finally {
    liveOutput?.finish();
  }
}

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

      const ecosystems = collectUniqueEcosystems(ctx);
      const executedCommands: string[] = [];
      for (const key of ecosystems) {
        const descriptor = ecosystemCatalog.get(key);
        if (!descriptor) continue;
        const instance = new descriptor.ecosystemClass(ctx.cwd);
        const command = await instance.defaultTestCommand(
          ctx.options.testScript,
        );
        executedCommands.push(command);
        task.title = t("task.test.titleWithCommand", { command });

        try {
          await execEcosystemCommand(ctx, task, command);
        } catch (error) {
          throw new AbstractError(
            t("error.test.failedWithHint", {
              script: command,
              command,
            }),
            { cause: error },
          );
        }
      }

      task.output = t("task.test.runningAfterHooks");
      await ctx.runtime.pluginRunner.runHook("afterTest", ctx);
      task.output = t("task.test.completed", {
        command: executedCommands.join(", "),
      });
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

      const ecosystems = collectUniqueEcosystems(ctx);
      const executedCommands: string[] = [];
      for (const key of ecosystems) {
        const descriptor = ecosystemCatalog.get(key);
        if (!descriptor) continue;
        const instance = new descriptor.ecosystemClass(ctx.cwd);
        const command = await instance.defaultBuildCommand(
          ctx.options.buildScript,
        );
        executedCommands.push(command);
        task.title = t("task.build.titleWithCommand", { command });

        try {
          await execEcosystemCommand(ctx, task, command);
        } catch (error) {
          throw new AbstractError(
            t("error.build.failedWithHint", {
              script: command,
              command,
            }),
            { cause: error },
          );
        }
      }

      task.output = t("task.build.runningAfterHooks");
      await ctx.runtime.pluginRunner.runHook("afterBuild", ctx);
      task.output = t("task.build.completed", {
        command: executedCommands.join(", "),
      });
    },
  };
}
