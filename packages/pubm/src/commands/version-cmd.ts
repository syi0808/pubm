import path from "node:path";
import process from "node:process";
import type {
  BumpType,
  Ecosystem,
  ResolvedPackageConfig,
  ResolvedPubmConfig,
  VersionBump,
} from "@pubm/core";
import {
  applyFixedGroup,
  applyLinkedGroup,
  buildChangelogEntries,
  calculateVersionBumps,
  createKeyResolver,
  deleteChangesetFiles,
  ecosystemCatalog,
  Git,
  generateChangelog,
  readChangesets,
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

  // 1. Read changesets
  const resolver = createKeyResolver(config.packages);
  const changesets = readChangesets(cwd, resolver);
  if (changesets.length === 0) {
    ui.info(t("cmd.version.noChangesets"));
    return;
  }

  // 2. Get all packages and their current versions from resolved config
  const currentVersions = new Map(
    config.packages.map((p) => [p.path, p.version]),
  );
  if (currentVersions.size === 0) {
    throw new Error("No packages found.");
  }

  // 3. Calculate version bumps
  const bumps = calculateVersionBumps(currentVersions, cwd, resolver);

  if (bumps.size === 0) {
    ui.info(t("cmd.version.noChangesets"));
    return;
  }

  // 4. Apply fixed/linked groups from config
  {
    const allPackages = config.packages.map((p) => p.name);

    if (config.fixed && config.fixed.length > 0) {
      const resolvedFixed = resolveGroups(config.fixed, allPackages);
      const bumpTypes = extractBumpTypes(bumps);
      for (const group of resolvedFixed) {
        applyFixedGroup(bumpTypes, group);
      }
      reapplyBumpTypes(bumps, bumpTypes, currentVersions);
    }

    if (config.linked && config.linked.length > 0) {
      const resolvedLinked = resolveGroups(config.linked, allPackages);
      const bumpTypes = extractBumpTypes(bumps);
      for (const group of resolvedLinked) {
        applyLinkedGroup(bumpTypes, group);
      }
      reapplyBumpTypes(bumps, bumpTypes, currentVersions);
    }
  }

  // 5. Log bumps and generate changelogs
  const changelogs = new Map<string, { pkgPath: string; content: string }>();
  for (const [pkgPath, bump] of bumps) {
    const newVersion = bump.newVersion;

    const pkgConfig = config.packages.find((p) => p.path === pkgPath);
    const displayName = pkgConfig?.name ?? pkgPath;
    console.log(
      `${displayName}: ${bump.currentVersion} → ${newVersion} (${bump.bumpType})`,
    );

    // Generate changelog entries from changesets for this package
    const entries = buildChangelogEntries(changesets, pkgPath);
    const changelogContent = generateChangelog(newVersion, entries);

    if (dryRun) {
      console.log(
        `${ui.labels.DRY_RUN} ${t("cmd.version.dryRunWouldWrite", { version: newVersion })}`,
      );
      console.log(`${ui.labels.DRY_RUN} Changelog:\n${changelogContent}`);
      continue;
    }

    const absPath = pkgConfig ? path.resolve(cwd, pkgConfig.path) : cwd;
    changelogs.set(pkgPath, { pkgPath: absPath, content: changelogContent });
  }

  if (dryRun) {
    return;
  }

  // 6. Write versions to manifest files via ecosystem
  const ecosystems = buildEcosystems(config.packages, bumps, cwd);
  const versions = new Map<string, string>();
  for (const [pkgPath, bump] of bumps) {
    versions.set(pkgPath, bump.newVersion);
  }
  await writeVersionsForEcosystem(ecosystems, versions, config.lockfileSync);

  // Write changelogs
  for (const { pkgPath, content } of changelogs.values()) {
    writeChangelogToFile(pkgPath, content);
  }

  // 7. Delete consumed changeset files
  deleteChangesetFiles(cwd, changesets);

  // 8. Create a git commit for the version bump
  const git = new Git();
  await git.stage(".");
  const versionCommitMsg = `Version Packages\n\n${[...bumps]
    .map(
      ([p, bump]) =>
        `- ${config.packages.find((pkg) => pkg.path === p)?.name ?? p}: ${bump.newVersion}`,
    )
    .join("\n")}`;
  await git.commit(versionCommitMsg);
  ui.success(
    `Consumed ${changesets.length} changeset(s) and committed version bump.`,
  );
}

function buildEcosystems(
  packages: ResolvedPackageConfig[],
  bumps: Map<string, VersionBump>,
  cwd: string,
): { eco: Ecosystem; pkg: ResolvedPackageConfig }[] {
  const result: { eco: Ecosystem; pkg: ResolvedPackageConfig }[] = [];
  for (const [pkgPath] of bumps) {
    const pkg = packages.find((p) => p.path === pkgPath);
    if (!pkg) continue;
    const ecoKey = pkg.ecosystem ?? "js";
    const descriptor = ecosystemCatalog.get(ecoKey);
    if (!descriptor) continue;
    const absPath = path.resolve(cwd, pkg.path);
    const eco = new descriptor.ecosystemClass(absPath);
    result.push({ eco, pkg });
  }
  return result;
}

function extractBumpTypes(
  bumps: Map<string, VersionBump>,
): Map<string, BumpType> {
  const bumpTypes = new Map<string, BumpType>();
  for (const [name, bump] of bumps) {
    bumpTypes.set(name, bump.bumpType);
  }
  return bumpTypes;
}

function reapplyBumpTypes(
  bumps: Map<string, VersionBump>,
  bumpTypes: Map<string, BumpType>,
  currentVersions: Map<string, string>,
): void {
  for (const [name, bumpType] of bumpTypes) {
    const existing = bumps.get(name);
    const currentVersion = currentVersions.get(name);
    if (!currentVersion) continue;

    const newVersion = inc(currentVersion, bumpType);
    if (!newVersion) continue;

    if (existing) {
      existing.bumpType = bumpType;
      existing.newVersion = newVersion;
    } else {
      bumps.set(name, { currentVersion, newVersion, bumpType });
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
