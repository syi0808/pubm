import type { Task, TaskRunner } from "@pubm/runner";
import semver from "semver";

import type { PubmContext } from "../context.js";
import { t } from "../i18n/index.js";
import { defaultOptions } from "../options.js";
import { registryCatalog } from "../registry/catalog.js";
import { createListr } from "../utils/listr.js";
import { handleMultiPackage } from "./prompts/independent-mode.js";
import { handleSinglePackage } from "./prompts/single-package.js";

const { prerelease } = semver;

export const requiredMissingInformationTasks = (
  options?: Omit<Task<PubmContext>, "title" | "task">,
): TaskRunner<PubmContext> =>
  createListr<PubmContext>({
    ...options,
    title: t("task.info.checking"),
    task: (_, parentTask): TaskRunner<PubmContext> =>
      parentTask.newListr([
        {
          title: t("task.info.checkingVersion"),
          skip: (ctx) => !!ctx.runtime.versionPlan,
          task: async (ctx, task): Promise<void> => {
            const packages = ctx.config.packages;
            const isSinglePackage = packages.length <= 1;

            if (isSinglePackage) {
              await handleSinglePackage(ctx, task);
            } else {
              await handleMultiPackage(ctx, task, packages);
            }
          },
          exitOnError: true,
        },
        {
          title: t("task.info.checkingTag"),
          skip: (ctx) => {
            const plan = ctx.runtime.versionPlan;
            const ver = plan
              ? plan.mode === "independent"
                ? [...plan.packages.values()][0]
                : plan.version
              : undefined;
            return !ver
              ? true
              : !prerelease(`${ver}`) && ctx.runtime.tag === defaultOptions.tag;
          },
          task: async (ctx, task): Promise<void> => {
            const registryKeys = new Set(
              ctx.config.packages.flatMap((pkg) => pkg.registries ?? []),
            );
            const firstPkgPath = ctx.config.packages[0]?.path;
            const allDistTags: string[] = [];

            for (const key of registryKeys) {
              const descriptor = registryCatalog.get(key);
              if (!descriptor) continue;
              try {
                const registry = await descriptor.factory(firstPkgPath);
                allDistTags.push(...(await registry.distTags()));
              } catch {
                // Registry not yet published — ignore
              }
            }

            const distTags = [...new Set(allDistTags)].filter(
              (tag) => tag !== defaultOptions.tag,
            );

            if (distTags.length <= 0) distTags.push("next");

            let tag = await task.prompt().run<string>({
              type: "select",
              message: t("prompt.tag.selectPrerelease"),
              choices: distTags
                .map((distTag) => ({
                  message: distTag,
                  name: distTag,
                }))
                .concat([
                  {
                    message: t("prompt.tag.customTag"),
                    name: "specify",
                  },
                ]),
              name: "tag",
            });

            if (tag === "specify") {
              tag = await task.prompt().run<string>({
                type: "input",
                message: t("prompt.tag.enterTag"),
                name: "tag",
              });
            }

            ctx.runtime.tag = tag;
          },
          exitOnError: true,
        },
      ]),
  });
