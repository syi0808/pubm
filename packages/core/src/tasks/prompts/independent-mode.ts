import type { TaskContext } from "@pubm/runner";
import semver from "semver";

const { SemVer } = semver;

import { isCI } from "std-env";
import type { VersionBump } from "../../changeset/version.js";
import type { ResolvedPackageConfig } from "../../config/types.js";
import type {
  FixedVersionPlan,
  IndependentVersionPlan,
  PubmContext,
} from "../../context.js";
import { t } from "../../i18n/index.js";
import { filterConfigPackages } from "../../utils/filter-config.js";
import { packageKey } from "../../utils/package-key.js";
import { ui } from "../../utils/ui.js";
import {
  buildDependencyBumpNote,
  displayRecommendationSummary,
  type PackageNotes,
  renderPackageVersionSummary,
} from "./display.js";
import { handleFixedMode } from "./fixed-mode.js";
import {
  analyzeAllSources,
  buildGraphFromPackages,
  buildReverseDeps,
  promptVersion,
} from "./version-choices.js";

/**
 * Builds a FixedVersionPlan or IndependentVersionPlan based on the configured
 * versioning mode. In fixed mode, all packages are unified to the highest version.
 */
export function buildVersionPlan(
  versioning: "fixed" | "independent",
  packages: Map<string, string>,
): FixedVersionPlan | IndependentVersionPlan {
  if (versioning === "fixed") {
    const versionEntries = [...packages.values()];
    let highest = versionEntries[0] ?? "0.0.0";
    for (const ver of versionEntries.slice(1)) {
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
 * Multi-package flow — unified summary with Accept/Edit/Skip.
 */
export async function handleMultiPackage(
  ctx: PubmContext,
  task: TaskContext<PubmContext>,
  packageInfos: ResolvedPackageConfig[],
): Promise<void> {
  const graph = buildGraphFromPackages(packageInfos);
  const currentVersions = new Map(packageInfos.map((p) => [p.path, p.version]));
  const pathToKeys = new Map<string, string[]>();
  for (const p of packageInfos) {
    const existing = pathToKeys.get(p.path) ?? [];
    existing.push(packageKey(p));
    pathToKeys.set(p.path, existing);
  }
  const recommendations = await analyzeAllSources(ctx);
  const packageMatchesRecommendation = (
    pkg: ResolvedPackageConfig,
    rec: { packagePath: string; packageKey?: string },
  ) =>
    rec.packageKey
      ? packageKey(pkg) === rec.packageKey
      : pkg.path === rec.packagePath;
  const recommendationKeys = (rec: {
    packagePath: string;
    packageKey?: string;
  }): string[] =>
    rec.packageKey
      ? [rec.packageKey]
      : (pathToKeys.get(rec.packagePath) ?? [rec.packagePath]);

  // CI mode: auto-accept
  if (isCI && recommendations.length > 0) {
    const packages = new Map<string, string>();
    for (const rec of recommendations) {
      const matchingPkgs = packageInfos.filter((p) =>
        packageMatchesRecommendation(p, rec),
      );
      for (const pkg of matchingPkgs) {
        const newVer = semver.inc(pkg.version, rec.bumpType);
        if (newVer) {
          packages.set(packageKey(pkg), newVer);
        }
      }
    }
    ctx.runtime.versionPlan = buildVersionPlan(
      ctx.config.versioning ?? "independent",
      packages,
    );
    ctx.runtime.changesetConsumed = recommendations.some((r) => {
      const keys = recommendationKeys(r);
      return r.source === "changeset" && keys.some((k) => packages.has(k));
    });
    return;
  }

  // Show summary
  if (recommendations.length > 0) {
    task.output = displayRecommendationSummary(recommendations);
  } else {
    task.output = "\n  No version recommendations found.\n";
  }

  // Action selection
  const prompt = task.prompt();
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
      const matchingPkgs = packageInfos.filter((p) =>
        packageMatchesRecommendation(p, rec),
      );
      for (const pkg of matchingPkgs) {
        const newVer = semver.inc(pkg.version, rec.bumpType);
        if (newVer) {
          selectedVersions.set(packageKey(pkg), newVer);
        }
      }
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
        const currentVersionsByKey = new Map(
          packageInfos.map((p) => [packageKey(p), p.version]),
        );
        const publishKeys = new Set<string>();
        for (const [key, selectedVersion] of plan.packages) {
          if (selectedVersion !== (currentVersionsByKey.get(key) ?? "")) {
            publishKeys.add(key);
          }
        }
        plan.packages = new Map(
          [...plan.packages].filter(([k]) => publishKeys.has(k)),
        );
        filterConfigPackages(ctx, publishKeys);
      }
    }
    const plan = ctx.runtime.versionPlan;
    ctx.runtime.changesetConsumed = recommendations.some((r) => {
      if (r.source !== "changeset" || !plan || !("packages" in plan))
        return false;
      const keys = recommendationKeys(r);
      return keys.some((k) => plan.packages.has(k));
    });
    return;
  }

  if (selectedVersions.size === 0) return;

  ctx.runtime.versionPlan = buildVersionPlan(
    ctx.config.versioning ?? "independent",
    selectedVersions,
  );
  ctx.runtime.changesetConsumed = recommendations.some((r) => {
    const keys = recommendationKeys(r);
    return (
      r.source === "changeset" && keys.some((k) => selectedVersions.has(k))
    );
  });
}

/**
 * Independent mode: prompt per package with dependency cascade suggestions.
 */
export async function handleIndependentMode(
  ctx: PubmContext,
  task: TaskContext<PubmContext>,
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
    const deps = graph.get(pkg.path) ?? [];
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
    versions.set(packageKey(pkg), result.version);
    lastBumpType = result.bumpType;

    if (result.version !== currentVersion) {
      bumpedPackages.add(pkg.path);
    }
  }

  // After all versions selected, check for unbumped dependents of bumped packages
  const unbumpedDependents: string[] = [];
  for (const bumped of bumpedPackages) {
    const dependents = reverseDeps.get(bumped) ?? [];
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
      const deps = (graph.get(pkgPath) ?? []).filter((d) =>
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

    const cascadeChoice = await task.prompt().run<string>({
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
        const pkgs = packageInfos.filter((p) => p.path === pkgPath);
        for (const pkg of pkgs) {
          const currentVersion = pkg.version;
          const patchVersion = new SemVer(currentVersion)
            .inc("patch")
            .toString();
          versions.set(packageKey(pkg), patchVersion);
        }
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
