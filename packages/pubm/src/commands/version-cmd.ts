import path from "node:path";
import process from "node:process";
import type { BumpType, VersionBump } from "@pubm/core";
import {
  applyFixedGroup,
  applyLinkedGroup,
  buildChangelogEntries,
  calculateVersionBumps,
  deleteChangesetFiles,
  discoverCurrentVersions,
  discoverPackageInfos,
  Git,
  generateChangelog,
  loadConfig,
  readChangesets,
  replaceVersion,
  replaceVersionAtPath,
  resolveGroups,
  writeChangelogToFile,
} from "@pubm/core";
import type { Command } from "commander";
import { inc } from "semver";

export interface VersionCommandOptions {
  dryRun?: boolean;
}

export async function runVersionCommand(
  cwd: string,
  options: VersionCommandOptions = {},
): Promise<void> {
  const { dryRun = false } = options;

  // 1. Read changesets
  const changesets = readChangesets(cwd);
  if (changesets.length === 0) {
    console.log("No changesets found.");
    return;
  }

  // 2. Discover all packages and their current versions
  const currentVersions = await discoverCurrentVersions(cwd);
  if (currentVersions.size === 0) {
    throw new Error("No packages found.");
  }

  // 3. Calculate version bumps
  const bumps = calculateVersionBumps(currentVersions, cwd);

  if (bumps.size === 0) {
    console.log("No changesets found.");
    return;
  }

  // 4. Apply fixed/linked groups from config
  const config = await loadConfig(cwd);
  if (config) {
    const allPackages = [...currentVersions.keys()];

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

  // For multi-package: get package paths for per-package version writing
  const packageInfos =
    currentVersions.size > 1 ? await discoverPackageInfos(cwd) : null;

  // 5. Process each bump
  for (const [name, bump] of bumps) {
    const newVersion = bump.newVersion;

    console.log(
      `${name}: ${bump.currentVersion} → ${newVersion} (${bump.bumpType})`,
    );

    // Generate changelog entries from changesets for this package
    const entries = buildChangelogEntries(changesets, name);
    const changelogContent = generateChangelog(newVersion, entries);

    if (dryRun) {
      console.log(`[dry-run] Would write version ${newVersion}`);
      console.log(`[dry-run] Changelog:\n${changelogContent}`);
      continue;
    }

    // Write version to manifest files
    if (packageInfos) {
      const pkgInfo = packageInfos.find((p) => p.name === name);
      if (pkgInfo) {
        const pkgPath = path.resolve(cwd, pkgInfo.path);
        await replaceVersionAtPath(newVersion, pkgPath);
      }
    } else {
      await replaceVersion(newVersion, config?.packages);
    }

    // Prepend changelog to CHANGELOG.md
    if (packageInfos) {
      const pkgInfo = packageInfos.find((p) => p.name === name);
      if (pkgInfo) {
        writeChangelogToFile(path.resolve(cwd, pkgInfo.path), changelogContent);
      }
    } else {
      writeChangelogToFile(cwd, changelogContent);
    }

  }

  if (dryRun) {
    return;
  }

  // 7. Delete consumed changeset files
  deleteChangesetFiles(cwd, changesets);

  // 8. Create a git commit for the version bump
  const git = new Git();
  await git.stage(".");
  const bumpedNames = [...bumps.keys()].join(", ");
  await git.commit(`chore: version ${bumpedNames}`);
  console.log(
    `\nConsumed ${changesets.length} changeset(s) and committed version bump.`,
  );
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

export function registerVersionCommand(parent: Command): void {
  parent
    .command("version")
    .description("Consume changesets and bump versions")
    .option("--dry-run", "Show changes without writing")
    .action(async (options: { dryRun?: boolean }) => {
      await runVersionCommand(process.cwd(), { dryRun: options.dryRun });
    });
}
