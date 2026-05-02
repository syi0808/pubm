import micromatch from "micromatch";
import semver from "semver";
import { createKeyResolver } from "../changeset/resolve.js";
import type { ResolvedPubmConfig } from "../config/types.js";
import type { PubmContext, VersionPlan } from "../context.js";
import { applyFixedGroup, applyLinkedGroup } from "../monorepo/groups.js";
import { packageKey } from "../utils/package-key.js";
import { ChangesetSource } from "./changeset-source.js";
import { ConventionalCommitSource } from "./conventional-commit-source.js";
import { mergeRecommendations } from "./merge.js";
import type {
  VersionRecommendation,
  VersionSource,
  VersionSourceContext,
} from "./types.js";

export function createVersionPlanFromRecommendations(
  config: ResolvedPubmConfig,
  recommendations: readonly VersionRecommendation[],
): VersionPlan | undefined {
  const groupedRecommendations = applyConfiguredGroups(config, recommendations);
  if (groupedRecommendations.length === 0) return undefined;

  const packages = new Map<string, string>();
  for (const rec of groupedRecommendations) {
    const matchingPackages = config.packages.filter((pkg) =>
      rec.packageKey
        ? packageKey(pkg) === rec.packageKey
        : pkg.path === rec.packagePath,
    );
    for (const pkg of matchingPackages) {
      const newVersion = semver.inc(pkg.version, rec.bumpType);
      if (newVersion) packages.set(packageKey(pkg), newVersion);
    }
  }

  if (packages.size === 0) return undefined;
  if (packages.size === 1 && config.packages.length <= 1) {
    const [key, version] = [...packages][0];
    return {
      mode: "single",
      packageKey: key,
      version,
    };
  }

  if (config.versioning === "fixed") {
    const version = highestVersion([...packages.values()]);
    return {
      mode: "fixed",
      version,
      packages: new Map(
        config.packages.map((pkg) => [packageKey(pkg), version]),
      ),
    };
  }

  return { mode: "independent", packages };
}

export async function analyzeVersionSources(
  ctx: PubmContext,
): Promise<VersionRecommendation[]> {
  const currentVersions = new Map(
    ctx.config.packages.map((pkg) => [pkg.path, pkg.version]),
  );
  const versionSources = ctx.config.versionSources ?? "all";
  const sources: VersionSource[] = [];
  if (versionSources === "all" || versionSources === "changesets") {
    sources.push(new ChangesetSource());
  }
  if (versionSources === "all" || versionSources === "commits") {
    sources.push(
      new ConventionalCommitSource(ctx.config.conventionalCommits?.types),
    );
  }

  const sourceContext: VersionSourceContext = {
    cwd: ctx.cwd,
    packages: currentVersions,
    resolveKey: createKeyResolver(ctx.config.packages),
  };
  const sourceResults: VersionRecommendation[][] = [];
  for (const source of sources) {
    sourceResults.push(await source.analyze(sourceContext));
  }
  return mergeRecommendations(sourceResults);
}

export async function applyVersionSourcePlan(ctx: PubmContext): Promise<void> {
  const recommendations = await analyzeVersionSources(ctx);
  const plan = createVersionPlanFromRecommendations(
    ctx.config,
    recommendations,
  );
  if (!plan) return;

  ctx.runtime.versionPlan = plan;
  ctx.runtime.changesetConsumed = recommendations.some(
    (rec) => rec.source === "changeset",
  );
}

function highestVersion(versions: readonly string[]): string {
  let highest = versions[0] ?? "";
  for (const version of versions.slice(1)) {
    if (semver.valid(version) && semver.valid(highest)) {
      if (semver.gt(version, highest)) highest = version;
    }
  }
  return highest;
}

function applyConfiguredGroups(
  config: ResolvedPubmConfig,
  recommendations: readonly VersionRecommendation[],
): VersionRecommendation[] {
  const fixedGroups = config.fixed ?? [];
  const linkedGroups = config.linked ?? [];
  if (
    config.versioning === "fixed" ||
    recommendations.length === 0 ||
    (fixedGroups.length === 0 && linkedGroups.length === 0)
  ) {
    return [...recommendations];
  }

  const packagesByKey = new Map(
    config.packages.map((pkg) => [packageKey(pkg), pkg]),
  );
  const recommendationsByKey = new Map<string, VersionRecommendation>();
  const bumps = new Map<string, VersionRecommendation["bumpType"]>();

  for (const rec of recommendations) {
    const key =
      rec.packageKey ??
      config.packages.find((pkg) => pkg.path === rec.packagePath)?.path;
    const pkgKey = key?.includes("::")
      ? key
      : config.packages
          .map((pkg) => packageKey(pkg))
          .find((candidate) => candidate === key);
    const resolvedKey =
      pkgKey ??
      config.packages
        .filter((pkg) => pkg.path === rec.packagePath)
        .map((pkg) => packageKey(pkg))[0];
    if (!resolvedKey) continue;
    recommendationsByKey.set(resolvedKey, {
      ...rec,
      packageKey: resolvedKey,
      packagePath: packagesByKey.get(resolvedKey)?.path ?? rec.packagePath,
    });
    bumps.set(resolvedKey, rec.bumpType);
  }

  for (const group of fixedGroups) {
    applyFixedGroup(bumps, resolveGroupKeys(config, group));
  }
  for (const group of linkedGroups) {
    applyLinkedGroup(bumps, resolveGroupKeys(config, group));
  }

  return [...bumps]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, bumpType]) => {
      const original = recommendationsByKey.get(key);
      if (original) return { ...original, bumpType };
      const pkg = packagesByKey.get(key);
      return {
        packagePath: pkg?.path ?? key,
        packageKey: key,
        bumpType,
        source: "group",
        entries: [],
      };
    });
}

function resolveGroupKeys(
  config: ResolvedPubmConfig,
  group: readonly string[],
): string[] {
  const keys = new Set<string>();
  for (const ref of group) {
    for (const pkg of config.packages) {
      const key = packageKey(pkg);
      const aliases = [key, pkg.path, pkg.name].filter(Boolean) as string[];
      if (
        aliases.some((alias) => alias === ref || micromatch.isMatch(alias, ref))
      ) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}
