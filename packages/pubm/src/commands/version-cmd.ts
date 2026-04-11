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
import { inc } from "semver";

export interface VersionCommandOptions {
  dryRun?: boolean;
}

export async function runVersionCommand(
  cwd: string,
  config: ResolvedPubmConfig,
  options: VersionCommandOptions = {},
): Promise<void> {
  const { dryRun = false } = options;

  // 1. Build version sources based on config
  const resolver = createKeyResolver(config.packages);
  const sources: VersionSource[] = [];
  const versionSources = config.versionSources ?? "all";
  if (versionSources === "all" || versionSources === "changesets") {
    sources.push(new ChangesetSource());
  }
  if (versionSources === "all" || versionSources === "commits") {
    sources.push(
      new ConventionalCommitSource(config.conventionalCommits?.types),
    );
  }

  // 2. Get all packages and their current versions from resolved config
  const currentVersions = new Map(
    config.packages.map((p) => [p.path, p.version]),
  );
  if (currentVersions.size === 0) {
    throw new Error("No packages found.");
  }

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

  // 4. Convert recommendations to VersionBump map (keyed by packageKey)
  const bumps = new Map<string, VersionBump>();
  for (const rec of recommendations) {
    const currentVersion = currentVersions.get(rec.packagePath);
    if (!currentVersion) continue;
    const newVersion = inc(currentVersion, rec.bumpType);
    if (!newVersion) continue;
    const pkg = config.packages.find((p) => p.path === rec.packagePath);
    if (!pkg) continue;
    bumps.set(packageKey(pkg), {
      currentVersion,
      newVersion,
      bumpType: rec.bumpType,
    });
  }

  if (bumps.size === 0) {
    ui.info(t("cmd.version.noChangesets"));
    return;
  }

  // 5. Apply fixed/linked groups from config
  // Build a packageKey → pkg lookup for use in reapplyBumpTypes
  const pkgByKey = new Map(config.packages.map((p) => [packageKey(p), p]));

  {
    const allPackages = config.packages.map((p) => p.name);

    if (config.fixed && config.fixed.length > 0) {
      const resolvedFixed = resolveGroups(config.fixed, allPackages);
      const bumpTypes = extractBumpTypes(bumps, pkgByKey);
      for (const group of resolvedFixed) {
        applyFixedGroup(bumpTypes, group);
      }
      reapplyBumpTypes(bumps, bumpTypes, config.packages, currentVersions);
    }

    if (config.linked && config.linked.length > 0) {
      const resolvedLinked = resolveGroups(config.linked, allPackages);
      const bumpTypes = extractBumpTypes(bumps, pkgByKey);
      for (const group of resolvedLinked) {
        applyLinkedGroup(bumpTypes, group);
      }
      reapplyBumpTypes(bumps, bumpTypes, config.packages, currentVersions);
    }
  }

  // 6. Log bumps and generate changelogs
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
      (r) => r.packagePath === (pkgConfig?.path ?? pkgKey),
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

  // 7. Write versions to manifest files via ecosystem
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

  // 8. Consume sources (delete changeset files, etc.)
  for (const source of sources) {
    await source.consume?.([]);
  }

  // 9. Create a git commit for the version bump
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

/**
 * Extracts a name-keyed bump type map from the packageKey-keyed bumps map.
 * applyFixedGroup/applyLinkedGroup operate on package names, not packageKeys.
 */
function extractBumpTypes(
  bumps: Map<string, VersionBump>,
  pkgByKey: Map<string, ResolvedPackageConfig>,
): Map<string, BumpType> {
  const bumpTypes = new Map<string, BumpType>();
  for (const [pkgKey, bump] of bumps) {
    const pkg = pkgByKey.get(pkgKey);
    if (pkg) bumpTypes.set(pkg.name, bump.bumpType);
  }
  return bumpTypes;
}

/**
 * Writes name-keyed bump types back to the packageKey-keyed bumps map.
 */
function reapplyBumpTypes(
  bumps: Map<string, VersionBump>,
  bumpTypes: Map<string, BumpType>,
  packages: ResolvedPackageConfig[],
  currentVersions: Map<string, string>,
): void {
  for (const [name, bumpType] of bumpTypes) {
    const pkg = packages.find((p) => p.name === name);
    if (!pkg) continue;
    const pkgKey = packageKey(pkg);
    const existing = bumps.get(pkgKey);
    const currentVersion = currentVersions.get(pkg.path);
    if (!currentVersion) continue;

    const newVersion = inc(currentVersion, bumpType);
    if (!newVersion) continue;

    if (existing) {
      existing.bumpType = bumpType;
      existing.newVersion = newVersion;
    } else {
      bumps.set(pkgKey, { currentVersion, newVersion, bumpType });
    }
  }
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
