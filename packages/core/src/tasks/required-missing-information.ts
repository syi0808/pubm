import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type Listr, type ListrTask } from "listr2";
import semver from "semver";
import { getStatus } from "../changeset/status.js";
import type { VersionBump } from "../changeset/version.js";
import { calculateVersionBumps } from "../changeset/version.js";
import type { ResolvedPackageConfig } from "../config/types.js";
import type { PubmContext } from "../context.js";
import { defaultOptions } from "../options.js";
import { registryCatalog } from "../registry/catalog.js";
import { createListr } from "../utils/listr.js";

const { RELEASE_TYPES, SemVer, prerelease } = semver;

type PackageNotes = Map<string, string[]>;

function pluralize(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

function formatPackageVersionSummary(
  currentVersion: string,
  selectedVersion?: string,
): string {
  const current = color.dim(`v${currentVersion}`);

  if (!selectedVersion || selectedVersion === currentVersion) {
    return current;
  }

  return `${current} -> ${color.dim(`v${selectedVersion}`)}`;
}

function buildDependencyBumpNote(
  currentVersion: string,
  bumpedDependencies: string[],
): string {
  const suggestedVersion = new SemVer(currentVersion).inc("patch").toString();
  const dependencyLabel =
    bumpedDependencies.length === 1 ? "dependency" : "dependencies";

  return `💡 ${dependencyLabel} ${bumpedDependencies.join(", ")} bumped, suggest at least patch -> ${suggestedVersion}`;
}

function renderPackageVersionSummary(
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  selectedVersions: Map<string, string>,
  options: {
    activePackage?: string;
    notes?: PackageNotes;
  } = {},
): string {
  const lines = ["Packages:"];

  for (const pkg of packageInfos) {
    const currentVersion = currentVersions.get(pkg.name) ?? pkg.version;
    const selectedVersion = selectedVersions.get(pkg.name);
    const prefix = options.activePackage === pkg.name ? "> " : "  ";

    lines.push(
      `${prefix}${pkg.name}  ${formatPackageVersionSummary(currentVersion, selectedVersion)}`,
    );

    for (const note of options.notes?.get(pkg.name) ?? []) {
      lines.push(`    ${note}`);
    }
  }

  return lines.join("\n");
}

function versionChoices(currentVersion: string, recommendedBumpType?: string) {
  return [
    {
      message: `Keep current version ${color.dim(currentVersion)}`,
      name: currentVersion,
    },
    ...RELEASE_TYPES.map((releaseType) => {
      const increasedVersion = new SemVer(currentVersion)
        .inc(releaseType)
        .toString();
      const marker =
        recommendedBumpType === releaseType
          ? ` ${color.dim("← recommended by changesets")}`
          : "";
      return {
        message: `${releaseType} ${color.dim(increasedVersion)}${marker}`,
        name: increasedVersion,
      };
    }),
    { message: "Custom version (specify)", name: "specify" },
  ];
}

async function promptVersion(
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  currentVersion: string,
  label: string,
  recommendedBumpType?: string,
  initialBumpType?: string,
): Promise<{ version: string; bumpType: string | undefined }> {
  const initial = initialBumpType
    ? RELEASE_TYPES.indexOf(initialBumpType as semver.ReleaseType) + 1
    : 0;

  let nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
    type: "select",
    message: `Select SemVer increment for ${label} ${color.dim(`(current: ${currentVersion})`)}`,
    choices: versionChoices(currentVersion, recommendedBumpType),
    initial,
    name: "version",
  });

  if (nextVersion === "specify") {
    nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "input",
      message: `Version for ${label}`,
      name: "version",
    });
    return { version: nextVersion, bumpType: undefined };
  }

  // Determine which bump type was selected
  const bumpType = RELEASE_TYPES.find(
    (rt) => new SemVer(currentVersion).inc(rt).toString() === nextVersion,
  );

  return { version: nextVersion, bumpType };
}

/**
 * Build a reverse dependency map: for each package, which packages depend on it.
 */
