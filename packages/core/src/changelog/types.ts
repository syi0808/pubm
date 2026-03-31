import type { VersionEntry } from "../version-source/types.js";

export interface ChangelogSection {
  category?: string;
  items: string[];
}

export interface ChangelogWriter {
  formatEntries(entries: VersionEntry[]): ChangelogSection[];
}
