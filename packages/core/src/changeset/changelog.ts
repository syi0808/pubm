import type { BumpType, Changeset } from "./parser.js";

export { writeChangelogToFile } from "../changelog/file.js";

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

const BUMP_PRIORITY: Record<string, number> = {
  major: 3,
  minor: 2,
  patch: 1,
};

export function deduplicateEntries(
  entries: ChangelogEntry[],
): ChangelogEntry[] {
  const map = new Map<string, ChangelogEntry>();
  for (const entry of entries) {
    const existing = map.get(entry.id);
    if (
      !existing ||
      (BUMP_PRIORITY[entry.type] ?? 0) > (BUMP_PRIORITY[existing.type] ?? 0)
    ) {
      map.set(entry.id, entry);
    }
  }
  return [...map.values()];
}

export function buildChangelogEntries(
  changesets: Changeset[],
  packagePath: string,
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      if (release.path === packagePath) {
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
