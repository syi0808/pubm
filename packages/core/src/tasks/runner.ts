import { existsSync, readFileSync } from "node:fs";
import path, { join } from "node:path";
import process from "node:process";
import { color, type Listr } from "listr2";
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
import type { PackageConfig } from "../config/types.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError, consoleError } from "../error.js";
import { Git } from "../git.js";
import { PluginRunner } from "../plugin/runner.js";
import type { ResolvedOptions } from "../types/options.js";
import { link } from "../utils/cli.js";
import { sortCratesByDependencyOrder } from "../utils/crate-graph.js";
import { exec } from "../utils/exec.js";
import { createListr } from "../utils/listr.js";
import { openUrl } from "../utils/open-url.js";
import {
  getJsrJson,
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
import { injectTokensToEnv } from "../utils/token.js";
import { cratesPublishTasks, createCratesPublishTask } from "./crates.js";
import {
  cratesDryRunPublishTask,
  createCratesDryRunPublishTask,
  jsrDryRunPublishTask,
  npmDryRunPublishTask,
} from "./dry-run-publish.js";
import { createGitHubRelease, type ReleaseContext } from "./github-release.js";
import { jsrPublishTasks } from "./jsr.js";
import { npmPublishTasks } from "./npm.js";
import { collectTokens, promptGhSecretsSync } from "./preflight.js";
import { prerequisitesCheckTask } from "./prerequisites-check.js";
import { requiredConditionsCheckTask } from "./required-conditions-check.js";

const { prerelease } = SemVer;

export interface Ctx extends ResolvedOptions {
  promptEnabled: boolean;
  cleanWorkingTree: boolean;
  pluginRunner: PluginRunner;
  releaseContext?: ReleaseContext;
}

function registryTask(registry: string) {
  switch (registry) {
    case "npm":
      return npmPublishTasks;
    case "jsr":
      return jsrPublishTasks;
    case "crates":
      return cratesPublishTasks;
    default:
      return npmPublishTasks;
  }
}

async function collectPublishTasks(ctx: Ctx) {
  if (ctx.packages?.length) {
    const nonCratesTasks = ctx.packages.flatMap((pkg: PackageConfig) =>
      pkg.registries
        .filter((reg) => reg !== "crates")
        .map((reg) => registryTask(reg)),
    );

    const cratesPaths = ctx.packages
      .filter((pkg) => pkg.registries.includes("crates"))
      .map((pkg) => pkg.path);

    if (cratesPaths.length === 0) {
      return nonCratesTasks;
    }

    const sortedPaths = await sortCratesByDependencyOrder(cratesPaths);
    const sequentialCratesTask = {
      title: "Publishing to crates.io (sequential)",
      task: (_ctx: Ctx, task: { newListr: (...args: any[]) => any }) =>
        task.newListr(
          sortedPaths.map((p) => createCratesPublishTask(p)),
          { concurrent: false },
        ),
    };

    return [
      ...nonCratesTasks,
      sequentialCratesTask,
      ...pluginPublishTasks(ctx),
    ];
  }
  return [
    ...collectRegistries(ctx).map(registryTask),
    ...pluginPublishTasks(ctx),
  ];
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

function dryRunRegistryTask(registry: string) {
  switch (registry) {
    case "npm":
      return npmDryRunPublishTask;
    case "jsr":
      return jsrDryRunPublishTask;
    case "crates":
      return cratesDryRunPublishTask;
    default:
      return npmDryRunPublishTask;
  }
}

async function collectDryRunPublishTasks(ctx: Ctx) {
  if (ctx.packages?.length) {
    const nonCratesTasks = ctx.packages.flatMap((pkg: PackageConfig) =>
      pkg.registries
        .filter((reg) => reg !== "crates")
        .map((reg) => dryRunRegistryTask(reg)),
    );

    const cratesPaths = ctx.packages
      .filter((pkg) => pkg.registries.includes("crates"))
      .map((pkg) => pkg.path);

    if (cratesPaths.length === 0) {
      return nonCratesTasks;
    }

    const sortedPaths = await sortCratesByDependencyOrder(cratesPaths);
    const siblingCrateNames = await Promise.all(
      cratesPaths.map((p) => new RustEcosystem(p).packageName()),
    );
    const sequentialCratesTask = {
      title: "Dry-run crates.io publish (sequential)",
      task: (_ctx: Ctx, task: { newListr: (...args: any[]) => any }) =>
        task.newListr(
          sortedPaths.map((p) =>
            createCratesDryRunPublishTask(p, siblingCrateNames),
          ),
          { concurrent: false },
        ),
    };

    return [...nonCratesTasks, sequentialCratesTask];
  }
  return collectRegistries(ctx).map(dryRunRegistryTask);
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

    await createListr<Ctx>(
      options.ci
        ? [
            {
              title: "Publishing",
              task: async (ctx, parentTask): Promise<Listr<Ctx>> =>
                parentTask.newListr(await collectPublishTasks(ctx), {
                  concurrent: true,
                }),
            },
            {
              title: "Creating GitHub Release",
              task: async (ctx): Promise<void> => {
                let changelogBody: string | undefined;

                if (ctx.versions && ctx.versions.size > 1) {
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
                ctx.releaseContext = result;
              },
            },
            {
              title: "Running after-release hooks",
              skip: (ctx) => !ctx.releaseContext,
              task: async (ctx): Promise<void> => {
                if (ctx.releaseContext) {
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
              task: async (ctx, parentTask): Promise<Listr<Ctx>> =>
                parentTask.newListr(await collectPublishTasks(ctx), {
                  concurrent: true,
                }),
            }
          : [
              {
                skip: options.skipTests,
                title: "Running tests",
                task: async (ctx): Promise<void> => {
                  await ctx.pluginRunner.runHook("beforeTest", ctx);
                  const packageManager = await getPackageManager();

                  try {
                    await exec(packageManager, ["run", ctx.testScript], {
                      throwOnError: true,
                    });
                  } catch (error) {
                    throw new AbstractError(
                      `Test script '${ctx.testScript}' failed. Run \`${packageManager} run ${ctx.testScript}\` locally to see full output.`,
                      { cause: error },
                    );
                  }
                  await ctx.pluginRunner.runHook("afterTest", ctx);
                },
              },
              {
                skip: options.skipBuild,
                title: "Building the project",
                task: async (ctx): Promise<void> => {
                  await ctx.pluginRunner.runHook("beforeBuild", ctx);
                  const packageManager = await getPackageManager();

                  try {
                    await exec(packageManager, ["run", ctx.buildScript], {
                      throwOnError: true,
                    });
                  } catch (error) {
                    throw new AbstractError(
                      `Build script '${ctx.buildScript}' failed. Run \`${packageManager} run ${ctx.buildScript}\` locally to see full output.`,
                      { cause: error },
                    );
                  }
                  await ctx.pluginRunner.runHook("afterBuild", ctx);
                },
              },
              {
                title: "Bumping version",
                skip: (ctx) => !!ctx.preview,
                task: async (ctx, task): Promise<void> => {
                  await ctx.pluginRunner.runHook("beforeVersion", ctx);
                  const git = new Git();
                  let tagCreated = false;
                  let commited = false;

                  const hasMultiPackageVersions =
                    ctx.versions && ctx.versions.size > 0;
                  const isIndependent =
                    hasMultiPackageVersions &&
                    new Set(ctx.versions!.values()).size > 1;

                  addRollback(async () => {
                    if (tagCreated) {
                      try {
                        rollbackLog("Deleting tag(s)");
                        if (isIndependent && ctx.versions) {
                          for (const [pkgName, pkgVersion] of ctx.versions) {
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

                  await git.reset();

                  if (hasMultiPackageVersions) {
                    // Multi-package version replacement (fixed and independent)
                    const packageInfos = await discoverPackageInfos(
                      process.cwd(),
                    );

                    for (const [pkgName, pkgVersion] of ctx.versions!) {
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
                      const changesets = readChangesets(process.cwd());
                      if (changesets.length > 0) {
                        if (isIndependent) {
                          // Independent: per-package changelogs
                          for (const [pkgName, pkgVersion] of ctx.versions!) {
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
                          const allEntries = [...ctx.versions!.keys()].flatMap(
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

                    await ctx.pluginRunner.runHook("afterVersion", ctx);
                    await git.stage(".");

                    if (isIndependent) {
                      // Independent: per-package commit message and tags
                      const commitMsg = [...ctx.versions!]
                        .map(([name, ver]) => `${name}@${ver}`)
                        .join(", ");
                      const commit = await git.commit(commitMsg);
                      commited = true;

                      task.output = "Creating tags...";
                      for (const [pkgName, pkgVersion] of ctx.versions!) {
                        await git.createTag(
                          `${pkgName}@${pkgVersion}`,
                          commit,
                        );
                      }
                      tagCreated = true;
                    } else {
                      // Fixed monorepo: single version commit and tag
                      const nextVersion = `v${ctx.version}`;
                      const commit = await git.commit(nextVersion);
                      commited = true;

                      task.output = "Creating tag...";
                      await git.createTag(nextVersion, commit);
                      tagCreated = true;
                    }
                  } else {
                    // Single package: existing behavior
                    const replaced = await replaceVersion(
                      ctx.version,
                      ctx.packages,
                    );

                    for (const replacedFile of replaced) {
                      await git.stage(replacedFile);
                    }

                    if (ctx.changesetConsumed) {
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

                    await ctx.pluginRunner.runHook("afterVersion", ctx);
                    await git.stage(".");

                    const nextVersion = `v${ctx.version}`;
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
                  await ctx.pluginRunner.runHook("beforePublish", ctx);
                  return parentTask.newListr(await collectPublishTasks(ctx), {
                    concurrent: true,
                  });
                },
              },
              {
                skip: (ctx) =>
                  !!options.skipPublish || !!ctx.preview || !!options.preflight,
                title: "Running post-publish hooks",
                task: async (ctx): Promise<void> => {
                  await ctx.pluginRunner.runHook("afterPublish", ctx);
                },
              },
              {
                skip: !options.preflight,
                title: "Validating publish (dry-run)",
                task: async (ctx, parentTask): Promise<Listr<Ctx>> =>
                  parentTask.newListr(await collectDryRunPublishTasks(ctx), {
                    concurrent: true,
                  }),
              },
              {
                title: "Pushing tags to GitHub",
                skip: (ctx) => !!ctx.preview,
                task: async (ctx, task): Promise<void> => {
                  await ctx.pluginRunner.runHook("beforePush", ctx);
                  const git = new Git();

                  const result = await git.push("--follow-tags");

                  if (!result) {
                    task.title +=
                      " (Only tags were pushed because the release branch is protected. Please push the branch manually.)";

                    await git.push("--tags");
                  }
                  await ctx.pluginRunner.runHook("afterPush", ctx);
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

                  const repositoryUrl = await git.repository();

                  const latestTag = `${await git.latestTag()}`;

                  const lastRev =
                    (await git.previousTag(latestTag)) ||
                    (await git.firstCommit());

                  const commits = (
                    await git.commits(lastRev, `${latestTag}`)
                  ).slice(1);

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

                  await openUrl(releaseDraftUrl.toString());
                },
              },
            ],
    ).run(ctx);

    const registries = collectRegistries(ctx);
    const parts: string[] = [];

    if (registries.includes("npm")) {
      const npmPackageName = (await getPackageJson()).name;
      parts.push(`${color.bold(npmPackageName)} on ${color.green("npm")}`);
    }

    if (registries.includes("jsr")) {
      const jsrPackageName = (await getJsrJson()).name;
      parts.push(`${color.bold(jsrPackageName)} on ${color.yellow("jsr")}`);
    }

    if (registries.includes("crates")) {
      const crateNames = ctx.packages
        ?.filter((pkg) => pkg.registries.includes("crates"))
        .map((pkg) => pkg.path) ?? ["crate"];
      for (const name of crateNames) {
        parts.push(`${color.bold(name)} on ${color.red("crates.io")}`);
      }
    }

    process.removeListener("SIGINT", onSigint);

    if (options.preflight) {
      cleanupEnv?.();
      console.log(
        `\n\n✅ Preflight check passed. CI publish should succeed for ${parts.join(", ")}.\n`,
      );
    } else {
      const versionLabel =
        ctx.versions && ctx.versions.size > 1
          ? [...ctx.versions].map(([name, ver]) => `${name}@${ver}`).join(", ")
          : `v${ctx.version}`;
      console.log(
        `\n\n🚀 Successfully published ${parts.join(", ")} ${color.blueBright(versionLabel)} 🚀\n`,
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
