import type { ReleaseBehaviorScenario } from "./contract-types.js";

export const releaseBehaviorScenarios = [
  {
    id: "local-direct-single-npm-jsr",
    description:
      "Local release writes the next version, publishes one package to npm and jsr, then creates git release markers.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-single",
        path: "packages/contract-single",
        currentVersion: "1.0.0",
        registries: ["npm", "jsr"],
      },
    ],
    options: {
      registries: ["npm", "jsr"],
      tag: "latest",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-single",
          from: "1.0.0",
          to: "1.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-single/package.json",
          detail: { version: "1.1.0" },
        },
        {
          kind: "manifest.write",
          target: "packages/contract-single/jsr.json",
          detail: { version: "1.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v1.1.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-single@1.1.0",
          detail: { tag: "latest", version: "1.1.0" },
        },
        {
          kind: "registry.publish",
          target: "jsr:@pubm/contract-single@1.1.0",
          detail: { tag: "latest", version: "1.1.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "github.release",
          target: "v1.1.0",
        },
      ],
      forbiddenSideEffects: [],
      finalVersions: {
        "@pubm/contract-single": "1.1.0",
      },
      finalState: {
        published: [
          "npm:@pubm/contract-single@1.1.0",
          "jsr:@pubm/contract-single@1.1.0",
        ],
        localTags: ["v1.1.0"],
        remoteTags: ["v1.1.0"],
        pushed: true,
      },
      compensationLabels: [
        "Restore packages/contract-single/package.json",
        "Restore packages/contract-single/jsr.json",
        "Reset git commit",
        "Delete local tag v1.1.0",
      ],
    },
  },
  {
    id: "local-dry-run-no-side-effects",
    description:
      "Local dry-run computes the same release plan without mutating manifests, registries, or git state.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-dry-run",
        path: "packages/contract-dry-run",
        currentVersion: "2.0.0",
        registries: ["npm", "jsr"],
      },
    ],
    options: {
      dryRun: true,
      registries: ["npm", "jsr"],
      tag: "next",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-dry-run",
          from: "2.0.0",
          to: "2.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-dry-run/package.json",
          detail: { version: "2.1.0" },
        },
        {
          kind: "manifest.write",
          target: "packages/contract-dry-run/jsr.json",
          detail: { version: "2.1.0" },
        },
        {
          kind: "registry.dryRun",
          target: "npm:@pubm/contract-dry-run@2.1.0",
          detail: { tag: "next", version: "2.1.0" },
        },
        {
          kind: "registry.dryRun",
          target: "jsr:@pubm/contract-dry-run@2.1.0",
          detail: { tag: "next", version: "2.1.0" },
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-dry-run/package.json",
          detail: { version: "2.0.0" },
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-dry-run/jsr.json",
          detail: { version: "2.0.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-dry-run@2.1.0",
        },
        {
          kind: "registry.publish",
          target: "jsr:@pubm/contract-dry-run@2.1.0",
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v2.1.0",
        },
        {
          kind: "git.push",
          target: "origin",
        },
      ],
      finalVersions: {
        "@pubm/contract-dry-run": "2.0.0",
      },
      finalState: {
        published: [],
        localTags: [],
        remoteTags: [],
        pushed: false,
      },
      compensationLabels: [],
    },
  },
  {
    id: "ci-publish-manifest-version",
    description:
      "CI publish-only mode reads the manifest version and publishes it without writing a new version.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-ci",
        path: "packages/contract-ci",
        currentVersion: "3.2.0",
        registries: ["npm"],
      },
    ],
    options: {
      ci: true,
      publishOnly: true,
      registries: ["npm"],
      tag: "latest",
    },
    versionPlan: {
      source: "manifest",
      changes: [
        {
          packageName: "@pubm/contract-ci",
          from: "3.2.0",
          to: "3.2.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-ci@3.2.0",
          detail: { tag: "latest", version: "3.2.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-ci/package.json",
        },
      ],
      finalVersions: {
        "@pubm/contract-ci": "3.2.0",
      },
      finalState: {
        published: ["npm:@pubm/contract-ci@3.2.0"],
        localTags: [],
        remoteTags: [],
        pushed: false,
      },
      compensationLabels: ["unpublish npm:@pubm/contract-ci@3.2.0"],
    },
  },
  {
    id: "partial-publish-failure-rollback",
    description:
      "A publish failure after one registry succeeds rolls back the successful publish and restores local files.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-flaky",
        path: "packages/contract-flaky",
        currentVersion: "4.0.0",
        registries: ["npm", "jsr"],
      },
    ],
    options: {
      registries: ["npm", "jsr"],
      tag: "latest",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-flaky",
          from: "4.0.0",
          to: "4.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-flaky/package.json",
          detail: { version: "4.1.0" },
        },
        {
          kind: "manifest.write",
          target: "packages/contract-flaky/jsr.json",
          detail: { version: "4.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v4.1.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-flaky@4.1.0",
          detail: { tag: "latest", version: "4.1.0" },
        },
        {
          kind: "registry.unpublish",
          target: "npm:@pubm/contract-flaky@4.1.0",
        },
        {
          kind: "git.tag.delete",
          target: "v4.1.0",
        },
        {
          kind: "git.reset",
          target: "HEAD^ --hard",
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-flaky/jsr.json",
          detail: { version: "4.0.0" },
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-flaky/package.json",
          detail: { version: "4.0.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "git.push",
          target: "origin",
        },
      ],
      finalVersions: {
        "@pubm/contract-flaky": "4.0.0",
      },
      finalState: {
        published: [],
        unpublished: ["npm:@pubm/contract-flaky@4.1.0"],
        localTags: [],
        remoteTags: [],
        pushed: false,
        commits: ["initial"],
      },
      compensationLabels: [
        "Restore packages/contract-flaky/package.json",
        "Restore packages/contract-flaky/jsr.json",
        "Reset git commit",
        "Delete local tag v4.1.0",
        "unpublish npm:@pubm/contract-flaky@4.1.0",
      ],
    },
    failureInjection: {
      at: "registry.publish",
      target: "jsr:@pubm/contract-flaky@4.1.0",
      error: "JSR publish rejected",
    },
  },
  {
    id: "local-fixed-monorepo-npm-jsr",
    description:
      "Fixed monorepo release writes one version across packages, creates a shared tag, publishes all registry targets, and drafts one release.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-fixed-a",
        path: "packages/contract-fixed-a",
        currentVersion: "1.0.0",
        registries: ["npm"],
      },
      {
        name: "@pubm/contract-fixed-b",
        path: "packages/contract-fixed-b",
        currentVersion: "1.0.0",
        registries: ["npm", "jsr"],
      },
    ],
    options: {
      versioning: "fixed",
      registries: ["npm", "jsr"],
      tag: "next",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-fixed-a",
          from: "1.0.0",
          to: "1.2.0",
        },
        {
          packageName: "@pubm/contract-fixed-b",
          from: "1.0.0",
          to: "1.2.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-fixed-a/package.json",
          detail: { version: "1.2.0" },
        },
        {
          kind: "manifest.write",
          target: "packages/contract-fixed-b/package.json",
          detail: { version: "1.2.0" },
        },
        {
          kind: "manifest.write",
          target: "packages/contract-fixed-b/jsr.json",
          detail: { version: "1.2.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v1.2.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-fixed-a@1.2.0",
          detail: { tag: "next", version: "1.2.0" },
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-fixed-b@1.2.0",
          detail: { tag: "next", version: "1.2.0" },
        },
        {
          kind: "registry.publish",
          target: "jsr:@pubm/contract-fixed-b@1.2.0",
          detail: { tag: "next", version: "1.2.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "github.release",
          target: "v1.2.0",
        },
      ],
      forbiddenSideEffects: [],
      finalVersions: {
        "@pubm/contract-fixed-a": "1.2.0",
        "@pubm/contract-fixed-b": "1.2.0",
      },
      finalState: {
        published: [
          "npm:@pubm/contract-fixed-a@1.2.0",
          "npm:@pubm/contract-fixed-b@1.2.0",
          "jsr:@pubm/contract-fixed-b@1.2.0",
        ],
        localTags: ["v1.2.0"],
        remoteTags: ["v1.2.0"],
        pushed: true,
      },
      compensationLabels: [
        "Restore packages/contract-fixed-a/package.json",
        "Restore packages/contract-fixed-b/package.json",
        "Restore packages/contract-fixed-b/jsr.json",
        "Reset git commit",
        "Delete local tag v1.2.0",
      ],
    },
  },
  {
    id: "local-independent-monorepo-tags",
    description:
      "Independent monorepo release writes per-package versions and creates per-package git and GitHub release markers.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-independent-a",
        path: "packages/contract-independent-a",
        currentVersion: "1.0.0",
        registries: ["npm"],
      },
      {
        name: "@pubm/contract-independent-b",
        path: "packages/contract-independent-b",
        currentVersion: "2.0.0",
        registries: ["npm"],
      },
    ],
    options: {
      versioning: "independent",
      registries: ["npm"],
      tag: "latest",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-independent-a",
          from: "1.0.0",
          to: "1.1.0",
        },
        {
          packageName: "@pubm/contract-independent-b",
          from: "2.0.0",
          to: "2.0.1",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-independent-a/package.json",
          detail: { version: "1.1.0" },
        },
        {
          kind: "manifest.write",
          target: "packages/contract-independent-b/package.json",
          detail: { version: "2.0.1" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "@pubm/contract-independent-a@1.1.0",
        },
        {
          kind: "git.tag",
          target: "@pubm/contract-independent-b@2.0.1",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-independent-a@1.1.0",
          detail: { tag: "latest", version: "1.1.0" },
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-independent-b@2.0.1",
          detail: { tag: "latest", version: "2.0.1" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "github.release",
          target: "@pubm/contract-independent-a@1.1.0",
        },
        {
          kind: "github.release",
          target: "@pubm/contract-independent-b@2.0.1",
        },
      ],
      forbiddenSideEffects: [],
      finalVersions: {
        "@pubm/contract-independent-a": "1.1.0",
        "@pubm/contract-independent-b": "2.0.1",
      },
      finalState: {
        published: [
          "npm:@pubm/contract-independent-a@1.1.0",
          "npm:@pubm/contract-independent-b@2.0.1",
        ],
        localTags: [
          "@pubm/contract-independent-a@1.1.0",
          "@pubm/contract-independent-b@2.0.1",
        ],
        remoteTags: [
          "@pubm/contract-independent-a@1.1.0",
          "@pubm/contract-independent-b@2.0.1",
        ],
        pushed: true,
      },
      compensationLabels: [
        "Restore packages/contract-independent-a/package.json",
        "Restore packages/contract-independent-b/package.json",
        "Reset git commit",
        "Delete local tag @pubm/contract-independent-a@1.1.0",
        "Delete local tag @pubm/contract-independent-b@2.0.1",
      ],
    },
  },
  {
    id: "local-independent-crates-order-and-yank",
    description:
      "Independent Rust release writes Cargo manifests, publishes crates in registry order, and registers yank rollbacks.",
    mode: "release",
    packages: [
      {
        name: "contract_crate_z",
        path: "crates/z-dep",
        currentVersion: "1.0.0",
        registries: ["crates"],
        ecosystem: "rust",
      },
      {
        name: "contract_crate_a",
        path: "crates/a-core",
        currentVersion: "2.0.0",
        registries: ["crates"],
        ecosystem: "rust",
      },
    ],
    options: {
      versioning: "independent",
      registries: ["crates"],
      tag: "latest",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "contract_crate_z",
          from: "1.0.0",
          to: "1.0.1",
        },
        {
          packageName: "contract_crate_a",
          from: "2.0.0",
          to: "2.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "crates/z-dep/Cargo.toml",
          detail: { version: "1.0.1" },
        },
        {
          kind: "manifest.write",
          target: "crates/a-core/Cargo.toml",
          detail: { version: "2.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "contract_crate_z@1.0.1",
        },
        {
          kind: "git.tag",
          target: "contract_crate_a@2.1.0",
        },
        {
          kind: "registry.publish",
          target: "crates:contract_crate_a@2.1.0",
          detail: { tag: "latest", version: "2.1.0" },
        },
        {
          kind: "registry.publish",
          target: "crates:contract_crate_z@1.0.1",
          detail: { tag: "latest", version: "1.0.1" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "github.release",
          target: "contract_crate_z@1.0.1",
        },
        {
          kind: "github.release",
          target: "contract_crate_a@2.1.0",
        },
      ],
      forbiddenSideEffects: [],
      finalVersions: {
        contract_crate_z: "1.0.1",
        contract_crate_a: "2.1.0",
      },
      finalState: {
        published: [
          "crates:contract_crate_a@2.1.0",
          "crates:contract_crate_z@1.0.1",
        ],
        localTags: ["contract_crate_z@1.0.1", "contract_crate_a@2.1.0"],
        remoteTags: ["contract_crate_z@1.0.1", "contract_crate_a@2.1.0"],
        pushed: true,
      },
      compensationLabels: [
        "Restore crates/z-dep/Cargo.toml",
        "Restore crates/a-core/Cargo.toml",
        "Reset git commit",
        "Delete local tag contract_crate_z@1.0.1",
        "Delete local tag contract_crate_a@2.1.0",
        "yank crates:contract_crate_a@2.1.0",
        "yank crates:contract_crate_z@1.0.1",
      ],
    },
  },
  {
    id: "local-private-registry-boundary",
    description:
      "Local release publishes to a resolved private npm-compatible registry key without falling back to the public npm target.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-private",
        path: "packages/contract-private",
        currentVersion: "5.0.0",
        registries: ["registry.internal.test/npm"],
      },
    ],
    options: {
      registries: ["registry.internal.test/npm"],
      tag: "internal",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-private",
          from: "5.0.0",
          to: "5.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-private/package.json",
          detail: { version: "5.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v5.1.0",
        },
        {
          kind: "registry.publish",
          target: "registry.internal.test/npm:@pubm/contract-private@5.1.0",
          detail: { tag: "internal", version: "5.1.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "github.release",
          target: "v5.1.0",
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-private@5.1.0",
        },
      ],
      finalVersions: {
        "@pubm/contract-private": "5.1.0",
      },
      finalState: {
        published: ["registry.internal.test/npm:@pubm/contract-private@5.1.0"],
        localTags: ["v5.1.0"],
        remoteTags: ["v5.1.0"],
        pushed: true,
      },
      compensationLabels: [
        "Restore packages/contract-private/package.json",
        "Reset git commit",
        "Delete local tag v5.1.0",
        "unpublish registry.internal.test/npm:@pubm/contract-private@5.1.0",
      ],
    },
  },
  {
    id: "local-push-fallback-version-pr",
    description:
      "A rejected direct git push falls back to a version PR while preserving tags and release creation.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-pr",
        path: "packages/contract-pr",
        currentVersion: "6.0.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "latest",
      pushSucceeds: false,
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-pr",
          from: "6.0.0",
          to: "6.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-pr/package.json",
          detail: { version: "6.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v6.1.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-pr@6.1.0",
          detail: { tag: "latest", version: "6.1.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags", result: false },
        },
        {
          kind: "git.branch.create",
          target: "pubm/version-packages-1770000000000",
        },
        {
          kind: "git.branch.push",
          target: "origin/pubm/version-packages-1770000000000",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "github.pr.create",
          target: "pubm/version-packages-1770000000000",
          detail: { number: 42 },
        },
        {
          kind: "git.switch",
          target: "main",
        },
        {
          kind: "github.release",
          target: "v6.1.0",
        },
      ],
      forbiddenSideEffects: [],
      finalVersions: {
        "@pubm/contract-pr": "6.1.0",
      },
      finalState: {
        published: ["npm:@pubm/contract-pr@6.1.0"],
        localTags: ["v6.1.0"],
        remoteTags: ["v6.1.0"],
        branches: [
          "pubm/version-packages-1770000000000",
          "origin/pubm/version-packages-1770000000000",
        ],
        pullRequest: {
          number: 42,
          branch: "pubm/version-packages-1770000000000",
          closed: false,
        },
        pushed: true,
      },
      compensationLabels: [
        "Restore packages/contract-pr/package.json",
        "Reset git commit",
        "Delete local tag v6.1.0",
        'task.push.deleteRemoteTag {"tag":"v6.1.0"}',
        'task.push.deleteRemoteBranch {"branch":"pubm/version-packages-1770000000000"}',
        'task.push.closePr {"number":42}',
      ],
    },
  },
  {
    id: "local-release-browser-draft-fallback",
    description:
      "Local release opens a browser draft URL instead of calling the GitHub API when no token is available.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-browser",
        path: "packages/contract-browser",
        currentVersion: "7.0.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "latest",
      githubToken: false,
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-browser",
          from: "7.0.0",
          to: "7.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-browser/package.json",
          detail: { version: "7.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v7.1.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-browser@7.1.0",
          detail: { tag: "latest", version: "7.1.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "browser.open",
          target: "https://github.com/acme/repo/releases/new",
          detail: { tag: "v7.1.0", prerelease: "false" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "github.release",
          target: "v7.1.0",
        },
      ],
      finalVersions: {
        "@pubm/contract-browser": "7.1.0",
      },
      finalState: {
        published: ["npm:@pubm/contract-browser@7.1.0"],
        localTags: ["v7.1.0"],
        remoteTags: ["v7.1.0"],
        pushed: true,
      },
      compensationLabels: [
        "Restore packages/contract-browser/package.json",
        "Reset git commit",
        "Delete local tag v7.1.0",
      ],
    },
  },
  {
    id: "local-github-release-assets-payload",
    description:
      "GitHub release creation preserves release metadata and prepared asset payloads at the external boundary.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-assets",
        path: "packages/contract-assets",
        currentVersion: "8.0.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "latest",
      releaseAssets: true,
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-assets",
          from: "8.0.0",
          to: "8.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-assets/package.json",
          detail: { version: "8.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v8.1.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-assets@8.1.0",
          detail: { tag: "latest", version: "8.1.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "github.release",
          target: "v8.1.0",
          detail: {
            displayLabel: "@pubm/contract-assets",
            version: "8.1.0",
            draft: false,
            assets: [
              {
                name: "pubm-contract-darwin-arm64.tar.gz",
                sha256: "asset-sha256",
              },
            ],
          },
        },
      ],
      forbiddenSideEffects: [],
      finalVersions: {
        "@pubm/contract-assets": "8.1.0",
      },
      finalState: {
        published: ["npm:@pubm/contract-assets@8.1.0"],
        localTags: ["v8.1.0"],
        remoteTags: ["v8.1.0"],
        pushed: true,
        releases: [
          {
            id: "release-v8.1.0",
            tag: "v8.1.0",
            deleted: false,
          },
        ],
      },
      compensationLabels: [
        "Restore packages/contract-assets/package.json",
        "Reset git commit",
        "Delete local tag v8.1.0",
      ],
    },
  },
  {
    id: "github-release-create-fails-after-push",
    description:
      "A GitHub release create failure after publish and push rolls back registry, local git, and remote git side effects.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-release-fail",
        path: "packages/contract-release-fail",
        currentVersion: "9.0.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "latest",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-release-fail",
          from: "9.0.0",
          to: "9.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-release-fail/package.json",
          detail: { version: "9.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v9.1.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-release-fail@9.1.0",
          detail: { tag: "latest", version: "9.1.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "git.forcePush",
          target: "origin sha-HEAD~1:main",
        },
        {
          kind: "git.remoteTag.delete",
          target: "v9.1.0",
        },
        {
          kind: "registry.unpublish",
          target: "npm:@pubm/contract-release-fail@9.1.0",
        },
        {
          kind: "git.tag.delete",
          target: "v9.1.0",
        },
        {
          kind: "git.reset",
          target: "HEAD^ --hard",
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-release-fail/package.json",
          detail: { version: "9.0.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "github.release",
          target: "v9.1.0",
        },
      ],
      finalVersions: {
        "@pubm/contract-release-fail": "9.0.0",
      },
      finalState: {
        published: [],
        unpublished: ["npm:@pubm/contract-release-fail@9.1.0"],
        localTags: [],
        remoteTags: [],
        commits: ["initial"],
      },
      compensationLabels: [
        "Restore packages/contract-release-fail/package.json",
        "Reset git commit",
        "Delete local tag v9.1.0",
        "unpublish npm:@pubm/contract-release-fail@9.1.0",
        'task.push.deleteRemoteTag {"tag":"v9.1.0"}',
        'task.push.forceRevert {"branch":"main"}',
      ],
    },
    failureInjection: {
      at: "github.release",
      target: "v9.1.0",
      error: "GitHub release rejected",
    },
  },
  {
    id: "github-release-asset-upload-fails-after-release-created",
    description:
      "An asset upload failure deletes the created GitHub release before the runner rollback compensates previous side effects.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-asset-fail",
        path: "packages/contract-asset-fail",
        currentVersion: "9.1.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "latest",
      releaseAssets: true,
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-asset-fail",
          from: "9.1.0",
          to: "9.2.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-asset-fail/package.json",
          detail: { version: "9.2.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v9.2.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-asset-fail@9.2.0",
          detail: { tag: "latest", version: "9.2.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "github.release",
          target: "v9.2.0",
        },
        {
          kind: "github.release.delete",
          target: "release-v9.2.0",
        },
        {
          kind: "git.forcePush",
          target: "origin sha-HEAD~1:main",
        },
        {
          kind: "git.remoteTag.delete",
          target: "v9.2.0",
        },
        {
          kind: "registry.unpublish",
          target: "npm:@pubm/contract-asset-fail@9.2.0",
        },
        {
          kind: "git.tag.delete",
          target: "v9.2.0",
        },
        {
          kind: "git.reset",
          target: "HEAD^ --hard",
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-asset-fail/package.json",
          detail: { version: "9.1.0" },
        },
      ],
      forbiddenSideEffects: [],
      finalVersions: {
        "@pubm/contract-asset-fail": "9.1.0",
      },
      finalState: {
        published: [],
        unpublished: ["npm:@pubm/contract-asset-fail@9.2.0"],
        localTags: [],
        remoteTags: [],
        commits: ["initial"],
        releases: [
          {
            id: "release-v9.2.0",
            tag: "v9.2.0",
            deleted: true,
          },
        ],
      },
      compensationLabels: [
        "Restore packages/contract-asset-fail/package.json",
        "Reset git commit",
        "Delete local tag v9.2.0",
        "unpublish npm:@pubm/contract-asset-fail@9.2.0",
        'task.push.deleteRemoteTag {"tag":"v9.2.0"}',
        'task.push.forceRevert {"branch":"main"}',
      ],
    },
    failureInjection: {
      at: "github.assetUpload",
      target: "v9.2.0",
      error: "GitHub asset upload rejected",
    },
  },
  {
    id: "crates-publish-then-github-release-fails",
    description:
      "A release failure after crates publish yanks the crate and restores local/remote git state.",
    mode: "release",
    packages: [
      {
        name: "contract_crate_fail",
        path: "crates/fail",
        currentVersion: "3.0.0",
        registries: ["crates"],
        ecosystem: "rust",
      },
    ],
    options: {
      registries: ["crates"],
      tag: "latest",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "contract_crate_fail",
          from: "3.0.0",
          to: "3.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "crates/fail/Cargo.toml",
          detail: { version: "3.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v3.1.0",
        },
        {
          kind: "registry.publish",
          target: "crates:contract_crate_fail@3.1.0",
          detail: { tag: "latest", version: "3.1.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "git.forcePush",
          target: "origin sha-HEAD~1:main",
        },
        {
          kind: "git.remoteTag.delete",
          target: "v3.1.0",
        },
        {
          kind: "registry.yank",
          target: "crates:contract_crate_fail@3.1.0",
        },
        {
          kind: "git.tag.delete",
          target: "v3.1.0",
        },
        {
          kind: "git.reset",
          target: "HEAD^ --hard",
        },
        {
          kind: "manifest.restore",
          target: "crates/fail/Cargo.toml",
          detail: { version: "3.0.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "github.release",
          target: "v3.1.0",
        },
      ],
      finalVersions: {
        contract_crate_fail: "3.0.0",
      },
      finalState: {
        published: [],
        unpublished: ["crates:contract_crate_fail@3.1.0"],
        localTags: [],
        remoteTags: [],
        commits: ["initial"],
      },
      compensationLabels: [
        "Restore crates/fail/Cargo.toml",
        "Reset git commit",
        "Delete local tag v3.1.0",
        "yank crates:contract_crate_fail@3.1.0",
        'task.push.deleteRemoteTag {"tag":"v3.1.0"}',
        'task.push.forceRevert {"branch":"main"}',
      ],
    },
    failureInjection: {
      at: "github.release",
      target: "v3.1.0",
      error: "GitHub release rejected",
    },
  },
  {
    id: "push-fallback-version-pr-fails",
    description:
      "If direct push fails and the version PR cannot be created, local and remote branch/tag work is compensated.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-pr-fail",
        path: "packages/contract-pr-fail",
        currentVersion: "10.0.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "latest",
      pushSucceeds: false,
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-pr-fail",
          from: "10.0.0",
          to: "10.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-pr-fail/package.json",
          detail: { version: "10.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v10.1.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-pr-fail@10.1.0",
          detail: { tag: "latest", version: "10.1.0" },
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--follow-tags", result: false },
        },
        {
          kind: "git.branch.create",
          target: "pubm/version-packages-1770000000000",
        },
        {
          kind: "git.branch.push",
          target: "origin/pubm/version-packages-1770000000000",
          detail: { args: "--follow-tags" },
        },
        {
          kind: "git.remoteTag.delete",
          target: "v10.1.0",
        },
        {
          kind: "git.remoteTag.delete",
          target: "pubm/version-packages-1770000000000",
        },
        {
          kind: "registry.unpublish",
          target: "npm:@pubm/contract-pr-fail@10.1.0",
        },
        {
          kind: "git.tag.delete",
          target: "v10.1.0",
        },
        {
          kind: "git.reset",
          target: "HEAD^ --hard",
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-pr-fail/package.json",
          detail: { version: "10.0.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "github.pr.create",
          target: "pubm/version-packages-1770000000000",
        },
        {
          kind: "github.release",
          target: "v10.1.0",
        },
      ],
      finalVersions: {
        "@pubm/contract-pr-fail": "10.0.0",
      },
      finalState: {
        published: [],
        unpublished: ["npm:@pubm/contract-pr-fail@10.1.0"],
        localTags: [],
        remoteTags: [],
        commits: ["initial"],
        pullRequest: undefined,
      },
      compensationLabels: [
        "Restore packages/contract-pr-fail/package.json",
        "Reset git commit",
        "Delete local tag v10.1.0",
        "unpublish npm:@pubm/contract-pr-fail@10.1.0",
        'task.push.deleteRemoteBranch {"branch":"pubm/version-packages-1770000000000"}',
        'task.push.deleteRemoteTag {"tag":"v10.1.0"}',
      ],
    },
    failureInjection: {
      at: "github.pr.create",
      target: "pubm/version-packages-1770000000000",
      error: "GitHub PR rejected",
    },
  },
  {
    id: "tag-overwrite-prompt-cancel-rolls-back",
    description:
      "An interactive tag-overwrite prompt cancellation restores manifest writes and prevents publish side effects.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-prompt-cancel",
        path: "packages/contract-prompt-cancel",
        currentVersion: "10.1.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "latest",
      stdinIsTTY: true,
      existingTags: ["v10.2.0"],
      promptResponses: [{ throws: "Prompt cancelled" }],
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-prompt-cancel",
          from: "10.1.0",
          to: "10.2.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-prompt-cancel/package.json",
          detail: { version: "10.2.0" },
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-prompt-cancel/package.json",
          detail: { version: "10.1.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-prompt-cancel@10.2.0",
        },
        {
          kind: "git.push",
          target: "origin",
        },
      ],
      finalVersions: {
        "@pubm/contract-prompt-cancel": "10.1.0",
      },
      finalState: {
        published: [],
        localTags: ["v10.2.0"],
        remoteTags: [],
        pushed: false,
      },
      compensationLabels: [
        "Restore packages/contract-prompt-cancel/package.json",
      ],
    },
    failureInjection: {
      at: "prompt.cancel",
      error: "Prompt cancelled",
    },
  },
  {
    id: "sigint-after-publish-runs-rollback",
    description:
      "SIGINT after a registry publish runs non-confirm rollback work and exits through the interrupt path.",
    mode: "release",
    packages: [
      {
        name: "@pubm/contract-sigint",
        path: "packages/contract-sigint",
        currentVersion: "11.0.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "latest",
      sigintAfter: "registry.publish:npm:@pubm/contract-sigint@11.1.0",
    },
    versionPlan: {
      source: "explicit",
      changes: [
        {
          packageName: "@pubm/contract-sigint",
          from: "11.0.0",
          to: "11.1.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-sigint/package.json",
          detail: { version: "11.1.0" },
        },
        {
          kind: "git.commit",
          target: "Version Packages",
        },
        {
          kind: "git.tag",
          target: "v11.1.0",
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-sigint@11.1.0",
          detail: { tag: "latest", version: "11.1.0" },
        },
        {
          kind: "git.tag.delete",
          target: "v11.1.0",
        },
        {
          kind: "git.reset",
          target: "HEAD^ --hard",
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-sigint/package.json",
          detail: { version: "11.0.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "git.push",
          target: "origin",
        },
        {
          kind: "registry.unpublish",
          target: "npm:@pubm/contract-sigint@11.1.0",
        },
      ],
      finalVersions: {
        "@pubm/contract-sigint": "11.0.0",
      },
      finalState: {
        published: ["npm:@pubm/contract-sigint@11.1.0"],
        localTags: [],
        remoteTags: [],
        commits: ["initial"],
        pushed: false,
      },
      compensationLabels: [
        "Restore packages/contract-sigint/package.json",
        "Reset git commit",
        "Delete local tag v11.1.0",
        "unpublish npm:@pubm/contract-sigint@11.1.0",
      ],
    },
  },
  {
    id: "snapshot-restores-original-versions",
    description:
      "Snapshot publish uses temporary versions and restores original manifest versions after publishing.",
    mode: "snapshot",
    packages: [
      {
        name: "@pubm/contract-snapshot",
        path: "packages/contract-snapshot",
        currentVersion: "0.8.0",
        registries: ["npm"],
      },
    ],
    options: {
      registries: ["npm"],
      tag: "snapshot",
      snapshot: true,
    },
    versionPlan: {
      source: "snapshot",
      changes: [
        {
          packageName: "@pubm/contract-snapshot",
          from: "0.8.0",
          to: "0.8.1-snapshot.20260427.0",
        },
      ],
    },
    expected: {
      sideEffects: [
        {
          kind: "manifest.write",
          target: "packages/contract-snapshot/package.json",
          detail: { version: "0.8.1-snapshot.20260427.0" },
        },
        {
          kind: "registry.publish",
          target: "npm:@pubm/contract-snapshot@0.8.1-snapshot.20260427.0",
          detail: { tag: "snapshot", version: "0.8.1-snapshot.20260427.0" },
        },
        {
          kind: "git.tag",
          target: "v0.8.1-snapshot.20260427.0",
        },
        {
          kind: "git.push",
          target: "origin",
          detail: { args: "--tags" },
        },
        {
          kind: "manifest.restore",
          target: "packages/contract-snapshot/package.json",
          detail: { version: "0.8.0" },
        },
      ],
      forbiddenSideEffects: [
        {
          kind: "github.release",
          target: "@pubm/contract-snapshot@0.8.1-snapshot.20260427.0",
        },
      ],
      finalVersions: {
        "@pubm/contract-snapshot": "0.8.0",
      },
      finalState: {
        published: ["npm:@pubm/contract-snapshot@0.8.1-snapshot.20260427.0"],
        localTags: ["v0.8.1-snapshot.20260427.0"],
        remoteTags: ["v0.8.1-snapshot.20260427.0"],
        pushed: true,
      },
      compensationLabels: [
        "restore manifest @pubm/contract-snapshot",
        "unpublish npm:@pubm/contract-snapshot@0.8.1-snapshot.20260427.0",
      ],
    },
  },
] satisfies readonly ReleaseBehaviorScenario[];

export type ReleaseBehaviorScenarioId =
  (typeof releaseBehaviorScenarios)[number]["id"];