function buildReverseDeps(graph: Map<string, string[]>): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const name of graph.keys()) {
    reverse.set(name, []);
  }
  for (const [pkg, deps] of graph) {
    for (const dep of deps) {
      const list = reverse.get(dep);
      if (list) list.push(pkg);
    }
  }
  return reverse;
}

/**
 * Build a dependency graph from ResolvedPackageConfig[] where dependencies
 * are already resolved as internal dependency names.
 */
function buildGraphFromPackages(
  packages: ResolvedPackageConfig[],
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const pkg of packages) {
    graph.set(pkg.name, [...pkg.dependencies]);
  }
  return graph;
}

export const requiredMissingInformationTasks = (
  options?: Omit<ListrTask<PubmContext>, "title" | "task">,
): Listr<PubmContext> =>
  createListr<PubmContext>({
    ...options,
    title: "Checking required information",
    task: (_, parentTask): Listr<PubmContext> =>
      parentTask.newListr([
        {
          title: "Checking version information",
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
          title: "Checking tag information",
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
                message: "Select the tag for this pre-release version in npm",
                choices: distTags
                  .map((distTag) => ({
                    message: distTag,
                    name: distTag,
                  }))
                  .concat([
                    {
                      message: "Custom version (specify)",
                      name: "specify",
                    },
                  ]),
                name: "tag",
              });

            if (tag === "specify") {
              tag = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
                type: "input",
                message: "Tag",
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
  const pkgName = pkg?.name ?? "";
  const cwd = ctx.cwd ?? process.cwd();

  // Check for pending changesets
  const status = getStatus(cwd);

  if (status.hasChangesets) {
    const currentVersions = new Map([[pkgName, currentVersion]]);
    const bumps = calculateVersionBumps(currentVersions, cwd);
    const bump = bumps.get(pkgName);

    if (bump) {
      const pkgStatus = status.packages.get(pkgName);
      const changesetCount = pkgStatus?.changesetCount ?? 0;
      const changesetLabel = pluralize(changesetCount, "changeset");

      const choice = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
        type: "select",
        message: `Changesets suggest: ${currentVersion} → ${bump.newVersion} (${bump.bumpType}, ${changesetLabel})`,
        choices: [
          {
            message: `Accept ${bump.newVersion}`,
            name: "accept",
          },
          {
            message: "Choose a different version",
            name: "customize",
          },
        ],
        name: "version",
      });

      if (choice === "accept") {
        ctx.runtime.version = bump.newVersion;
        ctx.runtime.versionPlan = {
          mode: "single",
          version: bump.newVersion,
          packageName: ctx.config.packages[0].name,
        };
        ctx.runtime.changesetConsumed = true;
        return;
      }
    }
  }

  // Fallback: manual version selection
  let nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
    type: "select",
    message: "Select SemVer increment or specify new version",
    choices: versionChoices(currentVersion),
    name: "version",
  });

  if (nextVersion === "specify") {
    nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "input",
      message: "Version",
      name: "version",
    });
  }

  ctx.runtime.version = nextVersion;
  ctx.runtime.versionPlan = {
    mode: "single",
    version: nextVersion,
    packageName: ctx.config.packages[0].name,
  };
}

function sortPackageInfosByDependency(
  packageInfos: ResolvedPackageConfig[],
  graph: Map<string, string[]>,
): ResolvedPackageConfig[] {
  // Compute depth: 0 = no internal dependencies (base packages), higher = depends on deeper packages
  const depths = new Map<string, number>();

  function getDepth(name: string, visited: Set<string>): number {
    if (depths.has(name)) return depths.get(name) as number;
    if (visited.has(name)) return 0;
    visited.add(name);
    const deps = graph.get(name) ?? [];
    const depth =
      deps.length === 0
        ? 0
        : Math.max(...deps.map((d) => getDepth(d, visited))) + 1;
    depths.set(name, depth);
    return depth;
  }

  for (const name of graph.keys()) {
    getDepth(name, new Set());
  }

  // Sort by depth ascending (dependencies first). Array.sort is stable,
  // so packages at the same depth keep their original order.
  return [...packageInfos].sort(
    (a, b) => (depths.get(a.name) ?? 0) - (depths.get(b.name) ?? 0),
  );
}

