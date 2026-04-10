import { describe, expect, it } from "vitest";
import { renderReleaseNoteSections } from "../../../src/tasks/release-notes.js";
import type { ChangelogSection } from "../../../src/changelog/types.js";

describe("renderReleaseNoteSections", () => {
  it("renders sections with category headers", () => {
    const sections: ChangelogSection[] = [
      { category: "Features", items: ["- add glob support (a1b2c3d)"] },
      { category: "Bug Fixes", items: ["- fix path resolution (c3d4e5f)"] },
    ];

    const result = renderReleaseNoteSections(sections);
    expect(result).toBe(
      "### Features\n\n- add glob support (a1b2c3d)\n\n### Bug Fixes\n\n- fix path resolution (c3d4e5f)",
    );
  });

  it("renders multiple items within a section", () => {
    const sections: ChangelogSection[] = [
      {
        category: "Features",
        items: ["- feat one (a1b2c3d)", "- feat two (b2c3d4e)"],
      },
    ];

    const result = renderReleaseNoteSections(sections);
    expect(result).toBe(
      "### Features\n\n- feat one (a1b2c3d)\n- feat two (b2c3d4e)",
    );
  });

  it("returns empty string for empty sections", () => {
    expect(renderReleaseNoteSections([])).toBe("");
  });

  it("renders sections without category as plain items", () => {
    const sections: ChangelogSection[] = [
      { items: ["- uncategorized item (abc1234)"] },
    ];

    const result = renderReleaseNoteSections(sections);
    expect(result).toBe("- uncategorized item (abc1234)");
  });
});
