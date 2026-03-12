import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type Listr, type ListrTask } from "listr2";
import semver from "semver";
import {
  discoverCurrentVersions,
  discoverPackageInfos,
} from "../changeset/packages.js";
import { getStatus } from "../changeset/status.js";
import type { VersionBump } from "../changeset/version.js";
import { calculateVersionBumps } from "../changeset/version.js";
import { loadConfig } from "../config/loader.js";
import {
  buildDependencyGraph,
  type PackageNode,
} from "../monorepo/dependency-graph.js";
import { defaultOptions } from "../options.js";
import { jsrRegistry } from "../registry/jsr.js";
import { npmRegistry } from "../registry/npm.js";
import { createListr } from "../utils/listr.js";
import { getPackageJson, version } from "../utils/package.js";

const { RELEASE_TYPES, SemVer, prerelease } = semver;

interface Ctx {
  version?: string;
  versions?: Map<string, string>;
  changesetConsumed?: boolean;
  tag: string;
}

type PackageInfos = Awaited<ReturnType<typeof discoverPackageInfos>>;
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
  packageInfos: PackageInfos,
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

function versionChoices(currentVersion: string) {
  return [
    {
      message: `Keep current version ${color.dim(currentVersion)}`,
      name: currentVersion,
    },
    ...RELEASE_TYPES.map((releaseType) => {
      const increasedVersion = new SemVer(currentVersion)
        .inc(releaseType)
        .toString();
      return {
        message: `${releaseType} ${color.dim(increasedVersion)}`,
        name: increasedVersion,
      };
    }),
    { message: "Custom version (specify)", name: "specify" },
  ];
}

async function promptVersion(
  task: Parameters<ListrTask<Ctx>["task"]>[1],
  currentVersion: string,
  label: string,
): Promise<string> {
  let nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
    type: "select",
    message: `Select SemVer increment for ${label} ${color.dim(`(current: ${currentVersion})`)}`,
    choices: versionChoices(currentVersion),
    name: "version",
  });

  if (nextVersion === "specify") {
    nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "input",
      message: `Version for ${label}`,
      name: "version",
    });
  }

  return nextVersion;
}

