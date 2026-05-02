import path from "node:path";
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
import type { PubmContext, VersionPlan } from "../../context.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import { pathFromKey } from "../../utils/package-key.js";
import type { ReleaseOperationContext } from "../release-operation.js";
import { consumeChangesetsForScope } from "../release-utils/changeset-consume.js";
import {
  formatVersionPlan,
  formatVersionSummary,
} from "../release-utils/output-formatting.js";
import {
  registerChangelogBackup,
  registerChangesetBackups,
  registerManifestBackups,
  requireVersionPlan,
} from "../release-utils/rollback-handlers.js";
import { writeVersions } from "../release-utils/write-versions.js";
import {
  createWorkflowVersionMap,
  createWorkflowVersionStepOutputFromParts,
  createWorkflowVersionTagReferences,
  pinWorkflowVersionStepOutput,
  type WorkflowVersionTagReference,
} from "../version-step-output.js";

export interface PreparedVersionMaterialization {
  plan: VersionPlan;
  versionMap: [string, string][];
  tagReferences: WorkflowVersionTagReference[];
}

export async function prepareVersionMaterialization(
  ctx: PubmContext,
  task: ReleaseOperationContext,
): Promise<PreparedVersionMaterialization> {
  task.title = t("task.version.titleWithSummary", {
    summary: formatVersionSummary(ctx),
  });
  task.output = t("task.version.runningBeforeHooks");
  await ctx.runtime.pluginRunner.runHook("beforeVersion", ctx);
  const git = new Git();

  const plan = requireVersionPlan(ctx);
  const versionMap = createWorkflowVersionMap(ctx, plan);
  const plannedTagReferences = createWorkflowVersionTagReferences(ctx, plan);
  pinWorkflowVersionStepOutput(
    ctx,
    createWorkflowVersionStepOutputFromParts(
      ctx,
      plan,
      versionMap,
      plannedTagReferences,
    ),
  );

  task.output = formatVersionPlan(ctx);

  task.output = "Refreshing git index before version updates...";
  await git.reset();

  return {
    plan,
    versionMap,
    tagReferences: createWorkflowVersionTagReferences(ctx, plan, {
      strictQualifiedTags: true,
    }),
  };
}

export async function writeReleaseFiles(
  ctx: PubmContext,
  task: ReleaseOperationContext,
  prepared: PreparedVersionMaterialization,
  options: {
    dryRun: boolean;
    consumeChangesets?: "all" | "scope";
    packageKeys?: ReadonlySet<string>;
  },
): Promise<void> {
  if (options.dryRun) return;

  task.output =
    prepared.plan.mode === "single"
      ? "Updating package manifest versions..."
      : "Updating package versions across the workspace...";

  const git = new Git();

  registerManifestBackups(ctx);

  const replaced = await writeVersions(ctx, new Map(prepared.versionMap));

  for (const replacedFile of replaced) {
    await git.stage(replacedFile);
  }

  if (ctx.runtime.changesetConsumed) {
    task.output = "Applying changesets and generating changelog entries...";
    writeChangesetChangelogs(ctx, prepared.plan, options);
  }

  task.output = "Running plugin afterVersion hooks...";
  await ctx.runtime.pluginRunner.runHook("afterVersion", ctx);
  task.output = "Staging version updates...";
  await git.stage(".");
}

function writeChangesetChangelogs(
  ctx: PubmContext,
  plan: VersionPlan,
  options: {
    consumeChangesets?: "all" | "scope";
    packageKeys?: ReadonlySet<string>;
  },
): void {
  const resolver = createKeyResolver(ctx.config.packages);
  const changesets = readChangesets(ctx.cwd, resolver);
  if (changesets.length === 0) return;

  registerChangesetBackups(ctx, changesets);
  const selectedChangesets =
    options.consumeChangesets === "scope" && options.packageKeys
      ? consumeChangesetsForScope({
          cwd: ctx.cwd,
          packageKeys: options.packageKeys,
          resolver,
        }).consumed
      : changesets;

  if (plan.mode === "single") {
    const changelogPath = path.join(ctx.cwd, "CHANGELOG.md");
    registerChangelogBackup(ctx, changelogPath);

    const pkgPath = ctx.config.packages[0]?.path ?? "";
    const entries = buildChangelogEntries(selectedChangesets, pkgPath);
    const changelogContent = generateChangelog(plan.version, entries);
    writeChangelogToFile(ctx.cwd, changelogContent);
    if (options.consumeChangesets !== "scope") {
      deleteChangesetFiles(ctx.cwd, changesets);
    }
    return;
  }

  if (plan.mode === "fixed") {
    const changelogPath = path.join(ctx.cwd, "CHANGELOG.md");
    registerChangelogBackup(ctx, changelogPath);

    const allEntries = deduplicateEntries(
      [...plan.packages.keys()].flatMap((key) =>
        buildChangelogEntries(selectedChangesets, key),
      ),
    );
    if (allEntries.length > 0) {
      const changelogContent = generateChangelog(plan.version, allEntries);
      writeChangelogToFile(ctx.cwd, changelogContent);
    }
    if (options.consumeChangesets !== "scope") {
      deleteChangesetFiles(ctx.cwd, changesets);
    }
    return;
  }

  for (const [key] of plan.packages) {
    const changelogPath = path.join(
      independentChangelogDir(ctx, key),
      "CHANGELOG.md",
    );
    registerChangelogBackup(ctx, changelogPath);
  }

  for (const [key, pkgVersion] of plan.packages) {
    const entries = buildChangelogEntries(selectedChangesets, key);
    if (entries.length === 0) continue;

    writeChangelogToFile(
      independentChangelogDir(ctx, key),
      generateChangelog(pkgVersion, entries),
    );
  }

  if (options.consumeChangesets !== "scope") {
    deleteChangesetFiles(ctx.cwd, changesets);
  }
}

function independentChangelogDir(ctx: PubmContext, key: string): string {
  const pkgConfig = ctx.config.packages.find(
    (p) => p.path === pathFromKey(key),
  );
  return pkgConfig ? path.resolve(ctx.cwd, pkgConfig.path) : ctx.cwd;
}
