import process from "node:process";
import { isCI } from "std-env";
import { createKeyResolver } from "../changeset/resolve.js";
import type { ResolvedPackageConfig } from "../config/types.js";
import type {
  FixedVersionPlan,
  IndependentVersionPlan,
  PubmContext,
  SingleVersionPlan,
  VersionPlan,
} from "../context.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";
import { t } from "../i18n/index.js";
import { restoreManifests } from "../monorepo/resolve-workspace.js";
import { registryCatalog } from "../registry/catalog.js";
import { exec } from "../utils/exec.js";
import { packageKey } from "../utils/package-key.js";
import { getPackageManager } from "../utils/package-manager.js";
import { collectRegistries } from "../utils/registries.js";
import { generateSnapshotVersion } from "../utils/snapshot.js";
import { ui } from "../utils/ui.js";
import {
  type ReleaseOperation,
  runReleaseOperations,
} from "../workflow/release-operation.js";
import {
  type CleanupRef,
  runCiPublishPluginCreds,
} from "../workflow/release-phases/preflight.js";
import {
  createPrerequisitesCheckOperation,
  createRequiredConditionsCheckOperation,
} from "../workflow/release-phases/preflight-checks.js";
import { collectPublishOperations } from "../workflow/release-phases/publish.js";
import { resolveWorkspaceProtocols } from "../workflow/release-utils/manifest-handling.js";
import { formatVersionSummary } from "../workflow/release-utils/output-formatting.js";
import { formatTag } from "../workflow/release-utils/rollback-handlers.js";
import { writeVersions } from "../workflow/release-utils/write-versions.js";

function chainCleanup(
  existing: (() => void) | undefined,
  next: () => void,
): () => void {
  return () => {
    existing?.();
    next();
  };
}

function createSnapshotTestOperation(skipTests?: boolean): ReleaseOperation {
  return {
    skip: skipTests,
    title: t("task.test.title"),
    run: async (ctx, operation): Promise<void> => {
      const packageManager = await getPackageManager();
      const command = `${packageManager} run ${ctx.options.testScript}`;
      operation.title = t("task.test.titleWithCommand", { command });
      operation.output = `Executing \`${command}\``;
      try {
        await exec(packageManager, ["run", ctx.options.testScript], {
          throwOnError: true,
        });
      } catch (error) {
        throw new AbstractError(
          t("error.test.failed", { script: ctx.options.testScript }),
          { cause: error },
        );
      }
    },
  };
}

function createSnapshotBuildOperation(skipBuild?: boolean): ReleaseOperation {
  return {
    skip: skipBuild,
    title: t("task.build.title"),
    run: async (ctx, operation): Promise<void> => {
      const packageManager = await getPackageManager();
      const command = `${packageManager} run ${ctx.options.buildScript}`;
      operation.title = t("task.build.titleWithCommand", { command });
      operation.output = `Executing \`${command}\``;
      try {
        await exec(packageManager, ["run", ctx.options.buildScript], {
          throwOnError: true,
        });
      } catch (error) {
        throw new AbstractError(
          t("error.build.failed", { script: ctx.options.buildScript }),
          { cause: error },
        );
      }
    },
  };
}

function createSnapshotPublishOperation(
  plan: VersionPlan,
  snapshotVersions: Map<string, string>,
  tag: string,
): ReleaseOperation {
  return {
    title: t("task.snapshot.title"),
    run: async (ctx, operation) => {
      const versionLabel =
        plan.mode !== "independent"
          ? (plan as SingleVersionPlan | FixedVersionPlan).version
          : `${snapshotVersions.size} packages`;

      operation.title = t("task.snapshot.titleWithVersion", {
        version: versionLabel,
      });

      await writeVersions(ctx, snapshotVersions);
      await resolveWorkspaceProtocols(ctx);

      operation.output = t("task.snapshot.publishing", { tag });
      const publishOperations = await collectPublishOperations(ctx);
      await operation.runOperations(publishOperations, {
        concurrent: true,
      });
    },
  };
}

function createSnapshotTagOperation(
  plan: VersionPlan,
  dryRun: boolean,
): ReleaseOperation {
  return {
    title: t("task.snapshot.createTag"),
    enabled: !dryRun,
    run: async (ctx, operation): Promise<void> => {
      const git = new Git();
      const headCommit = await git.latestCommit();
      const createdTags: string[] = [];

      if (plan.mode === "independent") {
        for (const [key, pkgVersion] of plan.packages) {
          const tagName = formatTag(ctx, key, pkgVersion);
          operation.output = t("task.snapshot.creatingTag", { tag: tagName });
          await git.createTag(tagName, headCommit);
          createdTags.push(tagName);
        }
      } else {
        const version = (plan as SingleVersionPlan | FixedVersionPlan).version;
        const tagName = `v${version}`;
        operation.output = t("task.snapshot.creatingTag", { tag: tagName });
        await git.createTag(tagName, headCommit);
        createdTags.push(tagName);
      }

      for (const tagName of createdTags) {
        operation.output = t("task.snapshot.pushingTag", { tag: tagName });
        await git.push("origin", `refs/tags/${tagName}`);
      }
      operation.output = t("task.snapshot.tagPushed", {
        tag: createdTags.join(", "),
      });
    },
  };
}