async function readPackageDependencies(
  pkgPath: string,
): Promise<Record<string, string>> {
  try {
    const raw = (await readFile(path.join(pkgPath, "package.json"))).toString();
    const json = JSON.parse(raw);
    return {
      ...json.dependencies,
      ...json.devDependencies,
      ...json.peerDependencies,
    };
  } catch {
    return {};
  }
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

export const requiredMissingInformationTasks = (
  options?: Omit<ListrTask<Ctx>, "title" | "task">,
): Listr<Ctx> =>
  createListr<Ctx>({
    ...options,
    title: "Checking required information",
    task: (_, parentTask): Listr<Ctx> =>
      parentTask.newListr([
        {
          title: "Checking version information",
          skip: (ctx) =>
            !!ctx.version || (!!ctx.versions && ctx.versions.size > 0),
          task: async (ctx, task): Promise<void> => {
            const cwd = process.cwd();
            const packageInfos = await discoverPackageInfos(cwd);
            const isSinglePackage = packageInfos.length <= 1;

            if (isSinglePackage) {
              await handleSinglePackage(ctx, task, cwd);
            } else {
              await handleMultiPackage(ctx, task, cwd, packageInfos);
            }
          },
          exitOnError: true,
        },
        {
          title: "Checking tag information",
          skip: (ctx) => {
            const ver = ctx.version ?? ctx.versions?.values().next().value;
            return !ver
              ? true
              : !prerelease(`${ver}`) && ctx.tag === defaultOptions.tag;
          },
          task: async (ctx, task): Promise<void> => {
            const npm = await npmRegistry();
            const jsr = await jsrRegistry();
            const distTags = [
              ...new Set(
                (await Promise.all([npm.distTags(), jsr.distTags()])).flat(),
              ),
            ].filter((tag) => tag !== defaultOptions.tag);

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

            ctx.tag = tag;
          },
          exitOnError: true,
        },
      ]),
  });

/**
 * Single package flow — backward compatible with original behavior.
 */
async function handleSinglePackage(
  ctx: Ctx,
  task: Parameters<ListrTask<Ctx>["task"]>[1],
  cwd: string,
): Promise<void> {
  const currentVersion = await version();

  // Check for pending changesets
  const status = getStatus(cwd);

  if (status.hasChangesets) {
    const pkg = await getPackageJson({ cwd });
    const pkgName = pkg.name ?? "";
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
        ctx.version = bump.newVersion;
        ctx.changesetConsumed = true;
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

  ctx.version = nextVersion;
}

/**
 * Multi-package flow — changeset recommendations, sync/independent, dependency cascade.
 */
async function handleMultiPackage(
  ctx: Ctx,
  task: Parameters<ListrTask<Ctx>["task"]>[1],
  cwd: string,
  packageInfos: PackageInfos,
): Promise<void> {
  const currentVersions = await discoverCurrentVersions(cwd);
  const status = getStatus(cwd);

  task.output = renderPackageVersionSummary(
    packageInfos,
    currentVersions,
    new Map(),
  );

  // Try changeset-based recommendations first
  if (status.hasChangesets) {
    const bumps = calculateVersionBumps(currentVersions, cwd);

    if (bumps.size > 0) {
      const accepted = await promptChangesetRecommendations(
        ctx,
        task,
        status,
        bumps,
      );
      if (accepted) return;
    }
  }

  // Manual flow
  await handleManualMultiPackage(ctx, task, cwd, packageInfos, currentVersions);
}

/**
 * Show changeset recommendations for all affected packages and prompt accept/customize.
 */
async function promptChangesetRecommendations(
  ctx: Ctx,
  task: Parameters<ListrTask<Ctx>["task"]>[1],
  status: ReturnType<typeof getStatus>,
  bumps: Map<string, VersionBump>,
): Promise<boolean> {
  const lines: string[] = ["Changesets suggest:"];

  for (const [name, bump] of bumps) {
    const pkgStatus = status.packages.get(name);
    const changesetCount = pkgStatus?.changesetCount ?? 0;
    const changesetLabel = pluralize(changesetCount, "changeset");
    lines.push(
      `  ${name}  ${bump.currentVersion} → ${bump.newVersion} (${bump.bumpType}: ${changesetLabel})`,
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
    ctx.versions = versions;
    ctx.changesetConsumed = true;
    return true;
  }

  return false;
}

/**
 * Manual multi-package flow: determine sync strategy, then prompt for versions.
 */
async function handleManualMultiPackage(
  ctx: Ctx,
  task: Parameters<ListrTask<Ctx>["task"]>[1],
  cwd: string,
  packageInfos: PackageInfos,
  currentVersions: Map<string, string>,
): Promise<void> {
  task.output = renderPackageVersionSummary(
    packageInfos,
    currentVersions,
    new Map(),
  );

  const config = await loadConfig(cwd);
  let mode: "fixed" | "independent";

  if (config?.versioning) {
    mode = config.versioning;
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
    await handleFixedMode(ctx, task, packageInfos, currentVersions);
  } else {
    await handleIndependentMode(ctx, task, cwd, packageInfos, currentVersions);
  }
}

/**
 * Fixed mode: prompt once, apply to all packages.
 */
async function handleFixedMode(
  ctx: Ctx,
  task: Parameters<ListrTask<Ctx>["task"]>[1],
  packageInfos: PackageInfos,
  currentVersions: Map<string, string>,
): Promise<void> {
  // Use the highest current version as the base
  let highestVersion = "0.0.0";
  for (const ver of currentVersions.values()) {
    if (semver.gt(ver, highestVersion)) {
      highestVersion = ver;
    }
  }

  let nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
    type: "select",
    message: `Select version for all packages ${color.dim(`(highest current: ${highestVersion})`)}`,
    choices: versionChoices(highestVersion),
    name: "version",
  });

  if (nextVersion === "specify") {
    nextVersion = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "input",
      message: "Version",
      name: "version",
    });
  }

  ctx.version = nextVersion;

  // Set per-package versions so runner replaces all package.json files
  const versions = new Map<string, string>();
  for (const name of currentVersions.keys()) {
    versions.set(name, nextVersion);
  }
  ctx.versions = versions;

  task.output = renderPackageVersionSummary(
    packageInfos,
    currentVersions,
    versions,
  );
}

/**
 * Independent mode: prompt per package with dependency cascade suggestions.
 */
async function handleIndependentMode(
  ctx: Ctx,
  task: Parameters<ListrTask<Ctx>["task"]>[1],
  cwd: string,
  packageInfos: PackageInfos,
  currentVersions: Map<string, string>,
): Promise<void> {
  // Build dependency graph for cascade suggestions
  const packageNodes: PackageNode[] = [];
  for (const pkg of packageInfos) {
    const pkgPath = path.resolve(cwd, pkg.path);
    const deps = await readPackageDependencies(pkgPath);
    packageNodes.push({
      name: pkg.name,
      version: pkg.version,
      path: pkg.path,
      dependencies: deps,
    });
  }

  const graph = buildDependencyGraph(packageNodes);
  const reverseDeps = buildReverseDeps(graph);
  const versions = new Map<string, string>();
  const bumpedPackages = new Set<string>();

  for (const pkg of packageInfos) {
    const currentVersion = currentVersions.get(pkg.name) ?? pkg.version;

    // Check if a dependency was bumped — suggest patch bump for dependents
    const deps = graph.get(pkg.name) ?? [];
    const bumpedDeps = deps.filter((dep) => bumpedPackages.has(dep));
    const notes: PackageNotes = new Map();

    if (bumpedDeps.length > 0) {
      notes.set(pkg.name, [
        buildDependencyBumpNote(currentVersion, bumpedDeps),
      ]);
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

    const nextVersion = await promptVersion(task, currentVersion, pkg.name);
    versions.set(pkg.name, nextVersion);

    if (nextVersion !== currentVersion) {
      bumpedPackages.add(pkg.name);
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

    for (const name of uniqueDependents) {
      const currentVersion = currentVersions.get(name) ?? "0.0.0";
      const deps = (graph.get(name) ?? []).filter((d) => bumpedPackages.has(d));
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
        const currentVersion = currentVersions.get(name) ?? "0.0.0";
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

  ctx.versions = versions;
}
