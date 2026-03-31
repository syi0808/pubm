import {
  COMMIT_TYPE_CATEGORY_MAP,
  DEFAULT_CATEGORY,
} from "../conventional-commit/types.js";
import type { VersionEntry } from "../version-source/types.js";
import type { ChangelogSection, ChangelogWriter } from "./types.js";

const CATEGORY_ORDER = [
  "Features",
  "Bug Fixes",
  "Performance",
  "Refactoring",
  "Documentation",
  "Other Changes",
];

export class ConventionalCommitChangelogWriter implements ChangelogWriter {
  formatEntries(entries: VersionEntry[]): ChangelogSection[] {
    if (entries.length === 0) return [];
    const groups = new Map<string, string[]>();

    for (const entry of entries) {
      const category =
        (entry.type && COMMIT_TYPE_CATEGORY_MAP[entry.type]) ||
        DEFAULT_CATEGORY;
      const hashSuffix = entry.hash ? ` (${entry.hash})` : "";
      const item = `- ${entry.summary}${hashSuffix}`;
      const existing = groups.get(category);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(category, [item]);
      }
    }

    const sections: ChangelogSection[] = [];
    for (const category of CATEGORY_ORDER) {
      const items = groups.get(category);
      if (items) sections.push({ category, items });
    }
    return sections;
  }
}
