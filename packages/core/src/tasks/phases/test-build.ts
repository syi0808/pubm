import path from "node:path";
import type { ListrTask } from "listr2";
import type { ResolvedPackageConfig } from "../../config/types.js";
import type { PubmContext } from "../../context.js";
import { ecosystemCatalog } from "../../ecosystem/catalog.js";
import { AbstractError } from "../../error.js";
import { t } from "../../i18n/index.js";
import { detectWorkspace } from "../../monorepo/workspace.js";
import { exec } from "../../utils/exec.js";
import {
  createLiveCommandOutput,
  shouldRenderLiveCommandOutput,
} from "../runner-utils/output-formatting.js";

interface ResolvedExecution {
  label: string;
  cmd: string;
  args: string[];
  cwd: string;
}

type CommandType = "test" | "build";

const JS_WORKSPACE_TYPES = new Set(["pnpm", "npm", "yarn", "bun", "deno"]);

const ECOSYSTEM_DEFAULTS: Record<string, Record<CommandType, string>> = {
  js: { test: "test", build: "build" },
  rust: { test: "test", build: "build --release" },
};

function hasWorkspaceForEcosystem(cwd: string, ecosystemKey: string): boolean {
  const workspaces = detectWorkspace(cwd);
  if (ecosystemKey === "js") {
    return workspaces.some((w) => JS_WORKSPACE_TYPES.has(w.type));
  }
  if (ecosystemKey === "rust") {
    return workspaces.some((w) => w.type === "cargo");
  }
  return false;
}

function hasPackageLevelOverride(
  pkg: ResolvedPackageConfig,
  type: CommandType,
): boolean {
  return type === "test"
    ? !!(pkg.testCommand || pkg.testScript)
    : !!(pkg.buildCommand || pkg.buildScript);
}

function resolveScript(
  pkg: ResolvedPackageConfig,
  ecosystemKey: string,
  ctx: PubmContext,
  type: CommandType,
): { script?: string; command?: string } {
  const sf = type === "test" ? "testScript" : "buildScript";
  const cf = type === "test" ? "testCommand" : "buildCommand";

  if (pkg[cf]) return { command: pkg[cf] };
  if (pkg[sf]) return { script: pkg[sf] };

  const eco = ctx.config.ecosystems?.[ecosystemKey];
  if (eco?.[cf]) return { command: eco[cf] };
  if (eco?.[sf]) return { script: eco[sf] };

  const globalScript =
    type === "test" ? ctx.options.testScript : ctx.options.buildScript;
  if (globalScript) return { script: globalScript };

  return { script: ECOSYSTEM_DEFAULTS[ecosystemKey]?.[type] ?? type };
}

interface EcosystemGroup {
  ecosystemKey: string;
  groupPackages: ResolvedPackageConfig[];
  individualPackages: ResolvedPackageConfig[];
  hasWorkspace: boolean;
}

function groupByEcosystem(
  ctx: PubmContext,
  type: CommandType,
): EcosystemGroup[] {
  const map = new Map<
    string,
    { group: ResolvedPackageConfig[]; individual: ResolvedPackageConfig[] }
  >();

  for (const pkg of ctx.config.packages) {
    const key = pkg.ecosystem ?? "js";
    if (!map.has(key)) map.set(key, { group: [], individual: [] });
    const entry = map.get(key)!;
    if (hasPackageLevelOverride(pkg, type)) {
      entry.individual.push(pkg);
    } else {
      entry.group.push(pkg);
    }
  }

  const result: EcosystemGroup[] = [];
  for (const descriptor of ecosystemCatalog.all()) {
    const entry = map.get(descriptor.key);
    if (!entry) continue;
    if (entry.group.length === 0 && entry.individual.length === 0) continue;
    result.push({
      ecosystemKey: descriptor.key,
      groupPackages: entry.group,
      individualPackages: entry.individual,
      hasWorkspace: hasWorkspaceForEcosystem(ctx.cwd, descriptor.key),
    });
  }
  return result;
}

