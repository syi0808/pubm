import { describe, expect, it } from "vitest";
import { ConventionalCommitChangelogWriter } from "../../../src/changelog/conventional-commit-writer.js";
import type { VersionEntry } from "../../../src/version-source/types.js";

describe("ConventionalCommitChangelogWriter", () => {
  const writer = new ConventionalCommitChangelogWriter();

  it("groups entries by commit type category", () => {
    const entries: VersionEntry[] = [
      { summary: "feat(core): add feature", type: "feat", hash: "abc1234" },
      { summary: "fix(core): fix bug", type: "fix", hash: "def5678" },
    ];
    const sections = writer.formatEntries(entries);
    expect(sections).toEqual([
      { category: "Features", items: ["- feat(core): add feature (abc1234)"] },
      { category: "Bug Fixes", items: ["- fix(core): fix bug (def5678)"] },
    ]);
  });

  it("groups perf under Performance", () => {
    const entries: VersionEntry[] = [
      { summary: "perf: optimize", type: "perf", hash: "aaa" },
    ];
    const sections = writer.formatEntries(entries);
    expect(sections[0].category).toBe("Performance");
  });

  it("uses Other Changes for unknown types", () => {
    const entries: VersionEntry[] = [
      { summary: "build: update config", type: "build", hash: "aaa" },
    ];
    const sections = writer.formatEntries(entries);
    expect(sections[0].category).toBe("Other Changes");
  });

  it("omits hash suffix when hash is missing", () => {
    const entries: VersionEntry[] = [
      { summary: "feat: no hash entry", type: "feat" },
    ];
    const sections = writer.formatEntries(entries);
    expect(sections[0].items[0]).toBe("- feat: no hash entry");
  });

  it("uses default category when type is missing", () => {
    const entries: VersionEntry[] = [{ summary: "some change", hash: "aaa" }];
    const sections = writer.formatEntries(entries);
    expect(sections[0].category).toBe("Other Changes");
  });

  it("returns empty for no entries", () => {
    expect(writer.formatEntries([])).toEqual([]);
  });

  it("preserves order: Features before Bug Fixes", () => {
    const entries: VersionEntry[] = [
      { summary: "fix: bug", type: "fix", hash: "bbb" },
      { summary: "feat: feature", type: "feat", hash: "aaa" },
    ];
    const sections = writer.formatEntries(entries);
    expect(sections[0].category).toBe("Features");
    expect(sections[1].category).toBe("Bug Fixes");
  });
});
