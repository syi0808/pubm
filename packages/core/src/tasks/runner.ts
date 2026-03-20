import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import process from "node:process";
import { stripVTControlCharacters } from "node:util";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { Listr, ListrRenderer, ListrTask, ListrTaskWrapper } from "listr2";
import micromatch from "micromatch";
import SemVer from "semver";
import { isCI } from "std-env";
import { runAssetPipeline } from "../assets/pipeline.js";
import { normalizeConfig, resolveAssets } from "../assets/resolver.js";
import type { PreparedAsset } from "../assets/types.js";
import {
  buildChangelogEntries,
  generateChangelog,
  writeChangelogToFile,
} from "../changeset/changelog.js";
import { parseChangelogSection } from "../changeset/changelog-parser.js";
import { deleteChangesetFiles, readChangesets } from "../changeset/reader.js";
import { createKeyResolver } from "../changeset/resolve.js";
import type { PubmContext } from "../context.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { AbstractError, consoleError } from "../error.js";
import { Git } from "../git.js";
import { writeVersionsForEcosystem } from "../manifest/write-versions.js";
import {
  collectWorkspaceVersions,
  resolveWorkspaceProtocolsInManifests,
  restoreManifests,
} from "../monorepo/resolve-workspace.js";
import { registryCatalog } from "../registry/catalog.js";
import { JsrClient } from "../registry/jsr.js";
import { exec } from "../utils/exec.js";
import { resolveGitHubToken, saveGitHubToken } from "../utils/github-token.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { openUrl } from "../utils/open-url.js";
import { getPackageManager } from "../utils/package-manager.js";
import { collectRegistries } from "../utils/registries.js";
import { resolvePhases } from "../utils/resolve-phases.js";
import {
  addRollback,
  rollback,
  rollbackError,
  rollbackLog,
} from "../utils/rollback.js";
import { generateSnapshotVersion } from "../utils/snapshot.js";
import { injectTokensToEnv } from "../utils/token.js";
import { ui } from "../utils/ui.js";
import { createCratesPublishTask } from "./crates.js";
import {
  createCratesDryRunPublishTask,
  createJsrDryRunPublishTask,
  createNpmDryRunPublishTask,
} from "./dry-run-publish.js";
import { createGitHubRelease } from "./github-release.js";
import {
  collectEcosystemRegistryGroups,
  countRegistryTargets,
  ecosystemLabel,
  registryLabel,
} from "./grouping.js";
import { createJsrPublishTask } from "./jsr.js";
import { createNpmPublishTask } from "./npm.js";
import { collectTokens, promptGhSecretsSync } from "./preflight.js";
import { prerequisitesCheckTask } from "./prerequisites-check.js";
import { requiredConditionsCheckTask } from "./required-conditions-check.js";

const { prerelease } = SemVer;
const LIVE_COMMAND_OUTPUT_LINE_LIMIT = 4;

