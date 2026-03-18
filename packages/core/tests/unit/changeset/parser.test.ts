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
      releases: [{ path: "pkg-name", type: "minor" }],
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
        { path: "pkg-a", type: "major" },
        { path: "@scope/pkg-b", type: "patch" },
        { path: "pkg-c", type: "minor" },
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

  it("parses changeset with CRLF line endings", () => {
    const content =
      '---\r\n"pkg-name": patch\r\n---\r\n\r\nWindows line endings.';

    const result = parseChangeset(content, "crlf.md");

    expect(result).toEqual({
      id: "crlf",
      summary: "Windows line endings.",
      releases: [{ path: "pkg-name", type: "patch" }],
    });
  });

  it("throws on invalid frontmatter", () => {
    const content = "No frontmatter here, just text.";

    expect(() => parseChangeset(content, "bad-file.md")).toThrow(
      'Invalid changeset format in "bad-file.md": missing frontmatter',
    );
  });

  it("resolves name to path via resolveKey", () => {
    const content = '---\n"@pubm/core": minor\n---\n\nsome change\n';
    const resolver = (key: string) =>
      key === "@pubm/core" ? "packages/core" : key;
    const result = parseChangeset(content, "test.md", resolver);
    expect(result.releases[0].path).toBe("packages/core");
  });

  it("passes key through when resolveKey is not provided", () => {
    const content = '---\n"packages/core": minor\n---\n\nsome change\n';
    const result = parseChangeset(content, "test.md");
    expect(result.releases[0].path).toBe("packages/core");
  });
});
