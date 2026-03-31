import { describe, expect, it } from "vitest";
import { renderChangelog } from "../../../src/changelog/renderer.js";
import type { ChangelogSection } from "../../../src/changelog/types.js";
import type { BumpType } from "../../../src/changeset/parser.js";

describe("renderChangelog", () => {
  it("renders changeset-only entries as flat items", () => {
    const bumpGroups: { bumpType: BumpType; sections: ChangelogSection[] }[] = [
      {
        bumpType: "minor",
        sections: [{ category: undefined, items: ["- Add plugin API"] }],
      },
    ];
    const result = renderChangelog("1.3.0", bumpGroups);
    expect(result).toBe(
      ["## 1.3.0", "", "### Minor Changes", "", "- Add plugin API", ""].join(
        "\n",
      ),
    );
  });

  it("renders CC entries with category headings", () => {
    const bumpGroups: { bumpType: BumpType; sections: ChangelogSection[] }[] = [
      {
        bumpType: "minor",
        sections: [
          { category: "Features", items: ["- feat(sync): add glob (a1b2c3d)"] },
        ],
      },
    ];
    const result = renderChangelog("1.3.0", bumpGroups);
    expect(result).toBe(
      [
        "## 1.3.0",
        "",
        "### Minor Changes",
        "",
        "#### Features",
        "",
        "- feat(sync): add glob (a1b2c3d)",
        "",
      ].join("\n"),
    );
  });

  it("renders mixed: flat items first, then categorized", () => {
    const bumpGroups: { bumpType: BumpType; sections: ChangelogSection[] }[] = [
      {
        bumpType: "minor",
        sections: [
          { category: undefined, items: ["- Add plugin API"] },
          { category: "Features", items: ["- feat(sync): add glob (a1b2c3d)"] },
        ],
      },
      {
        bumpType: "patch",
        sections: [
          { category: undefined, items: ["- Fix CLI flag parsing"] },
          {
            category: "Bug Fixes",
            items: ["- fix(brew): handle empty (def456)"],
          },
          { category: "Performance", items: ["- perf: optimize (c3d4e5f)"] },
        ],
      },
    ];
    const result = renderChangelog("1.3.0", bumpGroups);
    expect(result).toBe(
      [
        "## 1.3.0",
        "",
        "### Minor Changes",
        "",
        "- Add plugin API",
        "",
        "#### Features",
        "",
        "- feat(sync): add glob (a1b2c3d)",
        "",
        "### Patch Changes",
        "",
        "- Fix CLI flag parsing",
        "",
        "#### Bug Fixes",
        "",
        "- fix(brew): handle empty (def456)",
        "",
        "#### Performance",
        "",
        "- perf: optimize (c3d4e5f)",
        "",
      ].join("\n"),
    );
  });

  it("renders major section", () => {
    const bumpGroups: { bumpType: BumpType; sections: ChangelogSection[] }[] = [
      {
        bumpType: "major",
        sections: [
          { category: "Features", items: ["- feat!: remove API (abc)"] },
        ],
      },
    ];
    const result = renderChangelog("2.0.0", bumpGroups);
    expect(result).toContain("### Major Changes");
  });

  it("sorts bump groups by severity (major -> minor -> patch)", () => {
    const bumpGroups: { bumpType: BumpType; sections: ChangelogSection[] }[] = [
      {
        bumpType: "patch",
        sections: [{ category: undefined, items: ["- fix something"] }],
      },
      {
        bumpType: "major",
        sections: [{ category: undefined, items: ["- breaking change"] }],
      },
    ];
    const result = renderChangelog("2.0.0", bumpGroups);
    const majorIdx = result.indexOf("### Major Changes");
    const patchIdx = result.indexOf("### Patch Changes");
    expect(majorIdx).toBeLessThan(patchIdx);
  });

  it("returns heading only with no groups", () => {
    expect(renderChangelog("1.0.0", [])).toBe("## 1.0.0\n");
  });
});
