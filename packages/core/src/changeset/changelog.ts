import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BumpType, Changeset } from "./parser.js";

export interface ChangelogEntry {
  summary: string;
  type: BumpType;
  id: string;
}

export interface DependencyUpdate {
  name: string;
  version: string;
}

const SECTION_ORDER: { type: BumpType; heading: string }[] = [
  { type: "major", heading: "Major Changes" },
  { type: "minor", heading: "Minor Changes" },
  { type: "patch", heading: "Patch Changes" },
];

export function generateChangelog(
  version: string,
  entries: ChangelogEntry[],
  depUpdates?: DependencyUpdate[],
): string {
  const lines: string[] = [`## ${version}`];

  for (const section of SECTION_ORDER) {
    const sectionEntries = entries.filter((e) => e.type === section.type);
    if (sectionEntries.length === 0) continue;

    lines.push("");
    lines.push(`### ${section.heading}`);
    lines.push("");
    for (const entry of sectionEntries) {
      lines.push(`- ${entry.summary}`);
    }
  }

  if (depUpdates && depUpdates.length > 0) {
    lines.push("");
    lines.push("### Dependency Updates");
    lines.push("");
    for (const dep of depUpdates) {
      lines.push(`- Updated \`${dep.name}\` to ${dep.version}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function buildChangelogEntries(
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

export function writeChangelogToFile(cwd: string, newContent: string): void {
  const changelogPath = path.join(cwd, "CHANGELOG.md");

  let existing = "";
  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, "utf-8");
  }

  const header = "# Changelog\n\n";
  const doubleNewline = existing.indexOf("\n\n");
  const body =
    existing.startsWith("# Changelog") && doubleNewline !== -1
      ? existing.slice(doubleNewline + 2)
      : existing;

  writeFileSync(changelogPath, `${header}${newContent}\n${body}`, "utf-8");
}
