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
  t,
  ui,
  writeChangelogToFile,
  writeVersionsForEcosystem,
} from "@pubm/core";
import type { Command } from "commander";
import { diff } from "semver";

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
  const bumps = versionPlan
    ? createBumpsFromVersionPlan(config, versionPlan, recommendations)
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
    const bumpType =
      (fixedMode ? fixedBump : bumpTypeFromVersions(pkg.version, newVersion)) ??
      recommendationBumpForPackage(config, recommendations, pkgKey) ??
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
