import micromatch from "micromatch";
import semver from "semver";
import type { ResolvedPubmConfig } from "../config/types.js";
import type { PubmContext, VersionPlan } from "../context.js";
import { applyFixedGroup, applyLinkedGroup } from "../monorepo/groups.js";
import { analyzeReleaseChanges } from "../release-analysis/analyze.js";
import { packageKey } from "../utils/package-key.js";
import type { VersionRecommendation } from "./types.js";

export function createVersionPlanFromRecommendations(
  config: ResolvedPubmConfig,
  recommendations: readonly VersionRecommendation[],
): VersionPlan | undefined {
  const groupedRecommendations = applyConfiguredGroups(config, recommendations);
  if (groupedRecommendations.length === 0) return undefined;

  const packages = new Map<string, string>();
  const matchedRecommendations: VersionRecommendation[] = [];
  for (const rec of groupedRecommendations) {
    const matchingPackages = config.packages.filter((pkg) =>
      rec.packageKey
        ? packageKey(pkg) === rec.packageKey
        : pkg.path === rec.packagePath,
    );
    let matched = false;
    for (const pkg of matchingPackages) {
      const newVersion = semver.inc(pkg.version, rec.bumpType);
      if (newVersion) {
        packages.set(packageKey(pkg), newVersion);
        matched = true;
      }
    }
    if (matched) matchedRecommendations.push(rec);
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

  if (releaseVersioning(config).mode === "fixed") {
    const version = createFixedVersion(config, matchedRecommendations);
    if (!version) return undefined;
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
  const analysis = await analyzeReleaseChanges(ctx);
  ctx.runtime.releaseAnalysis = analysis;
  return analysis.recommendations;
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

const bumpRank: Record<VersionRecommendation["bumpType"], number> = {
  patch: 0,
  minor: 1,
  major: 2,
};

function createFixedVersion(
  config: ResolvedPubmConfig,
  recommendations: readonly VersionRecommendation[],
): string | undefined {
  const baseVersion = highestVersion(config.packages.map((pkg) => pkg.version));
  const bumpType = highestBump(recommendations);
  return baseVersion && bumpType
    ? (semver.inc(baseVersion, bumpType) ?? undefined)
    : undefined;
}

function highestBump(
  recommendations: readonly VersionRecommendation[],
): VersionRecommendation["bumpType"] | undefined {
  let highest: VersionRecommendation["bumpType"] | undefined;
  for (const rec of recommendations) {
    if (!highest || bumpRank[rec.bumpType] > bumpRank[highest]) {
      highest = rec.bumpType;
    }
  }
  return highest;
}

function highestVersion(versions: readonly string[]): string | undefined {
  let highest: string | undefined;
  for (const version of versions) {
    if (!semver.valid(version)) continue;
    if (!highest || semver.gt(version, highest)) highest = version;
  }
  return highest;
}

function applyConfiguredGroups(
  config: ResolvedPubmConfig,
  recommendations: readonly VersionRecommendation[],
): VersionRecommendation[] {
  const versioning = releaseVersioning(config);
  const fixedGroups = versioning.fixed ?? [];
  const linkedGroups = versioning.linked ?? [];
  if (
    versioning.mode === "fixed" ||
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
    for (const resolvedKey of resolveRecommendationKeys(config, rec)) {
      recommendationsByKey.set(resolvedKey, {
        ...rec,
        packageKey: resolvedKey,
        packagePath: packagesByKey.get(resolvedKey)?.path ?? rec.packagePath,
      });
      bumps.set(resolvedKey, rec.bumpType);
    }
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

function resolveRecommendationKeys(
  config: ResolvedPubmConfig,
  rec: VersionRecommendation,
): string[] {
  if (rec.packageKey) {
    const pkg = config.packages.find((candidate) => {
      const key = packageKey(candidate);
      return key === rec.packageKey;
    });
    if (pkg) return [packageKey(pkg)];
    if (rec.packageKey.includes("::")) return [rec.packageKey];
  }

  return config.packages
    .filter((pkg) => pkg.path === rec.packagePath)
    .map((pkg) => packageKey(pkg));
}

function releaseVersioning(config: ResolvedPubmConfig) {
  return (
    config.release?.versioning ?? {
      mode: config.versioning ?? "independent",
      fixed: config.fixed ?? [],
      linked: config.linked ?? [],
      updateInternalDependencies: config.updateInternalDependencies ?? "patch",
    }
  );
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
