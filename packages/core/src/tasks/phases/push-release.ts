import { rmSync } from "node:fs";
import process from "node:process";
import type { Task } from "@pubm/runner";
import SemVer from "semver";
import type { PubmContext } from "../../context.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import {
  resolveGitHubToken,
  saveGitHubToken,
} from "../../utils/github-token.js";
import { openUrl } from "../../utils/open-url.js";
import { pathFromKey } from "../../utils/package-key.js";
import { ui } from "../../utils/ui.js";
import { createGitHubRelease, deleteGitHubRelease } from "../github-release.js";
import { buildReleaseBody, truncateForUrl } from "../release-notes.js";
import { prepareReleaseAssets } from "../runner-utils/manifest-handling.js";
import { formatVersionSummary } from "../runner-utils/output-formatting.js";
import {
  getPackageName,
  isReleaseExcluded,
  registerRemoteTagRollback,
  requireVersionPlan,
} from "../runner-utils/rollback-handlers.js";
import { pushViaPr } from "../runner-utils/version-pr.js";

const { prerelease } = SemVer;

export function createPushTask(
  hasPrepare: boolean,
  dryRun: boolean,
): Task<PubmContext> {
  return {
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
  };
}

export function createReleaseTask(
  hasPublish: boolean,
  dryRun: boolean,
  mode: string,
  skipReleaseDraft: boolean,
): Task<PubmContext> {
  return {
    enabled: hasPublish && !skipReleaseDraft && !dryRun,
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
        const answer = await task.prompt().run<string>({
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
          const token = await task.prompt().run<string>({
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
          for (const [key, pkgVersion] of plan.packages) {
            const pkgPath = pathFromKey(key);
            if (isReleaseExcluded(ctx.config, pkgPath)) continue;
            const pkgName = getPackageName(ctx, key);
            const tag = `${pkgName}@${pkgVersion}`;
            task.output = t("task.release.creating", { tag });

            const git = new Git();
            const repositoryUrl = (await git.repository())
              .replace(/^git@github\.com:/, "https://github.com/")
              .replace(/\.git$/, "");

            const body = await buildReleaseBody(ctx, {
              pkgPath,
              version: pkgVersion,
              tag,
              repositoryUrl,
            });

            const { assets: preparedAssets, tempDir } =
              await prepareReleaseAssets(ctx, pkgName, pkgVersion, pkgPath);
            const result = await createGitHubRelease(ctx, {
              displayLabel: pkgName,
              version: pkgVersion,
              tag,
              body,
              assets: preparedAssets,
              draft: !!ctx.options.releaseDraft,
            });
            if (result) {
              if (result.releaseId) {
                const releaseId = result.releaseId;
                ctx.runtime.rollback.add({
                  label: t("task.release.deleteRelease", { tag }),
                  fn: async () => {
                    await deleteGitHubRelease(releaseId);
                  },
                });
              }
              // Additional upload targets (plugin hooks)
              const assetHooks = ctx.runtime.pluginRunner.collectAssetHooks();
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
              await ctx.runtime.pluginRunner.runAfterReleaseHook(ctx, result);
            } else {
              task.output = t("task.release.alreadyExists", { tag });
            }
            if (tempDir) rmSync(tempDir, { recursive: true, force: true });
          }
        } else {
          // Single or fixed: one release
          const version = plan.version;
          const tag = `v${version}`;
          task.output = t("task.release.creating", { tag });

          const git = new Git();
          const repositoryUrl = (await git.repository())
            .replace(/^git@github\.com:/, "https://github.com/")
            .replace(/\.git$/, "");

          const body = await buildReleaseBody(ctx, {
            pkgPath:
              plan.mode === "single" ? pathFromKey(plan.packageKey) : undefined,
            version,
            tag,
            repositoryUrl,
          });

          const packageName =
            plan.mode === "single"
              ? getPackageName(ctx, plan.packageKey)
              : (ctx.config.packages[0]?.name ?? "");
          const pkgPath =
            plan.mode === "single"
              ? pathFromKey(plan.packageKey)
              : ctx.config.packages[0]?.path;
          const { assets: preparedAssets, tempDir } =
            await prepareReleaseAssets(ctx, packageName, version, pkgPath);
          const result = await createGitHubRelease(ctx, {
            displayLabel: packageName,
            version,
            tag,
            body,
            assets: preparedAssets,
            draft: !!ctx.options.releaseDraft,
          });
          if (result) {
            const assetHooks = ctx.runtime.pluginRunner.collectAssetHooks();
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
            task.output = t("task.release.created", { url: result.releaseUrl });
            if (result.releaseId) {
              const releaseId = result.releaseId;
              ctx.runtime.rollback.add({
                label: t("task.release.deleteRelease", { tag }),
                fn: async () => {
                  await deleteGitHubRelease(releaseId);
                },
              });
            }
            await ctx.runtime.pluginRunner.runAfterReleaseHook(ctx, result);
          } else {
            task.output = t("task.release.alreadyExists", { tag });
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

        const repositoryUrl = (await git.repository())
          .replace(/^git@github\.com:/, "https://github.com/")
          .replace(/\.git$/, "");

        if (plan.mode === "independent") {
          let first = true;
          for (const [key, pkgVersion] of plan.packages) {
            const pkgPath = pathFromKey(key);
            if (isReleaseExcluded(ctx.config, pkgPath)) continue;
            const pkgName = getPackageName(ctx, key);
            const tag = `${pkgName}@${pkgVersion}`;

            const body = await buildReleaseBody(ctx, {
              pkgPath,
              version: pkgVersion,
              tag,
              repositoryUrl,
            });

            const releaseDraftUrl = new URL(`${repositoryUrl}/releases/new`);
            releaseDraftUrl.searchParams.set("tag", tag);
            releaseDraftUrl.searchParams.set(
              "prerelease",
              `${!!prerelease(pkgVersion)}`,
            );

            const baseUrl = `${releaseDraftUrl.toString()}&body=`;
            const truncated = await truncateForUrl(body, baseUrl);
            releaseDraftUrl.searchParams.set("body", truncated.body);

            const linkUrl = ui.link(tag, releaseDraftUrl.toString());
            task.title += ` ${linkUrl}`;

            if (first) {
              const openingMsg = t("task.release.openingDraft", { tag });
              if (truncated.clipboardCopied) {
                task.output = `${t("task.release.copiedToClipboard")}\n${openingMsg}`;
              } else if (truncated.truncated) {
                task.output = `${t("task.release.truncated")}\n${openingMsg}`;
              } else {
                task.output = openingMsg;
              }
              await openUrl(releaseDraftUrl.toString());
              first = false;
            }
          }
        } else {
          const version = plan.version;
          const tag = `v${version}`;

          const body = await buildReleaseBody(ctx, {
            pkgPath:
              plan.mode === "single" ? pathFromKey(plan.packageKey) : undefined,
            version,
            tag,
            repositoryUrl,
          });

          const releaseDraftUrl = new URL(`${repositoryUrl}/releases/new`);
          releaseDraftUrl.searchParams.set("tag", tag);
          releaseDraftUrl.searchParams.set(
            "prerelease",
            `${!!prerelease(version)}`,
          );

          const baseUrl = `${releaseDraftUrl.toString()}&body=`;
          const truncated = await truncateForUrl(body, baseUrl);
          releaseDraftUrl.searchParams.set("body", truncated.body);

          const linkUrl = ui.link("Link", releaseDraftUrl.toString());
          task.title += ` ${linkUrl}`;
          const openingMsg = t("task.release.openingDraft", { tag });
          if (truncated.clipboardCopied) {
            task.output = `${t("task.release.copiedToClipboard")}\n${openingMsg}`;
          } else if (truncated.truncated) {
            task.output = `${t("task.release.truncated")}\n${openingMsg}`;
          } else {
            task.output = openingMsg;
          }
          await openUrl(releaseDraftUrl.toString());
        }
      }
    },
  };
}
