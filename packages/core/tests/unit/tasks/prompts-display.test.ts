import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import {
  buildDependencyBumpNote,
  displayRecommendationSummary,
  renderPackageVersionSummary,
} from "../../../src/tasks/prompts/display.js";
import { versionChoices } from "../../../src/tasks/prompts/version-choices.js";

const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;

afterEach(() => {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }
  if (originalForceColor === undefined) {
    delete process.env.FORCE_COLOR;
  } else {
    process.env.FORCE_COLOR = originalForceColor;
  }
});

function hasAnsi(value: string): boolean {
  return value.includes("\u001B[");
}

function pipeColumns(value: string): number[] {
  return [...value.matchAll(/\|/g)].map((match) => match.index ?? -1);
}

describe("prompt display colors", () => {
  it("renders recommendations as an improved table", () => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;

    const summary = stripVTControlCharacters(
      displayRecommendationSummary([
        {
          packagePath: "packages/core",
          bumpType: "minor",
          source: "changeset",
          entries: [
            { summary: "Add release automation" },
            { summary: "Document setup" },
          ],
        },
        {
          packagePath: "packages/pubm",
          bumpType: "patch",
          source: "commit",
          entries: [{ summary: "fix: npm login" }],
        },
      ]),
    );

    expect(summary).toContain("Version Recommendations");
    expect(summary).toContain("Package");
    expect(summary).toContain("Bump");
    expect(summary).toContain("Source");
    expect(summary).toContain("Details");
    expect(summary).toContain("Package       | Bump  | Source    | Details");
    expect(summary).toContain(
      "------------- | ----- | --------- | ----------------------------------",
    );
    expect(summary).toContain(
      'packages/core | minor | changeset | "Add release automation" (+1 more)',
    );
    expect(summary).toContain(
      "packages/pubm | patch | commit    | fix: npm login",
    );
    expect(summary).toContain("2 packages to bump");
    expect(summary).not.toContain("bump:");
    expect(summary).not.toContain("source:");
    expect(summary).not.toContain("detail:");

    const lines = summary.split("\n").filter(Boolean);
    const headerLine = lines.find((line) => line.startsWith("Package")) ?? "";
    const dividerLine = lines.find((line) => line.startsWith("-")) ?? "";
    const coreLine =
      lines.find((line) => line.startsWith("packages/core")) ?? "";
    const pubmLine =
      lines.find((line) => line.startsWith("packages/pubm")) ?? "";

    expect(headerLine).not.toBe("");
    expect(dividerLine).not.toBe("");
    expect(coreLine).not.toBe("");
    expect(pubmLine).not.toBe("");
    expect(pipeColumns(dividerLine)).toEqual(pipeColumns(headerLine));
    expect(pipeColumns(coreLine)).toEqual(pipeColumns(headerLine));
    expect(pipeColumns(pubmLine)).toEqual(pipeColumns(headerLine));
  });

  it("keeps long recommendation details within the table width", () => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;

    const summary = stripVTControlCharacters(
      displayRecommendationSummary([
        {
          packagePath: "packages/core",
          bumpType: "minor",
          source: "changeset",
          entries: [
            {
              summary:
                "Add a very long recommendation detail that would otherwise stretch the table",
            },
          ],
        },
      ]),
    );

    const detailLine = summary
      .split("\n")
      .find((line) => line.includes("packages/core"));

    expect(detailLine).toContain("...");
    expect(detailLine).toContain(
      '"Add a very long recommendation detail that w...',
    );
  });

  it("highlights recommendation summary headings, packages, and bump types", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";

    const summary = displayRecommendationSummary([
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "changeset",
        entries: [{ summary: "Add feature" }],
      },
      {
        packagePath: "packages/pubm",
        bumpType: "patch",
        source: "commit",
        entries: [{ summary: "fix: bug" }],
      },
    ]);

    expect(hasAnsi(summary)).toBe(true);
    expect(summary).toContain("\u001b[1mVersion Recommendations");
    expect(summary).toContain("\u001b[1mpackages/core");
    expect(summary).toContain("\u001b[36mminor");
    expect(summary).toContain("\u001b[32mpatch");
    expect(summary).toContain("\u001b[35mchangeset");
    expect(stripVTControlCharacters(summary)).toContain("packages/core");
  });

  it("highlights selected versions and dependency bump notes", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const packages: ResolvedPackageConfig[] = [
      {
        name: "@pubm/core",
        version: "1.2.3",
        path: "packages/core",
        dependencies: [],
        registries: ["npm"],
        ecosystem: "js",
      },
    ];
    const selectedVersions = new Map([["packages/core::js", "1.2.4"]]);

    const summary = renderPackageVersionSummary(
      packages,
      new Map([["packages/core", "1.2.3"]]),
      selectedVersions,
    );
    const note = buildDependencyBumpNote("1.2.3", ["@pubm/core"]);

    expect(summary).toContain("\u001b[32mv1.2.4");
    expect(note).toContain("\u001b[32m1.2.4");
    expect(stripVTControlCharacters(note)).toContain("@pubm/core");
  });

  it("highlights the recommended version choice marker", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";

    const recommended = versionChoices("1.2.3", "minor").find((choice) =>
      stripVTControlCharacters(String(choice.message)).includes("recommended"),
    );

    expect(recommended?.message).toContain("\u001b[93m");
  });
});