async function prepareReleaseAssets(
  ctx: PubmContext,
  packageName: string,
  version: string,
  packagePath?: string,
): Promise<{ assets: PreparedAsset[]; tempDir: string }> {
  const assetConfig = ctx.config.releaseAssets ?? [];
  if (assetConfig.length === 0) {
    return { assets: [], tempDir: "" };
  }

  const assetHooks = ctx.runtime.pluginRunner.collectAssetHooks();
  const normalizedGroups = normalizeConfig(assetConfig, ctx.config.compress);

  // Find relevant group for this package
  const relevantGroup = normalizedGroups.find(
    (g) => !g.packagePath || g.packagePath === packagePath,
  ) ?? { files: [] };

  const tempDir = join(tmpdir(), `pubm-assets-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  ctx.runtime.tempDir = tempDir;

  const resolvedAssets = resolveAssets(
    relevantGroup,
    ctx.config.compress,
    ctx.cwd,
  );
  const preparedAssets = await runAssetPipeline(resolvedAssets, assetHooks, {
    name: packageName.replace(/^@[^/]+\//, ""),
    version,
    tempDir,
    pubmContext: ctx,
  });

  return { assets: preparedAssets, tempDir };
}

function isReleaseExcluded(
  config: { excludeRelease?: string[] },
  pkgPath: string,
): boolean {
  const patterns = config.excludeRelease;
  if (!patterns?.length) return false;
  return micromatch.isMatch(pkgPath, patterns);
}

function getPackageName(ctx: PubmContext, packagePath: string): string {
  return (
    ctx.config.packages.find((p) => p.path === packagePath)?.name ?? packagePath
  );
}

async function writeVersions(
  ctx: PubmContext,
  versions: Map<string, string>,
): Promise<string[]> {
  const ecosystems = ctx.config.packages.map((pkg) => {
    const absPath = path.resolve(ctx.cwd ?? process.cwd(), pkg.path);
    const descriptor = ecosystemCatalog.get(pkg.ecosystem!);
    if (!descriptor) throw new Error(`Unknown ecosystem: ${pkg.ecosystem}`);
    const eco = new descriptor.ecosystemClass(absPath);
    return { eco, pkg };
  });

  const lockfileChanges = await writeVersionsForEcosystem(ecosystems, versions);

  // Collect manifest file paths for git staging
  const manifestFiles = ecosystems.flatMap(({ eco }) =>
    eco.manifestFiles().map((f) => path.resolve(eco.packagePath, f)),
  );

  return [...manifestFiles, ...lockfileChanges];
}

type NewListrParentTask<Context extends object> = ListrTaskWrapper<
  Context,
  typeof ListrRenderer,
  typeof ListrRenderer
>;

// Registry key → publish task mapping (kept in runner for listr2 orchestration)
const publishTaskMap: Record<
  string,
  (packagePath: string) => ListrTask<PubmContext>
> = {
  npm: (p) => createNpmPublishTask(p),
  jsr: (p) => createJsrPublishTask(p),
  crates: (p) => createCratesPublishTask(p),
};

function createPublishTaskForPath(
  registryKey: string,
  packagePath: string,
): ListrTask<PubmContext> {
  const factory = publishTaskMap[registryKey];
  if (!factory)
    return { title: `Publish to ${registryKey}`, task: async () => {} };
  return factory(packagePath);
}

function resolveWorkspaceProtocols(ctx: PubmContext): void {
  if (!ctx.cwd) return;

  const workspaceVersions = collectWorkspaceVersions(ctx.cwd);
  if (workspaceVersions.size === 0) return;

  const packagePaths = ctx.config.packages.map((pkg) =>
    path.resolve(ctx.cwd, pkg.path),
  );

  const backups = resolveWorkspaceProtocolsInManifests(
    packagePaths,
    workspaceVersions,
  );

  if (backups.size > 0) {
    ctx.runtime.workspaceBackups = backups;
    addRollback(async () => restoreManifests(backups), ctx);
  }
}

async function applyVersionsForDryRun(ctx: PubmContext): Promise<void> {
  const plan = ctx.runtime.versionPlan;
  if (!plan) return;

  // Backup original versions from config (safe: writeVersions not yet called in dry-run)
  ctx.runtime.dryRunVersionBackup = new Map(
    ctx.config.packages.map((pkg) => [pkg.path, pkg.version ?? "0.0.0"]),
  );

  // Build new versions map from versionPlan
  let newVersions: Map<string, string>;
  if (plan.mode === "single") {
    newVersions = new Map(
      ctx.config.packages.map((pkg) => [pkg.path, plan.version]),
    );
  } else {
    // fixed and independent both use plan.packages
    newVersions = plan.packages;
  }

  await writeVersions(ctx, newVersions);
}

async function collectPublishTasks(ctx: PubmContext) {
  const groups = collectEcosystemRegistryGroups(ctx.config);

  const ecosystemTasks = await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packagePaths }) => {
          const descriptor = registryCatalog.get(registry);

          const paths = descriptor?.orderPackages
            ? await descriptor.orderPackages(packagePaths)
            : packagePaths;

          const label = descriptor
            ? `Running ${descriptor.label} publish`
            : `Running ${registry} publish`;

          return {
            title: label,
            task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
              task.newListr(
                paths.map((p) => createPublishTaskForPath(registry, p)),
                { concurrent: descriptor?.concurrentPublish ?? true },
              ),
          };
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
          task.newListr(registryTasks, { concurrent: true }),
      };
    }),
  );

  return [...ecosystemTasks, ...pluginPublishTasks(ctx)];
}

function pluginPublishTasks(ctx: PubmContext) {
  const pluginRegistries = ctx.runtime.pluginRunner.collectRegistries();
  return pluginRegistries.map((registry) => ({
    title: `Publishing to ${registry.packageName} (plugin)`,
    task: async (): Promise<void> => {
      await registry.publish();
    },
  }));
}

// Registry key → dry-run task mapping
const dryRunTaskMap: Record<
  string,
  (packagePath: string, siblingPaths?: string[]) => ListrTask<PubmContext>
> = {
  npm: (p) => createNpmDryRunPublishTask(p),
  jsr: (p) => createJsrDryRunPublishTask(p),
  crates: (p, siblingPaths) => createCratesDryRunPublishTask(p, siblingPaths),
};

function createDryRunTaskForPath(
  registryKey: string,
  packagePath: string,
  siblingPaths?: string[],
): ListrTask<PubmContext> {
  const factory = dryRunTaskMap[registryKey];
  if (!factory)
    return { title: `Dry-run ${registryKey}`, task: async () => {} };
  return factory(packagePath, siblingPaths);
}

async function collectDryRunPublishTasks(ctx: PubmContext) {
  const groups = collectEcosystemRegistryGroups(ctx.config);

  return await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packagePaths }) => {
          const descriptor = registryCatalog.get(registry);

          const paths = descriptor?.orderPackages
            ? await descriptor.orderPackages(packagePaths)
            : packagePaths;

          // For non-concurrent registries with multiple packages, pass sibling paths
          let siblingPaths: string[] | undefined;
          if (!descriptor?.concurrentPublish && packagePaths.length > 1) {
            siblingPaths = packagePaths;
          }

          const concurrent = descriptor?.concurrentPublish ?? true;
          const label = descriptor
            ? `Dry-run ${descriptor.label} publish${concurrent ? "" : " (sequential)"}`
            : `Dry-run ${registry} publish`;

          return {
            title: label,
            task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
              task.newListr(
                paths.map((p) =>
                  createDryRunTaskForPath(registry, p, siblingPaths),
                ),
                { concurrent },
              ),
          };
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
          task.newListr(registryTasks, { concurrent: true }),
      };
    }),
  );
}

function formatRegistryGroupSummary(
  heading: string,
  ctx: PubmContext,
  includePluginTargets = false,
): string {
  const lines = collectEcosystemRegistryGroups(ctx.config).flatMap((group) =>
    group.registries.map(({ registry, packagePaths }) => {
      const packageSummary =
        packagePaths.length > 1 ? ` (${packagePaths.length} packages)` : "";
      return `- ${ecosystemLabel(group.ecosystem)} > ${registryLabel(registry)}${packageSummary}`;
    }),
  );

  if (includePluginTargets) {
    for (const registry of ctx.runtime.pluginRunner.collectRegistries()) {
      lines.push(`- Plugin registry > ${registry.packageName}`);
    }
  }

  if (lines.length === 0) {
    return heading;
  }

  return `${heading}:\n${lines.join("\n")}`;
}

function countPublishTargets(ctx: PubmContext): number {
  return (
    countRegistryTargets(collectEcosystemRegistryGroups(ctx.config)) +
    ctx.runtime.pluginRunner.collectRegistries().length
  );
}

function formatVersionSummary(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (plan) {
    if (plan.mode === "independent") {
      return [...plan.packages]
        .map(([pkgPath, ver]) => `${getPackageName(ctx, pkgPath)}@${ver}`)
        .join(", ");
    }
    return `v${plan.version}`;
  }
  return "";
}

function formatVersionPlan(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (plan) {
    if (plan.mode === "independent" || plan.mode === "fixed") {
      return `Target versions:\n${[...plan.packages]
        .map(([pkgPath, ver]) => `  ${getPackageName(ctx, pkgPath)}: ${ver}`)
        .join("\n")}`;
    }
    return `Target version: v${plan.version}`;
  }
  return "";
}

function shouldRenderLiveCommandOutput(_ctx: PubmContext): boolean {
  return !isCI && Boolean(process.stdout.isTTY);
}

function normalizeLiveCommandOutputLine(line: string): string {
  const normalized = stripVTControlCharacters(line).trimEnd();
  return normalized.trim() ? normalized : "";
}

function createLiveCommandOutput(
  task: Pick<NewListrParentTask<PubmContext>, "output">,
  command: string,
) {
  const recentLines: string[] = [];
  const pending = {
    stdout: "",
    stderr: "",
  };

  const render = (partialLine?: string): void => {
    const previewLines = partialLine
      ? [...recentLines, partialLine].slice(-LIVE_COMMAND_OUTPUT_LINE_LIMIT)
      : recentLines;

    task.output =
      previewLines.length > 0
        ? [`Executing \`${command}\``, ...previewLines].join("\n")
        : `Executing \`${command}\``;
  };

  const pushLine = (line: string): void => {
    const normalized = normalizeLiveCommandOutputLine(line);
    if (!normalized) {
      return;
    }

    recentLines.push(normalized);
    if (recentLines.length > LIVE_COMMAND_OUTPUT_LINE_LIMIT) {
      recentLines.shift();
    }
  };

  const updateFromChunk = (
    source: keyof typeof pending,
    chunk: string,
  ): void => {
    const segments =
      `${pending[source]}${chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n")}`.split(
        "\n",
      );
    pending[source] = segments.pop() as string;

    for (const segment of segments) {
      pushLine(segment);
    }

    const partialLine = normalizeLiveCommandOutputLine(pending[source]);
    render(partialLine || undefined);
  };

  const finish = (): void => {
    pushLine(pending.stdout);
    pushLine(pending.stderr);
    pending.stdout = "";
    pending.stderr = "";
    render();
  };

  render();

  return {
    onStdout: (chunk: string) => {
      updateFromChunk("stdout", chunk);
    },
    onStderr: (chunk: string) => {
      updateFromChunk("stderr", chunk);
    },
    finish,
  };
}

