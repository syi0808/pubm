import { existsSync, readFileSync, rmSync } from "node:fs";
import path, { join } from "node:path";
import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { Listr } from "listr2";
import SemVer from "semver";
import { isCI } from "std-env";
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
import { t } from "../i18n/index.js";
import { writeVersionsForEcosystem } from "../manifest/write-versions.js";
import { restoreManifests } from "../monorepo/resolve-workspace.js";
import { registryCatalog } from "../registry/catalog.js";
import { JsrClient } from "../registry/jsr.js";
import { exec } from "../utils/exec.js";
import { resolveGitHubToken, saveGitHubToken } from "../utils/github-token.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { openUrl } from "../utils/open-url.js";
import { getPackageManager } from "../utils/package-manager.js";
import { parseOwnerRepo } from "../utils/parse-owner-repo.js";
import { collectRegistries } from "../utils/registries.js";
import { resolvePhases } from "../utils/resolve-phases.js";
import { injectPluginTokensToEnv, injectTokensToEnv } from "../utils/token.js";
import { ui } from "../utils/ui.js";
import { createGitHubRelease, deleteGitHubRelease } from "./github-release.js";
import {
  collectEcosystemRegistryGroups,
  countRegistryTargets,
} from "./grouping.js";
import {
  collectPluginCredentials,
  collectTokens,
  type GhSecretEntry,
  promptGhSecretsSync,
} from "./preflight.js";
import { prerequisitesCheckTask } from "./prerequisites-check.js";
import { requiredConditionsCheckTask } from "./required-conditions-check.js";
import {
  applyVersionsForDryRun,
  prepareReleaseAssets,
  resolveWorkspaceProtocols,
} from "./runner-utils/manifest-handling.js";
import {
  countPublishTargets,
  createLiveCommandOutput,
  formatRegistryGroupSummary,
  formatVersionPlan,
  formatVersionSummary,
  shouldRenderLiveCommandOutput,
} from "./runner-utils/output-formatting.js";
import {
  collectDryRunPublishTasks,
  collectPublishTasks,
} from "./runner-utils/publish-tasks.js";
import {
  getPackageName,
  isReleaseExcluded,
  registerChangelogBackup,
  registerChangesetBackups,
  registerCommitRollback,
  registerManifestBackups,
  registerRemoteTagRollback,
  registerTagRollback,
  requirePackageEcosystem,
  requireVersionPlan,
} from "./runner-utils/rollback-handlers.js";
import { pushViaPr } from "./runner-utils/version-pr.js";

export { collectPublishTasks } from "./runner-utils/publish-tasks.js";

const { prerelease } = SemVer;

function chainCleanup(
  existing: (() => void) | undefined,
  next: () => void,
): () => void {
  return () => {
    existing?.();
    next();
  };
}

