import type { ConvertResult, ParsedMigrationConfig } from "./types.js";

const DEFAULT_TAG_FORMAT = "v${version}";

export function convertToPublishConfig(
  parsed: ParsedMigrationConfig,
  options?: { changesetFiles?: string[] },
): ConvertResult {
  const config: ConvertResult["config"] = {};
  const warnings: string[] = [];

  // Rule 1: git.branch → config.branch
  if (parsed.git?.branch !== undefined) {
    config.branch = parsed.git.branch;
  }

  // Rules 2–5: npm settings
  if (parsed.npm !== undefined) {
    const { publish, access, tag, publishPath } = parsed.npm;

    // Rule 2: npm.publish → packages
    config.packages = [{ path: ".", registries: publish ? ["npm"] : [] }];

    // Rule 3: npm.access → config.access
    if (access !== undefined) {
      config.access = access;
    }

    // Rule 4: npm.tag → config.tag
    if (tag !== undefined) {
      config.tag = tag;
    }

    // Rule 5: npm.publishPath → config.contents
    if (publishPath !== undefined) {
      config.contents = publishPath;
    }
  }

  // Rules 6–7: changelog settings
  if (parsed.changelog !== undefined) {
    // Rule 6: changelog.enabled → config.changelog
    config.changelog = parsed.changelog.enabled;

    // Rule 7: changelog.preset === "github" → changelogFormat = "github"
    if (parsed.changelog.preset === "github") {
      config.changelogFormat = "github";
    }
  }

  // Rules 8–9: github settings
  if (parsed.github !== undefined) {
    if (parsed.github.release === false) {
      // Rule 9: release=false → releaseDraft=false, releaseNotes=false
      config.releaseDraft = false;
      config.releaseNotes = false;
    } else if (parsed.github.draft !== undefined) {
      // Rule 8: github.draft → config.releaseDraft
      config.releaseDraft = parsed.github.draft;
    }
  }

  // Rule: ignore → config.ignore
  if (parsed.ignore !== undefined) {
    config.ignore = parsed.ignore;
  }

  // Rule: snapshotTemplate → config.snapshotTemplate
  if (parsed.snapshotTemplate !== undefined) {
    config.snapshotTemplate = parsed.snapshotTemplate;
  }

  // Rule: cleanInstall → config.validate.cleanInstall
  if (parsed.cleanInstall !== undefined) {
    config.validate = { cleanInstall: parsed.cleanInstall };
  }

  // Rule: anyBranch warning
  if (parsed.anyBranch === true) {
    warnings.push(
      "anyBranch was enabled — pubm enforces branch restrictions by default; remove git.branch to allow any branch",
    );
  }

  // Rules 10–12: monorepo settings
  if (parsed.monorepo !== undefined) {
    if (parsed.monorepo.fixed !== undefined) {
      config.fixed = parsed.monorepo.fixed;
    }
    if (parsed.monorepo.linked !== undefined) {
      config.linked = parsed.monorepo.linked;
    }
    if (parsed.monorepo.updateInternalDeps !== undefined) {
      config.updateInternalDependencies = parsed.monorepo.updateInternalDeps;
    }
  }

  // Rule: tests.script → warning (custom test script)
  if (parsed.tests?.script !== undefined) {
    warnings.push(
      `Custom test script "${parsed.tests.script}" — configure in packages[].testCommand`,
    );
  }

  // Rule 13: hooks → warnings
  if (parsed.hooks !== undefined) {
    for (const hook of parsed.hooks) {
      warnings.push(
        `Hook ${hook.lifecycle} requires manual conversion to pubm plugin`,
      );
    }
  }

  // Rules 14–15: prerelease warnings
  if (parsed.prerelease !== undefined) {
    if (parsed.prerelease.active) {
      warnings.push("Pre-release mode is active, complete before migrating");
    }
    if (parsed.prerelease.branches !== undefined) {
      for (const branch of parsed.prerelease.branches) {
        warnings.push(
          `Branch ${branch.name} has prerelease config — not yet supported`,
        );
      }
    }
  }

  // Rule 16: unmappable → warnings
  for (const item of parsed.unmappable) {
    warnings.push(`${item.key} — ${item.reason}`);
  }

  // Rule 17: git.commitMessage → warning
  if (parsed.git?.commitMessage !== undefined) {
    warnings.push("Custom commit message — pubm does not yet support");
  }

  // Rule 18: git.tagFormat (non-default) → warning
  if (
    parsed.git?.tagFormat !== undefined &&
    parsed.git.tagFormat !== DEFAULT_TAG_FORMAT
  ) {
    warnings.push(
      `Custom tag format "${parsed.git.tagFormat}" — pubm does not yet support custom tag format`,
    );
  }

  return {
    config,
    warnings,
    ...(options?.changesetFiles !== undefined
      ? { changesetFiles: options.changesetFiles }
      : {}),
  };
}
