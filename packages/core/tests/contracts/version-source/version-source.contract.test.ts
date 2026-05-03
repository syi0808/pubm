import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import { handleMultiPackage } from "../../../src/tasks/prompts/independent-mode.js";
import { analyzeAllSources } from "../../../src/tasks/prompts/version-choices.js";
import { mergeRecommendations } from "../../../src/version-source/index.js";
import {
  applyVersionSourcePlan,
  createVersionPlanFromRecommendations,
} from "../../../src/version-source/plan.js";
import type { VersionRecommendation } from "../../../src/version-source/types.js";

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock("@pubm/runner", () => ({
  color: new Proxy(
    {},
    {
      get: () => (value: string) => value,
    },
  ),
}));

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock("std-env", () => ({
  isCI: true,
}));

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pubm-version-source-"));
  roots.push(root);
  return root;
}

function writeFixture(root: string, relativePath: string, contents: string) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf-8");
}

function writeChangeset(root: string, fileName: string, contents: string) {
  writeFixture(root, path.join(".pubm", "changesets", fileName), contents);
}

function makePackage(
  overrides: Partial<ResolvedPackageConfig> & {
    name: string;
    path: string;
    version: string;
  },
): ResolvedPackageConfig {
  return {
    dependencies: [],
    ecosystem: "js",
    registries: ["npm"],
    ...overrides,
  };
}

function makeContext(
  root: string,
  packages: ResolvedPackageConfig[],
  versioning: "independent" | "fixed" = "independent",
) {
  return {
    cwd: root,
    config: {
      packages,
      release: {
        versioning: {
          mode: versioning,
          fixed: [],
          linked: [],
          updateInternalDependencies: "patch",
        },
        changesets: { directory: ".pubm/changesets" },
        commits: { format: "conventional", types: {} },
        changelog: true,
        pullRequest: {
          branchTemplate: "pubm/release/{scopeSlug}",
          titleTemplate: "chore(release): {scope} {version}",
          label: "pubm:release-pr",
          bumpLabels: {
            patch: "release:patch",
            minor: "release:minor",
            major: "release:major",
            prerelease: "release:prerelease",
          },
          grouping: versioning,
          fixed: [],
          linked: [],
          unversionedChanges: "warn",
        },
      },
    },
    runtime: {},
  };
}

function mockGitLog(output: string) {
  mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
    if (args[0] === "tag") return "";
    if (args[0] === "log" && args.includes("--grep=^Version Packages$")) {
      return "";
    }
    if (args[0] === "log" && args.includes("--name-only")) {
      return output;
    }
    return "";
  });
}

function commitLog(...lines: string[]): string {
  return [...lines, ""].join("\n");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGitLog("");
});