export async function run(ctx: PubmContext): Promise<void> {
  ctx.runtime.promptEnabled = !isCI && process.stdin.isTTY;

  const mode = ctx.options.mode ?? "local";
  const phases = resolvePhases(ctx.options);
  const dryRun = !!ctx.options.dryRun;
  const hasPrepare = phases.includes("prepare");
  const hasPublish = phases.includes("publish");

  let cleanupEnv: (() => void) | undefined;

  const onSigint = async () => {
    cleanupEnv?.();
    await rollback();
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  try {
    if (ctx.options.contents) process.chdir(ctx.options.contents);

    if (ctx.options.snapshot) {
      // Snapshot pipeline: prerequisites → conditions → test → build → temp publish → tag push
      await prerequisitesCheckTask({
        skip: ctx.options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: ctx.options.skipConditionsCheck,
      }).run(ctx);

      const pipelineListrOptions = isCI
        ? createCiListrOptions<PubmContext>()
        : undefined;

      await createListr<PubmContext>(
        [
          {
            skip: ctx.options.skipTests,
            title: "Running tests",
            task: async (ctx, task): Promise<void> => {
              const packageManager = await getPackageManager();
              const command = `${packageManager} run ${ctx.options.testScript}`;
              task.title = `Running tests (${command})`;
              task.output = `Executing \`${command}\``;
              try {
                await exec(packageManager, ["run", ctx.options.testScript], {
                  throwOnError: true,
                });
              } catch (error) {
                throw new AbstractError(
                  `Test script '${ctx.options.testScript}' failed.`,
                  { cause: error },
                );
              }
            },
          },
          {
            skip: ctx.options.skipBuild,
            title: "Building the project",
            task: async (ctx, task): Promise<void> => {
              const packageManager = await getPackageManager();
              const command = `${packageManager} run ${ctx.options.buildScript}`;
              task.title = `Building the project (${command})`;
              task.output = `Executing \`${command}\``;
              try {
                await exec(packageManager, ["run", ctx.options.buildScript], {
                  throwOnError: true,
                });
              } catch (error) {
                throw new AbstractError(
                  `Build script '${ctx.options.buildScript}' failed.`,
                  { cause: error },
                );
              }
            },
          },
          {
            title: "Publishing snapshot",
            task: async (ctx, task): Promise<void> => {
              const snapshotTag =
                typeof ctx.options.snapshot === "string"
                  ? ctx.options.snapshot
                  : "snapshot";

              // Check for monorepo
              if (ctx.config.packages.length > 1) {
                throw new AbstractError(
                  "Snapshot publishing is only supported for single-package projects.",
                );
              }

              // Read current version from resolved config
              const currentVersion = ctx.config.packages[0].version ?? "0.0.0";

              // Generate snapshot version
              const snapshotVersion = generateSnapshotVersion({
                baseVersion: currentVersion,
                tag: snapshotTag,
                template: ctx.config.snapshotTemplate,
              });

              ctx.runtime.versionPlan = {
                mode: "single",
                version: snapshotVersion,
                packagePath: ctx.config.packages[0].path,
              };
              task.title = `Publishing snapshot (${snapshotVersion})`;
              task.output = `Snapshot version: ${snapshotVersion}`;

              // Temporarily replace manifest version
              const snapshotVersions = new Map([
                [ctx.config.packages[0].path, snapshotVersion],
              ]);
              await writeVersions(ctx, snapshotVersions);

              try {
                // Publish with snapshot tag
                task.output = `Publishing to registries with tag "${snapshotTag}"...`;
                ctx.runtime.tag = snapshotTag;

                const publishTasks = await collectPublishTasks(ctx);
                await createListr<PubmContext>(publishTasks, {
                  concurrent: true,
                }).run(ctx);
              } finally {
                // Restore original version
                task.output = "Restoring original manifest version...";
                const restoreVersions = new Map([
                  [ctx.config.packages[0].path, currentVersion],
                ]);
                await writeVersions(ctx, restoreVersions);
              }

              task.output = `Published ${snapshotVersion}`;
            },
          },
          {
            title: "Creating and pushing snapshot tag",
            skip: () => dryRun,
            task: async (ctx, task): Promise<void> => {
              const git = new Git();
              const snapshotPlan = ctx.runtime.versionPlan!;
              const tagName = `v${snapshotPlan.mode !== "independent" ? snapshotPlan.version : ""}`;
              task.output = `Creating tag ${tagName}...`;

              const headCommit = await git.latestCommit();
              await git.createTag(tagName, headCommit);

              task.output = `Pushing tag ${tagName}...`;
              await git.push("--tags");
              task.output = `Tag ${tagName} pushed.`;
            },
          },
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

      console.log(
        `\n\n📸 Successfully published snapshot ${parts.join(", ")} ${ui.chalk.blueBright(ctx.runtime.versionPlan?.mode !== "independent" ? (ctx.runtime.versionPlan?.version ?? "") : "")} 📸\n`,
      );

      return;
    }

    if (mode === "ci" && hasPrepare) {
      // CI prepare: Collect tokens (interactive)
      await createListr<PubmContext>({
        title: "Collecting registry tokens",
        task: async (ctx, task): Promise<void> => {
          const registries = collectRegistries(ctx.config);
          const tokens = await collectTokens(registries, task);
          await promptGhSecretsSync(tokens, task);

          // Inject tokens and switch to non-interactive mode
          cleanupEnv = injectTokensToEnv(tokens);
          ctx.runtime.promptEnabled = false;
        },
      }).run(ctx);

      await prerequisitesCheckTask({
        skip: ctx.options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: ctx.options.skipConditionsCheck,
      }).run(ctx);
    }

    if (mode === "local" && hasPrepare) {
      await prerequisitesCheckTask({
        skip: ctx.options.skipPrerequisitesCheck,
      }).run(ctx);

      // Collect JSR token early if JSR registry is configured
      const registries = collectRegistries(ctx.config);
      if (registries.includes("jsr") && ctx.runtime.promptEnabled) {
        await createListr<PubmContext>({
          title: "Ensuring JSR authentication",
          task: async (_ctx, task): Promise<void> => {
            const tokens = await collectTokens(["jsr"], task);
            cleanupEnv = injectTokensToEnv(tokens);
            if (tokens.jsr) {
              JsrClient.token = tokens.jsr;
            }
          },
        }).run(ctx);
      }

      await requiredConditionsCheckTask({
        skip: ctx.options.skipConditionsCheck,
      }).run(ctx);
    }

    const pipelineListrOptions = isCI
      ? createCiListrOptions<PubmContext>()
      : undefined;

    await createListr<PubmContext>(
      [
        // === PREPARE PHASE ===
        {
          skip: !hasPrepare || ctx.options.skipTests,
          title: "Running tests",
          task: async (ctx, task): Promise<void> => {
            task.output = "Running plugin beforeTest hooks...";
            await ctx.runtime.pluginRunner.runHook("beforeTest", ctx);
            const packageManager = await getPackageManager();
            const command = `${packageManager} run ${ctx.options.testScript}`;
            task.title = `Running tests (${command})`;
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
                `Test script '${ctx.options.testScript}' failed. Run \`${command}\` locally to see full output.`,
                { cause: error },
              );
            }
            liveOutput?.finish();
            task.output = "Running plugin afterTest hooks...";
            await ctx.runtime.pluginRunner.runHook("afterTest", ctx);
            task.output = `Completed \`${command}\``;
          },
        },
        {
          skip: !hasPrepare || ctx.options.skipBuild,
          title: "Building the project",
          task: async (ctx, task): Promise<void> => {
            task.output = "Running plugin beforeBuild hooks...";
            await ctx.runtime.pluginRunner.runHook("beforeBuild", ctx);
            const packageManager = await getPackageManager();
            const command = `${packageManager} run ${ctx.options.buildScript}`;
            task.title = `Building the project (${command})`;
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
                `Build script '${ctx.options.buildScript}' failed. Run \`${command}\` locally to see full output.`,
                { cause: error },
              );
            }
            liveOutput?.finish();
            task.output = "Running plugin afterBuild hooks...";
            await ctx.runtime.pluginRunner.runHook("afterBuild", ctx);
            task.output = `Completed \`${command}\``;
          },
        },
        {
          title: "Bumping version",
          skip: !hasPrepare,
          task: async (ctx, task): Promise<void> => {
            task.title = `Bumping version (${formatVersionSummary(ctx)})`;
            task.output = "Running plugin beforeVersion hooks...";
            await ctx.runtime.pluginRunner.runHook("beforeVersion", ctx);
            const git = new Git();
            let tagCreated = false;
            let commited = false;

            const plan = ctx.runtime.versionPlan!;

            task.output = formatVersionPlan(ctx);

            addRollback(async () => {
              if (tagCreated) {
                try {
                  rollbackLog("Deleting tag(s)");
                  if (plan.mode === "independent") {
                    for (const [pkgPath, pkgVersion] of plan.packages) {
                      if (isReleaseExcluded(ctx.config, pkgPath)) continue;
                      const pkgName = getPackageName(ctx, pkgPath);
                      try {
                        await git.deleteTag(`${pkgName}@${pkgVersion}`);
                      } catch (tagError) {
                        rollbackError(
                          `Failed to delete tag ${pkgName}@${pkgVersion}: ${tagError instanceof Error ? tagError.message : tagError}`,
                        );
                      }
                    }
                  } else {
                    const tagName = `v${plan.version}`;
                    try {
                      await git.deleteTag(tagName);
                    } catch (e) {
                      rollbackError(
                        `Failed to delete tag: ${e instanceof Error ? e.message : e}`,
                      );
                    }
                  }
                } catch (error) {
                  rollbackError(
                    `Failed to delete tag: ${error instanceof Error ? error.message : error}`,
                  );
                }
              }

              if (commited) {
                try {
                  rollbackLog("Resetting commits");
                  await git.reset();
                  const dirty = (await git.status()) !== "";
                  if (dirty) {
                    await git.stash();
                  }
                  await git.reset("HEAD^", "--hard");
                  if (dirty) {
                    await git.popStash();
                  }
                } catch (error) {
                  rollbackError(
                    `Failed to reset commits: ${error instanceof Error ? error.message : error}`,
                  );
                }
              }
            }, ctx);

            task.output = "Refreshing git index before version updates...";
            await git.reset();

            if (plan.mode === "single") {
              // Single package: write version for all config packages
              task.output = "Updating package manifest versions...";
              const singleVersions = new Map(
                ctx.config.packages.map((pkg) => [pkg.path, plan.version]),
              );
              if (dryRun) {
                return;
              }

              const replaced = await writeVersions(ctx, singleVersions);

              for (const replacedFile of replaced) {
                await git.stage(replacedFile);
              }

              if (ctx.runtime.changesetConsumed) {
                task.output =
                  "Applying changesets and generating changelog entries...";
                const resolver = createKeyResolver(ctx.config.packages);
                const changesets = readChangesets(process.cwd(), resolver);
                if (changesets.length > 0) {
                  const pkgPath = ctx.config.packages[0]?.path ?? "";
                  const entries = buildChangelogEntries(changesets, pkgPath);
                  const changelogContent = generateChangelog(
                    plan.version,
                    entries,
                  );
                  writeChangelogToFile(process.cwd(), changelogContent);
                  deleteChangesetFiles(process.cwd(), changesets);
                }
              }

              task.output = "Running plugin afterVersion hooks...";
              await ctx.runtime.pluginRunner.runHook("afterVersion", ctx);
              task.output = "Staging version updates...";
              await git.stage(".");

              // Tag existence check
              const tagName = `v${plan.version}`;
              if (await git.checkTagExist(tagName)) {
                if (ctx.runtime.promptEnabled) {
                  const deleteTag = await task
                    .prompt(ListrEnquirerPromptAdapter)
                    .run<boolean>({
                      type: "toggle",
                      message: `The Git tag '${tagName}' already exists. Delete it?`,
                      enabled: "Yes",
                      disabled: "No",
                    });
                  if (deleteTag) {
                    await git.deleteTag(tagName);
                  } else {
                    throw new AbstractError(
                      `Git tag '${tagName}' already exists.`,
                    );
                  }
                } else {
                  throw new AbstractError(
                    `Git tag '${tagName}' already exists. Remove it manually or use a different version.`,
                  );
                }
              }

              task.output = `Creating release commit ${tagName}...`;
              const commit = await git.commit(tagName);
              commited = true;
              task.output = "Creating tag...";
              await git.createTag(tagName, commit);
              tagCreated = true;
            } else if (plan.mode === "fixed") {
              // Fixed monorepo: same version for all packages
              task.output = "Updating package versions across the workspace...";

              if (dryRun) {
                return;
              }

              const replaced = await writeVersions(ctx, plan.packages);

              for (const f of replaced) {
                await git.stage(f);
              }

              if (ctx.runtime.changesetConsumed) {
                task.output =
                  "Applying changesets and generating changelog entries...";
                const resolver = createKeyResolver(ctx.config.packages);
                const changesets = readChangesets(process.cwd(), resolver);
                if (changesets.length > 0) {
                  const allEntries = [...plan.packages.keys()].flatMap(
                    (pkgPath) => buildChangelogEntries(changesets, pkgPath),
                  );
                  if (allEntries.length > 0) {
                    const changelogContent = generateChangelog(
                      plan.version,
                      allEntries,
                    );
                    writeChangelogToFile(process.cwd(), changelogContent);
                  }
                  deleteChangesetFiles(process.cwd(), changesets);
                }
              }

              task.output = "Running plugin afterVersion hooks...";
              await ctx.runtime.pluginRunner.runHook("afterVersion", ctx);
              task.output = "Staging version updates...";
              await git.stage(".");

              const tagName = `v${plan.version}`;
              if (await git.checkTagExist(tagName)) {
                if (ctx.runtime.promptEnabled) {
                  const deleteTag = await task
                    .prompt(ListrEnquirerPromptAdapter)
                    .run<boolean>({
                      type: "toggle",
                      message: `The Git tag '${tagName}' already exists. Delete it?`,
                      enabled: "Yes",
                      disabled: "No",
                    });
                  if (deleteTag) {
                    await git.deleteTag(tagName);
                  } else {
                    throw new AbstractError(
                      `Git tag '${tagName}' already exists.`,
                    );
                  }
                } else {
                  throw new AbstractError(
                    `Git tag '${tagName}' already exists. Remove it manually or use a different version.`,
                  );
                }
              }

              task.output = `Creating release commit ${tagName}...`;
              const commit = await git.commit(tagName);
              commited = true;
              task.output = "Creating tag...";
              await git.createTag(tagName, commit);
              tagCreated = true;
            } else {
              // Independent monorepo
              task.output = "Updating package versions across the workspace...";

              if (dryRun) {
                return;
              }

              const replaced = await writeVersions(ctx, plan.packages);

              for (const f of replaced) {
                await git.stage(f);
              }

              if (ctx.runtime.changesetConsumed) {
                task.output =
                  "Applying changesets and generating changelog entries...";
                const resolver = createKeyResolver(ctx.config.packages);
                const changesets = readChangesets(process.cwd(), resolver);
                if (changesets.length > 0) {
                  for (const [pkgPath, pkgVersion] of plan.packages) {
                    const entries = buildChangelogEntries(changesets, pkgPath);
                    if (entries.length > 0) {
                      const pkgConfig = ctx.config.packages.find(
                        (p) => p.path === pkgPath,
                      );
                      const changelogDir = pkgConfig
                        ? path.resolve(process.cwd(), pkgConfig.path)
                        : process.cwd();
                      writeChangelogToFile(
                        changelogDir,
                        generateChangelog(pkgVersion, entries),
                      );
                    }
                  }
                  deleteChangesetFiles(process.cwd(), changesets);
                }
              }

              task.output = "Running plugin afterVersion hooks...";
              await ctx.runtime.pluginRunner.runHook("afterVersion", ctx);
              task.output = "Staging version updates...";
              await git.stage(".");

              // Tag existence checks for all packages
              for (const [pkgPath, pkgVersion] of plan.packages) {
                if (isReleaseExcluded(ctx.config, pkgPath)) continue;
                const pkgName = getPackageName(ctx, pkgPath);
                const tagName = `${pkgName}@${pkgVersion}`;
                if (await git.checkTagExist(tagName)) {
                  if (ctx.runtime.promptEnabled) {
                    const deleteTag = await task
                      .prompt(ListrEnquirerPromptAdapter)
                      .run<boolean>({
                        type: "toggle",
                        message: `The Git tag '${tagName}' already exists. Delete it?`,
                        enabled: "Yes",
                        disabled: "No",
                      });
                    if (deleteTag) {
                      await git.deleteTag(tagName);
                    } else {
                      throw new AbstractError(
                        `Git tag '${tagName}' already exists.`,
                      );
                    }
                  } else {
                    throw new AbstractError(
                      `Git tag '${tagName}' already exists. Remove it manually or use a different version.`,
                    );
                  }
                }
              }

              // Commit with "Version Packages" message
              const commitMsg = `Version Packages\n\n${[...plan.packages]
                .map(
                  ([pkgPath, ver]) =>
                    `- ${getPackageName(ctx, pkgPath)}: ${ver}`,
                )
                .join("\n")}`;
              task.output = "Creating release commit...";
              const commit = await git.commit(commitMsg);
              commited = true;

              // Create per-package tags
              task.output = "Creating tags...";
              for (const [pkgPath, pkgVersion] of plan.packages) {
                if (isReleaseExcluded(ctx.config, pkgPath)) continue;
                const pkgName = getPackageName(ctx, pkgPath);
                await git.createTag(`${pkgName}@${pkgVersion}`, commit);
              }
              tagCreated = true;
            }
          },
        },

        // === PUBLISH PHASE ===
        {
          skip: (ctx) => !hasPublish || !!ctx.options.skipPublish || dryRun,
          title: "Publishing",
          task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
            parentTask.output = "Running plugin beforePublish hooks...";
            await ctx.runtime.pluginRunner.runHook("beforePublish", ctx);
            resolveWorkspaceProtocols(ctx);

            const publishTasks = await collectPublishTasks(ctx);
            parentTask.title = `Publishing (${countPublishTargets(ctx)} targets)`;
            parentTask.output = formatRegistryGroupSummary(
              "Concurrent publish tasks",
              ctx,
              true,
            );

            return parentTask.newListr(publishTasks, {
              concurrent: true,
            });
          },
        },
        {
          skip: (ctx) =>
            !hasPublish ||
            !!ctx.options.skipPublish ||
            dryRun ||
            !ctx.runtime.workspaceBackups?.size,
          title: "Restoring workspace protocols",
          task: (ctx) => {
            restoreManifests(ctx.runtime.workspaceBackups!);
            ctx.runtime.workspaceBackups = undefined;
          },
        },
        {
          skip: (ctx) => !hasPublish || !!ctx.options.skipPublish || dryRun,
          title: "Running post-publish hooks",
          task: async (ctx, task): Promise<void> => {
            task.output = "Running plugin afterPublish hooks...";
            await ctx.runtime.pluginRunner.runHook("afterPublish", ctx);
            task.output = "Completed plugin afterPublish hooks.";
          },
        },

        // === DRY-RUN PUBLISH VALIDATION (for --dry-run OR ci prepare) ===
        {
          skip: !dryRun && !(mode === "ci" && hasPrepare),
          title: "Validating publish (dry-run)",
          task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
            resolveWorkspaceProtocols(ctx);
            await applyVersionsForDryRun(ctx);

            const dryRunTasks = await collectDryRunPublishTasks(ctx);
            parentTask.title = `Validating publish (${countRegistryTargets(
              collectEcosystemRegistryGroups(ctx.config),
            )} targets)`;
            parentTask.output = formatRegistryGroupSummary(
              "Dry-run publish tasks",
              ctx,
            );

            return parentTask.newListr(dryRunTasks, {
              concurrent: true,
            });
          },
        },
        {
          skip: (ctx) =>
            (!dryRun && !(mode === "ci" && hasPrepare)) ||
            !ctx.runtime.workspaceBackups?.size,
          title: "Restoring workspace protocols",
          task: (ctx) => {
            restoreManifests(ctx.runtime.workspaceBackups!);
            ctx.runtime.workspaceBackups = undefined;
          },
        },
        {
          skip: (ctx) => !dryRun || !ctx.runtime.dryRunVersionBackup?.size,
          title: "Restoring original versions (dry-run)",
          task: async (ctx): Promise<void> => {
            await writeVersions(ctx, ctx.runtime.dryRunVersionBackup!);
            ctx.runtime.dryRunVersionBackup = undefined;
          },
        },

        // === PUSH & RELEASE ===
        {
          title: "Pushing tags to GitHub",
          skip: !hasPrepare || dryRun,
          task: async (ctx, task): Promise<void> => {
            task.output = "Running plugin beforePush hooks...";
            await ctx.runtime.pluginRunner.runHook("beforePush", ctx);
            const git = new Git();
            task.output = "Executing `git push --follow-tags`...";

            const result = await git.push("--follow-tags");

            if (!result) {
              task.title +=
                " (Only tags were pushed because the release branch is protected. Please push the branch manually.)";
              task.output =
                "Protected branch detected. Falling back to `git push --tags`.";

              await git.push("--tags");
            }
            task.output = "Running plugin afterPush hooks...";
            await ctx.runtime.pluginRunner.runHook("afterPush", ctx);
            task.output = "Push step completed.";
          },
        },
        {
          skip: (ctx) =>
            !hasPublish || !!ctx.options.skipReleaseDraft || dryRun,
          title: "Creating GitHub Release",
          task: async (ctx, task): Promise<void> => {
            const plan = ctx.runtime.versionPlan!;

            // Resolve GitHub token from env or secure store
            const tokenResult = resolveGitHubToken();
            let hasToken = !!tokenResult;

            if (tokenResult) {
              process.env.GITHUB_TOKEN = tokenResult.token;
            } else if (mode !== "ci") {
              // Local/interactive mode: prompt for token or fall back to browser
              const answer = await task
                .prompt(ListrEnquirerPromptAdapter)
                .run<string>({
                  type: "select",
                  message:
                    "No GitHub token found. How would you like to create the release?",
                  choices: [
                    { name: "enter", message: "Enter a GitHub token" },
                    {
                      name: "browser",
                      message: "Open release draft in browser",
                    },
                    { name: "skip", message: "Skip release creation" },
                  ],
                });

              if (answer === "enter") {
                const token = await task
                  .prompt(ListrEnquirerPromptAdapter)
                  .run<string>({
                    type: "password",
                    message: "GitHub personal access token:",
                  });
                if (token) {
                  process.env.GITHUB_TOKEN = token;
                  saveGitHubToken(token);
                  hasToken = true;
                }
              } else if (answer === "skip") {
                task.skip("Skipped by user.");
                return;
              }
              // "browser" falls through to browser fallback below
            }

            if (hasToken) {
              // Create GitHub Release via API
              task.title = `Creating GitHub Release (${formatVersionSummary(ctx)})`;

              if (plan.mode === "independent") {
                // Per-package releases
                for (const [pkgPath, pkgVersion] of plan.packages) {
                  if (isReleaseExcluded(ctx.config, pkgPath)) continue;
                  const pkgName = getPackageName(ctx, pkgPath);
                  const tag = `${pkgName}@${pkgVersion}`;
                  task.output = `Creating release for ${tag}...`;

                  let changelogBody: string | undefined;
                  const pkgConfig = ctx.config.packages.find(
                    (p) => p.path === pkgPath,
                  );
                  if (pkgConfig) {
                    const changelogPath = join(
                      process.cwd(),
                      pkgConfig.path,
                      "CHANGELOG.md",
                    );
                    if (existsSync(changelogPath)) {
                      const section = parseChangelogSection(
                        readFileSync(changelogPath, "utf-8"),
                        pkgVersion,
                      );
                      if (section) changelogBody = section;
                    }
                  }

                  const { assets: preparedAssets, tempDir } =
                    await prepareReleaseAssets(
                      ctx,
                      pkgName,
                      pkgVersion,
                      pkgPath,
                    );
                  const result = await createGitHubRelease(ctx, {
                    displayLabel: pkgName,
                    version: pkgVersion,
                    tag,
                    changelogBody,
                    assets: preparedAssets,
                    draft: !!ctx.options.releaseDraft,
                  });
                  if (result) {
                    // Additional upload targets (plugin hooks)
                    const assetHooks =
                      ctx.runtime.pluginRunner.collectAssetHooks();
                    if (assetHooks.uploadAssets) {
                      const additional = await assetHooks.uploadAssets(
                        preparedAssets,
                        ctx,
                      );
                      result.assets.push(
                        ...additional.map((a) => ({
                          name: a.name,
                          url: a.url,
                          sha256: a.sha256,
                          platform: a.platform,
                        })),
                      );
                    }
                    task.output = `Release created: ${result.releaseUrl}`;
                    await ctx.runtime.pluginRunner.runAfterReleaseHook(
                      ctx,
                      result,
                    );
                  } else {
                    task.output = `Release already exists for ${tag}, skipped.`;
                  }
                  if (tempDir)
                    rmSync(tempDir, { recursive: true, force: true });
                }
              } else {
                // Single or fixed: one release
                const version = plan.version;
                const tag = `v${version}`;
                task.output = `Creating release for ${tag}...`;

                let changelogBody: string | undefined;
                if (plan.mode === "fixed") {
                  const sections: string[] = [];
                  for (const [pkgPath, pkgVersion] of plan.packages) {
                    const pkgName = getPackageName(ctx, pkgPath);
                    const pkgConfig = ctx.config.packages.find(
                      (p) => p.path === pkgPath,
                    );
                    if (!pkgConfig) continue;
                    const changelogPath = join(
                      process.cwd(),
                      pkgConfig.path,
                      "CHANGELOG.md",
                    );
                    if (existsSync(changelogPath)) {
                      const section = parseChangelogSection(
                        readFileSync(changelogPath, "utf-8"),
                        pkgVersion,
                      );
                      if (section) {
                        sections.push(
                          `## ${pkgName} v${pkgVersion}\n\n${section}`,
                        );
                      }
                    }
                  }
                  if (sections.length > 0) {
                    changelogBody = sections.join("\n\n---\n\n");
                  }
                } else {
                  const changelogPath = join(process.cwd(), "CHANGELOG.md");
                  if (existsSync(changelogPath)) {
                    const section = parseChangelogSection(
                      readFileSync(changelogPath, "utf-8"),
                      version,
                    );
                    if (section) changelogBody = section;
                  }
                }

                const packageName =
                  plan.mode === "single"
                    ? getPackageName(ctx, plan.packagePath)
                    : (ctx.config.packages[0]?.name ?? "");
                const pkgPath =
                  plan.mode === "single"
                    ? plan.packagePath
                    : ctx.config.packages[0]?.path;
                const { assets: preparedAssets, tempDir } =
                  await prepareReleaseAssets(
                    ctx,
                    packageName,
                    version,
                    pkgPath,
                  );
                const result = await createGitHubRelease(ctx, {
                  displayLabel: packageName,
                  version,
                  tag,
                  changelogBody,
                  assets: preparedAssets,
                  draft: !!ctx.options.releaseDraft,
                });
                if (result) {
                  const assetHooks =
                    ctx.runtime.pluginRunner.collectAssetHooks();
                  if (assetHooks.uploadAssets) {
                    const additional = await assetHooks.uploadAssets(
                      preparedAssets,
                      ctx,
                    );
                    result.assets.push(
                      ...additional.map((a) => ({
                        name: a.name,
                        url: a.url,
                        sha256: a.sha256,
                        platform: a.platform,
                      })),
                    );
                  }
                  task.output = `Release created: ${result.releaseUrl}`;
                  await ctx.runtime.pluginRunner.runAfterReleaseHook(
                    ctx,
                    result,
                  );
                } else {
                  task.output = `Release already exists for ${tag}, skipped.`;
                }
                if (tempDir) rmSync(tempDir, { recursive: true, force: true });
              }
            } else {
              // No token available: open release draft URL in the browser
              const git = new Git();
              task.title = `Creating release draft on GitHub (${formatVersionSummary(ctx)})`;
              task.output =
                "Resolving repository metadata for the release draft...";

              const repositoryUrl = await git.repository();

              if (plan.mode === "independent") {
                let first = true;
                for (const [pkgPath, pkgVersion] of plan.packages) {
                  if (isReleaseExcluded(ctx.config, pkgPath)) continue;
                  const pkgName = getPackageName(ctx, pkgPath);
                  const tag = `${pkgName}@${pkgVersion}`;
                  const lastRev =
                    (await git.previousTag(tag)) || (await git.firstCommit());
                  const commits = (await git.commits(lastRev, tag)).slice(1);

                  let body = commits
                    .map(
                      ({ id, message }) =>
                        `- ${message.replace("#", `${repositoryUrl}/issues/`)} ${repositoryUrl}/commit/${id}`,
                    )
                    .join("\n");
                  body += `\n\n${repositoryUrl}/compare/${lastRev}...${tag}`;

                  const releaseDraftUrl = new URL(
                    `${repositoryUrl}/releases/new`,
                  );
                  releaseDraftUrl.searchParams.set("tag", tag);
                  releaseDraftUrl.searchParams.set("body", body);
                  releaseDraftUrl.searchParams.set(
                    "prerelease",
                    `${!!prerelease(pkgVersion)}`,
                  );

                  const linkUrl = ui.link(tag, releaseDraftUrl.toString());
                  task.title += ` ${linkUrl}`;

                  if (first) {
                    task.output = `Opening release draft for ${tag}...`;
                    await openUrl(releaseDraftUrl.toString());
                    first = false;
                  }
                }
              } else {
                const version = plan.version;
                const tag = `v${version}`;
                const lastRev =
                  (await git.previousTag(tag)) || (await git.firstCommit());
                const commits = (await git.commits(lastRev, tag)).slice(1);
                task.output = `Collected ${commits.length} commits for ${tag}.`;

                let body = commits
                  .map(
                    ({ id, message }) =>
                      `- ${message.replace("#", `${repositoryUrl}/issues/`)} ${repositoryUrl}/commit/${id}`,
                  )
                  .join("\n");
                body += `\n\n${repositoryUrl}/compare/${lastRev}...${tag}`;

                const releaseDraftUrl = new URL(
                  `${repositoryUrl}/releases/new`,
                );
                releaseDraftUrl.searchParams.set("tag", tag);
                releaseDraftUrl.searchParams.set("body", body);
                releaseDraftUrl.searchParams.set(
                  "prerelease",
                  `${!!prerelease(version)}`,
                );

                const linkUrl = ui.link("Link", releaseDraftUrl.toString());
                task.title += ` ${linkUrl}`;
                task.output = `Opening release draft for ${tag}...`;
                await openUrl(releaseDraftUrl.toString());
              }
            }
          },
        },
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
      cleanupEnv?.();
      console.log(
        `\n\n✅ CI prepare completed. Release tags pushed — CI should pick up the publish.\n`,
      );
    } else if (dryRun) {
      console.log(`\n\n✅ Dry-run completed. No side effects were applied.\n`);
    } else {
      console.log(
        `\n\n🚀 Successfully published ${parts.join(", ")} ${ui.chalk.blueBright(formatVersionSummary(ctx))} 🚀\n`,
      );
    }

    await ctx.runtime.pluginRunner.runHook("onSuccess", ctx);
  } catch (e: unknown) {
    process.removeListener("SIGINT", onSigint);
    cleanupEnv?.();

    await ctx.runtime.pluginRunner.runErrorHook(ctx, e as Error);

    consoleError(e as Error);
    await rollback();

    await ctx.runtime.pluginRunner.runHook("onRollback", ctx);

    process.exit(1);
  }
}
