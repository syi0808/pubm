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
import { createCiListrOptions, createListr } from "../utils/listr.js";
import { packageKey, pathFromKey } from "../utils/package-key.js";
import { getPackageManager } from "../utils/package-manager.js";
import { collectRegistries } from "../utils/registries.js";
import { generateSnapshotVersion } from "../utils/snapshot.js";
import { ui } from "../utils/ui.js";
import { prerequisitesCheckTask } from "./prerequisites-check.js";
import { requiredConditionsCheckTask } from "./required-conditions-check.js";
import { collectPublishTasks, writeVersions } from "./runner.js";
import { resolveWorkspaceProtocols } from "./runner-utils/manifest-handling.js";
import { formatVersionSummary } from "./runner-utils/output-formatting.js";

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

  // Prerequisites and conditions checks
  await prerequisitesCheckTask({ skip: false }).run(ctx);
  await requiredConditionsCheckTask({ skip: false }).run(ctx);

  const pipelineListrOptions = isCI
    ? createCiListrOptions<PubmContext>()
    : undefined;

  // Build snapshot version map
  const snapshotVersions: Map<string, string> =
    plan.mode === "single"
      ? new Map([[plan.packageKey, plan.version]])
      : plan.packages;

  // Original versions for restore
  const originalVersions = new Map(
    targetPackages.map((p) => [packageKey(p), p.version || "0.0.0"]),
  );

  try {
    await createListr<PubmContext>(
      [
        {
          skip: options.skipTests,
          title: t("task.test.title"),
          task: async (ctx, task): Promise<void> => {
            const packageManager = await getPackageManager();
            const command = `${packageManager} run ${ctx.options.testScript}`;
            task.title = t("task.test.titleWithCommand", { command });
            task.output = `Executing \`${command}\``;
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
        },
        {
          skip: options.skipBuild,
          title: t("task.build.title"),
          task: async (ctx, task): Promise<void> => {
            const packageManager = await getPackageManager();
            const command = `${packageManager} run ${ctx.options.buildScript}`;
            task.title = t("task.build.titleWithCommand", { command });
            task.output = `Executing \`${command}\``;
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
        },
        {
          title: t("task.snapshot.title"),
          task: async (ctx, task) => {
            const versionLabel =
              plan.mode !== "independent"
                ? (plan as SingleVersionPlan | FixedVersionPlan).version
                : `${snapshotVersions.size} packages`;

            task.title = t("task.snapshot.titleWithVersion", {
              version: versionLabel,
            });

            await writeVersions(ctx, snapshotVersions);
            await resolveWorkspaceProtocols(ctx);

            task.output = t("task.snapshot.publishing", { tag });
            const publishTasks = await collectPublishTasks(ctx);

            return task.newListr(publishTasks, {
              concurrent: true,
            });
          },
        },
        {
          title: t("task.snapshot.createTag"),
          enabled: !dryRun,
          task: async (ctx, task): Promise<void> => {
            const git = new Git();
            const headCommit = await git.latestCommit();

            if (plan.mode === "independent") {
              for (const [key, pkgVersion] of plan.packages) {
                const pkgName =
                  ctx.config.packages.find((p) => packageKey(p) === key)
                    ?.name ?? pathFromKey(key);
                const tagName = `${pkgName}@${pkgVersion}`;
                task.output = t("task.snapshot.creatingTag", { tag: tagName });
                await git.createTag(tagName, headCommit);
              }
            } else {
              const version = (plan as SingleVersionPlan | FixedVersionPlan)
                .version;
              const tagName = `v${version}`;
              task.output = t("task.snapshot.creatingTag", { tag: tagName });
              await git.createTag(tagName, headCommit);
            }

            task.output = t("task.snapshot.pushingTag", { tag: "tags" });
            await git.push("--tags");
            task.output = t("task.snapshot.tagPushed", { tag: "tags" });
          },
        },
      ],
      pipelineListrOptions,
    ).run(ctx);
  } finally {
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
