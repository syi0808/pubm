import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateChangesets } from "../src/validate.js";

describe("validateChangesets", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "pubm-in-repo-actions-validate-"));
    mkdirSync(path.join(cwd, ".pubm", "changesets"), { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function writeChangeset(file: string, content: string) {
    writeFileSync(path.join(cwd, file), content);
  }

  function makePackage(packagePath: string) {
    mkdirSync(path.join(cwd, packagePath), { recursive: true });
  }

  it("validates a correct changeset", () => {
    makePackage("packages/core");
    writeChangeset(
      ".pubm/changesets/brave-fox.md",
      "---\npackages/core: minor\n---\n\nAdd new feature\n",
    );

    const result = validateChangesets([".pubm/changesets/brave-fox.md"], cwd);

    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.valid[0].id).toBe("brave-fox");
    expect(result.valid[0].releases[0]).toEqual({
      path: "packages/core",
      type: "minor",
    });
  });

  it("validates package names through the core package key resolver", () => {
    makePackage("packages/core");
    writeChangeset(
      ".pubm/changesets/name-key.md",
      '---\n"@scope/core": minor\n---\n\nAdd named package support\n',
    );

    const result = validateChangesets(
      [".pubm/changesets/name-key.md"],
      cwd,
      (key) => (key === "@scope/core" ? "packages/core::js" : key),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.valid[0].releases[0]).toEqual({
      path: "packages/core",
      ecosystem: "js",
      type: "minor",
    });
  });

  it("reports error for missing frontmatter", () => {
    writeChangeset(".pubm/changesets/bad-file.md", "No frontmatter here\n");

    const result = validateChangesets([".pubm/changesets/bad-file.md"], cwd);

    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("missing frontmatter");
  });

  it("reports error for invalid bump type", () => {
    writeChangeset(
      ".pubm/changesets/bad-bump.md",
      "---\npackages/core: big\n---\n\nSome change\n",
    );

    const result = validateChangesets([".pubm/changesets/bad-bump.md"], cwd);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Invalid bump type "big"');
  });

  it("reports error for empty summary", () => {
    makePackage("packages/core");
    writeChangeset(
      ".pubm/changesets/empty-summary.md",
      "---\npackages/core: patch\n---\n",
    );

    const result = validateChangesets(
      [".pubm/changesets/empty-summary.md"],
      cwd,
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("summary is empty");
  });

  it("reports error for empty frontmatter (no releases)", () => {
    writeChangeset(
      ".pubm/changesets/no-releases.md",
      "---\n---\n\nSome change\n",
    );

    const result = validateChangesets([".pubm/changesets/no-releases.md"], cwd);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("No package releases");
  });

  it("reports error for non-existent package path", () => {
    writeChangeset(
      ".pubm/changesets/bad-path.md",
      "---\npackages/nonexistent: patch\n---\n\nSome fix\n",
    );

    const result = validateChangesets([".pubm/changesets/bad-path.md"], cwd);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("does not exist");
  });

  it("reports error when file cannot be read", () => {
    const result = validateChangesets([".pubm/changesets/missing.md"], cwd);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe("File could not be read");
  });

  it("handles multiple files with mixed results", () => {
    makePackage("packages/core");
    writeChangeset(
      ".pubm/changesets/good-file.md",
      "---\npackages/core: minor\n---\n\nGood change\n",
    );
    writeChangeset(".pubm/changesets/bad-file.md", "No frontmatter");

    const result = validateChangesets(
      [".pubm/changesets/good-file.md", ".pubm/changesets/bad-file.md"],
      cwd,
    );

    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});
