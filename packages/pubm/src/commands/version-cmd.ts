import path from "node:path";
import process from "node:process";
import type {
  BumpGroup,
  BumpType,
  Ecosystem,
  ResolvedPackageConfig,
  ResolvedPubmConfig,
  VersionBump,
  VersionRecommendation,
  VersionSource,
  VersionSourceContext,
} from "@pubm/core";
import {
  applyFixedGroup,
  applyLinkedGroup,
  ChangesetChangelogWriter,
  ChangesetSource,
  ConventionalCommitChangelogWriter,
  ConventionalCommitSource,
  createKeyResolver,
  createVersionPlanFromRecommendations,
  ecosystemCatalog,
  Git,
  mergeRecommendations,
  packageKey,
  renderChangelog,
  resolveGroups,
  t,
  ui,
  writeChangelogToFile,
  writeVersionsForEcosystem,
} from "@pubm/core";
import type { Command } from "commander";
import { diff } from "semver";

type VersioningConfig = {
  mode: "independent" | "fixed";
  fixed: string[][];
  linked: string[][];
  updateInternalDependencies: "patch" | "minor";
};

export interface VersionCommandOptions {
  dryRun?: boolean;
}

export async function runVersionCommand(
  cwd: string,
  config: ResolvedPubmConfig,
  options: VersionCommandOptions = {},
): Promise<void> {
  const { dryRun = false } = options;

  // 1. Get all packages and their current versions from resolved config
  const currentVersions = new Map(
    config.packages.map((p) => [p.path, p.version]),
  );
  if (currentVersions.size === 0) {
    throw new Error("No packages found.");
  }

  // 2. Build release sources based on config
  const resolver = createKeyResolver(config.packages);
  const sources: VersionSource[] = [
    new ChangesetSource(
      config.release?.changesets?.directory ?? ".pubm/changesets",
    ),
    new ConventionalCommitSource(config.release?.commits?.types ?? {}),
  ];

  // 3. Analyze all sources
  const vsContext: VersionSourceContext = {
    cwd,
    packages: currentVersions,
    resolveKey: resolver,
  };
  const sourceResults: VersionRecommendation[][] = [];
  for (const source of sources) {
    sourceResults.push(await source.analyze(vsContext));
  }
  const recommendations = mergeRecommendations(sourceResults);

  if (recommendations.length === 0) {
    ui.info(t("cmd.version.noChangesets"));
    return;
  }

  // 4. Convert the shared release planner result to the command's write map.
  const versionPlan = createVersionPlanFromRecommendations(
    config,
    recommendations,
  );
  const bumpRecommendations = versionPlan
    ? createGroupedRecommendations(config, recommendations)
    : recommendations;
  const bumps = versionPlan
    ? createBumpsFromVersionPlan(config, versionPlan, bumpRecommendations)
    : new Map<string, VersionBump>();

  if (bumps.size === 0) {
    ui.info(t("cmd.version.noChangesets"));
    return;
  }

  // 5. Log bumps and generate changelogs
  const changesetWriter = new ChangesetChangelogWriter();
  const ccWriter = new ConventionalCommitChangelogWriter();
  const changelogs = new Map<string, { pkgPath: string; content: string }>();
  for (const [pkgKey, bump] of bumps) {
    const newVersion = bump.newVersion;

    const pkgConfig = config.packages.find((p) => packageKey(p) === pkgKey);
    const displayName = pkgConfig?.name ?? pkgKey;
    console.log(
      `${displayName}: ${bump.currentVersion} → ${newVersion} (${bump.bumpType})`,
    );

    // Generate changelog entries from recommendations for this package
    const rec = recommendations.find(
      (r) =>
        r.packageKey === pkgKey ||
        (!r.packageKey && r.packagePath === (pkgConfig?.path ?? pkgKey)),
    );
    let changelogContent: string;
    if (rec) {
      const sections =
        rec.source === "changeset"
          ? changesetWriter.formatEntries(rec.entries)
          : ccWriter.formatEntries(rec.entries);
      const bumpGroups: BumpGroup[] = [{ bumpType: bump.bumpType, sections }];
      changelogContent = renderChangelog(bump.newVersion, bumpGroups);
    } else {
      changelogContent = renderChangelog(bump.newVersion, []);
    }

    if (dryRun) {
      console.log(
        `${ui.labels.DRY_RUN} ${t("cmd.version.dryRunWouldWrite", { version: newVersion })}`,
      );
      console.log(`${ui.labels.DRY_RUN} Changelog:\n${changelogContent}`);
      continue;
    }

    const absPath = pkgConfig ? path.resolve(cwd, pkgConfig.path) : cwd;
    changelogs.set(pkgKey, { pkgPath: absPath, content: changelogContent });
  }

  if (dryRun) {
    return;
  }

  // 6. Write versions to manifest files via ecosystem
  const ecosystems = buildEcosystems(config.packages, bumps, cwd);
  // bumps is already packageKey-keyed — pass directly to writeVersionsForEcosystem
  const versions = new Map(
    [...bumps].map(([pkgKey, bump]) => [pkgKey, bump.newVersion]),
  );
  await writeVersionsForEcosystem(ecosystems, versions, config.lockfileSync);

  // Write changelogs
  for (const { pkgPath, content } of changelogs.values()) {
    writeChangelogToFile(pkgPath, content);
  }

  // 7. Consume sources (delete changeset files, etc.)
  for (const source of sources) {
    await source.consume?.([]);
  }

  // 8. Create a git commit for the version bump
  const git = new Git();
  await git.stage(".");
  const versionCommitMsg = `Version Packages\n\n${[...bumps]
    .map(
      ([pkgKey, bump]) =>
        `- ${config.packages.find((pkg) => packageKey(pkg) === pkgKey)?.name ?? pkgKey}: ${bump.newVersion}`,
    )
    .join("\n")}`;
  await git.commit(versionCommitMsg);
  ui.success(
    `Consumed ${recommendations.length} recommendation(s) and committed version bump.`,
  );
}

