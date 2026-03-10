import { describe, expect, it } from "vitest";
import { parseChangelogSection } from "../../../src/changeset/changelog-parser.js";

describe("parseChangelogSection", () => {
  const changelog = `# Changelog

## 1.3.0

### Minor Changes

- Add custom changelog templates
- Support plugin hooks

### Patch Changes

- Fix typo in README

## 1.2.0

### Minor Changes

- Initial changeset support

## 1.1.0

### Patch Changes

- Bug fix
`;

  it("extracts a specific version section", () => {
    const result = parseChangelogSection(changelog, "1.3.0");
    expect(result).toContain("### Minor Changes");
    expect(result).toContain("- Add custom changelog templates");
    expect(result).toContain("### Patch Changes");
    expect(result).toContain("- Fix typo in README");
    expect(result).not.toContain("## 1.2.0");
  });

  it("returns null for non-existent version", () => {
    const result = parseChangelogSection(changelog, "9.9.9");
    expect(result).toBeNull();
  });

  it("handles version with v prefix in header", () => {
    const cl = `# Changelog\n\n## v2.0.0\n\n- Breaking change\n`;
    const result = parseChangelogSection(cl, "2.0.0");
    expect(result).toContain("- Breaking change");
  });

  it("handles last version in file (no next header)", () => {
    const result = parseChangelogSection(changelog, "1.1.0");
    expect(result).toContain("- Bug fix");
  });
});
