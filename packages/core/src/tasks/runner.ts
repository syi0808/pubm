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
import { deleteChangesetFiles, readChangesets } from "../changeset/reader.js";
import type { PubmContext } from "../context.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { AbstractError, consoleError } from "../error.js";
import { Git } from "../git.js";
import { writeVersionsForEcosystem } from "../manifest/write-versions.js";
import { registryCatalog } from "../registry/catalog.js";
import { link } from "../utils/cli.js";
import { exec } from "../utils/exec.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { openUrl } from "../utils/open-url.js";
import { getPackageManager } from "../utils/package-manager.js";
import { collectRegistries } from "../utils/registries.js";
import {
  addRollback,
  rollback,
  rollbackError,
  rollbackLog,
} from "../utils/rollback.js";
import { generateSnapshotVersion } from "../utils/snapshot.js";
import { injectTokensToEnv } from "../utils/token.js";
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
  (packagePath: string, siblingNames?: string[]) => ListrTask<PubmContext>
> = {
  npm: (p) => createNpmDryRunPublishTask(p),
  jsr: (p) => createJsrDryRunPublishTask(p),
  crates: (p, siblingNames) => createCratesDryRunPublishTask(p, siblingNames),
};

function createDryRunTaskForPath(
  registryKey: string,
  packagePath: string,
  siblingNames?: string[],
): ListrTask<PubmContext> {
  const factory = dryRunTaskMap[registryKey];
  if (!factory)
    return { title: `Dry-run ${registryKey}`, task: async () => {} };
  return factory(packagePath, siblingNames);
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

          // For non-concurrent registries with multiple packages, gather sibling names
          let siblingNames: string[] | undefined;
          if (!descriptor?.concurrentPublish && packagePaths.length > 1) {
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

          const concurrent = descriptor?.concurrentPublish ?? true;
          const label = descriptor
            ? `Dry-run ${descriptor.label} publish${concurrent ? "" : " (sequential)"}`
            : `Dry-run ${registry} publish`;

          return {
            title: label,
            task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
              task.newListr(
                paths.map((p) =>
                  createDryRunTaskForPath(registry, p, siblingNames),
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
  if (ctx.runtime.versions && ctx.runtime.versions.size > 1) {
    return [...ctx.runtime.versions]
      .map(([name, ver]) => `${name}@${ver}`)
      .join(", ");
  }

  return `v${ctx.runtime.version}`;
}

function formatVersionPlan(ctx: PubmContext): string {
  if (ctx.runtime.versions && ctx.runtime.versions.size > 0) {
    return `Target versions:\n${[...ctx.runtime.versions]
      .map(([name, version]) => `- ${name}@${version}`)
      .join("\n")}`;
  }

  return `Target version: v${ctx.runtime.version}`;
}

function shouldRenderLiveCommandOutput(ctx: PubmContext): boolean {
  return !ctx.options.ci && !isCI && Boolean(process.stdout.isTTY);
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

      const pipelineListrOptions =
        ctx.options.ci || isCI
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

              ctx.runtime.version = snapshotVersion;
              task.title = `Publishing snapshot (${snapshotVersion})`;
              task.output = `Snapshot version: ${snapshotVersion}`;

              // Temporarily replace manifest version
              const snapshotVersions = new Map([
                [ctx.config.packages[0].name, snapshotVersion],
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
                  [ctx.config.packages[0].name, currentVersion],
                ]);
                await writeVersions(ctx, restoreVersions);
              }

              task.output = `Published ${snapshotVersion}`;
            },
          },
          {
            title: "Creating and pushing snapshot tag",
            skip: (ctx) => !!ctx.options.preview,
            task: async (ctx, task): Promise<void> => {
              const git = new Git();
              const tagName = `v${ctx.runtime.version}`;
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
          parts.push(`${color.bold(name)} on ${descriptor.label}`);
        }
      }

      console.log(
        `\n\n📸 Successfully published snapshot ${parts.join(", ")} ${color.blueBright(ctx.runtime.version ?? "")} 📸\n`,
      );

      return;
    }

    if (ctx.options.preflight) {
      // Phase 1: Collect tokens (interactive)
      await createListr<PubmContext>({
        title: "Collecting registry tokens",
        task: async (ctx, task): Promise<void> => {
          const registries = collectRegistries(ctx.config);
          const tokens = await collectTokens(registries, task);
          await promptGhSecretsSync(tokens, task);

          // Phase 2: Inject tokens and switch to non-interactive mode
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

    if (!ctx.options.publishOnly && !ctx.options.ci && !ctx.options.preflight) {
      await prerequisitesCheckTask({
        skip: ctx.options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: ctx.options.skipConditionsCheck,
      }).run(ctx);
    }

    const pipelineListrOptions =
      ctx.options.ci || isCI ? createCiListrOptions<PubmContext>() : undefined;

    await createListr<PubmContext>(
      ctx.options.ci
        ? [
            {
              title: "Publishing",
              task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
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

                if (ctx.runtime.versions && ctx.runtime.versions.size > 1) {
                  task.output =
                    "Collecting release notes from per-package CHANGELOG.md files...";
                  // Multi-package: combine changelogs from per-package CHANGELOG.md files
                  const sections: string[] = [];

                  for (const [pkgName, pkgVersion] of ctx.runtime.versions) {
                    const pkgConfig = ctx.config.packages.find(
                      (p) => p.name === pkgName,
                    );
                    if (!pkgConfig) continue;
                    const pkgChangelogPath = join(
                      process.cwd(),
                      pkgConfig.path,
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
                      ctx.runtime.version ?? "",
                    );
                    if (section) {
                      changelogBody = section;
                    }
                  }
                }

                const result = await createGitHubRelease(ctx, changelogBody);
                task.output = `GitHub Release created: ${result.releaseUrl}`;
                ctx.runtime.releaseContext = result;
              },
            },
            {
              title: "Running after-release hooks",
              skip: (ctx) => !ctx.runtime.releaseContext,
              task: async (ctx, task): Promise<void> => {
                if (ctx.runtime.releaseContext) {
                  task.output = `Running after-release hooks for ${ctx.runtime.releaseContext.tag}...`;
                  await ctx.runtime.pluginRunner.runAfterReleaseHook(
                    ctx,
                    ctx.runtime.releaseContext,
                  );
                }
              },
            },
          ]
        : ctx.options.publishOnly
          ? {
              title: "Publishing",
              task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
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
                skip: ctx.options.skipTests,
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
                    await exec(
                      packageManager,
                      ["run", ctx.options.testScript],
                      {
                        onStdout: liveOutput?.onStdout,
                        onStderr: liveOutput?.onStderr,
                        throwOnError: true,
                      },
                    );
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
                skip: ctx.options.skipBuild,
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
                    await exec(
                      packageManager,
                      ["run", ctx.options.buildScript],
                      {
                        onStdout: liveOutput?.onStdout,
                        onStderr: liveOutput?.onStderr,
                        throwOnError: true,
                      },
                    );
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
                skip: (ctx) => !!ctx.options.preview,
                task: async (ctx, task): Promise<void> => {
                  task.title = `Bumping version (${formatVersionSummary(ctx)})`;
                  task.output = "Running plugin beforeVersion hooks...";
                  await ctx.runtime.pluginRunner.runHook("beforeVersion", ctx);
                  const git = new Git();
                  let tagCreated = false;
                  let commited = false;

                  const versions = ctx.runtime.versions;
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
                    const replaced = await writeVersions(ctx, versions);
                    for (const f of replaced) {
                      await git.stage(f);
                    }

                    // Changeset consumption
                    if (ctx.runtime.changesetConsumed) {
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
                              const pkgConfig = ctx.config.packages.find(
                                (p) => p.name === pkgName,
                              );
                              const changelogDir = pkgConfig
                                ? path.resolve(process.cwd(), pkgConfig.path)
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
                              ctx.runtime.version ?? "",
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
                    await ctx.runtime.pluginRunner.runHook("afterVersion", ctx);
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
                      const nextVersion = `v${ctx.runtime.version}`;
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
                    const singleVersions = new Map<string, string>();
                    for (const pkg of ctx.config.packages) {
                      singleVersions.set(pkg.name, ctx.runtime.version ?? "");
                    }
                    const replaced = await writeVersions(ctx, singleVersions);

                    for (const replacedFile of replaced) {
                      await git.stage(replacedFile);
                    }

                    if (ctx.runtime.changesetConsumed) {
                      task.output =
                        "Applying changesets and generating changelog entries...";
                      const changesets = readChangesets(process.cwd());
                      if (changesets.length > 0) {
                        const pkgName = ctx.config.packages[0]?.name ?? "";
                        const entries = buildChangelogEntries(
                          changesets,
                          pkgName,
                        );
                        const changelogContent = generateChangelog(
                          ctx.runtime.version ?? "",
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

                    const nextVersion = `v${ctx.runtime.version}`;
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
                  !!ctx.options.skipPublish ||
                  !!ctx.options.preview ||
                  !!ctx.options.preflight,
                title: "Publishing",
                task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
                  parentTask.output = "Running plugin beforePublish hooks...";
                  await ctx.runtime.pluginRunner.runHook("beforePublish", ctx);
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
                  !!ctx.options.skipPublish ||
                  !!ctx.options.preview ||
                  !!ctx.options.preflight,
                title: "Running post-publish hooks",
                task: async (ctx, task): Promise<void> => {
                  task.output = "Running plugin afterPublish hooks...";
                  await ctx.runtime.pluginRunner.runHook("afterPublish", ctx);
                  task.output = "Completed plugin afterPublish hooks.";
                },
              },
              {
                skip: !ctx.options.preflight,
                title: "Validating publish (dry-run)",
                task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
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
                title: "Pushing tags to GitHub",
                skip: (ctx) => !!ctx.options.preview,
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
                  !!ctx.options.skipReleaseDraft ||
                  !!ctx.options.preview ||
                  !!ctx.options.preflight,
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
                    `${!!prerelease(ctx.runtime.version ?? "")}`,
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

    const registries = collectRegistries(ctx.config);
    const parts: string[] = [];

    for (const registryKey of registries) {
      const descriptor = registryCatalog.get(registryKey);
      if (!descriptor?.resolveDisplayName) continue;
      const names = await descriptor.resolveDisplayName(ctx.config);
      for (const name of names) {
        parts.push(`${color.bold(name)} on ${descriptor.label}`);
      }
    }

    process.removeListener("SIGINT", onSigint);

    if (ctx.options.preflight) {
      cleanupEnv?.();
      console.log(
        `\n\n✅ Preflight check passed. CI publish should succeed for ${parts.join(", ")}.\n`,
      );
    } else {
      console.log(
        `\n\n🚀 Successfully published ${parts.join(", ")} ${color.blueBright(formatVersionSummary(ctx))} 🚀\n`,
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
