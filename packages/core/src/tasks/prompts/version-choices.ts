import { color, type TaskContext } from "@pubm/runner";
import semver from "semver";
import { createKeyResolver } from "../../changeset/resolve.js";
import type { ResolvedPackageConfig } from "../../config/types.js";
import type { PubmContext } from "../../context.js";
import { t } from "../../i18n/index.js";
import {
  ChangesetSource,
  ConventionalCommitSource,
  mergeRecommendations,
} from "../../version-source/index.js";
import type {
  VersionRecommendation,
  VersionSource,
  VersionSourceContext,
} from "../../version-source/types.js";

const { RELEASE_TYPES, SemVer } = semver;

export function createVersionSources(ctx: PubmContext): VersionSource[] {
  const sources: VersionSource[] = [];
  const versionSources = ctx.config.versionSources ?? "all";
  if (versionSources === "all" || versionSources === "changesets") {
    sources.push(new ChangesetSource());
  }
  if (versionSources === "all" || versionSources === "commits") {
    sources.push(
      new ConventionalCommitSource(ctx.config.conventionalCommits?.types),
    );
  }
  return sources;
}

export async function analyzeAllSources(
  ctx: PubmContext,
): Promise<VersionRecommendation[]> {
  const sources = createVersionSources(ctx);
  const currentVersions = new Map(
    ctx.config.packages.map((p) => [p.path, p.version]),
  );
  const vsContext: VersionSourceContext = {
    cwd: ctx.cwd,
    packages: currentVersions,
    resolveKey: createKeyResolver(ctx.config.packages),
  };
  const sourceResults: VersionRecommendation[][] = [];
  for (const source of sources) {
    sourceResults.push(await source.analyze(vsContext));
  }
  return mergeRecommendations(sourceResults);
}

export function versionChoices(
  currentVersion: string,
  recommendedBumpType?: string,
) {
  return [
    {
      message: t("prompt.version.keepCurrent", {
        version: color.dim(currentVersion),
      }),
      name: currentVersion,
    },
    ...RELEASE_TYPES.map((releaseType) => {
      const increasedVersion = new SemVer(currentVersion)
        .inc(releaseType)
        .toString();
      const marker =
        recommendedBumpType === releaseType
          ? ` ${color.yellowBright(t("prompt.version.recommendedMarker"))}`
          : "";
      return {
        message: t("prompt.version.releaseChoice", {
          releaseType,
          version: color.dim(increasedVersion),
          marker,
        }),
        name: increasedVersion,
      };
    }),
    { message: t("prompt.version.custom"), name: "specify" },
  ];
}

export async function promptVersion(
  task: TaskContext<PubmContext>,
  currentVersion: string,
  label: string,
  recommendedBumpType?: string,
  initialBumpType?: string,
): Promise<{ version: string; bumpType: string | undefined }> {
  const initial = initialBumpType
    ? RELEASE_TYPES.indexOf(initialBumpType as semver.ReleaseType) + 1
    : 0;

  let nextVersion = await task.prompt().run<string>({
    type: "select",
    message: t("prompt.version.selectIncrement", {
      label,
      currentVersion: color.dim(`(current: ${currentVersion})`),
    }),
    choices: versionChoices(currentVersion, recommendedBumpType),
    initial,
    name: "version",
  });

  if (nextVersion === "specify") {
    nextVersion = await task.prompt().run<string>({
      type: "input",
      message: t("prompt.version.enterVersion", { label }),
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
export function buildReverseDeps(
  graph: Map<string, string[]>,
): Map<string, string[]> {
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
export function buildGraphFromPackages(
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
