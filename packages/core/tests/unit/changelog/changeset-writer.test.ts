import { describe, expect, it } from "vitest";
import { ChangesetChangelogWriter } from "../../../src/changelog/changeset-writer.js";
import type { VersionEntry } from "../../../src/version-source/types.js";

describe("ChangesetChangelogWriter", () => {
  const writer = new ChangesetChangelogWriter();

  it("formats entries as flat items without category", () => {
    const entries: VersionEntry[] = [
      { summary: "Add plugin API", id: "cs-1" },
      { summary: "Fix CLI flag parsing", id: "cs-2" },
    ];
    const sections = writer.formatEntries(entries);
    expect(sections).toEqual([
      {
        category: undefined,
        items: ["- Add plugin API", "- Fix CLI flag parsing"],
      },
    ]);
  });

  it("returns empty array for no entries", () => {
    expect(writer.formatEntries([])).toEqual([]);
  });
});
