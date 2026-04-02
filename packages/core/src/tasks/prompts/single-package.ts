import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import semver from "semver";

import type { PubmContext } from "../../context.js";
import { t } from "../../i18n/index.js";
import { displayRecommendationSummary, pluralize } from "./display.js";
import { analyzeAllSources, versionChoices } from "./version-choices.js";

/**
 * Single package flow — backward compatible with original behavior.
 */
export async function handleSinglePackage(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
): Promise<void> {
  const pkg = ctx.config.packages[0];
  const currentVersion = pkg?.version ?? "0.0.0";

  const recommendations = await analyzeAllSources(ctx);
  const rec = recommendations.find((r) => r.packagePath === (pkg?.path ?? ""));

  if (rec) {
    const newVer = semver.inc(currentVersion, rec.bumpType);
    if (newVer) {
      // CI mode: auto-accept
      if (!ctx.runtime.promptEnabled) {
        ctx.runtime.versionPlan = {
          mode: "single",
          version: newVer,
          packagePath: ctx.config.packages[0].path,
        };
        ctx.runtime.changesetConsumed = rec.source === "changeset";
        return;
      }

      task.output = displayRecommendationSummary([rec]);

      const choice = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
        type: "select",
        message: t("prompt.changeset.suggest", {
          current: currentVersion,
          next: newVer,
          bumpType: rec.bumpType,
          changesetLabel: pluralize(rec.entries.length, "changeset"),
        }),
        choices: [
          {
            message: t("prompt.changeset.accept", { version: newVer }),
            name: "accept",
          },
          {
            message: t("prompt.changeset.chooseDifferent"),
            name: "customize",
          },
        ],
        name: "version",
      });

      if (choice === "accept") {
        ctx.runtime.versionPlan = {
          mode: "single",
          version: newVer,
          packagePath: ctx.config.packages[0].path,
        };
        ctx.runtime.changesetConsumed = rec.source === "changeset";
        return;
      }
    }
  }

  // Fallback: manual version selection
  let nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
    type: "select",
    message: t("prompt.changeset.selectOrSpecify"),
    choices: versionChoices(currentVersion),
    name: "version",
  });

  if (nextVersion === "specify") {
    nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "input",
      message: t("prompt.version.enterVersionGeneric"),
      name: "version",
    });
  }

  ctx.runtime.versionPlan = {
    mode: "single",
    version: nextVersion,
    packagePath: ctx.config.packages[0].path,
  };
}