async function resolveExecutions(
  ctx: PubmContext,
  type: CommandType,
): Promise<ResolvedExecution[]> {
  const groups = groupByEcosystem(ctx, type);
  const executions: ResolvedExecution[] = [];

  for (const group of groups) {
    const descriptor = ecosystemCatalog.get(group.ecosystemKey);
    if (!descriptor) continue;

    if (group.groupPackages.length > 0) {
      // Safe to use [0]: group packages have no per-package overrides,
      // so they all resolve identically through ecosystem/global/default levels.
      const resolved = resolveScript(
        group.groupPackages[0],
        group.ecosystemKey,
        ctx,
        type,
      );

      if (resolved.command) {
        if (group.hasWorkspace) {
          executions.push({
            label: resolved.command,
            cmd: "sh",
            args: ["-c", resolved.command],
            cwd: ctx.cwd,
          });
        } else {
          for (const pkg of group.groupPackages) {
            const pkgCwd = path.resolve(ctx.cwd, pkg.path);
            executions.push({
              label: `${resolved.command} (${pkg.path})`,
              cmd: "sh",
              args: ["-c", resolved.command],
              cwd: pkgCwd,
            });
          }
        }
      } else if (resolved.script) {
        if (group.hasWorkspace) {
          const instance = new descriptor.ecosystemClass(ctx.cwd);
          const { cmd, args } =
            type === "test"
              ? await instance.resolveTestCommand(resolved.script)
              : await instance.resolveBuildCommand(resolved.script);
          executions.push({
            label: `${cmd} ${args.join(" ")}`,
            cmd,
            args,
            cwd: ctx.cwd,
          });
        } else {
          for (const pkg of group.groupPackages) {
            const pkgCwd = path.resolve(ctx.cwd, pkg.path);
            const instance = new descriptor.ecosystemClass(pkgCwd);
            const { cmd, args } =
              type === "test"
                ? await instance.resolveTestCommand(resolved.script)
                : await instance.resolveBuildCommand(resolved.script);
            executions.push({
              label: `${cmd} ${args.join(" ")} (${pkg.path})`,
              cmd,
              args,
              cwd: pkgCwd,
            });
          }
        }
      }
    }

    for (const pkg of group.individualPackages) {
      const pkgCwd = path.resolve(ctx.cwd, pkg.path);
      const resolved = resolveScript(pkg, group.ecosystemKey, ctx, type);

      if (resolved.command) {
        executions.push({
          label: `${resolved.command} (${pkg.path})`,
          cmd: "sh",
          args: ["-c", resolved.command],
          cwd: pkgCwd,
        });
      } else if (resolved.script) {
        const instance = new descriptor.ecosystemClass(pkgCwd);
        const { cmd, args } =
          type === "test"
            ? await instance.resolveTestCommand(resolved.script)
            : await instance.resolveBuildCommand(resolved.script);
        executions.push({
          label: `${cmd} ${args.join(" ")} (${pkg.path})`,
          cmd,
          args,
          cwd: pkgCwd,
        });
      }
    }
  }

  return executions;
}

async function runExecution(
  execution: ResolvedExecution,
  ctx: PubmContext,
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
  task: any,
): Promise<void> {
  const liveOutput = shouldRenderLiveCommandOutput(ctx)
    ? createLiveCommandOutput(task, execution.label)
    : undefined;
  task.output = `Executing \`${execution.label}\``;

  try {
    await exec(execution.cmd, execution.args, {
      onStdout: liveOutput?.onStdout,
      onStderr: liveOutput?.onStderr,
      throwOnError: true,
      nodeOptions: { cwd: execution.cwd },
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

      const executions = await resolveExecutions(ctx, "test");
      for (const execution of executions) {
        task.title = t("task.test.titleWithCommand", {
          command: execution.label,
        });
        try {
          await runExecution(execution, ctx, task);
        } catch (error) {
          throw new AbstractError(
            t("error.test.failedWithHint", {
              script: execution.label,
              command: execution.label,
            }),
            { cause: error },
          );
        }
      }

      task.output = t("task.test.runningAfterHooks");
      await ctx.runtime.pluginRunner.runHook("afterTest", ctx);
      task.output = t("task.test.completed", {
        command: executions.map((e) => e.label).join(", "),
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

      const executions = await resolveExecutions(ctx, "build");
      for (const execution of executions) {
        task.title = t("task.build.titleWithCommand", {
          command: execution.label,
        });
        try {
          await runExecution(execution, ctx, task);
        } catch (error) {
          throw new AbstractError(
            t("error.build.failedWithHint", {
              script: execution.label,
              command: execution.label,
            }),
            { cause: error },
          );
        }
      }

      task.output = t("task.build.runningAfterHooks");
      await ctx.runtime.pluginRunner.runHook("afterBuild", ctx);
      task.output = t("task.build.completed", {
        command: executions.map((e) => e.label).join(", "),
      });
    },
  };
}