/**
 * Multi-package flow — changeset recommendations, sync/independent, dependency cascade.
 */
async function handleMultiPackage(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
): Promise<void> {
  const cwd = ctx.cwd ?? process.cwd();
  const currentVersions = new Map(packageInfos.map((p) => [p.name, p.version]));
  const status = getStatus(cwd);

  // Build dependency graph and sort packages
  const graph = buildGraphFromPackages(packageInfos);
  const sortedPackageInfos = sortPackageInfosByDependency(packageInfos, graph);

  task.output = renderPackageVersionSummary(
    sortedPackageInfos,
    currentVersions,
    new Map(),
  );

  // Try changeset-based recommendations first
  let bumps: Map<string, VersionBump> | undefined;
  if (status.hasChangesets) {
    bumps = calculateVersionBumps(currentVersions, cwd);

    if (bumps.size > 0) {
      const accepted = await promptChangesetRecommendations(
        ctx,
        task,
        status,
        bumps,
        sortedPackageInfos,
      );
      if (accepted) return;
    }
  }

  // Manual flow
  await handleManualMultiPackage(
    ctx,
    task,
    sortedPackageInfos,
    currentVersions,
    graph,
    bumps,
    status,
  );
}

/**
 * Show changeset recommendations for all affected packages and prompt accept/customize.
 */
async function promptChangesetRecommendations(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  status: ReturnType<typeof getStatus>,
  bumps: Map<string, VersionBump>,
  sortedPackageInfos: ResolvedPackageConfig[],
): Promise<boolean> {
  const lines: string[] = ["Changesets suggest:"];

  for (const pkg of sortedPackageInfos) {
    const bump = bumps.get(pkg.name);
    if (!bump) continue;
    const pkgStatus = status.packages.get(pkg.name);
    const changesetCount = pkgStatus?.changesetCount ?? 0;
    const changesetLabel = pluralize(changesetCount, "changeset");
    lines.push(
      `  ${pkg.name}  ${bump.currentVersion} → ${bump.newVersion} (${bump.bumpType}: ${changesetLabel})`,
    );
  }

  task.output = lines.join("\n");

  const choice = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
    type: "select",
    message: "Accept changeset recommendations?",
    choices: [
      { message: "Accept all", name: "accept" },
      { message: "Customize versions", name: "customize" },
    ],
    name: "version",
  });

  if (choice === "accept") {
    const versions = new Map<string, string>();
    for (const [name, bump] of bumps) {
      versions.set(name, bump.newVersion);
    }
    ctx.runtime.versions = versions;
    ctx.runtime.versionPlan = {
      mode: "independent",
      packages: versions,
    };
    ctx.runtime.changesetConsumed = true;
    return true;
  }

  return false;
}

/**
 * Manual multi-package flow: determine sync strategy, then prompt for versions.
 */
function buildChangesetNotes(
  packageInfos: ResolvedPackageConfig[],
  bumps: Map<string, VersionBump>,
  status: ReturnType<typeof getStatus>,
): PackageNotes {
  const notes: PackageNotes = new Map();
  for (const pkg of packageInfos) {
    const bump = bumps.get(pkg.name);
    if (!bump) continue;
    const pkgStatus = status.packages.get(pkg.name);
    const changesetCount = pkgStatus?.changesetCount ?? 0;
    const changesetLabel = pluralize(changesetCount, "changeset");
    notes.set(pkg.name, [
      `📦 ${changesetLabel} suggests ${bump.bumpType} -> ${bump.newVersion}`,
    ]);
  }
  return notes;
}

