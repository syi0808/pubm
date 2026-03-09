import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { CAC } from "cac";
import { inc } from "semver";
import type { ChangelogEntry } from "../changeset/changelog.js";
import { generateChangelog } from "../changeset/changelog.js";
import type { BumpType, Changeset } from "../changeset/parser.js";
import { readChangesets } from "../changeset/reader.js";
import type { VersionBump } from "../changeset/version.js";
import { calculateVersionBumps } from "../changeset/version.js";
import { loadConfig } from "../config/loader.js";
import { Git } from "../git.js";
import {
  applyFixedGroup,
  applyLinkedGroup,
  resolveGroups,
} from "../monorepo/index.js";
import type { PreState } from "../prerelease/pre.js";
import { readPreState } from "../prerelease/pre.js";
import { getPackageJson, replaceVersion } from "../utils/package.js";

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

  // 2. Read current package version
  const packageJson = await getPackageJson({ cwd });
  const packageName = packageJson.name ?? "unknown";
  const currentVersion = packageJson.version;

  if (!currentVersion) {
    throw new Error("No version found in package.json");
  }

  // 3. Calculate version bumps
  const currentVersions = new Map<string, string>([
    [packageName, currentVersion],
  ]);
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

  // 5. Check pre-release state
  const preState = readPreState(cwd);

  // 6. Process each bump
  for (const [name, bump] of bumps) {
    let newVersion: string;

    if (preState) {
      newVersion = computePreReleaseVersion(name, bump, preState);
    } else {
      newVersion = bump.newVersion;
    }

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
    await replaceVersion(newVersion, config?.packages);

    // Prepend changelog to CHANGELOG.md
    writeChangelog(cwd, changelogContent);

    // Update pre-release state
    if (preState) {
      updatePreState(cwd, preState, name, bump);
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

function computePreReleaseVersion(
  name: string,
  bump: VersionBump,
  preState: PreState,
): string {
  const pkgState = preState.packages[name];

  if (pkgState) {
    // If the base version matches the new version, increment iteration
    if (pkgState.baseVersion === bump.newVersion) {
      return `${bump.newVersion}-${preState.tag}.${pkgState.iteration + 1}`;
    }
    // Otherwise start a new pre-release
    return `${bump.newVersion}-${preState.tag}.0`;
  }

  // First pre-release for this package
  return `${bump.newVersion}-${preState.tag}.0`;
}

function buildChangelogEntries(
  changesets: Changeset[],
  packageName: string,
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      if (release.name === packageName) {
        entries.push({
          summary: changeset.summary,
          type: release.type,
          id: changeset.id,
        });
      }
    }
  }

  return entries;
}

function writeChangelog(cwd: string, newContent: string): void {
  const changelogPath = path.join(cwd, "CHANGELOG.md");

  let existing = "";
  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, "utf-8");
  }

  const header = "# Changelog\n\n";
  const body = existing.startsWith("# Changelog")
    ? existing.slice(existing.indexOf("\n\n") + 2)
    : existing;

  writeFileSync(changelogPath, `${header}${newContent}\n${body}`, "utf-8");
}

function updatePreState(
  cwd: string,
  preState: PreState,
  name: string,
  bump: VersionBump,
): void {
  const pkgState = preState.packages[name];
  const iteration =
    pkgState?.baseVersion === bump.newVersion ? pkgState.iteration + 1 : 0;

  preState.packages[name] = {
    baseVersion: bump.newVersion,
    iteration,
  };

  const preStatePath = path.join(cwd, ".pubm", "pre.json");
  writeFileSync(preStatePath, JSON.stringify(preState, null, 2), "utf-8");
}

function deleteChangesetFiles(cwd: string, changesets: Changeset[]): void {
  const changesetsDir = path.join(cwd, ".pubm", "changesets");

  for (const changeset of changesets) {
    const filePath = path.join(changesetsDir, `${changeset.id}.md`);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }
}

export function registerVersionCommand(cli: CAC): void {
  cli
    .command("version", "Consume changesets and bump versions")
    .option("--dry-run", "Show changes without writing")
    .action(async (options: { dryRun?: boolean }) => {
      await runVersionCommand(process.cwd(), { dryRun: options.dryRun });
    });
}