export async function writeVersions(
  ctx: PubmContext,
  versions: Map<string, string>,
): Promise<string[]> {
  const ecosystems = ctx.config.packages.map((pkg) => {
    const absPath = path.resolve(ctx.cwd ?? process.cwd(), pkg.path);
    const ecosystem = requirePackageEcosystem(pkg);
    const descriptor = ecosystemCatalog.get(ecosystem);
    if (!descriptor) throw new Error(`Unknown ecosystem: ${ecosystem}`);
    const eco = new descriptor.ecosystemClass(absPath);
    return { eco, pkg };
  });

  const lockfileChanges = await writeVersionsForEcosystem(
    ecosystems,
    versions,
    ctx.config.lockfileSync,
  );

  // Collect manifest file paths for git staging
  const manifestFiles = ecosystems.flatMap(({ eco }) =>
    eco.manifestFiles().map((f) => path.resolve(eco.packagePath, f)),
  );

  return [...manifestFiles, ...lockfileChanges];
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
      // CI prepare: Collect tokens (interactive)
      await createListr<PubmContext>({
        title: t("task.tokens.collecting"),
        task: async (ctx, task): Promise<void> => {
          const registries = collectRegistries(ctx.config);
          const tokens = await collectTokens(registries, task);

          // Collect plugin credentials
          const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
          const pluginTokens = await collectPluginCredentials(
            pluginCreds,
            ctx.runtime.promptEnabled,
            task,
          );
          ctx.runtime.pluginTokens = pluginTokens;

          // Build plugin secrets for GitHub sync
          const pluginSecrets: GhSecretEntry[] = pluginCreds
            .filter(
              (c): c is typeof c & { ghSecretName: string } =>
                !!c.ghSecretName && !!pluginTokens[c.key],
            )
            .map((c) => ({
              secretName: c.ghSecretName,
              token: pluginTokens[c.key],
            }));

          let repoSlug: string;
          try {
            const remoteUrl = await new Git().repository();
            const { owner, repo } = parseOwnerRepo(remoteUrl);
            repoSlug = `${owner}/${repo}`;
          } catch {
            repoSlug = process.cwd();
          }

          await promptGhSecretsSync(tokens, task, pluginSecrets, repoSlug);

          // Inject tokens and switch to non-interactive mode
          cleanupEnv = injectTokensToEnv(tokens);
          cleanupEnv = chainCleanup(
            cleanupEnv,
            injectPluginTokensToEnv(pluginTokens, pluginCreds),
          );
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

      // Collect tokens early for registries that require early auth
      const registries = collectRegistries(ctx.config);
      const earlyAuthRegistries = registries.filter((r) => {
        const desc = registryCatalog.get(r);
        return desc?.requiresEarlyAuth;
      });

      if (earlyAuthRegistries.length > 0 && ctx.runtime.promptEnabled) {
        await createListr<PubmContext>({
          title: t("task.tokens.ensuring"),
          task: async (_ctx, task): Promise<void> => {
            const tokens = await collectTokens(earlyAuthRegistries, task);
            cleanupEnv = injectTokensToEnv(tokens);
            // TODO(extensibility): replace with descriptor-driven client injection (e.g., onTokenCollected callback)
            if (tokens.jsr) {
              JsrClient.token = tokens.jsr;
            }
          },
        }).run(ctx);
      }

      // Collect plugin credentials
      const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
      if (pluginCreds.length > 0) {
        await createListr<PubmContext>({
          title: t("task.tokens.collectingPlugin"),
          task: async (ctx, task): Promise<void> => {
            const pluginTokens = await collectPluginCredentials(
              pluginCreds,
              ctx.runtime.promptEnabled,
              task,
            );
            ctx.runtime.pluginTokens = pluginTokens;
            cleanupEnv = chainCleanup(
              cleanupEnv,
              injectPluginTokensToEnv(pluginTokens, pluginCreds),
            );
          },
        }).run(ctx);
      }

      await requiredConditionsCheckTask({
        skip: ctx.options.skipConditionsCheck,
      }).run(ctx);
    }

    // CI publish: collect plugin credentials from env (no prompting)
    if (mode === "ci" && hasPublish && !hasPrepare) {
      const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
      if (pluginCreds.length > 0) {
        await createListr<PubmContext>({
          title: t("task.tokens.collectingPlugin"),
          task: async (ctx, task): Promise<void> => {
            const pluginTokens = await collectPluginCredentials(
              pluginCreds,
              false, // No prompting in CI
              task,
            );
            ctx.runtime.pluginTokens = pluginTokens;
            cleanupEnv = chainCleanup(
              cleanupEnv,
              injectPluginTokensToEnv(pluginTokens, pluginCreds),
            );
          },
        }).run(ctx);
      }
    }

    const pipelineListrOptions = isCI
      ? createCiListrOptions<PubmContext>()
      : undefined;

    await createListr<PubmContext>(
      [
        // === PREPARE PHASE ===
        {
          enabled: hasPrepare && !ctx.options.skipTests,
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
        },
        {
          enabled: hasPrepare && !ctx.options.skipBuild,
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
        },
        {
          title: t("task.version.title"),
          enabled: hasPrepare,
          task: async (ctx, task): Promise<void> => {
            task.title = t("task.version.titleWithSummary", {
              summary: formatVersionSummary(ctx),
            });
            task.output = t("task.version.runningBeforeHooks");
            await ctx.runtime.pluginRunner.runHook("beforeVersion", ctx);
            const git = new Git();

            const plan = requireVersionPlan(ctx);

            task.output = formatVersionPlan(ctx);

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

              registerManifestBackups(ctx);

              const replaced = await writeVersions(ctx, singleVersions);

              for (const replacedFile of replaced) {
                await git.stage(replacedFile);
              }

              if (ctx.runtime.changesetConsumed) {
                task.output =
                  "Applying changesets and generating changelog entries...";
                const resolver = createKeyResolver(ctx.config.packages);
                const changesets = readChangesets(ctx.cwd, resolver);
                if (changesets.length > 0) {
                  registerChangesetBackups(ctx, changesets);

                  const changelogPath = path.join(ctx.cwd, "CHANGELOG.md");
                  registerChangelogBackup(ctx, changelogPath);

                  const pkgPath = ctx.config.packages[0]?.path ?? "";
                  const entries = buildChangelogEntries(changesets, pkgPath);
                  const changelogContent = generateChangelog(
                    plan.version,
                    entries,
                  );
                  writeChangelogToFile(ctx.cwd, changelogContent);
                  deleteChangesetFiles(ctx.cwd, changesets);
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
                      message: t("task.version.tagExists", { tag: tagName }),
                      enabled: "Yes",
                      disabled: "No",
                    });
                  if (deleteTag) {
                    await git.deleteTag(tagName);
                  } else {
                    throw new AbstractError(
                      t("error.version.tagExists", { tag: tagName }),
                    );
                  }
                } else {
                  throw new AbstractError(
                    t("error.version.tagExistsManual", { tag: tagName }),
                  );
                }
              }

              task.output = t("task.version.creatingCommit", { tag: tagName });
              const singleCommitMsg = `Version Packages\n\n${ctx.config.packages
                .map((pkg) => `- ${pkg.name}: ${plan.version}`)
                .join("\n")}`;
              const commit = await git.commit(singleCommitMsg);
              registerCommitRollback(ctx);
              task.output = t("task.version.creatingTags");
              await git.createTag(tagName, commit);
              registerTagRollback(ctx, tagName);
            } else if (plan.mode === "fixed") {
              // Fixed monorepo: same version for all packages
              task.output = "Updating package versions across the workspace...";

              if (dryRun) {
                return;
              }

              registerManifestBackups(ctx);

              const replaced = await writeVersions(ctx, plan.packages);

              for (const f of replaced) {
                await git.stage(f);
              }

              if (ctx.runtime.changesetConsumed) {
                task.output =
                  "Applying changesets and generating changelog entries...";
                const resolver = createKeyResolver(ctx.config.packages);
                const changesets = readChangesets(ctx.cwd, resolver);
                if (changesets.length > 0) {
                  registerChangesetBackups(ctx, changesets);

                  const changelogPath = path.join(ctx.cwd, "CHANGELOG.md");
                  registerChangelogBackup(ctx, changelogPath);

                  const allEntries = [...plan.packages.keys()].flatMap(
                    (pkgPath) => buildChangelogEntries(changesets, pkgPath),
                  );
                  if (allEntries.length > 0) {
                    const changelogContent = generateChangelog(
                      plan.version,
                      allEntries,
                    );
                    writeChangelogToFile(ctx.cwd, changelogContent);
                  }
                  deleteChangesetFiles(ctx.cwd, changesets);
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
                      message: t("task.version.tagExists", { tag: tagName }),
                      enabled: "Yes",
                      disabled: "No",
                    });
                  if (deleteTag) {
                    await git.deleteTag(tagName);
                  } else {
                    throw new AbstractError(
                      t("error.version.tagExists", { tag: tagName }),
                    );
                  }
                } else {
                  throw new AbstractError(
                    t("error.version.tagExistsManual", { tag: tagName }),
                  );
                }
              }

              task.output = t("task.version.creatingCommit", { tag: tagName });
              const fixedCommitMsg = `Version Packages\n\n${[...plan.packages]
                .map(
                  ([pkgPath]) =>
                    `- ${getPackageName(ctx, pkgPath)}: ${plan.version}`,
                )
                .join("\n")}`;
              const commit = await git.commit(fixedCommitMsg);
              registerCommitRollback(ctx);
              task.output = t("task.version.creatingTags");
              await git.createTag(tagName, commit);
              registerTagRollback(ctx, tagName);
            } else {
              // Independent monorepo
              task.output = "Updating package versions across the workspace...";

              if (dryRun) {
                return;
              }

              registerManifestBackups(ctx);

              const replaced = await writeVersions(ctx, plan.packages);

              for (const f of replaced) {
                await git.stage(f);
              }

              if (ctx.runtime.changesetConsumed) {
                task.output =
                  "Applying changesets and generating changelog entries...";
                const resolver = createKeyResolver(ctx.config.packages);
                const changesets = readChangesets(ctx.cwd, resolver);
                if (changesets.length > 0) {
                  registerChangesetBackups(ctx, changesets);

                  // Back up changelog files (per-package for independent mode)
                  for (const [pkgPath] of plan.packages) {
                    const pkgConfig = ctx.config.packages.find(
                      (p) => p.path === pkgPath,
                    );
                    const changelogDir = pkgConfig
                      ? path.resolve(process.cwd(), pkgConfig.path)
                      : process.cwd();
                    const changelogPath = path.join(
                      changelogDir,
                      "CHANGELOG.md",
                    );
                    registerChangelogBackup(ctx, changelogPath);
                  }

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
                  deleteChangesetFiles(ctx.cwd, changesets);
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
                        message: t("task.version.tagExists", { tag: tagName }),
                        enabled: "Yes",
                        disabled: "No",
                      });
                    if (deleteTag) {
                      await git.deleteTag(tagName);
                    } else {
                      throw new AbstractError(
                        t("error.version.tagExists", { tag: tagName }),
                      );
                    }
                  } else {
                    throw new AbstractError(
                      t("error.version.tagExistsManual", { tag: tagName }),
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
              task.output = t("task.version.creatingCommitGeneric");
              const commit = await git.commit(commitMsg);
              registerCommitRollback(ctx);

              // Create per-package tags
              task.output = t("task.version.creatingTags");
              for (const [pkgPath, pkgVersion] of plan.packages) {
                if (isReleaseExcluded(ctx.config, pkgPath)) continue;
                const pkgName = getPackageName(ctx, pkgPath);
                const tag = `${pkgName}@${pkgVersion}`;
                await git.createTag(tag, commit);
                registerTagRollback(ctx, tag);
              }
            }
          },
        },

        // === PUBLISH PHASE ===
        {
          enabled: hasPublish && !ctx.options.skipPublish && !dryRun,
          title: t("task.publish.title"),
          task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
            parentTask.output = "Running plugin beforePublish hooks...";
            await ctx.runtime.pluginRunner.runHook("beforePublish", ctx);
            await resolveWorkspaceProtocols(ctx);

            const publishTasks = await collectPublishTasks(ctx);
            parentTask.title = t("task.publish.titleWithTargets", {
              count: countPublishTargets(ctx),
            });
            parentTask.output = formatRegistryGroupSummary(
              t("task.publish.concurrent"),
              ctx,
            );

            return parentTask.newListr(publishTasks, {
              concurrent: true,
            });
          },
        },
        {
          enabled: hasPublish && !ctx.options.skipPublish && !dryRun,
          skip: (ctx) => !ctx.runtime.workspaceBackups?.size,
          title: t("task.publish.restoreProtocols"),
          task: (ctx) => {
            const backups = ctx.runtime.workspaceBackups;
            if (!backups) {
              throw new Error("Workspace backups are required for restore.");
            }
            restoreManifests(backups);
            ctx.runtime.workspaceBackups = undefined;
          },
        },
        {
          enabled: hasPublish && !ctx.options.skipPublish && !dryRun,
          title: t("task.publish.runningAfterHooks"),
          task: async (ctx, task): Promise<void> => {
            task.output = t("task.publish.runningAfterHooksDetail");
            await ctx.runtime.pluginRunner.runHook("afterPublish", ctx);
            task.output = t("task.publish.completedAfterHooks");
          },
        },

        // === DRY-RUN PUBLISH VALIDATION (for --dry-run OR ci prepare) ===
        {
          enabled: dryRun || (mode === "ci" && hasPrepare),
          title: t("task.dryRunValidation.title"),
          task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
            await resolveWorkspaceProtocols(ctx);
            await applyVersionsForDryRun(ctx);

            const dryRunTasks = await collectDryRunPublishTasks(ctx);
            parentTask.title = t("task.dryRunValidation.titleWithTargets", {
              count: countRegistryTargets(
                collectEcosystemRegistryGroups(ctx.config),
              ),
            });
            parentTask.output = formatRegistryGroupSummary(
              t("task.dryRunValidation.concurrent"),
              ctx,
            );

            return parentTask.newListr(dryRunTasks, {
              concurrent: true,
            });
          },
        },
        {
          enabled: dryRun || (mode === "ci" && hasPrepare),
          skip: (ctx) => !ctx.runtime.workspaceBackups?.size,
          title: t("task.dryRunValidation.restoreProtocols"),
          task: async (ctx) => {
            const backups = ctx.runtime.workspaceBackups;
            if (!backups) {
              throw new Error("Workspace backups are required for restore.");
            }
            restoreManifests(backups);
            ctx.runtime.workspaceBackups = undefined;

            // Re-sync lockfile to reflect restored workspace:* protocols
            const syncedLockfiles = new Set<string>();
            for (const pkg of ctx.config.packages) {
              const absPath = path.resolve(ctx.cwd ?? process.cwd(), pkg.path);
              const ecosystem = requirePackageEcosystem(pkg);
              const descriptor = ecosystemCatalog.get(ecosystem);
              if (!descriptor) continue;
              const eco = new descriptor.ecosystemClass(absPath);
              const lockfilePath = await eco.syncLockfile(
                ctx.config.lockfileSync,
              );
              if (lockfilePath && !syncedLockfiles.has(lockfilePath)) {
                syncedLockfiles.add(lockfilePath);
              }
            }
          },
        },
        {
          enabled: dryRun,
          skip: (ctx) => !ctx.runtime.dryRunVersionBackup?.size,
          title: t("task.dryRunValidation.restoringVersions"),
          task: async (ctx): Promise<void> => {
            const backupVersions = ctx.runtime.dryRunVersionBackup;
            if (!backupVersions) {
              throw new Error(
                "Dry-run version backup is required for restore.",
              );
            }
            await writeVersions(ctx, backupVersions);
            ctx.runtime.dryRunVersionBackup = undefined;
          },
        },

        // === PUSH & RELEASE ===
        {
          title: t("task.push.title"),
          enabled: hasPrepare && !dryRun,
          task: async (ctx, task): Promise<void> => {
            task.output = t("task.push.runningBeforeHooks");
            await ctx.runtime.pluginRunner.runHook("beforePush", ctx);
            const git = new Git();
            const prePushSha = await git.revParse("HEAD~1");
            task.output = t("task.push.executing");

            const createPr = ctx.options.createPr ?? ctx.config.createPr;

            if (createPr) {
              await pushViaPr(ctx, git, task);
            } else {
              const result = await git.push("--follow-tags");

              if (!result) {
                task.output = t("task.push.prFallback");
                await pushViaPr(ctx, git, task);
              } else {
                registerRemoteTagRollback(ctx);

                const branch = await git.branch();
                ctx.runtime.rollback.add({
                  label: t("task.push.forceRevert", { branch }),
                  fn: async () => {
                    const g = new Git();
                    await g.forcePush("origin", `${prePushSha}:${branch}`);
                  },
                  confirm: true,
                });
              }
            }

            task.output = t("task.push.runningAfterHooks");
            await ctx.runtime.pluginRunner.runHook("afterPush", ctx);
            task.output = t("task.push.completed");
          },
        },
        {
          enabled: hasPublish && !ctx.options.skipReleaseDraft && !dryRun,
          title: t("task.release.title"),
          task: async (ctx, task): Promise<void> => {
            const plan = requireVersionPlan(ctx);

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
                  message: t("task.release.noTokenPrompt"),
                  choices: [
                    { name: "enter", message: t("task.release.enterToken") },
                    {
                      name: "browser",
                      message: t("task.release.openDraft"),
                    },
                    { name: "skip", message: t("task.release.skip") },
                  ],
                });

              if (answer === "enter") {
                const token = await task
                  .prompt(ListrEnquirerPromptAdapter)
                  .run<string>({
                    type: "password",
                    message: t("task.release.tokenPrompt"),
                  });
                if (token) {
                  process.env.GITHUB_TOKEN = token;
                  saveGitHubToken(token);
                  hasToken = true;
                }
              } else if (answer === "skip") {
                task.skip(t("task.release.skippedByUser"));
                return;
              }
              // "browser" falls through to browser fallback below
            }

            if (hasToken) {
              // Create GitHub Release via API
              task.title = t("task.release.titleWithVersion", {
                summary: formatVersionSummary(ctx),
              });

              if (plan.mode === "independent") {
                // Per-package releases
                for (const [pkgPath, pkgVersion] of plan.packages) {
                  if (isReleaseExcluded(ctx.config, pkgPath)) continue;
                  const pkgName = getPackageName(ctx, pkgPath);
                  const tag = `${pkgName}@${pkgVersion}`;
                  task.output = t("task.release.creating", { tag });

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
                    task.output = t("task.release.created", {
                      url: result.releaseUrl,
                    });
                    if (result.releaseId) {
                      const releaseId = result.releaseId;
                      ctx.runtime.rollback.add({
                        label: t("task.release.deleteRelease", { tag }),
                        fn: async () => {
                          await deleteGitHubRelease(releaseId);
                        },
                      });
                    }
                    await ctx.runtime.pluginRunner.runAfterReleaseHook(
                      ctx,
                      result,
                    );
                  } else {
                    task.output = t("task.release.alreadyExists", { tag });
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
                  if (result.releaseId) {
                    const releaseId = result.releaseId;
                    ctx.runtime.rollback.add({
                      label: `Delete GitHub Release ${tag}`,
                      fn: async () => {
                        await deleteGitHubRelease(releaseId);
                      },
                    });
                  }
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
              task.title = t("task.release.draftTitle", {
                summary: formatVersionSummary(ctx),
              });
              task.output = t("task.release.resolvingMetadata");

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
                    task.output = t("task.release.openingDraft", { tag });
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
                task.output = t("task.release.collectedCommits", {
                  count: commits.length,
                  tag,
                });

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
    cleanupEnv?.();

    await ctx.runtime.pluginRunner.runErrorHook(ctx, e as Error);

    consoleError(e as Error);
    await ctx.runtime.rollback.execute(ctx, {
      interactive: ctx.runtime.promptEnabled,
    });

    process.exit(1);
  }
}
