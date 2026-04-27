import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildChangelogEntries,
  calculateVersionBumps,
  generateChangelog,
  generateChangesetContent,
  getStatus,
  parseChangeset,
  readChangesets,
  writeChangeset,
} from "../../../src/changeset/index.js";
import type { ChangesetFileScenario } from "./scenarios.js";
import {
  changesetWorkflowScenarios,
  invalidChangesetScenarios,
} from "./scenarios.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createProjectRoot(id: string): string {
  const root = path.join(
    tmpdir(),
    `pubm-changesets-contract-${id}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

function changesetsDir(root: string): string {
  return path.join(root, ".pubm", "changesets");
}

function writeScenarioFile(root: string, file: ChangesetFileScenario): void {
  mkdirSync(changesetsDir(root), { recursive: true });
  writeFileSync(
    path.join(changesetsDir(root), file.fileName),
    generateChangesetContent([...file.releases], file.summary),
    "utf-8",
  );
}

function snapshotChangesetFiles(root: string): Map<string, string> {
  const dir = changesetsDir(root);
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir)
      .sort()
      .map((fileName) => [
        fileName,
        readFileSync(path.join(dir, fileName), "utf-8"),
      ]),
  );
}

describe("Changesets Workflow contract", () => {
  for (const scenario of changesetWorkflowScenarios) {
    it(`${scenario.id}: ${scenario.description}`, () => {
      const root = createProjectRoot(scenario.id);
      for (const file of scenario.files) writeScenarioFile(root, file);

      const status = getStatus(root);
      expect(status.hasChangesets).toBe(true);
      expect(status.changesets.map((changeset) => changeset.id).sort()).toEqual(
        scenario.files.map((file) => file.fileName.replace(/\.md$/, "")).sort(),
      );

      for (const [key, expected] of Object.entries(scenario.expected.status)) {
        expect(status.packages.get(key)).toEqual(expected);
      }

      const versionBumps = calculateVersionBumps(
        new Map(Object.entries(scenario.currentVersions)),
        root,
      );
      expect(Object.fromEntries(versionBumps)).toEqual(
        scenario.expected.versionBumps,
      );

      const changelogEntries = buildChangelogEntries(
        status.changesets,
        scenario.expected.changelog.target,
      );
      const changelog = generateChangelog(
        scenario.expected.changelog.version,
        changelogEntries,
      );
      for (const expectedText of scenario.expected.changelog.contains) {
        expect(changelog).toContain(expectedText);
      }
    });
  }

  it("writeChangeset produces add-like files that round-trip through the public reader", () => {
    const root = createProjectRoot("write-changeset");
    const writtenPath = writeChangeset(
      [
        { path: "packages/core", ecosystem: "js", type: "minor" },
        { path: "packages/core", ecosystem: "rust", type: "patch" },
      ],
      "Update both manifests for a multi-ecosystem package.",
      root,
    );

    expect(writtenPath.replace(/\\/g, "/")).toMatch(
      /\/\.pubm\/changesets\/[a-z]+-[a-z]+-[a-z0-9]+\.md$/,
    );

    const changesets = readChangesets(root);
    expect(changesets).toHaveLength(1);
    expect(changesets[0]).toMatchObject({
      summary: "Update both manifests for a multi-ecosystem package.",
      releases: [
        { path: "packages/core", ecosystem: "js", type: "minor" },
        { path: "packages/core", ecosystem: "rust", type: "patch" },
      ],
    });
  });

  for (const scenario of invalidChangesetScenarios) {
    it(`${scenario.id}: ${scenario.description}`, () => {
      expect(() => parseChangeset(scenario.content, scenario.fileName)).toThrow(
        scenario.message,
      );
    });
  }

  it("dry-run style projections do not mutate changeset files or create a changelog", () => {
    const scenario = changesetWorkflowScenarios[1];
    const root = createProjectRoot("dry-run-read-only");
    for (const file of scenario.files) writeScenarioFile(root, file);

    const before = snapshotChangesetFiles(root);

    const status = getStatus(root);
    const versionBumps = calculateVersionBumps(
      new Map(Object.entries(scenario.currentVersions)),
      root,
    );
    const entries = buildChangelogEntries(
      status.changesets,
      scenario.expected.changelog.target,
    );
    const rendered = generateChangelog(
      scenario.expected.changelog.version,
      entries,
    );

    expect(status.hasChangesets).toBe(true);
    expect(versionBumps.size).toBe(2);
    expect(rendered).toContain("## 2.4.0");
    expect(snapshotChangesetFiles(root)).toEqual(before);
    expect(existsSync(path.join(root, "CHANGELOG.md"))).toBe(false);
  });
});
