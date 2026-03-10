import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateChangesetContent } from "@pubm/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runChangelogCommand } from "../../../src/commands/changelog.js";

describe("runChangelogCommand", () => {
  const tmpDir = path.join(import.meta.dirname, ".tmp-changelog-test");
  const changesetsDir = path.join(tmpDir, ".pubm", "changesets");

  beforeEach(() => {
    mkdirSync(changesetsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates changelog preview from pending changesets", () => {
    const content = generateChangesetContent(
      [{ name: "test-pkg", type: "minor" }],
      "Add new feature",
    );
    writeFileSync(path.join(changesetsDir, "test-id.md"), content);

    const result = runChangelogCommand(tmpDir, {
      dryRun: true,
      version: "1.1.0",
    });

    expect(result).toContain("## 1.1.0");
    expect(result).toContain("Add new feature");
  });

  it("writes CHANGELOG.md when dryRun is false", () => {
    const content = generateChangesetContent(
      [{ name: "test-pkg", type: "patch" }],
      "Fix bug",
    );
    writeFileSync(path.join(changesetsDir, "test-id.md"), content);

    runChangelogCommand(tmpDir, { version: "1.0.1" });

    const written = readFileSync(path.join(tmpDir, "CHANGELOG.md"), "utf-8");
    expect(written).toContain("# Changelog");
    expect(written).toContain("## 1.0.1");
    expect(written).toContain("Fix bug");
  });

  it("prepends to existing CHANGELOG.md", () => {
    const existingChangelog = "# Changelog\n\n## 1.0.0\n\n- Initial release\n";
    writeFileSync(path.join(tmpDir, "CHANGELOG.md"), existingChangelog);

    const content = generateChangesetContent(
      [{ name: "test-pkg", type: "minor" }],
      "New feature",
    );
    writeFileSync(path.join(changesetsDir, "test-id.md"), content);

    runChangelogCommand(tmpDir, { version: "1.1.0" });

    const written = readFileSync(path.join(tmpDir, "CHANGELOG.md"), "utf-8");
    expect(written).toContain("## 1.1.0");
    expect(written).toContain("New feature");
    expect(written).toContain("## 1.0.0");
    expect(written).toContain("- Initial release");
    // New version should come before old
    expect(written.indexOf("1.1.0")).toBeLessThan(written.indexOf("1.0.0"));
  });

  it("returns null when no changesets exist", () => {
    const result = runChangelogCommand(tmpDir, {
      dryRun: true,
      version: "1.0.0",
    });

    expect(result).toBeNull();
  });
});
