import { existsSync, readFileSync } from "node:fs";
import path, { join } from "node:path";
import process from "node:process";
import { stripVTControlCharacters } from "node:util";
import {
  color,
  type Listr,
  type ListrRenderer,
  type ListrTask,
  type ListrTaskWrapper,
} from "listr2";
import SemVer from "semver";
import { isCI } from "std-env";
import {
  buildChangelogEntries,
  generateChangelog,
  writeChangelogToFile,
} from "../changeset/changelog.js";
import { parseChangelogSection } from "../changeset/changelog-parser.js";
import { discoverPackageInfos } from "../changeset/packages.js";
import { deleteChangesetFiles, readChangesets } from "../changeset/reader.js";
import { AbstractError, consoleError } from "../error.js";
import { Git } from "../git.js";
import { PluginRunner } from "../plugin/runner.js";
import { registryCatalog } from "../registry/catalog.js";
import type { ResolvedOptions } from "../types/options.js";
import { link } from "../utils/cli.js";
import { exec } from "../utils/exec.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { openUrl } from "../utils/open-url.js";
import {
  getPackageJson,
  replaceVersion,
  replaceVersionAtPath,
} from "../utils/package.js";
import { getPackageManager } from "../utils/package-manager.js";
import { collectRegistries } from "../utils/registries.js";
import {
  addRollback,
  rollback,
  rollbackError,
  rollbackLog,
} from "../utils/rollback.js";
import { generateSnapshotVersion } from "../utils/snapshot.js";
import { loadConfig } from "../config/loader.js";
import { injectTokensToEnv } from "../utils/token.js";
import { createCratesPublishTask } from "./crates.js";
import {
  createCratesDryRunPublishTask,
  jsrDryRunPublishTask,
  npmDryRunPublishTask,
} from "./dry-run-publish.js";
import { createGitHubRelease, type ReleaseContext } from "./github-release.js";
import {
  collectEcosystemRegistryGroups,
  countRegistryTargets,
  ecosystemLabel,
  registryLabel,
} from "./grouping.js";
import { jsrPublishTasks } from "./jsr.js";
import { npmPublishTasks } from "./npm.js";
import { collectTokens, promptGhSecretsSync } from "./preflight.js";
import { prerequisitesCheckTask } from "./prerequisites-check.js";
import { requiredConditionsCheckTask } from "./required-conditions-check.js";

const { prerelease } = SemVer;
const LIVE_COMMAND_OUTPUT_LINE_LIMIT = 4;

export interface Ctx extends ResolvedOptions {
  promptEnabled: boolean;
  cleanWorkingTree: boolean;
  pluginRunner: PluginRunner;
  releaseContext?: ReleaseContext;
}

type NewListrParentTask<Context extends {}> = ListrTaskWrapper<
  Context,
  typeof ListrRenderer,
  typeof ListrRenderer
>;

// Registry key → publish task mapping (kept in runner for listr2 orchestration)
const publishTaskMap: Record<string, (packagePath?: string) => ListrTask<Ctx>> =
  {
    npm: () => npmPublishTasks,
    jsr: () => jsrPublishTasks,
    crates: (packagePath) => createCratesPublishTask(packagePath),
  };

function createPublishTaskForPath(
  registryKey: string,
  packagePath: string,
): ListrTask<Ctx> {
  const factory = publishTaskMap[registryKey];
  if (!factory)
    return { title: `Publish to ${registryKey}`, task: async () => {} };
  return factory(packagePath);
}

async function collectPublishTasks(ctx: Ctx) {
  const groups = collectEcosystemRegistryGroups(ctx);

  const ecosystemTasks = await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packagePaths }) => {
          const descriptor = registryCatalog.get(registry);
          if (!descriptor)
            return createPublishTaskForPath(registry, packagePaths[0]);

          const reg = await descriptor.factory();

          // For concurrent registries, return the raw task directly
          // (the task itself handles publishing; no per-package dispatch needed)
          if (reg.concurrentPublish) {
            return createPublishTaskForPath(registry, packagePaths[0]);
          }

          const paths = await reg.orderPackages(packagePaths);

          return {
            title: `Publishing to ${descriptor.label} (sequential)`,
            task: (_ctx: Ctx, task: NewListrParentTask<Ctx>) =>
              task.newListr(
                paths.map((p) => createPublishTaskForPath(registry, p)),
                { concurrent: false },
              ),
          };
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        task: (_ctx: Ctx, task: NewListrParentTask<Ctx>) =>
          task.newListr(registryTasks, { concurrent: true }),
      };
    }),
  );

  return [...ecosystemTasks, ...pluginPublishTasks(ctx)];
}

