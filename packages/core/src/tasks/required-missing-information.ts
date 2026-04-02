import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type Listr, type ListrTask } from "listr2";
import semver from "semver";

const { SemVer } = semver;
import type { VersionBump } from "../changeset/version.js";
import type { ResolvedPackageConfig } from "../config/types.js";
import type {
  FixedVersionPlan,
  IndependentVersionPlan,
  PubmContext,
} from "../context.js";
import { t } from "../i18n/index.js";
import { defaultOptions } from "../options.js";
import { registryCatalog } from "../registry/catalog.js";
import { filterConfigPackages } from "../utils/filter-config.js";
import { createListr } from "../utils/listr.js";
import { ui } from "../utils/ui.js";
import type { VersionRecommendation } from "../version-source/types.js";
import {
  type PackageNotes,
  buildDependencyBumpNote,
  displayRecommendationSummary,
  pluralize,
  renderPackageVersionSummary,
} from "./prompts/display.js";
import {
  analyzeAllSources,
  buildGraphFromPackages,
  buildReverseDeps,
  promptVersion,
  versionChoices,
} from "./prompts/version-choices.js";

const { prerelease } = semver;

export const requiredMissingInformationTasks = (
  options?: Omit<ListrTask<PubmContext>, "title" | "task">,
): Listr<PubmContext> =>
  createListr<PubmContext>({
    ...options,
    title: t("task.info.checking"),
    task: (_, parentTask): Listr<PubmContext> =>
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

            let tag = await task
              .prompt(ListrEnquirerPromptAdapter)
              .run<string>({
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
              tag = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
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

/**
 * Single package flow — backward compatible with original behavior.
 */
async function handleSinglePackage(
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

/**
 * Multi-package flow — unified summary with Accept/Edit/Skip.
 */
async function handleMultiPackage(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
): Promise<void> {
  const graph = buildGraphFromPackages(packageInfos);
  const currentVersions = new Map(packageInfos.map((p) => [p.path, p.version]));
  const recommendations = await analyzeAllSources(ctx);

  // CI mode: auto-accept
  if (!ctx.runtime.promptEnabled && recommendations.length > 0) {
    const packages = new Map<string, string>();
    for (const rec of recommendations) {
      const current = currentVersions.get(rec.packagePath);
      if (!current) continue;
      const newVer = semver.inc(current, rec.bumpType);
      if (newVer) packages.set(rec.packagePath, newVer);
    }
    ctx.runtime.versionPlan = buildVersionPlan(
      ctx.config.versioning ?? "independent",
      packages,
    );
    ctx.runtime.changesetConsumed = recommendations.some(
      (r) => r.source === "changeset",
    );
    return;
  }

  // Show summary
  if (recommendations.length > 0) {
    task.output = displayRecommendationSummary(recommendations);
  } else {
    task.output = "\n  No version recommendations found.\n";
  }

  // Action selection
  const prompt = task.prompt(ListrEnquirerPromptAdapter);
  const action = await prompt.run<string>({
    type: "select",
    message: t("task.info.selectVersion"),
    choices: [
      ...(recommendations.length > 0
        ? [
            {
              name: "accept",
              message: `Accept all recommendations (${recommendations.length} packages)`,
            },
          ]
        : []),
      { name: "edit", message: "Edit recommendations" },
      { name: "skip", message: "Skip version bump" },
    ],
    initial: 0,
  });

  if (action === "skip") return;

  let selectedVersions: Map<string, string>;

  if (action === "accept") {
    selectedVersions = new Map();
    for (const rec of recommendations) {
      const current = currentVersions.get(rec.packagePath);
      if (!current) continue;
      const newVer = semver.inc(current, rec.bumpType);
      if (newVer) selectedVersions.set(rec.packagePath, newVer);
    }
  } else {
    // Edit mode: delegate to existing manual flows
    const bumps = new Map<string, VersionBump>();
    for (const rec of recommendations) {
      const current = currentVersions.get(rec.packagePath);
      if (!current) continue;
      const newVer = semver.inc(current, rec.bumpType);
      if (newVer)
        bumps.set(rec.packagePath, {
          currentVersion: current,
          newVersion: newVer,
          bumpType: rec.bumpType,
        });
    }

    if (ctx.config.versioning === "fixed") {
      await handleFixedMode(ctx, task, packageInfos, currentVersions, bumps);
    } else {
      await handleIndependentMode(
        ctx,
        task,
        packageInfos,
        currentVersions,
        graph,
        bumps,
      );

      // Filter out packages where the selected version equals the current version.
      const plan = ctx.runtime.versionPlan;
      if (plan && plan.mode === "independent") {
        const publishPaths = new Set<string>();
        for (const [pkgPath, selectedVersion] of plan.packages) {
          if (selectedVersion !== (currentVersions.get(pkgPath) ?? "")) {
            publishPaths.add(pkgPath);
          }
        }
        plan.packages = new Map(
          [...plan.packages].filter(([p]) => publishPaths.has(p)),
        );
        filterConfigPackages(ctx, publishPaths);
      }
    }
    ctx.runtime.changesetConsumed = recommendations.some(
      (r) => r.source === "changeset",
    );
    return;
  }

  if (selectedVersions.size === 0) return;

  ctx.runtime.versionPlan = buildVersionPlan(
    ctx.config.versioning ?? "independent",
    selectedVersions,
  );
  ctx.runtime.changesetConsumed = recommendations.some(
    (r) => r.source === "changeset" && selectedVersions.has(r.packagePath),
  );
}

/**
 * Builds a FixedVersionPlan or IndependentVersionPlan based on the configured
 * versioning mode. In fixed mode, all packages are unified to the highest version.
 */
function buildVersionPlan(
  versioning: "fixed" | "independent",
  packages: Map<string, string>,
): FixedVersionPlan | IndependentVersionPlan {
  if (versioning === "fixed") {
    let highest = "0.0.0";
    for (const ver of packages.values()) {
      if (semver.gt(ver, highest)) highest = ver;
    }
    const unified = new Map<string, string>();
    for (const key of packages.keys()) {
      unified.set(key, highest);
    }
    return { mode: "fixed", version: highest, packages: unified };
  }
  return { mode: "independent", packages };
}

/**
 * Fixed mode: prompt once, apply to all packages.
 */
async function handleFixedMode(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  bumps?: Map<string, VersionBump>,
): Promise<void> {
  // Use the highest current version as the base
  let highestVersion = "0.0.0";
  for (const ver of currentVersions.values()) {
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
  for (const pkgPath of currentVersions.keys()) {
    packages.set(pkgPath, nextVersion);
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

/**
 * Independent mode: prompt per package with dependency cascade suggestions.
 */
async function handleIndependentMode(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  graph: Map<string, string[]>,
  bumps?: Map<string, VersionBump>,
): Promise<void> {
  const packageVersionByPath = new Map(
    packageInfos.map((pkg) => [pkg.path, pkg.version]),
  );
  // Path-to-name map for display purposes (notes show names, not paths)
  const pathToName = new Map(
    packageInfos.map((pkg) => [pkg.path, pkg.name || pkg.path]),
  );
  const reverseDeps = buildReverseDeps(graph);
  const versions = new Map<string, string>();
  const bumpedPackages = new Set<string>();
  let lastBumpType: string | undefined;

  for (const pkg of packageInfos) {
    const currentVersion = currentVersions.get(pkg.path) ?? pkg.version;

    // Check if a dependency was bumped — suggest patch bump for dependents
    const deps = graph.get(pkg.path) as string[];
    const bumpedDeps = deps.filter((dep) => bumpedPackages.has(dep));
    const notes: PackageNotes = new Map();
    const pkgNotes: string[] = [];

    if (bumpedDeps.length > 0) {
      // Show dependency names (not paths) in the note
      const bumpedDepNames = bumpedDeps.map(
        (dep) => pathToName.get(dep) ?? dep,
      );
      pkgNotes.push(buildDependencyBumpNote(currentVersion, bumpedDepNames));
    }

    const bump = bumps?.get(pkg.path);
    if (bump) {
      pkgNotes.push(
        ui.formatNote(
          "suggest",
          t("note.changeset.suggest", {
            bumpType: bump.bumpType,
            version: bump.newVersion,
          }),
        ),
      );
    }

    if (pkgNotes.length > 0) {
      notes.set(pkg.path, pkgNotes);
    }

    task.output = renderPackageVersionSummary(
      packageInfos,
      currentVersions,
      versions,
      {
        activePackage: pkg.path,
        notes,
      },
    );

    const result = await promptVersion(
      task,
      currentVersion,
      pkg.name,
      bump?.bumpType,
      lastBumpType,
    );
    versions.set(pkg.path, result.version);
    lastBumpType = result.bumpType;

    if (result.version !== currentVersion) {
      bumpedPackages.add(pkg.path);
    }
  }

  // After all versions selected, check for unbumped dependents of bumped packages
  const unbumpedDependents: string[] = [];
  for (const bumped of bumpedPackages) {
    const dependents = reverseDeps.get(bumped) as string[];
    for (const dependent of dependents) {
      if (!bumpedPackages.has(dependent)) {
        unbumpedDependents.push(dependent);
      }
    }
  }

  if (unbumpedDependents.length > 0) {
    const uniqueDependents = [...new Set(unbumpedDependents)];
    const notes: PackageNotes = new Map();

    for (const pkgPath of uniqueDependents) {
      const currentVersion =
        currentVersions.get(pkgPath) ??
        (packageVersionByPath.get(pkgPath) as string);
      const deps = (graph.get(pkgPath) as string[]).filter((d) =>
        bumpedPackages.has(d),
      );
      // Show dependency names (not paths) in the note
      const depNames = deps.map((d) => pathToName.get(d) ?? d);
      notes.set(pkgPath, [buildDependencyBumpNote(currentVersion, depNames)]);
    }

    task.output = renderPackageVersionSummary(
      packageInfos,
      currentVersions,
      versions,
      { notes },
    );

    const cascadeChoice = await task
      .prompt(ListrEnquirerPromptAdapter)
      .run<string>({
        type: "select",
        message: t("prompt.dependency.bumpPrompt"),
        choices: [
          { message: t("prompt.dependency.yesApplyPatch"), name: "patch" },
          { message: t("prompt.dependency.noKeepCurrent"), name: "skip" },
        ],
        name: "cascade",
      });

    if (cascadeChoice === "patch") {
      for (const pkgPath of uniqueDependents) {
        const currentVersion =
          currentVersions.get(pkgPath) ??
          (packageVersionByPath.get(pkgPath) as string);
        const patchVersion = new SemVer(currentVersion).inc("patch").toString();
        versions.set(pkgPath, patchVersion);
      }
    }
  }

  task.output = renderPackageVersionSummary(
    packageInfos,
    currentVersions,
    versions,
  );

  ctx.runtime.versionPlan = {
    mode: "independent",
    packages: versions,
  };
}
