import path from "node:path";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import {
  buildChangelogEntries,
  deduplicateEntries,
  generateChangelog,
  writeChangelogToFile,
} from "../../changeset/changelog.js";
import {
  deleteChangesetFiles,
  readChangesets,
} from "../../changeset/reader.js";
import { createKeyResolver } from "../../changeset/resolve.js";
import type { PubmContext } from "../../context.js";
import { AbstractError } from "../../error.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import { pathFromKey } from "../../utils/package-key.js";
import {
  formatVersionPlan,
  formatVersionSummary,
} from "../runner-utils/output-formatting.js";
import {
  getPackageName,
  isReleaseExcluded,
  registerChangelogBackup,
  registerChangesetBackups,
  registerCommitRollback,
  registerManifestBackups,
  registerTagRollback,
  requireVersionPlan,
} from "../runner-utils/rollback-handlers.js";
import { writeVersions } from "../runner-utils/write-versions.js";

export function createVersionTask(
  hasPrepare: boolean,
  dryRun: boolean,
): ListrTask<PubmContext> {
  return {
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
            const changelogContent = generateChangelog(plan.version, entries);
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

            const allEntries = deduplicateEntries(
              [...plan.packages.keys()].flatMap((key) =>
                buildChangelogEntries(changesets, key),
              ),
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
          .map(([key]) => `- ${getPackageName(ctx, key)}: ${plan.version}`)
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
            for (const [key] of plan.packages) {
              const pkgConfig = ctx.config.packages.find(
                (p) => p.path === pathFromKey(key),
              );
              const changelogDir = pkgConfig
                ? path.resolve(ctx.cwd, pkgConfig.path)
                : ctx.cwd;
              const changelogPath = path.join(changelogDir, "CHANGELOG.md");
              registerChangelogBackup(ctx, changelogPath);
            }

            for (const [key, pkgVersion] of plan.packages) {
              const entries = buildChangelogEntries(changesets, key);
              if (entries.length > 0) {
                const pkgConfig = ctx.config.packages.find(
                  (p) => p.path === pathFromKey(key),
                );
                const changelogDir = pkgConfig
                  ? path.resolve(ctx.cwd, pkgConfig.path)
                  : ctx.cwd;
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
        for (const [key, pkgVersion] of plan.packages) {
          if (isReleaseExcluded(ctx.config, pathFromKey(key))) continue;
          const pkgName = getPackageName(ctx, key);
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
          .map(([key, ver]) => `- ${getPackageName(ctx, key)}: ${ver}`)
          .join("\n")}`;
        task.output = t("task.version.creatingCommitGeneric");
        const commit = await git.commit(commitMsg);
        registerCommitRollback(ctx);

        // Create per-package tags
        task.output = t("task.version.creatingTags");
        for (const [key, pkgVersion] of plan.packages) {
          if (isReleaseExcluded(ctx.config, pathFromKey(key))) continue;
          const pkgName = getPackageName(ctx, key);
          const tag = `${pkgName}@${pkgVersion}`;
          await git.createTag(tag, commit);
          registerTagRollback(ctx, tag);
        }
      }
    },
  };
}