function pluginPublishTasks(ctx: Ctx) {
  const pluginRegistries = ctx.pluginRunner.collectRegistries();
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
  (packagePath?: string, siblingNames?: string[]) => ListrTask<Ctx>
> = {
  npm: () => npmDryRunPublishTask,
  jsr: () => jsrDryRunPublishTask,
  crates: (packagePath, siblingNames) =>
    createCratesDryRunPublishTask(packagePath, siblingNames),
};

function createDryRunTaskForPath(
  registryKey: string,
  packagePath: string,
  siblingNames?: string[],
): ListrTask<Ctx> {
  const factory = dryRunTaskMap[registryKey];
  if (!factory)
    return { title: `Dry-run ${registryKey}`, task: async () => {} };
  return factory(packagePath, siblingNames);
}

async function collectDryRunPublishTasks(ctx: Ctx) {
  const groups = collectEcosystemRegistryGroups(ctx);

  return await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packagePaths }) => {
          const descriptor = registryCatalog.get(registry);
          if (!descriptor)
            return createDryRunTaskForPath(registry, packagePaths[0]);

          const reg = await descriptor.factory();

          // For concurrent registries, return the raw task directly
          if (reg.concurrentPublish) {
            return createDryRunTaskForPath(registry, packagePaths[0]);
          }

          const paths = await reg.orderPackages(packagePaths);

          // For non-concurrent registries with multiple packages, gather sibling names
          let siblingNames: string[] | undefined;
          if (packagePaths.length > 1) {
            const eco = await import("../ecosystem/index.js");
            const ecosystem = await eco.detectEcosystem(packagePaths[0]);
            if (ecosystem) {
              siblingNames = await Promise.all(
                packagePaths.map(async (p) => {
                  const e = await eco.detectEcosystem(p);
                  return e ? await e.packageName() : p;
                }),
              );
            }
          }

          return {
            title: `Dry-run ${descriptor.label} publish (sequential)`,
            task: (_ctx: Ctx, task: NewListrParentTask<Ctx>) =>
              task.newListr(
                paths.map((p) =>
                  createDryRunTaskForPath(registry, p, siblingNames),
                ),
                { concurrent: false },
              ),
          };
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        task: (_ctx: Ctx, task: NewListrParentTask<Ctx>) =>
          task.newListr(registryTasks, { concurrent: true }),
      };
    }),
  );
}

function formatRegistryGroupSummary(
  heading: string,
  ctx: Pick<Ctx, "packages" | "pluginRunner">,
  includePluginTargets = false,
): string {
  const lines = collectEcosystemRegistryGroups(ctx).flatMap((group) =>
    group.registries.map(({ registry, packagePaths }) => {
      const packageSummary =
        packagePaths.length > 1 ? ` (${packagePaths.length} packages)` : "";
      return `- ${ecosystemLabel(group.ecosystem)} > ${registryLabel(registry)}${packageSummary}`;
    }),
  );

  if (includePluginTargets) {
    for (const registry of ctx.pluginRunner.collectRegistries()) {
      lines.push(`- Plugin registry > ${registry.packageName}`);
    }
  }

  if (lines.length === 0) {
    return heading;
  }

  return `${heading}:\n${lines.join("\n")}`;
}

function countPublishTargets(
  ctx: Pick<Ctx, "packages" | "pluginRunner">,
): number {
  return (
    countRegistryTargets(collectEcosystemRegistryGroups(ctx)) +
    ctx.pluginRunner.collectRegistries().length
  );
}

function formatVersionSummary(ctx: Pick<Ctx, "version" | "versions">): string {
  if (ctx.versions && ctx.versions.size > 1) {
    return [...ctx.versions].map(([name, ver]) => `${name}@${ver}`).join(", ");
  }

  return `v${ctx.version}`;
}

function formatVersionPlan(ctx: Pick<Ctx, "version" | "versions">): string {
  if (ctx.versions && ctx.versions.size > 0) {
    return `Target versions:\n${[...ctx.versions]
      .map(([name, version]) => `- ${name}@${version}`)
      .join("\n")}`;
  }

  return `Target version: v${ctx.version}`;
}

