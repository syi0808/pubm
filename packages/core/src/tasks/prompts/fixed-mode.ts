import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type ListrTask } from "listr2";
import semver from "semver";

import type { VersionBump } from "../../changeset/version.js";
import type { ResolvedPackageConfig } from "../../config/types.js";
import type { PubmContext } from "../../context.js";
import { t } from "../../i18n/index.js";
import { packageKey } from "../../utils/package-key.js";
import { renderPackageVersionSummary } from "./display.js";
import { versionChoices } from "./version-choices.js";

/**
 * Fixed mode: prompt once, apply to all packages.
 */
export async function handleFixedMode(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  bumps?: Map<string, VersionBump>,
): Promise<void> {
  // Use the highest current version as the base
  const versionEntries = [...currentVersions.values()];
  let highestVersion = versionEntries[0] ?? "0.0.0";
  for (const ver of versionEntries.slice(1)) {
    if (semver.gt(ver, highestVersion)) {
      highestVersion = ver;
    }
  }

  // Find the highest bump type from changesets for marking
  let highestBumpType: string | undefined;
  if (bumps && bumps.size > 0) {
    const bumpPriority: Record<string, number> = {
      major: 3,
      minor: 2,
      patch: 1,
    };
    for (const bump of bumps.values()) {
      const priority = bumpPriority[bump.bumpType] ?? 0;
      const currentPriority = highestBumpType
        ? (bumpPriority[highestBumpType] ?? 0)
        : 0;
      if (priority > currentPriority) {
        highestBumpType = bump.bumpType;
      }
    }
  }

  let nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
    type: "select",
    message: t("prompt.version.selectForAll", {
      highestVersion: color.dim(`(highest current: ${highestVersion})`),
    }),
    choices: versionChoices(highestVersion, highestBumpType),
    name: "version",
  });

  if (nextVersion === "specify") {
    nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "input",
      message: t("prompt.version.enterVersionGeneric"),
      name: "version",
    });
  }

  const packages = new Map<string, string>();
  for (const pkg of packageInfos) {
    packages.set(packageKey(pkg), nextVersion);
  }
  ctx.runtime.versionPlan = {
    mode: "fixed",
    version: nextVersion,
    packages,
  };

  // Display uses path-keyed map for renderPackageVersionSummary
  const displayVersions = new Map<string, string>();
  for (const pkgPath of currentVersions.keys()) {
    displayVersions.set(pkgPath, nextVersion);
  }
  task.output = renderPackageVersionSummary(
    packageInfos,
    currentVersions,
    displayVersions,
  );
}