function createBumpsFromVersionPlan(
  config: ResolvedPubmConfig,
  plan: ReturnType<typeof createVersionPlanFromRecommendations>,
  recommendations: readonly VersionRecommendation[],
): Map<string, VersionBump> {
  const bumps = new Map<string, VersionBump>();
  if (!plan) return bumps;

  const fixedBump = highestRecommendationBump(recommendations);
  const addBump = (
    pkgKey: string,
    newVersion: string,
    fixedMode: boolean,
  ): void => {
    const pkg = config.packages.find(
      (candidate) => packageKey(candidate) === pkgKey,
    );
    if (!pkg) return;
    const recommendationBump = recommendationBumpForPackage(
      config,
      recommendations,
      pkgKey,
    );
    const bumpType =
      (fixedMode ? fixedBump : recommendationBump) ??
      bumpTypeFromVersions(pkg.version, newVersion) ??
      recommendationBump ??
      fixedBump;
    if (!bumpType) return;
    bumps.set(pkgKey, {
      currentVersion: pkg.version,
      newVersion,
      bumpType,
    });
  };

  if (plan.mode === "single") {
    addBump(plan.packageKey, plan.version, false);
    return bumps;
  }

  for (const [pkgKey, version] of plan.packages) {
    addBump(pkgKey, version, plan.mode === "fixed");
  }
  return bumps;
}

function buildEcosystems(
  packages: ResolvedPackageConfig[],
  bumps: Map<string, VersionBump>,
  cwd: string,
): { eco: Ecosystem; pkg: ResolvedPackageConfig }[] {
  const result: { eco: Ecosystem; pkg: ResolvedPackageConfig }[] = [];
  for (const [pkgKey] of bumps) {
    const pkg = packages.find((p) => packageKey(p) === pkgKey);
    if (!pkg) continue;
    const ecoKey = pkg.ecosystem;
    const descriptor = ecosystemCatalog.get(ecoKey);
    if (!descriptor) continue;
    const absPath = path.resolve(cwd, pkg.path);
    const eco = new descriptor.ecosystemClass(absPath);
    result.push({ eco, pkg });
  }
  return result;
}

function createGroupedRecommendations(
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
  const bumps = new Map<string, BumpType>();

  for (const rec of recommendations) {
    for (const resolvedKey of resolveRecommendationKeys(config, rec)) {
      const pkg = packagesByKey.get(resolvedKey);
      recommendationsByKey.set(resolvedKey, {
        ...rec,
        packageKey: resolvedKey,
        packagePath: pkg?.path ?? rec.packagePath,
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

function releaseVersioning(config: ResolvedPubmConfig): VersioningConfig {
  return (
    config.release?.versioning ?? {
      mode: config.versioning ?? "independent",
      fixed: config.fixed ?? [],
      linked: config.linked ?? [],
      updateInternalDependencies: config.updateInternalDependencies ?? "patch",
    }
  );
}

function resolveRecommendationKeys(
  config: ResolvedPubmConfig,
  rec: VersionRecommendation,
): string[] {
  if (rec.packageKey) {
    const key = rec.packageKey.includes("::")
      ? rec.packageKey
      : config.packages
          .map((pkg) => packageKey(pkg))
          .find((candidate) => candidate === rec.packageKey);
    if (key) return [key];
  }
  return config.packages
    .filter((pkg) => pkg.path === rec.packagePath)
    .map((pkg) => packageKey(pkg));
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
      const matches = resolveGroups([[ref]], aliases)[0] ?? [];
      if (aliases.some((alias) => alias === ref || matches.includes(alias))) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

function recommendationBumpForPackage(
  config: ResolvedPubmConfig,
  recommendations: readonly VersionRecommendation[],
  pkgKey: string,
): BumpType | undefined {
  const pkg = config.packages.find(
    (candidate) => packageKey(candidate) === pkgKey,
  );
  const rec = recommendations.find(
    (candidate) =>
      candidate.packageKey === pkgKey ||
      (!candidate.packageKey && pkg && candidate.packagePath === pkg.path),
  );
  return rec?.bumpType;
}

function highestRecommendationBump(
  recommendations: readonly VersionRecommendation[],
): BumpType | undefined {
  const rank: Record<BumpType, number> = { patch: 0, minor: 1, major: 2 };
  let highest: BumpType | undefined;
  for (const rec of recommendations) {
    if (!highest || rank[rec.bumpType] > rank[highest]) highest = rec.bumpType;
  }
  return highest;
}

function bumpTypeFromVersions(
  currentVersion: string,
  newVersion: string,
): BumpType | undefined {
  const type = diff(currentVersion, newVersion);
  if (type === "major" || type === "minor" || type === "patch") return type;
  if (type === "premajor") return "major";
  if (type === "preminor") return "minor";
  if (type === "prepatch" || type === "prerelease") return "patch";
  return undefined;
}

export function registerVersionCommand(
  parent: Command,
  getConfig: () => ResolvedPubmConfig,
): void {
  parent
    .command("version")
    .description(t("cmd.version.description"))
    .option("--dry-run", t("cmd.version.optionDryRun"))
    .action(async (options: { dryRun?: boolean }) => {
      await runVersionCommand(process.cwd(), getConfig(), {
        dryRun: options.dryRun,
      });
    });
}
