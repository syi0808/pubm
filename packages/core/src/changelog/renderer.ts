import type { BumpType } from "../changeset/parser.js";
import type { ChangelogSection } from "./types.js";

const BUMP_HEADINGS: Record<BumpType, string> = {
  major: "Major Changes",
  minor: "Minor Changes",
  patch: "Patch Changes",
};
const BUMP_ORDER: BumpType[] = ["major", "minor", "patch"];

export interface BumpGroup {
  bumpType: BumpType;
  sections: ChangelogSection[];
}

export function renderChangelog(
  version: string,
  bumpGroups: BumpGroup[],
): string {
  const lines: string[] = [`## ${version}`];
  const sorted = [...bumpGroups].sort(
    (a, b) => BUMP_ORDER.indexOf(a.bumpType) - BUMP_ORDER.indexOf(b.bumpType),
  );

  for (const group of sorted) {
    if (group.sections.length === 0) continue;
    lines.push("", `### ${BUMP_HEADINGS[group.bumpType]}`);

    const flat = group.sections.filter((s) => s.category === undefined);
    for (const section of flat) {
      lines.push("");
      for (const item of section.items) lines.push(item);
    }

    const categorized = group.sections.filter((s) => s.category !== undefined);
    for (const section of categorized) {
      lines.push("", `#### ${section.category}`, "");
      for (const item of section.items) lines.push(item);
    }
  }

  return `${lines.join("\n")}\n`;
}