export function applySnapshotFilter(
  packages: ResolvedPackageConfig[],
  filters: string[] | undefined,
): ResolvedPackageConfig[] {
  if (!filters || filters.length === 0) return packages;

  const resolver = createKeyResolver(packages);
  const resolvedPaths = new Set(filters.map((f) => resolver(f)));
  const filtered = packages.filter((p) => resolvedPaths.has(packageKey(p)));

  if (filtered.length === 0) {
    throw new AbstractError(t("error.snapshot.noMatchingPackages"));
  }

  return filtered;
}

export interface SnapshotRunnerOptions {
  tag: string;
  filter?: string[];
  dryRun?: boolean;
  skipTests?: boolean;
  skipBuild?: boolean;
}

export function buildSnapshotVersionPlan(
  packages: ResolvedPackageConfig[],
  versioning: "fixed" | "independent",
  tag: string,
  template: string | undefined,
): VersionPlan {
  if (packages.length === 1) {
    const pkg = packages[0];
    const version = generateSnapshotVersion({
      baseVersion: pkg.version || "0.0.0",
      tag,
      template,
    });
    return {
      mode: "single",
      version,
      packageKey: packageKey(pkg),
    } satisfies SingleVersionPlan;
  }

  if (versioning !== "independent") {
    const baseVersion = packages[0].version || "0.0.0";
    const version = generateSnapshotVersion({
      baseVersion,
      tag,
      template,
    });
    const pkgMap = new Map(packages.map((p) => [packageKey(p), version]));
    return {
      mode: "fixed",
      version,
      packages: pkgMap,
    } satisfies FixedVersionPlan;
  }

  const pkgMap = new Map(
    packages.map((p) => [
      packageKey(p),
      generateSnapshotVersion({
        baseVersion: p.version || "0.0.0",
        tag,
        template,
      }),
    ]),
  );
  return {
    mode: "independent",
    packages: pkgMap,
  } satisfies IndependentVersionPlan;
}

export async function runSnapshotPipeline(
  ctx: PubmContext,
  options: SnapshotRunnerOptions,
): Promise<void> {
  const { tag, filter, dryRun = false } = options;

  ctx.runtime.promptEnabled = !isCI && !!process.stdin.isTTY;

  // Apply filter
  const targetPackages = applySnapshotFilter(ctx.config.packages, filter);

  // Build version plan
  const versioning = ctx.config.versioning ?? "fixed";
  const plan = buildSnapshotVersionPlan(
    targetPackages,
    versioning,
    tag,
    ctx.config.snapshotTemplate,
  );
  ctx.runtime.versionPlan = plan;
  ctx.runtime.tag = tag;

  await runReleaseOperations(ctx, createPrerequisitesCheckOperation(false));
  await runReleaseOperations(
    ctx,
    createRequiredConditionsCheckOperation(false),
  );

  // Build snapshot version map
  const snapshotVersions: Map<string, string> =
    plan.mode === "single"
      ? new Map([[plan.packageKey, plan.version]])
      : plan.packages;

  // Original versions for restore
  const originalVersions = new Map(
    targetPackages.map((p) => [packageKey(p), p.version || "0.0.0"]),
  );
  const cleanupRef: CleanupRef = { current: undefined };

  try {
    if (!ctx.runtime.promptEnabled) {
      await runCiPublishPluginCreds(ctx, chainCleanup, cleanupRef);
    }

    await runReleaseOperations(ctx, [
      createSnapshotTestOperation(options.skipTests),
      createSnapshotBuildOperation(options.skipBuild),
      createSnapshotPublishOperation(plan, snapshotVersions, tag),
      createSnapshotTagOperation(plan, dryRun),
    ]);
  } finally {
    cleanupRef.current?.();
    if (ctx.runtime.workspaceBackups?.size) {
      restoreManifests(ctx.runtime.workspaceBackups);
      ctx.runtime.workspaceBackups = undefined;
    }
    await writeVersions(ctx, originalVersions);
  }

  // Success message
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

  const versionDisplay = ui.chalk.blueBright(formatVersionSummary(ctx));

  console.log(
    `\n\n📸 ${t("task.snapshot.success", { parts: parts.join(", "), version: versionDisplay })} 📸\n`,
  );
}
