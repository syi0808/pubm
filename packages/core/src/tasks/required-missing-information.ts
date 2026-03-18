import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type Listr, type ListrTask } from "listr2";
import semver from "semver";
import { createKeyResolver } from "../changeset/resolve.js";
import { getStatus } from "../changeset/status.js";
import type { VersionBump } from "../changeset/version.js";
import { calculateVersionBumps } from "../changeset/version.js";
import type { ResolvedPackageConfig } from "../config/types.js";
import type { PubmContext } from "../context.js";
import { defaultOptions } from "../options.js";
import { registryCatalog } from "../registry/catalog.js";
import { filterConfigPackages } from "../utils/filter-config.js";
import { createListr } from "../utils/listr.js";
import { ui } from "../utils/ui.js";

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

  return ui.formatNote(
    "hint",
    `${dependencyLabel} ${bumpedDependencies.join(", ")} bumped, suggest at least patch -> ${suggestedVersion}`,
  );
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
    const currentVersion = currentVersions.get(pkg.path) ?? pkg.version;
    const selectedVersion = selectedVersions.get(pkg.path);
    const prefix = options.activePackage === pkg.path ? "> " : "  ";

    lines.push(
      `${prefix}${pkg.name}  ${formatPackageVersionSummary(currentVersion, selectedVersion)}`,
    );

    for (const note of options.notes?.get(pkg.path) ?? []) {
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
 * Build a dependency graph from ResolvedPackageConfig[] where both keys and
 * values are package paths (translating dependency names to paths).
 */
function buildGraphFromPackages(
  packages: ResolvedPackageConfig[],
): Map<string, string[]> {
  // Build a name-to-path lookup so we can translate dependency names to paths
  const nameToPath = new Map<string, string>();
  const pathSet = new Set<string>();
  for (const pkg of packages) {
    if (pkg.name) nameToPath.set(pkg.name, pkg.path);
    pathSet.add(pkg.path);
  }

  const graph = new Map<string, string[]>();
  for (const pkg of packages) {
    graph.set(
      pkg.path,
      pkg.dependencies
        .map((dep) => nameToPath.get(dep) ?? dep)
        .filter((dep) => pathSet.has(dep)),
    );
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
  const pkgPath = pkg?.path ?? "";
  const cwd = ctx.cwd ?? process.cwd();

  const resolver = createKeyResolver(ctx.config.packages);

  // Check for pending changesets
  const status = getStatus(cwd, resolver);

  if (status.hasChangesets) {
    const currentVersions = new Map([[pkgPath, currentVersion]]);
    const bumps = calculateVersionBumps(currentVersions, cwd, resolver);
    const bump = bumps.get(pkgPath);

    if (bump) {
      const pkgStatus = status.packages.get(pkgPath);
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
        ctx.runtime.versionPlan = {
          mode: "single",
          version: bump.newVersion,
          packagePath: ctx.config.packages[0].path,
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

  ctx.runtime.versionPlan = {
    mode: "single",
    version: nextVersion,
    packagePath: ctx.config.packages[0].path,
  };
}

function sortPackageInfosByDependency(
  packageInfos: ResolvedPackageConfig[],
  graph: Map<string, string[]>,
): ResolvedPackageConfig[] {
  // Compute depth: 0 = no internal dependencies (base packages), higher = depends on deeper packages
  const depths = new Map<string, number>();

  function getDepth(path: string, visited: Set<string>): number {
    if (depths.has(path)) return depths.get(path) as number;
    if (visited.has(path)) return 0;
    visited.add(path);
    const deps = graph.get(path) ?? [];
    const depth =
      deps.length === 0
        ? 0
        : Math.max(...deps.map((d) => getDepth(d, visited))) + 1;
    depths.set(path, depth);
    return depth;
  }

  for (const path of graph.keys()) {
    getDepth(path, new Set());
  }

  // Sort by depth ascending (dependencies first). Array.sort is stable,
  // so packages at the same depth keep their original order.
  return [...packageInfos].sort(
    (a, b) => (depths.get(a.path) ?? 0) - (depths.get(b.path) ?? 0),
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
  const currentVersions = new Map(packageInfos.map((p) => [p.path, p.version]));
  const resolver = createKeyResolver(ctx.config.packages);
  const status = getStatus(cwd, resolver);

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
    bumps = calculateVersionBumps(currentVersions, cwd, resolver);

    if (bumps.size > 0) {
      const result = await promptChangesetRecommendations(
        ctx,
        task,
        status,
        bumps,
        sortedPackageInfos,
      );
      if (result === "accepted") return;
      if (result === "add_packages") {
        await handleAddPackages(
          ctx,
          task,
          sortedPackageInfos,
          currentVersions,
          graph,
          bumps!,
        );
        return;
      }
      // "no" — fall through to manual
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
 * add_packages branch: auto-bump changeset packages, then prompt for remaining.
 */
async function handleAddPackages(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  graph: Map<string, string[]>,
  bumps: Map<string, VersionBump>,
): Promise<void> {
  const remainingPackages = packageInfos.filter((p) => !bumps.has(p.path));
  const { versions, publishPaths } = await handleRemainingPackages(
    ctx,
    task,
    remainingPackages,
    packageInfos,
    currentVersions,
    graph,
    bumps,
  );

  ctx.runtime.versionPlan = {
    mode: "independent",
    packages: new Map([...versions].filter(([p]) => publishPaths.has(p))),
  };
  ctx.runtime.changesetConsumed = true;
  filterConfigPackages(ctx, publishPaths);
}

/**
 * Prompts version selection for non-changeset packages.
 * Returns merged versions map (superset of publishPaths) and publishPaths set.
 */
async function handleRemainingPackages(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  remainingPackages: ResolvedPackageConfig[],
  packageInfos: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
  graph: Map<string, string[]>,
  bumps: Map<string, VersionBump>,
): Promise<{ versions: Map<string, string>; publishPaths: Set<string> }> {
  const pathToName = new Map(
    ctx.config.packages.map((p) => [p.path, p.name || p.path]),
  );

  // Initialize with changeset-bumped packages (considered already bumped for cascade)
  const bumpedPackages = new Set<string>(bumps.keys());
  const versions = new Map<string, string>(
    [...bumps].map(([p, b]) => [p, b.newVersion]),
  );
  const publishPaths = new Set<string>(bumps.keys());
  const reverseDeps = buildReverseDeps(graph);

  for (const pkg of remainingPackages) {
    const currentVersion = currentVersions.get(pkg.path) ?? pkg.version;
    const deps = graph.get(pkg.path) ?? [];
    const bumpedDeps = deps.filter((dep) => bumpedPackages.has(dep));
    const pkgNotes: string[] = [];

    if (bumpedDeps.length > 0) {
      const bumpedDepNames = bumpedDeps.map(
        (dep) => pathToName.get(dep) ?? dep,
      );
      pkgNotes.push(buildDependencyBumpNote(currentVersion, bumpedDepNames));
    }

    if (pkgNotes.length > 0) {
      task.output = renderPackageVersionSummary(
        remainingPackages,
        currentVersions,
        versions,
        { activePackage: pkg.path, notes: new Map([[pkg.path, pkgNotes]]) },
      );
    }

    const result = await promptVersion(task, currentVersion, pkg.name);
    versions.set(pkg.path, result.version);

    if (result.version !== currentVersion) {
      bumpedPackages.add(pkg.path);
      publishPaths.add(pkg.path);
    }
  }

  // Cascade prompt for unbumped dependents
  const unbumpedDependents: string[] = [];
  for (const bumped of bumpedPackages) {
    for (const dep of reverseDeps.get(bumped) ?? []) {
      if (!bumpedPackages.has(dep)) {
        unbumpedDependents.push(dep);
      }
    }
  }

  if (unbumpedDependents.length > 0) {
    const uniqueDependents = [...new Set(unbumpedDependents)];
    const notes: PackageNotes = new Map();
    for (const pkgPath of uniqueDependents) {
      const currentVersion = currentVersions.get(pkgPath) ?? "0.0.0";
      const deps = (graph.get(pkgPath) ?? []).filter((d) =>
        bumpedPackages.has(d),
      );
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
        message: "Bump these dependent packages too?",
        choices: [
          { message: "Yes, apply patch bump", name: "patch" },
          { message: "No, keep current versions", name: "skip" },
        ],
        name: "cascade",
      });

    if (cascadeChoice === "patch") {
      for (const pkgPath of uniqueDependents) {
        const currentVersion = currentVersions.get(pkgPath) ?? "0.0.0";
        const patchVersion = new SemVer(currentVersion).inc("patch").toString();
        versions.set(pkgPath, patchVersion);
        publishPaths.add(pkgPath);
      }
    }
  }

  return { versions, publishPaths };
}

/**
 * Show changeset recommendations for all affected packages and prompt with three choices.
 */
async function promptChangesetRecommendations(
  ctx: PubmContext,
  task: Parameters<ListrTask<PubmContext>["task"]>[1],
  status: ReturnType<typeof getStatus>,
  bumps: Map<string, VersionBump>,
  sortedPackageInfos: ResolvedPackageConfig[],
): Promise<"accepted" | "add_packages" | "no"> {
  const lines: string[] = ["Changesets suggest:"];

  for (const pkg of sortedPackageInfos) {
    const bump = bumps.get(pkg.path);
    if (!bump) continue;
    const pkgStatus = status.packages.get(pkg.path);
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
      {
        message: "Only changesets (auto bump affected packages)",
        name: "only_changesets",
      },
      {
        message: "Also select versions for other packages",
        name: "add_packages",
      },
      { message: "No, select versions manually", name: "no" },
    ],
    name: "version",
  });

  if (choice === "only_changesets") {
    const versions = new Map<string, string>();
    for (const [path, bump] of bumps) {
      versions.set(path, bump.newVersion);
    }
    ctx.runtime.versionPlan = {
      mode: "independent",
      packages: versions,
    };
    ctx.runtime.changesetConsumed = true;
    filterConfigPackages(ctx, new Set(bumps.keys()));
    return "accepted";
  }

  if (choice === "add_packages") {
    return "add_packages";
  }

  return "no";
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
    const bump = bumps.get(pkg.path);
    if (!bump) continue;
    const pkgStatus = status.packages.get(pkg.path);
    const changesetCount = pkgStatus?.changesetCount ?? 0;
    const changesetLabel = pluralize(changesetCount, "changeset");
    notes.set(pkg.path, [
      ui.formatNote(
        "suggest",
        `${changesetLabel} suggests ${bump.bumpType} -> ${bump.newVersion}`,
      ),
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

    // Filter out packages where the selected version equals the current version.
    // This only applies when coming from the "no" branch (changesets were present
    // but declined). handleIndependentMode stores ALL packages in versionPlan.packages,
    // including "keep current" ones. Exclude them from the publish pipeline here.
    // When bumps is undefined/empty, this is a pure manual flow — no filtering needed.
    const plan = ctx.runtime.versionPlan;
    if (plan && plan.mode === "independent" && bumps && bumps.size > 0) {
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
          `changesets suggest ${bump.bumpType} -> ${bump.newVersion}`,
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
        message: "Bump these dependent packages too?",
        choices: [
          { message: "Yes, apply patch bump", name: "patch" },
          { message: "No, keep current versions", name: "skip" },
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