describe("version source contracts", () => {
  it("analyzes changesets and conventional commits from release config", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
    ];
    writeChangeset(
      root,
      "calm-owl.md",
      '---\n"@scope/core": minor\n---\n\nAdd the contract surface.\n',
    );
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "fix(core): commit-only fix",
        "COMMIT_FILES",
        "packages/core/src/index.ts",
        "COMMIT_START def5678",
        "fix(cli): repair flag parsing",
        "COMMIT_FILES",
        "packages/cli/src/cli.ts",
      ),
    );

    const recommendations = await analyzeAllSources(
      makeContext(root, packages) as never,
    );

    expect(recommendations).toEqual([
      {
        packagePath: "packages/core",
        packageKey: "packages/core::js",
        bumpType: "minor",
        source: "changeset",
        entries: [
          {
            summary: "Add the contract surface.",
            id: "calm-owl",
          },
        ],
      },
      {
        packagePath: "packages/cli",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [
          {
            summary: "fix(cli): repair flag parsing",
            type: "fix",
            hash: "def5678",
          },
        ],
      },
    ]);
  });

  it("keeps same-path multi-ecosystem changeset recommendations separate", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        ecosystem: "js",
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        ecosystem: "rust",
        name: "core-crate",
        path: "packages/core",
        version: "1.0.0",
        registries: ["crates"],
      }),
    ];
    writeChangeset(
      root,
      "multi-ecosystem.md",
      [
        "---",
        '"packages/core::js": minor',
        '"packages/core::rust": patch',
        "---",
        "",
        "Release both ecosystems independently.",
        "",
      ].join("\n"),
    );

    const recommendations = await analyzeAllSources(
      makeContext(root, packages) as never,
    );

    expect(recommendations).toEqual([
      {
        packagePath: "packages/core",
        packageKey: "packages/core::js",
        bumpType: "minor",
        source: "changeset",
        entries: [
          {
            summary: "Release both ecosystems independently.",
            id: "multi-ecosystem",
          },
        ],
      },
      {
        packagePath: "packages/core",
        packageKey: "packages/core::rust",
        bumpType: "patch",
        source: "changeset",
        entries: [
          {
            summary: "Release both ecosystems independently.",
            id: "multi-ecosystem",
          },
        ],
      },
    ]);
  });

  it("uses conventional commit recommendations when no changeset covers the package", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
    ];
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "feat(core): add core API",
        "COMMIT_FILES",
        "packages/core/src/index.ts",
        "COMMIT_START def5678",
        "fix(cli): repair flag parsing",
        "COMMIT_FILES",
        "packages/cli/src/cli.ts",
        "COMMIT_START fedcba9",
        "docs: update README",
        "COMMIT_FILES",
        "README.md",
      ),
    );

    const recommendations = await analyzeAllSources(
      makeContext(root, packages) as never,
    );

    expect(recommendations).toEqual([
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "conventional-commit",
        entries: [
          {
            summary: "feat(core): add core API",
            type: "feat",
            hash: "abc1234",
          },
        ],
      },
      {
        packagePath: "packages/cli",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [
          {
            summary: "fix(cli): repair flag parsing",
            type: "fix",
            hash: "def5678",
          },
        ],
      },
    ]);
  });

  it("keeps the first source result when recommendations overlap", () => {
    const changesets: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "minor",
        source: "changeset",
        entries: [{ summary: "Add API", id: "cs-1" }],
      },
    ];
    const commits: VersionRecommendation[] = [
      {
        packagePath: "packages/core",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [{ summary: "fix(core): bug", type: "fix", hash: "abc" }],
      },
      {
        packagePath: "packages/cli",
        bumpType: "patch",
        source: "conventional-commit",
        entries: [{ summary: "fix(cli): bug", type: "fix", hash: "def" }],
      },
    ];

    expect(mergeRecommendations([changesets, commits])).toEqual([
      changesets[0],
      commits[1],
    ]);
  });

  it("maps accepted recommendations differently for independent and fixed versioning", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
    ];
    writeChangeset(
      root,
      "planned-release.md",
      [
        "---",
        '"packages/core": minor',
        '"packages/cli": patch',
        "---",
        "",
        "Release both packages.",
        "",
      ].join("\n"),
    );

    const independentCtx = makeContext(root, packages, "independent");
    await handleMultiPackage(independentCtx as never, {} as never, packages);

    expect(independentCtx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/core::js", "1.1.0"],
        ["packages/cli::js", "2.0.1"],
      ]),
    });

    const fixedCtx = makeContext(root, packages, "fixed");
    await handleMultiPackage(fixedCtx as never, {} as never, packages);

    expect(fixedCtx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "2.1.0",
      packages: new Map([
        ["packages/core::js", "2.1.0"],
        ["packages/cli::js", "2.1.0"],
      ]),
    });
  });

  it("keeps a single recommendation package-scoped in independent monorepos", () => {
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
    ];

    const plan = createVersionPlanFromRecommendations(
      makeContext("", packages, "independent").config as never,
      [
        {
          packagePath: "packages/core",
          packageKey: "packages/core::js",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Add API", id: "cs-1" }],
        },
      ],
    );

    expect(plan).toEqual({
      mode: "independent",
      packages: new Map([["packages/core::js", "1.1.0"]]),
    });
  });

  it("uses empty release group defaults when group arrays are omitted", () => {
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
    ];
    const ctx = makeContext("", packages, "independent");
    ctx.config.release.versioning.fixed = undefined as never;
    ctx.config.release.versioning.linked = undefined as never;

    const plan = createVersionPlanFromRecommendations(ctx.config as never, [
      {
        packagePath: "packages/core",
        bumpType: "patch",
        source: "changeset",
        entries: [{ summary: "Fix core", id: "cs-1" }],
      },
    ]);

    expect(plan).toEqual({
      mode: "independent",
      packages: new Map([["packages/core::js", "1.0.1"]]),
    });
  });

  it("applies fixed and linked group bump semantics in independent monorepos", () => {
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
      makePackage({
        name: "@scope/ui",
        path: "packages/ui",
        version: "3.0.0",
      }),
    ];
    const ctx = makeContext("", packages, "independent");
    ctx.config.release.versioning.fixed = [["@scope/core", "@scope/cli"]];
    ctx.config.release.versioning.linked = [["@scope/*"]];

    const plan = createVersionPlanFromRecommendations(ctx.config as never, [
      {
        packagePath: "packages/core",
        packageKey: "packages/core::js",
        bumpType: "patch",
        source: "changeset",
        entries: [{ summary: "Fix core", id: "cs-1" }],
      },
      {
        packagePath: "packages/ui",
        bumpType: "minor",
        source: "changeset",
        entries: [{ summary: "Add UI", id: "cs-2" }],
      },
    ]);

    expect(plan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/cli::js", "2.1.0"],
        ["packages/core::js", "1.1.0"],
        ["packages/ui::js", "3.1.0"],
      ]),
    });
  });

  it("expands fixed version plans to every configured package", () => {
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
    ];

    const plan = createVersionPlanFromRecommendations(
      makeContext("", packages, "fixed").config as never,
      [
        {
          packagePath: "packages/core",
          packageKey: "packages/core::js",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Add API", id: "cs-1" }],
        },
      ],
    );

    expect(plan).toEqual({
      mode: "fixed",
      version: "2.1.0",
      packages: new Map([
        ["packages/core::js", "2.1.0"],
        ["packages/cli::js", "2.1.0"],
      ]),
    });
  });

  it("handles empty, invalid, and single-package recommendation plans", () => {
    const singlePackage = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
    ];
    expect(
      createVersionPlanFromRecommendations(
        makeContext("", singlePackage, "independent").config as never,
        [],
      ),
    ).toBeUndefined();
    expect(
      createVersionPlanFromRecommendations(
        makeContext("", singlePackage, "independent").config as never,
        [
          {
            packagePath: "packages/missing",
            bumpType: "patch",
            source: "changeset",
            entries: [],
          },
        ],
      ),
    ).toBeUndefined();
    expect(
      createVersionPlanFromRecommendations(
        makeContext(
          "",
          [
            makePackage({
              name: "@scope/core",
              path: "packages/core",
              version: "invalid",
            }),
          ],
          "independent",
        ).config as never,
        [
          {
            packagePath: "packages/core",
            bumpType: "patch",
            source: "changeset",
            entries: [],
          },
        ],
      ),
    ).toBeUndefined();

    expect(
      createVersionPlanFromRecommendations(
        makeContext("", singlePackage, "independent").config as never,
        [
          {
            packagePath: "packages/core",
            bumpType: "minor",
            source: "changeset",
            entries: [],
          },
        ],
      ),
    ).toEqual({
      mode: "single",
      packageKey: "packages/core::js",
      version: "1.1.0",
    });
  });

  it("uses the highest semver result for fixed version plans", () => {
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "2.0.0",
      }),
    ];

    expect(
      createVersionPlanFromRecommendations(
        makeContext("", packages, "fixed").config as never,
        [
          {
            packagePath: "packages/core",
            bumpType: "patch",
            source: "changeset",
            entries: [],
          },
          {
            packagePath: "packages/cli",
            bumpType: "minor",
            source: "changeset",
            entries: [],
          },
        ],
      ),
    ).toEqual({
      mode: "fixed",
      version: "2.1.0",
      packages: new Map([
        ["packages/core::js", "2.1.0"],
        ["packages/cli::js", "2.1.0"],
      ]),
    });

    const reversedPackages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "2.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "1.0.0",
      }),
    ];

    expect(
      createVersionPlanFromRecommendations(
        makeContext("", reversedPackages, "fixed").config as never,
        [
          {
            packagePath: "packages/core",
            bumpType: "patch",
            source: "changeset",
            entries: [],
          },
          {
            packagePath: "packages/cli",
            bumpType: "patch",
            source: "changeset",
            entries: [],
          },
        ],
      ),
    ).toEqual({
      mode: "fixed",
      version: "2.0.1",
      packages: new Map([
        ["packages/core::js", "2.0.1"],
        ["packages/cli::js", "2.0.1"],
      ]),
    });
  });

  it("applies version source plans and marks consumed changesets", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
    ];
    writeChangeset(
      root,
      "api.md",
      '---\n"@scope/core": minor\n---\n\nAdd API.\n',
    );
    const changesetCtx = makeContext(root, packages);

    await applyVersionSourcePlan(changesetCtx as never);

    expect(changesetCtx.runtime.versionPlan).toEqual({
      mode: "single",
      packageKey: "packages/core::js",
      version: "1.1.0",
    });
    expect(changesetCtx.runtime.changesetConsumed).toBe(true);

    const commitRoot = makeRoot();
    const commitCtx = makeContext(commitRoot, packages);
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "fix(core): repair path handling",
        "COMMIT_FILES",
        "packages/core/src/index.ts",
      ),
    );

    await applyVersionSourcePlan(commitCtx as never);

    expect(commitCtx.runtime.versionPlan).toEqual({
      mode: "single",
      packageKey: "packages/core::js",
      version: "1.0.1",
    });
    expect(commitCtx.runtime.changesetConsumed).toBe(false);
  });

  it("leaves the version plan unset without versioned recommendations", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
    ];
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "docs(core): clarify usage",
        "COMMIT_FILES",
        "packages/core/README.md",
      ),
    );
    const ctx = makeContext(root, packages);

    await applyVersionSourcePlan(ctx as never);

    expect(ctx.runtime.versionPlan).toBeUndefined();
    expect(ctx.runtime.changesetConsumed).toBeUndefined();
    expect(ctx.runtime.releaseAnalysis?.unversionedChanges).toEqual([
      {
        hash: "abc1234",
        summary: "docs(core): clarify usage",
        files: ["packages/core/README.md"],
        reason: "ignored-type",
        packagePath: "packages/core",
        type: "docs",
      },
    ]);
  });

  it("returns no recommendation and records unversioned changes when changesets and commits have no bump", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
    ];
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "docs(core): clarify usage",
        "COMMIT_FILES",
        "packages/core/README.md",
      ),
    );
    const ctx = makeContext(root, packages);

    const recommendations = await analyzeAllSources(ctx as never);

    expect(recommendations).toEqual([]);
    expect(ctx.runtime.releaseAnalysis?.unversionedChanges).toEqual([
      {
        hash: "abc1234",
        summary: "docs(core): clarify usage",
        files: ["packages/core/README.md"],
        reason: "ignored-type",
        packagePath: "packages/core",
        type: "docs",
      },
    ]);
  });

  it("records unversioned non-conventional and unmatched package changes", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "@scope/core",
        path: "packages/core",
        version: "1.0.0",
      }),
      makePackage({
        name: "@scope/cli",
        path: "packages/cli",
        version: "1.0.0",
      }),
    ];
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "update build scripts",
        "",
        "Keep scripts in sync.",
        "COMMIT_FILES",
        "packages/core/build.ts",
        "COMMIT_START def5678",
        "adjust shared tooling",
        "COMMIT_FILES",
        "tools/release.ts",
        "COMMIT_START fedcba9",
        "feat(unknown): add external tool",
        "COMMIT_FILES",
        "tools/external.ts",
        "COMMIT_START 987fedc",
        "docs(unknown): document external tool",
        "COMMIT_FILES",
        "tools/README.md",
        "COMMIT_START 456abcd",
        "docs(core): refresh package docs",
        "COMMIT_FILES",
        "packages/core/README.md",
        "COMMIT_START 321dcba",
        "docs(unknown): no files reported",
        "COMMIT_FILES",
      ),
    );
    const ctx = makeContext(root, packages);

    const recommendations = await analyzeAllSources(ctx as never);

    expect(recommendations).toEqual([]);
    expect(ctx.runtime.releaseAnalysis?.unversionedChanges).toEqual([
      {
        hash: "abc1234",
        summary: "update build scripts",
        files: ["packages/core/build.ts"],
        reason: "non-conventional",
        packagePath: "packages/core",
      },
      {
        hash: "def5678",
        summary: "adjust shared tooling",
        files: ["tools/release.ts"],
        reason: "unmatched-package",
      },
      {
        hash: "fedcba9",
        summary: "feat(unknown): add external tool",
        files: ["tools/external.ts"],
        reason: "unmatched-package",
        type: "feat",
      },
      {
        hash: "987fedc",
        summary: "docs(unknown): document external tool",
        files: ["tools/README.md"],
        reason: "unmatched-package",
        type: "docs",
      },
      {
        hash: "456abcd",
        summary: "docs(core): refresh package docs",
        files: ["packages/core/README.md"],
        reason: "ignored-type",
        packagePath: "packages/core",
        type: "docs",
      },
    ]);
  });

  it("treats root package commits without changed files as package changes", async () => {
    const root = makeRoot();
    const packages = [
      makePackage({
        name: "root-pkg",
        path: ".",
        version: "1.0.0",
      }),
    ];
    mockGitLog(
      commitLog(
        "COMMIT_START abc1234",
        "manual release note",
        "",
        "No changed files were reported.",
        "COMMIT_FILES",
      ),
    );
    const ctx = makeContext(root, packages);

    const recommendations = await analyzeAllSources(ctx as never);

    expect(recommendations).toEqual([]);
    expect(ctx.runtime.releaseAnalysis?.unversionedChanges).toEqual([
      {
        hash: "abc1234",
        summary: "manual release note",
        files: [],
        reason: "non-conventional",
        packagePath: ".",
      },
    ]);
  });
});