async function handleManualMultiPackage(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  graph: Map<string, string[]>,
  bumps?: Map<string, VersionBump>,
  status?: ReturnType<typeof getStatus>,
): Promise<void> {
  const changesetNotes =
    bumps && status
      ? buildChangesetNotes(packageInfos, bumps, status)
      : undefined;

  task.output = renderPackageVersionSummary(
    packageInfos,
    currentVersions,
    new Map(),
    { notes: changesetNotes },
  );

  let mode: "fixed" | "independent";

  if (ctx.config.versioning) {
    mode = ctx.config.versioning;
  } else {
    const choice = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "select",
      message: "How should packages be versioned?",
      choices: [
        {
          message: "Fixed (all packages get same version)",
          name: "fixed",
        },
        {
          message: "Independent (per-package versions)",
          name: "independent",
        },
      ],
      name: "mode",
    });
    mode = choice as "fixed" | "independent";
  }

  if (mode === "fixed") {
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
  }
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
    message: `Select version for all packages ${color.dim(`(highest current: ${highestVersion})`)}`,
    choices: versionChoices(highestVersion, highestBumpType),
    name: "version",
  });

  if (nextVersion === "specify") {
    nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "input",
      message: "Version",
      name: "version",
    });
  }

  const packages = new Map<string, string>();
  for (const name of currentVersions.keys()) {
    packages.set(name, nextVersion);
  }
  ctx.runtime.version = nextVersion;
  ctx.runtime.versions = packages;
  ctx.runtime.versionPlan = {
    mode: "fixed",
    version: nextVersion,
    packages,
  };

  task.output = renderPackageVersionSummary(
    packageInfos,
    currentVersions,
    packages,
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
  const packageVersionByName = new Map(
    packageInfos.map((pkg) => [pkg.name, pkg.version]),
  );
  const reverseDeps = buildReverseDeps(graph);
  const versions = new Map<string, string>();
  const bumpedPackages = new Set<string>();
  let lastBumpType: string | undefined;

  for (const pkg of packageInfos) {
    const currentVersion = currentVersions.get(pkg.name) ?? pkg.version;

    // Check if a dependency was bumped — suggest patch bump for dependents
    const deps = graph.get(pkg.name) as string[];
    const bumpedDeps = deps.filter((dep) => bumpedPackages.has(dep));
    const notes: PackageNotes = new Map();
    const pkgNotes: string[] = [];

    if (bumpedDeps.length > 0) {
      pkgNotes.push(buildDependencyBumpNote(currentVersion, bumpedDeps));
    }

    const bump = bumps?.get(pkg.name);
    if (bump) {
      pkgNotes.push(
        `📦 changesets suggest ${bump.bumpType} -> ${bump.newVersion}`,
      );
    }

    if (pkgNotes.length > 0) {
      notes.set(pkg.name, pkgNotes);
    }

    task.output = renderPackageVersionSummary(
      packageInfos,
      currentVersions,
      versions,
      {
        activePackage: pkg.name,
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
    versions.set(pkg.name, result.version);
    lastBumpType = result.bumpType;

    if (result.version !== currentVersion) {
      bumpedPackages.add(pkg.name);
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

    for (const name of uniqueDependents) {
      const currentVersion =
        currentVersions.get(name) ?? (packageVersionByName.get(name) as string);
      const deps = (graph.get(name) as string[]).filter((d) =>
        bumpedPackages.has(d),
      );
      notes.set(name, [buildDependencyBumpNote(currentVersion, deps)]);
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
        message: "Bump these dependent packages too?",
        choices: [
          { message: "Yes, apply patch bump", name: "patch" },
          { message: "No, keep current versions", name: "skip" },
        ],
        name: "cascade",
      });

    if (cascadeChoice === "patch") {
      for (const name of uniqueDependents) {
        const currentVersion =
          currentVersions.get(name) ??
          (packageVersionByName.get(name) as string);
        const patchVersion = new SemVer(currentVersion).inc("patch").toString();
        versions.set(name, patchVersion);
      }
    }
  }

  task.output = renderPackageVersionSummary(
    packageInfos,
    currentVersions,
    versions,
  );

  ctx.runtime.versions = versions;
  ctx.runtime.versionPlan = {
    mode: "independent",
    packages: versions,
  };
}
