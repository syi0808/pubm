import type { BumpType, Release } from "../../../src/changeset/parser.js";

export interface ChangesetFileScenario {
  fileName: string;
  releases: Release[];
  summary: string;
}

export interface ChangesetWorkflowScenario {
  id: string;
  description: string;
  files: readonly ChangesetFileScenario[];
  currentVersions: Record<string, string>;
  expected: {
    status: Record<
      string,
      {
        bumpType: BumpType;
        changesetCount: number;
        summaries: readonly string[];
      }
    >;
    versionBumps: Record<
      string,
      {
        currentVersion: string;
        newVersion: string;
        bumpType: BumpType;
      }
    >;
    changelog: {
      target: string;
      version: string;
      contains: readonly string[];
    };
  };
}

export const changesetWorkflowScenarios = [
  {
    id: "add-like-round-trip",
    description:
      "Generated add-like content can be written, read, parsed, projected into status, version bumps, and changelog entries.",
    files: [
      {
        fileName: "brave-core.md",
        releases: [
          { path: "packages/core", ecosystem: "js", type: "minor" },
          { path: "packages/pubm", ecosystem: "js", type: "patch" },
        ],
        summary: "Add registry-aware publish planning.",
      },
    ],
    currentVersions: {
      "packages/core::js": "1.4.0",
      "packages/pubm::js": "1.4.0",
    },
    expected: {
      status: {
        "packages/core::js": {
          bumpType: "minor",
          changesetCount: 1,
          summaries: ["Add registry-aware publish planning."],
        },
        "packages/pubm::js": {
          bumpType: "patch",
          changesetCount: 1,
          summaries: ["Add registry-aware publish planning."],
        },
      },
      versionBumps: {
        "packages/core::js": {
          currentVersion: "1.4.0",
          newVersion: "1.5.0",
          bumpType: "minor",
        },
        "packages/pubm::js": {
          currentVersion: "1.4.0",
          newVersion: "1.4.1",
          bumpType: "patch",
        },
      },
      changelog: {
        target: "packages/core::js",
        version: "1.5.0",
        contains: [
          "## 1.5.0",
          "### Minor Changes",
          "- Add registry-aware publish planning.",
        ],
      },
    },
  },
  {
    id: "semantic-aggregation",
    description:
      "Multiple changesets for the same package preserve summaries and select the highest semantic bump.",
    files: [
      {
        fileName: "calm-fix.md",
        releases: [{ path: "packages/core", ecosystem: "js", type: "patch" }],
        summary: "Fix status output for private packages.",
      },
      {
        fileName: "keen-feature.md",
        releases: [{ path: "packages/core", ecosystem: "js", type: "minor" }],
        summary: "Expose snapshot filters in the SDK.",
      },
      {
        fileName: "bold-breaking.md",
        releases: [{ path: "packages/plugin", ecosystem: "js", type: "major" }],
        summary: "Require explicit plugin publish targets.",
      },
    ],
    currentVersions: {
      "packages/core::js": "2.3.4",
      "packages/plugin::js": "0.8.0",
    },
    expected: {
      status: {
        "packages/core::js": {
          bumpType: "minor",
          changesetCount: 2,
          summaries: [
            "Fix status output for private packages.",
            "Expose snapshot filters in the SDK.",
          ],
        },
        "packages/plugin::js": {
          bumpType: "major",
          changesetCount: 1,
          summaries: ["Require explicit plugin publish targets."],
        },
      },
      versionBumps: {
        "packages/core::js": {
          currentVersion: "2.3.4",
          newVersion: "2.4.0",
          bumpType: "minor",
        },
        "packages/plugin::js": {
          currentVersion: "0.8.0",
          newVersion: "1.0.0",
          bumpType: "major",
        },
      },
      changelog: {
        target: "packages/core::js",
        version: "2.4.0",
        contains: [
          "## 2.4.0",
          "### Minor Changes",
          "- Expose snapshot filters in the SDK.",
          "### Patch Changes",
          "- Fix status output for private packages.",
        ],
      },
    },
  },
] satisfies readonly ChangesetWorkflowScenario[];

export const invalidChangesetScenarios = [
  {
    id: "invalid-bump",
    description:
      "Invalid bump labels fail before any semantic projection runs.",
    fileName: "bad-bump.md",
    content: '---\n"packages/core::js": prerelease\n---\n\nInvalid bump.\n',
    message:
      'Invalid bump type "prerelease" for package "packages/core::js" in "bad-bump.md"',
  },
  {
    id: "invalid-package-key",
    description:
      "Malformed path::ecosystem keys fail instead of producing ambiguous package semantics.",
    fileName: "bad-key.md",
    content: '---\n"packages/core::": patch\n---\n\nInvalid key.\n',
    message:
      'Invalid package key "packages/core::" in "bad-key.md". Expected "path::ecosystem" with non-empty path and ecosystem.',
  },
] as const;
