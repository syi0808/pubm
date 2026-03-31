import type { VersionEntry } from "../version-source/types.js";
import type { ChangelogSection, ChangelogWriter } from "./types.js";

export class ChangesetChangelogWriter implements ChangelogWriter {
  formatEntries(entries: VersionEntry[]): ChangelogSection[] {
    if (entries.length === 0) return [];
    return [
      { category: undefined, items: entries.map((e) => `- ${e.summary}`) },
    ];
  }
}
