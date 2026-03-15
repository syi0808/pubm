import { describe, expect, it } from "vitest";
import { parseChangeset } from "../../../src/changeset/parser.js";

describe("parseChangeset", () => {
  it("parses basic changeset with one package", () => {
    const content = `---
"pkg-name": minor
---

Summary text here.`;

    const result = parseChangeset(content, "cool-change.md");

    expect(result).toEqual({
      id: "cool-change",
      summary: "Summary text here.",
      releases: [{ name: "pkg-name", type: "minor" }],
    });
  });

  it("parses changeset with multiple packages", () => {
    const content = `---
"pkg-a": major
"@scope/pkg-b": patch
"pkg-c": minor
---

Added a new feature.`;

    const result = parseChangeset(content, "multi-pkg.md");

    expect(result).toEqual({
      id: "multi-pkg",
      summary: "Added a new feature.",
      releases: [
        { name: "pkg-a", type: "major" },
        { name: "@scope/pkg-b", type: "patch" },
        { name: "pkg-c", type: "minor" },
      ],
    });
  });

  it("parses empty changeset (no packages)", () => {
    const content = `---
---

Just a note.`;

    const result = parseChangeset(content, "empty-releases.md");

    expect(result).toEqual({
      id: "empty-releases",
      summary: "Just a note.",
      releases: [],
    });
  });

  it("trims whitespace from summary", () => {
    const content = `---
"pkg-name": patch
---

   Trimmed summary.   `;

    const result = parseChangeset(content, "whitespace.md");

    expect(result.summary).toBe("Trimmed summary.");
  });

  it("handles multiline summary", () => {
    const content = `---
"pkg-name": minor
---

First line of summary.

Second paragraph with more details.

- Bullet point one
- Bullet point two`;

    const result = parseChangeset(content, "multiline.md");

    expect(result.summary).toBe(
      "First line of summary.\n\nSecond paragraph with more details.\n\n- Bullet point one\n- Bullet point two",
    );
  });

  it("strips .md extension from id", () => {
    const content = `---
"pkg": patch
---

Summary.`;

    const result = parseChangeset(content, "my-change.md");

    expect(result.id).toBe("my-change");
  });

  it("throws on invalid bump type", () => {
    const content = `---
"pkg-name": invalid
---

Summary.`;

    expect(() => parseChangeset(content, "bad-type.md")).toThrow(
      'Invalid bump type "invalid" for package "pkg-name" in "bad-type.md"',
    );
  });

  it("throws on invalid frontmatter", () => {
    const content = "No frontmatter here, just text.";

    expect(() => parseChangeset(content, "bad-file.md")).toThrow(
      'Invalid changeset format in "bad-file.md": missing frontmatter',
    );
  });
});
