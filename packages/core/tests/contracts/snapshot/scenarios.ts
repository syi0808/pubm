import type { ResolvedPackageConfig } from "../../../src/config/types.js";

export interface SnapshotPlanScenario {
  id: string;
  description: string;
  versioning: "fixed" | "independent";
  tag: string;
  template?: string;
  packages: readonly ResolvedPackageConfig[];
  expected: {
    mode: "fixed" | "independent";
    version?: string;
    packages: Record<string, string>;
  };
}

export interface SnapshotFilterScenario {
  id: string;
  description: string;
  filters?: readonly string[];
  expectedPaths?: readonly string[];
  expectedError?: string;
}

export const snapshotPlanScenarios = [
  {
    id: "fixed-monorepo-plan",
    description:
      "Fixed snapshot expansion uses one version derived from the first selected package for all selected packages.",
    versioning: "fixed",
    tag: "canary",
    packages: [
      {
        path: "packages/a",
        name: "@scope/a",
        version: "1.2.3",
        ecosystem: "js",
        dependencies: [],
        registries: ["npm"],
      },
      {
        path: "packages/b",
        name: "@scope/b",
        version: "2.0.0",
        ecosystem: "js",
        dependencies: [],
        registries: ["npm"],
      },
    ],
    expected: {
      mode: "fixed",
      version: "1.2.3-canary-20260427T053000",
      packages: {
        "packages/a::js": "1.2.3-canary-20260427T053000",
        "packages/b::js": "1.2.3-canary-20260427T053000",
      },
    },
  },
  {
    id: "independent-monorepo-plan",
    description:
      "Independent snapshot expansion derives one snapshot version per selected package.",
    versioning: "independent",
    tag: "snapshot",
    template: "{tag}-{timestamp}",
    packages: [
      {
        path: "packages/a",
        name: "@scope/a",
        version: "1.2.3",
        ecosystem: "js",
        dependencies: [],
        registries: ["npm"],
      },
      {
        path: "packages/b",
        name: "@scope/b",
        version: "2.0.0",
        ecosystem: "js",
        dependencies: [],
        registries: ["npm"],
      },
    ],
    expected: {
      mode: "independent",
      packages: {
        "packages/a::js": "1.2.3-snapshot-20260427T053000",
        "packages/b::js": "2.0.0-snapshot-20260427T053000",
      },
    },
  },
] satisfies readonly SnapshotPlanScenario[];

export const snapshotFilterPackages = [
  {
    path: "packages/core",
    name: "@pubm/core",
    version: "1.0.0",
    ecosystem: "js",
    dependencies: [],
    registries: ["npm"],
  },
  {
    path: "packages/pubm",
    name: "pubm",
    version: "1.0.0",
    ecosystem: "js",
    dependencies: [],
    registries: ["npm"],
  },
  {
    path: "packages/plugin-brew",
    name: "@pubm/plugin-brew",
    version: "1.0.0",
    ecosystem: "js",
    dependencies: [],
    registries: ["npm"],
  },
] satisfies readonly ResolvedPackageConfig[];

export const snapshotFilterScenarios = [
  {
    id: "no-filter",
    description: "No filter selects every configured package.",
    expectedPaths: ["packages/core", "packages/pubm", "packages/plugin-brew"],
  },
  {
    id: "name-and-path-filter",
    description: "Filters can mix package names and package paths.",
    filters: ["@pubm/core", "packages/pubm"],
    expectedPaths: ["packages/core", "packages/pubm"],
  },
  {
    id: "missing-filter",
    description: "A filter that resolves no package fails semantically.",
    filters: ["missing-package"],
    expectedError: "No packages matched the provided --filter patterns.",
  },
] satisfies readonly SnapshotFilterScenario[];

export const snapshotPipelinePackages = [
  {
    path: "packages/a",
    name: "@scope/a",
    version: "1.0.0",
    ecosystem: "js",
    dependencies: ["@scope/b"],
    registries: ["npm"],
  },
  {
    path: "packages/b",
    name: "@scope/b",
    version: "2.0.0",
    ecosystem: "js",
    dependencies: [],
    registries: ["npm"],
  },
] satisfies readonly ResolvedPackageConfig[];