function shouldRenderLiveCommandOutput(ctx: Pick<Ctx, "ci">): boolean {
  return !ctx.ci && !isCI && Boolean(process.stdout.isTTY);
}

function normalizeLiveCommandOutputLine(line: string): string {
  const normalized = stripVTControlCharacters(line).trimEnd();
  return normalized.trim() ? normalized : "";
}

function createLiveCommandOutput(
  task: Pick<NewListrParentTask<Ctx>, "output">,
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

export async function run(options: ResolvedOptions): Promise<void> {
  const ctx = <Ctx>{
    ...options,
    promptEnabled: !isCI && process.stdin.isTTY,
    pluginRunner: options.pluginRunner ?? new PluginRunner([]),
  };

  let cleanupEnv: (() => void) | undefined;

  const onSigint = async () => {
    cleanupEnv?.();
    await rollback();
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  try {
    if (options.contents) process.chdir(options.contents);

    if (options.snapshot) {
      // Snapshot pipeline: prerequisites → conditions → test → build → temp publish → tag push
      await prerequisitesCheckTask({
        skip: options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: options.skipConditionsCheck,
      }).run(ctx);

      const pipelineListrOptions =
        options.ci || isCI ? createCiListrOptions<Ctx>() : undefined;

      await createListr<Ctx>(
        [
          {
            skip: options.skipTests,
            title: "Running tests",
            task: async (ctx, task): Promise<void> => {
              const packageManager = await getPackageManager();
              const command = `${packageManager} run ${ctx.testScript}`;
              task.title = `Running tests (${command})`;
              task.output = `Executing \`${command}\``;
              try {
                await exec(packageManager, ["run", ctx.testScript], {
                  throwOnError: true,
                });
              } catch (error) {
                throw new AbstractError(
                  `Test script '${ctx.testScript}' failed.`,
                  { cause: error },
                );
              }
            },
          },
          {
            skip: options.skipBuild,
            title: "Building the project",
            task: async (ctx, task): Promise<void> => {
              const packageManager = await getPackageManager();
              const command = `${packageManager} run ${ctx.buildScript}`;
              task.title = `Building the project (${command})`;
              task.output = `Executing \`${command}\``;
              try {
                await exec(packageManager, ["run", ctx.buildScript], {
                  throwOnError: true,
                });
              } catch (error) {
                throw new AbstractError(
                  `Build script '${ctx.buildScript}' failed.`,
                  { cause: error },
                );
              }
            },
          },
          {
            title: "Publishing snapshot",
            task: async (ctx, task): Promise<void> => {
              const snapshotTag =
                typeof options.snapshot === "string"
                  ? options.snapshot
                  : "snapshot";

              // Check for monorepo
              const packageInfos = await discoverPackageInfos(process.cwd());
              if (packageInfos.length > 1) {
                throw new AbstractError(
                  "Snapshot publishing is only supported for single-package projects.",
                );
              }

              // Read current version from manifest
              const pkgJson = await getPackageJson();
              const currentVersion = pkgJson.version ?? "0.0.0";

              // Generate snapshot version
              const config = await loadConfig(process.cwd());
              const snapshotVersion = generateSnapshotVersion({
                baseVersion: currentVersion,
                tag: snapshotTag,
                template: config?.snapshotTemplate,
              });

              ctx.version = snapshotVersion;
              task.title = `Publishing snapshot (${snapshotVersion})`;
              task.output = `Snapshot version: ${snapshotVersion}`;

              // Temporarily replace manifest version
              await replaceVersion(
                snapshotVersion,
                ctx.packages,
              );

              try {
                // Publish with snapshot tag
                task.output = `Publishing to registries with tag "${snapshotTag}"...`;
                ctx.tag = snapshotTag;

                const publishTasks = await collectPublishTasks(ctx);
                await createListr<Ctx>(publishTasks, {
                  concurrent: true,
                }).run(ctx);
              } finally {
                // Restore original version
                task.output = "Restoring original manifest version...";
                await replaceVersion(currentVersion, ctx.packages);
              }

              task.output = `Published ${snapshotVersion}`;
            },
          },
          {
            title: "Creating and pushing snapshot tag",
            skip: (ctx) => !!ctx.preview,
            task: async (ctx, task): Promise<void> => {
              const git = new Git();
              const tagName = `v${ctx.version}`;
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

      const registries = collectRegistries(ctx);
      const parts: string[] = [];
      for (const registryKey of registries) {
        const descriptor = registryCatalog.get(registryKey);
        if (!descriptor?.resolveDisplayName) continue;
        const names = await descriptor.resolveDisplayName(ctx);
        for (const name of names) {
          parts.push(`${color.bold(name)} on ${descriptor.label}`);
        }
      }

      console.log(
        `\n\n📸 Successfully published snapshot ${parts.join(", ")} ${color.blueBright(ctx.version)} 📸\n`,
      );

      return;
    }

    if (options.preflight) {
      // Phase 1: Collect tokens (interactive)
      await createListr<Ctx>({
        title: "Collecting registry tokens",
        task: async (ctx, task): Promise<void> => {
          const registries = collectRegistries(ctx);
          const tokens = await collectTokens(registries, task);
          await promptGhSecretsSync(tokens, task);

          // Phase 2: Inject tokens and switch to non-interactive mode
          cleanupEnv = injectTokensToEnv(tokens);
          ctx.promptEnabled = false;
        },
      }).run(ctx);

      await prerequisitesCheckTask({
        skip: options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: options.skipConditionsCheck,
      }).run(ctx);
    }

    if (!options.publishOnly && !options.ci && !options.preflight) {
      await prerequisitesCheckTask({
        skip: options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: options.skipConditionsCheck,
      }).run(ctx);
    }

    const pipelineListrOptions =
      options.ci || isCI ? createCiListrOptions<Ctx>() : undefined;

    await createListr<Ctx>(
      options.ci
        ? [
            {
              title: "Publishing",
              task: async (ctx, parentTask): Promise<Listr<Ctx>> => {
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
              title: "Creating GitHub Release",
              task: async (ctx, task): Promise<void> => {
                task.title = `Creating GitHub Release (${formatVersionSummary(ctx)})`;
                let changelogBody: string | undefined;

                if (ctx.versions && ctx.versions.size > 1) {
                  task.output =
                    "Collecting release notes from per-package CHANGELOG.md files...";
                  // Multi-package: combine changelogs from per-package CHANGELOG.md files
                  const { discoverPackageInfos: discoverPkgInfos } =
                    await import("../changeset/packages.js");
                  const packageInfos = await discoverPkgInfos(process.cwd());
                  const sections: string[] = [];

                  for (const [pkgName, pkgVersion] of ctx.versions) {
                    const pkgInfo = packageInfos.find(
                      (p) => p.name === pkgName,
                    );
                    if (!pkgInfo) continue;
                    const pkgChangelogPath = join(
                      process.cwd(),
                      pkgInfo.path,
                      "CHANGELOG.md",
                    );
                    if (existsSync(pkgChangelogPath)) {
                      const content = readFileSync(pkgChangelogPath, "utf-8");
                      const section = parseChangelogSection(
                        content,
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
                  task.output = "Reading CHANGELOG.md for release notes...";
                  // Single package: existing behavior
                  const changelogPath = join(process.cwd(), "CHANGELOG.md");
                  if (existsSync(changelogPath)) {
                    const changelogContent = readFileSync(
                      changelogPath,
                      "utf-8",
                    );
                    const section = parseChangelogSection(
                      changelogContent,
                      ctx.version,
                    );
                    if (section) {
                      changelogBody = section;
                    }
                  }
                }

                const result = await createGitHubRelease(ctx, changelogBody);
                task.output = `GitHub Release created: ${result.releaseUrl}`;
                ctx.releaseContext = result;
              },
            },
            {
              title: "Running after-release hooks",
              skip: (ctx) => !ctx.releaseContext,
              task: async (ctx, task): Promise<void> => {
                if (ctx.releaseContext) {
                  task.output = `Running after-release hooks for ${ctx.releaseContext.tag}...`;
                  await ctx.pluginRunner.runAfterReleaseHook(
                    ctx,
                    ctx.releaseContext,
                  );
                }
              },
            },
          ]
        : options.publishOnly
          ? {
              title: "Publishing",
              task: async (ctx, parentTask): Promise<Listr<Ctx>> => {
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
            }
          : [
              {
                skip: options.skipTests,
                title: "Running tests",
                task: async (ctx, task): Promise<void> => {
                  task.output = "Running plugin beforeTest hooks...";
                  await ctx.pluginRunner.runHook("beforeTest", ctx);
                  const packageManager = await getPackageManager();
                  const command = `${packageManager} run ${ctx.testScript}`;
                  task.title = `Running tests (${command})`;
                  const liveOutput = shouldRenderLiveCommandOutput(ctx)
                    ? createLiveCommandOutput(task, command)
                    : undefined;
                  task.output = `Executing \`${command}\``;

                  try {
                    await exec(packageManager, ["run", ctx.testScript], {
                      onStdout: liveOutput?.onStdout,
                      onStderr: liveOutput?.onStderr,
                      throwOnError: true,
                    });
                  } catch (error) {
                    liveOutput?.finish();
                    throw new AbstractError(
                      `Test script '${ctx.testScript}' failed. Run \`${command}\` locally to see full output.`,
                      { cause: error },
                    );
                  }
                  liveOutput?.finish();
                  task.output = "Running plugin afterTest hooks...";
                  await ctx.pluginRunner.runHook("afterTest", ctx);
                  task.output = `Completed \`${command}\``;
                },
              },
              {
                skip: options.skipBuild,
                title: "Building the project",
                task: async (ctx, task): Promise<void> => {
                  task.output = "Running plugin beforeBuild hooks...";
                  await ctx.pluginRunner.runHook("beforeBuild", ctx);
                  const packageManager = await getPackageManager();
                  const command = `${packageManager} run ${ctx.buildScript}`;
                  task.title = `Building the project (${command})`;
                  const liveOutput = shouldRenderLiveCommandOutput(ctx)
                    ? createLiveCommandOutput(task, command)
                    : undefined;
                  task.output = `Executing \`${command}\``;

                  try {
                    await exec(packageManager, ["run", ctx.buildScript], {
                      onStdout: liveOutput?.onStdout,
                      onStderr: liveOutput?.onStderr,
                      throwOnError: true,
                    });
                  } catch (error) {
                    liveOutput?.finish();
                    throw new AbstractError(
                      `Build script '${ctx.buildScript}' failed. Run \`${command}\` locally to see full output.`,
                      { cause: error },
                    );
                  }
                  liveOutput?.finish();
                  task.output = "Running plugin afterBuild hooks...";
                  await ctx.pluginRunner.runHook("afterBuild", ctx);
                  task.output = `Completed \`${command}\``;
                },
              },
              {
                title: "Bumping version",
                skip: (ctx) => !!ctx.preview,
                task: async (ctx, task): Promise<void> => {
                  task.title = `Bumping version (${formatVersionSummary(ctx)})`;
                  task.output = "Running plugin beforeVersion hooks...";
                  await ctx.pluginRunner.runHook("beforeVersion", ctx);
                  const git = new Git();
                  let tagCreated = false;
                  let commited = false;

                  const versions = ctx.versions;
                  const hasMultiPackageVersions =
                    versions !== undefined && versions.size > 0;
                  const isIndependent =
                    hasMultiPackageVersions &&
                    new Set(versions.values()).size > 1;

                  task.output = formatVersionPlan(ctx);

                  addRollback(async () => {
                    if (tagCreated) {
                      try {
                        rollbackLog("Deleting tag(s)");
                        if (isIndependent && versions) {
                          for (const [pkgName, pkgVersion] of versions) {
                            try {
                              await git.deleteTag(`${pkgName}@${pkgVersion}`);
                            } catch (tagError) {
                              rollbackError(
                                `Failed to delete tag ${pkgName}@${pkgVersion}: ${tagError instanceof Error ? tagError.message : tagError}`,
                              );
                            }
                          }
                        } else {
                          await git.deleteTag(`${await git.latestTag()}`);
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

                  task.output =
                    "Refreshing git index before version updates...";
                  await git.reset();

                  if (hasMultiPackageVersions) {
                    task.output =
                      "Updating package versions across the workspace...";
                    // Multi-package version replacement (fixed and independent)
                    const packageInfos = await discoverPackageInfos(
                      process.cwd(),
                    );

                    for (const [pkgName, pkgVersion] of versions) {
                      const pkgInfo = packageInfos.find(
                        (p) => p.name === pkgName,
                      );
                      if (!pkgInfo) continue;
                      const pkgPath = path.resolve(process.cwd(), pkgInfo.path);
                      const replaced = await replaceVersionAtPath(
                        pkgVersion,
                        pkgPath,
                      );
                      for (const f of replaced) {
                        await git.stage(f);
                      }
                    }

                    // Changeset consumption
                    if (ctx.changesetConsumed) {
                      task.output =
                        "Applying changesets and generating changelog entries...";
                      const changesets = readChangesets(process.cwd());
                      if (changesets.length > 0) {
                        if (isIndependent) {
                          // Independent: per-package changelogs
                          for (const [pkgName, pkgVersion] of versions) {
                            const entries = buildChangelogEntries(
                              changesets,
                              pkgName,
                            );
                            if (entries.length > 0) {
                              const pkgInfo = packageInfos.find(
                                (p) => p.name === pkgName,
                              );
                              const changelogDir = pkgInfo
                                ? path.resolve(process.cwd(), pkgInfo.path)
                                : process.cwd();
                              const changelogContent = generateChangelog(
                                pkgVersion,
                                entries,
                              );
                              writeChangelogToFile(
                                changelogDir,
                                changelogContent,
                              );
                            }
                          }
                        } else {
                          // Fixed monorepo: single changelog at root
                          const allEntries = [...versions.keys()].flatMap(
                            (pkgName) =>
                              buildChangelogEntries(changesets, pkgName),
                          );
                          if (allEntries.length > 0) {
                            const changelogContent = generateChangelog(
                              ctx.version,
                              allEntries,
                            );
                            writeChangelogToFile(
                              process.cwd(),
                              changelogContent,
                            );
                          }
                        }
                        deleteChangesetFiles(process.cwd(), changesets);
                      }
                    }

                    task.output = "Running plugin afterVersion hooks...";
                    await ctx.pluginRunner.runHook("afterVersion", ctx);
                    task.output = "Staging version updates...";
                    await git.stage(".");

                    if (isIndependent) {
                      // Independent: per-package commit message and tags
                      const commitMsg = [...versions]
                        .map(([name, ver]) => `${name}@${ver}`)
                        .join(", ");
                      task.output = `Creating release commit ${commitMsg}...`;
                      const commit = await git.commit(commitMsg);
                      commited = true;

                      task.output = "Creating tags...";
                      for (const [pkgName, pkgVersion] of versions) {
                        await git.createTag(`${pkgName}@${pkgVersion}`, commit);
                      }
                      tagCreated = true;
                    } else {
                      // Fixed monorepo: single version commit and tag
                      const nextVersion = `v${ctx.version}`;
                      task.output = `Creating release commit ${nextVersion}...`;
                      const commit = await git.commit(nextVersion);
                      commited = true;

                      task.output = "Creating tag...";
                      await git.createTag(nextVersion, commit);
                      tagCreated = true;
                    }
                  } else {
                    task.output = "Updating package manifest versions...";
                    // Single package: existing behavior
                    const replaced = await replaceVersion(
                      ctx.version,
                      ctx.packages,
                    );

                    for (const replacedFile of replaced) {
                      await git.stage(replacedFile);
                    }

                    if (ctx.changesetConsumed) {
                      task.output =
                        "Applying changesets and generating changelog entries...";
                      const changesets = readChangesets(process.cwd());
                      if (changesets.length > 0) {
                        const pkgJson = await getPackageJson();
                        const pkgName = pkgJson.name ?? "";
                        const entries = buildChangelogEntries(
                          changesets,
                          pkgName,
                        );
                        const changelogContent = generateChangelog(
                          ctx.version,
                          entries,
                        );
                        writeChangelogToFile(process.cwd(), changelogContent);
                        deleteChangesetFiles(process.cwd(), changesets);
                      }
                    }

                    task.output = "Running plugin afterVersion hooks...";
                    await ctx.pluginRunner.runHook("afterVersion", ctx);
                    task.output = "Staging version updates...";
                    await git.stage(".");

                    const nextVersion = `v${ctx.version}`;
                    task.output = `Creating release commit ${nextVersion}...`;
                    const commit = await git.commit(nextVersion);
                    commited = true;

                    task.output = "Creating tag...";
                    await git.createTag(nextVersion, commit);
                    tagCreated = true;
                  }
                },
              },
              {
                skip: (ctx) =>
                  !!options.skipPublish || !!ctx.preview || !!options.preflight,
                title: "Publishing",
                task: async (ctx, parentTask): Promise<Listr<Ctx>> => {
                  parentTask.output = "Running plugin beforePublish hooks...";
                  await ctx.pluginRunner.runHook("beforePublish", ctx);
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
                  !!options.skipPublish || !!ctx.preview || !!options.preflight,
                title: "Running post-publish hooks",
                task: async (ctx, task): Promise<void> => {
                  task.output = "Running plugin afterPublish hooks...";
                  await ctx.pluginRunner.runHook("afterPublish", ctx);
                  task.output = "Completed plugin afterPublish hooks.";
                },
              },
              {
                skip: !options.preflight,
                title: "Validating publish (dry-run)",
                task: async (ctx, parentTask): Promise<Listr<Ctx>> => {
                  const dryRunTasks = await collectDryRunPublishTasks(ctx);
                  parentTask.title = `Validating publish (${countRegistryTargets(
                    collectEcosystemRegistryGroups(ctx),
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
                title: "Pushing tags to GitHub",
                skip: (ctx) => !!ctx.preview,
                task: async (ctx, task): Promise<void> => {
                  task.output = "Running plugin beforePush hooks...";
                  await ctx.pluginRunner.runHook("beforePush", ctx);
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
                  await ctx.pluginRunner.runHook("afterPush", ctx);
                  task.output = "Push step completed.";
                },
              },
              {
                skip: (ctx) =>
                  !!options.skipReleaseDraft ||
                  !!ctx.preview ||
                  !!options.preflight,
                title: "Creating release draft on GitHub",
                task: async (ctx, task): Promise<void> => {
                  const git = new Git();
                  task.title = `Creating release draft on GitHub (${formatVersionSummary(ctx)})`;
                  task.output =
                    "Resolving repository metadata for the release draft...";

                  const repositoryUrl = await git.repository();

                  const latestTag = `${await git.latestTag()}`;

                  const lastRev =
                    (await git.previousTag(latestTag)) ||
                    (await git.firstCommit());

                  const commits = (
                    await git.commits(lastRev, `${latestTag}`)
                  ).slice(1);
                  task.output = `Collected ${commits.length} commits for ${latestTag}.`;

                  let body = commits
                    .map(
                      ({ id, message }) =>
                        `- ${message.replace("#", `${repositoryUrl}/issues/`)} ${repositoryUrl}/commit/${id}`,
                    )
                    .join("\n");

                  body += `\n\n${repositoryUrl}/compare/${lastRev}...${latestTag}`;

                  const releaseDraftUrl = new URL(
                    `${repositoryUrl}/releases/new`,
                  );

                  releaseDraftUrl.searchParams.set("tag", `${latestTag}`);
                  releaseDraftUrl.searchParams.set("body", body);
                  releaseDraftUrl.searchParams.set(
                    "prerelease",
                    `${!!prerelease(ctx.version)}`,
                  );

                  const linkUrl = link("Link", releaseDraftUrl.toString());

                  task.title += ` ${linkUrl}`;
                  task.output = `Opening release draft for ${latestTag}...`;

                  await openUrl(releaseDraftUrl.toString());
                },
              },
            ],
      pipelineListrOptions,
    ).run(ctx);

    const registries = collectRegistries(ctx);
    const parts: string[] = [];

    for (const registryKey of registries) {
      const descriptor = registryCatalog.get(registryKey);
      if (!descriptor?.resolveDisplayName) continue;
      const names = await descriptor.resolveDisplayName(ctx);
      for (const name of names) {
        parts.push(`${color.bold(name)} on ${descriptor.label}`);
      }
    }

    process.removeListener("SIGINT", onSigint);

    if (options.preflight) {
      cleanupEnv?.();
      console.log(
        `\n\n✅ Preflight check passed. CI publish should succeed for ${parts.join(", ")}.\n`,
      );
    } else {
      console.log(
        `\n\n🚀 Successfully published ${parts.join(", ")} ${color.blueBright(formatVersionSummary(ctx))} 🚀\n`,
      );
    }

    await ctx.pluginRunner.runHook("onSuccess", ctx);
  } catch (e: unknown) {
    process.removeListener("SIGINT", onSigint);
    cleanupEnv?.();

    await ctx.pluginRunner.runErrorHook(ctx, e as Error);

    consoleError(e as Error);
    await rollback();

    await ctx.pluginRunner.runHook("onRollback", ctx);

    process.exit(1);
  }
}
