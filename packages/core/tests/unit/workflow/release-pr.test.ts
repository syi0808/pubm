import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../src/context.js";
import {
  createVersionPlanFromManifestVersions,
  parseReleasePrReleaseNotes,
  prepareReleasePr,
  prepareReleasePrPublish,
  publishReleasePr,
  runReleasePrDryRun,
  scopeVersionPlan,
} from "../../../src/workflow/release-pr.js";
import {
  parseReleasePrBodyMetadata,
  RELEASE_PR_RELEASE_NOTES_END_MARKER,
  RELEASE_PR_RELEASE_NOTES_START_MARKER,
  sameReleasePrScope,
} from "../../../src/workflow/release-utils/release-pr-metadata.js";
import type { ReleasePrScope } from "../../../src/workflow/release-utils/scope.js";

const releasePrState = vi.hoisted(() => ({
  gitCalls: [] as Array<{ name: string; args: unknown[] }>,
  status: "M  packages/a/package.json\nA  packages/a/CHANGELOG.md",
  diffOutput: "packages/a/package.json\n",
  failPushTag: undefined as string | undefined,
  releaseBodyCalls: [] as unknown[],
  writeVersionsCalls: [] as Array<Map<string, string>>,
  runOperationsCalls: [] as unknown[][],
  runOperationsError: undefined as Error | undefined,
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../src/git.js", () => ({
  Git: class MockGit {
    async reset(...args: string[]): Promise<void> {
      releasePrState.gitCalls.push({ name: "reset", args });
    }

    async stage(...args: string[]): Promise<void> {
      releasePrState.gitCalls.push({ name: "stage", args });
    }

    async status(...args: string[]): Promise<string> {
      releasePrState.gitCalls.push({ name: "status", args });
      return releasePrState.status;
    }

    async commit(...args: string[]): Promise<string> {
      releasePrState.gitCalls.push({ name: "commit", args });
      return "commit-1";
    }

    async revParse(...args: string[]): Promise<string> {
      releasePrState.gitCalls.push({ name: "revParse", args });
      return "HEAD";
    }

    async createTag(...args: string[]): Promise<void> {
      releasePrState.gitCalls.push({ name: "createTag", args });
    }

    async checkTagExist(...args: string[]): Promise<boolean> {
      releasePrState.gitCalls.push({ name: "checkTagExist", args });
      return false;
    }

    async git(...args: unknown[]): Promise<string> {
      releasePrState.gitCalls.push({ name: "git", args });
      const command = args[0];
      if (Array.isArray(command) && command[0] === "push") {
        if (command[2] === releasePrState.failPushTag) {
          throw new Error(`push failed for ${command[2]}`);
        }
        return "";
      }
      return releasePrState.diffOutput;
    }

    async repository(): Promise<string> {
      releasePrState.gitCalls.push({ name: "repository", args: [] });
      return "git@github.com:acme/repo.git";
    }
  },
}));

vi.mock("../../../src/tasks/release-notes.js", () => ({
  buildReleaseBody: vi.fn(async (_ctx: PubmContext, input: unknown) => {
    releasePrState.releaseBodyCalls.push(input);
    return `generated release notes for ${(input as { tag: string }).tag}`;
  }),
}));

vi.mock("../../../src/workflow/release-utils/write-versions.js", () => ({
  writeVersions: vi.fn(
    async (_ctx: PubmContext, versions: Map<string, string>) => {
      releasePrState.writeVersionsCalls.push(new Map(versions));
      return ["packages/a/package.json"];
    },
  ),
}));

vi.mock("../../../src/workflow/release-operation.js", () => ({
  runReleaseOperations: vi.fn(
    async (_ctx: PubmContext, operations: unknown[]) => {
      releasePrState.runOperationsCalls.push(operations);
      if (releasePrState.runOperationsError) {
        throw releasePrState.runOperationsError;
      }
    },
  ),
}));

vi.mock("../../../src/workflow/release-phases/dry-run.js", () => ({
  createDryRunOperations: vi.fn((...args: unknown[]) => [
    { kind: "dry-run", args },
  ]),
}));

vi.mock("../../../src/workflow/release-phases/publish.js", () => ({
  createPublishOperations: vi.fn((...args: unknown[]) => [
    { kind: "publish", args },
  ]),
}));

vi.mock("../../../src/workflow/release-phases/push-release.js", () => ({
  createGitHubReleaseOperation: vi.fn((...args: unknown[]) => [
    { kind: "github-release", args },
  ]),
}));

vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(() => []),
  deleteChangesetFiles: vi.fn(),
}));

vi.mock("../../../src/changeset/resolve.js", () => ({
  createKeyResolver: vi.fn(() => (value: string) => value),
}));

function makeContext(): PubmContext {
  const versionPlan = {
    mode: "independent" as const,
    packages: new Map([
      ["packages/a::js", "1.1.0"],
      ["packages/b::js", "2.1.0"],
    ]),
  };

  return {
    cwd: "/repo",
    options: {},
    config: {
      versioning: "independent",
      release: {
        versioning: {
          mode: "independent",
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
          grouping: "independent",
          fixed: [],
          linked: [],
          unversionedChanges: "warn",
        },
      },
      packages: [
        {
          ecosystem: "js",
          name: "@acme/a",
          path: "packages/a",
          registries: ["npm"],
          version: "1.0.0",
          dependencies: [],
        },
        {
          ecosystem: "js",
          name: "@acme/b",
          path: "packages/b",
          registries: ["npm"],
          version: "2.0.0",
          dependencies: [],
        },
      ],
      fixed: [],
      linked: [],
      plugins: [],
      excludeRelease: [],
      registryQualifiedTags: false,
    },
    runtime: {
      changesetConsumed: false,
      cleanWorkingTree: true,
      pluginRunner: {
        runHook: vi.fn(async () => undefined),
      },
      promptEnabled: false,
      rollback: {
        add: vi.fn(),
        execute: vi.fn(async () => undefined),
      },
      tag: "latest",
      versionPlan,
    },
  } as unknown as PubmContext;
}

const scope: ReleasePrScope = {
  id: "packages/a::js",
  kind: "package",
  packageKeys: ["packages/a::js"],
  displayName: "@acme/a",
  slug: "packages-a-js",
};

beforeEach(() => {
  vi.clearAllMocks();
  releasePrState.gitCalls = [];
  releasePrState.status =
    "M  packages/a/package.json\nA  packages/a/CHANGELOG.md";
  releasePrState.diffOutput = "packages/a/package.json\n";
  releasePrState.failPushTag = undefined;
  releasePrState.releaseBodyCalls = [];
  releasePrState.writeVersionsCalls = [];
  releasePrState.runOperationsCalls = [];
  releasePrState.runOperationsError = undefined;
});

describe("prepareReleasePr", () => {
  it("materializes and commits only the requested release scope without tags", async () => {
    const ctx = makeContext();
    const originalPlan = ctx.runtime.versionPlan;
    const originalStepOutput = { original: true };
    (
      ctx.runtime as unknown as { workflowVersionStepOutput: unknown }
    ).workflowVersionStepOutput = originalStepOutput;

    const result = await prepareReleasePr(ctx, { scope });

    expect(result).toMatchObject({
      branchName: "pubm/release/packages-a-js",
      title: "chore(release): @acme/a 1.1.0",
      changedFiles: ["packages/a/package.json", "packages/a/CHANGELOG.md"],
      commitSha: "commit-1",
      versionSummary: "1.1.0",
    });
    expect(result.body).toContain("<!-- pubm:release-pr -->");
    expect(result.body).toContain("<!-- pubm:release-pr-metadata ");
    expect(result.body).toContain("## Release Notes Preview");
    expect(result.body).toContain("<details open>");
    expect(result.body).toContain(RELEASE_PR_RELEASE_NOTES_START_MARKER);
    expect(result.body).toContain("generated release notes for @acme/a@1.1.0");
    expect(result.body).toContain(RELEASE_PR_RELEASE_NOTES_END_MARKER);
    expect(result.body).toContain("- packages/a::js: 1.1.0");
    expect(parseReleasePrBodyMetadata(result.body)).toEqual({
      isReleasePr: true,
      schemaVersion: 1,
      scopeId: "packages/a::js",
      packageKeys: ["packages/a::js"],
    });
    expect(
      sameReleasePrScope(scope, parseReleasePrBodyMetadata(result.body)),
    ).toBe(true);
    expect(result.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([["packages/a::js", "1.1.0"]]),
    });
    expect(releasePrState.writeVersionsCalls).toEqual([
      new Map([["packages/a::js", "1.1.0"]]),
    ]);
    expect(releasePrState.gitCalls.map((call) => call.name)).toEqual([
      "reset",
      "stage",
      "stage",
      "status",
      "commit",
      "repository",
    ]);
    expect(ctx.runtime.versionPlan).toBe(originalPlan);
    expect(
      (ctx.runtime as unknown as { workflowVersionStepOutput: unknown })
        .workflowVersionStepOutput,
    ).toBe(originalStepOutput);
  });

  it("applies overrides before rendering release PR metadata", async () => {
    const ctx = makeContext();

    const result = await prepareReleasePr(ctx, {
      scope,
      override: {
        source: "slash",
        kind: "bump",
        bump: "major",
      },
    });

    expect(result).toMatchObject({
      branchName: "pubm/release/packages-a-js",
      title: "chore(release): @acme/a 2.0.0",
      versionSummary: "2.0.0",
    });
    expect(result.body).toContain("- slash: bump");
    expect(result.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([["packages/a::js", "2.0.0"]]),
    });
  });

  it("renders release note previews for single-package release PRs", async () => {
    const ctx = makeContext();
    ctx.runtime.versionPlan = {
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.1.0",
    };

    const result = await prepareReleasePr(ctx, { scope, commit: false });

    expect(result.versionPlan).toEqual({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.1.0",
    });
    expect(result.body).toContain("generated release notes for v1.1.0");
  });

  it("requires a runtime version plan to prepare release PRs", async () => {
    const ctx = makeContext();
    delete ctx.runtime.versionPlan;

    await expect(prepareReleasePr(ctx, { scope })).rejects.toThrow(
      "Version plan is required for release PR.",
    );
  });

  it("parses release PR body metadata defensively", () => {
    expect(parseReleasePrBodyMetadata("hello")).toEqual({
      isReleasePr: false,
      packageKeys: [],
    });
    expect(parseReleasePrBodyMetadata(null)).toEqual({
      isReleasePr: false,
      packageKeys: [],
    });
    expect(parseReleasePrBodyMetadata("<!-- pubm:release-pr -->")).toEqual({
      isReleasePr: true,
      packageKeys: [],
    });
    expect(
      parseReleasePrBodyMetadata(
        '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":1,"scopeId":"group:packages/a::js+packages/b::js","packageKeys":["packages/b::js","packages/a::js"]} -->',
      ),
    ).toEqual({
      isReleasePr: true,
      schemaVersion: 1,
      scopeId: "group:packages/a::js+packages/b::js",
      packageKeys: ["packages/a::js", "packages/b::js"],
    });
    expect(
      parseReleasePrBodyMetadata(
        '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":2,"scopeId":"packages/a::js","packageKeys":["packages/a::js"]} -->',
      ),
    ).toEqual({ isReleasePr: true, packageKeys: [] });
    expect(
      parseReleasePrBodyMetadata(
        "<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata nope -->",
      ),
    ).toEqual({ isReleasePr: true, packageKeys: [] });
    expect(
      parseReleasePrBodyMetadata(
        '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":1,"scopeId":123,"packageKeys":["packages/a::js",123]} -->',
      ),
    ).toEqual({
      isReleasePr: true,
      schemaVersion: 1,
      packageKeys: ["packages/a::js"],
    });
    expect(
      parseReleasePrBodyMetadata(
        '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":1,"scopeId":"packages/a::js","packageKeys":"packages/a::js"} -->',
      ),
    ).toEqual({
      isReleasePr: true,
      schemaVersion: 1,
      scopeId: "packages/a::js",
      packageKeys: [],
    });
  });

  it("parses edited release notes from the managed preview markers", () => {
    expect(
      parseReleasePrReleaseNotes(
        [
          "## Release Notes Preview",
          RELEASE_PR_RELEASE_NOTES_START_MARKER,
          "",
          "### Changed",
          "",
          "- Edited in the PR body",
          "",
          RELEASE_PR_RELEASE_NOTES_END_MARKER,
          "",
          "## Scope",
        ].join("\n"),
      ),
    ).toBe("### Changed\n\n- Edited in the PR body");

    expect(parseReleasePrReleaseNotes("no markers")).toBeUndefined();
    expect(parseReleasePrReleaseNotes(null)).toBeUndefined();
    expect(
      parseReleasePrReleaseNotes(RELEASE_PR_RELEASE_NOTES_START_MARKER),
    ).toBeUndefined();
    expect(
      parseReleasePrReleaseNotes(
        `${RELEASE_PR_RELEASE_NOTES_START_MARKER}\n\n${RELEASE_PR_RELEASE_NOTES_END_MARKER}`,
      ),
    ).toBeUndefined();
  });

  it("matches release PR scopes by metadata marker or package set", () => {
    expect(
      sameReleasePrScope(scope, { isReleasePr: false, packageKeys: [] }),
    ).toBe(false);
    expect(
      sameReleasePrScope(scope, {
        isReleasePr: true,
        packageKeys: ["packages/a::js"],
      }),
    ).toBe(true);
    expect(
      sameReleasePrScope(scope, {
        isReleasePr: true,
        packageKeys: ["packages/a::js", "packages/b::js"],
      }),
    ).toBe(false);
    expect(
      sameReleasePrScope(scope, {
        isReleasePr: true,
        packageKeys: ["packages/b::js"],
      }),
    ).toBe(false);
  });

  it("can materialize without committing for preview callers", async () => {
    const ctx = makeContext();

    const result = await prepareReleasePr(ctx, { scope, commit: false });

    expect(result.commitSha).toBeUndefined();
    expect(releasePrState.gitCalls.map((call) => call.name)).not.toContain(
      "commit",
    );
    expect(releasePrState.gitCalls.map((call) => call.name)).not.toContain(
      "createTag",
    );
  });

  it("keeps one-package independent scopes as independent version plans", () => {
    const ctx = makeContext();

    expect(scopeVersionPlan(ctx.runtime.versionPlan!, scope)).toEqual({
      mode: "independent",
      packages: new Map([["packages/a::js", "1.1.0"]]),
    });
  });

  it("scopes fixed and single version plans without changing their mode", () => {
    expect(
      scopeVersionPlan(
        {
          mode: "fixed",
          version: "2.0.0",
          packages: new Map([
            ["packages/a::js", "2.0.0"],
            ["packages/b::js", "2.0.0"],
          ]),
        },
        scope,
      ),
    ).toEqual({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["packages/a::js", "2.0.0"]]),
    });

    const single = {
      mode: "single" as const,
      packageKey: "packages/a::js",
      version: "1.1.0",
    };
    expect(scopeVersionPlan(single, scope)).toBe(single);
  });

  it("creates manifest version plans for single, fixed, and independent configs", () => {
    const ctx = makeContext();

    expect(
      createVersionPlanFromManifestVersions({
        ...ctx.config,
        packages: [ctx.config.packages[0]],
      }),
    ).toEqual({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.0.0",
    });

    expect(
      createVersionPlanFromManifestVersions({
        ...ctx.config,
        versioning: "fixed",
      }),
    ).toEqual({
      mode: "fixed",
      version: "1.0.0",
      packages: new Map([
        ["packages/a::js", "1.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });

    expect(createVersionPlanFromManifestVersions(ctx.config)).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });

    expect(
      createVersionPlanFromManifestVersions({
        ...ctx.config,
        packages: [],
      }),
    ).toEqual({
      mode: "single",
      packageKey: ".",
      version: "",
    });
  });

  it("reconstructs publish plans by matching configured release PR scopes", async () => {
    const ctx = makeContext();
    const linked = [["@acme/a", "@acme/b"]];
    ctx.config = Object.freeze({
      ...ctx.config,
      linked,
      release: {
        ...ctx.config.release,
        versioning: {
          ...ctx.config.release.versioning,
          linked,
        },
        pullRequest: {
          ...ctx.config.release.pullRequest,
          linked,
        },
      },
    });
    releasePrState.diffOutput =
      "packages/a/package.json\npackages/b/package.json\n";

    const plan = await prepareReleasePrPublish(ctx, {
      beforeSha: "before",
      afterSha: "after",
    });

    expect(plan).toMatchObject({
      scope: {
        kind: "group",
        packageKeys: ["packages/a::js", "packages/b::js"],
        displayName: "@acme/a, @acme/b",
      },
      versionPlan: {
        mode: "independent",
        packages: new Map([
          ["packages/a::js", "1.0.0"],
          ["packages/b::js", "2.0.0"],
        ]),
      },
    });
    expect(plan?.tagReferences.map((reference) => reference.tagName)).toEqual([
      "@acme/a@1.0.0",
      "@acme/b@2.0.0",
    ]);
  });

  it("returns no publish plan when a merge range has no manifest changes", async () => {
    const ctx = makeContext();
    releasePrState.diffOutput = "README.md\n";

    await expect(
      prepareReleasePrPublish(ctx, { beforeSha: "before", afterSha: "after" }),
    ).resolves.toBeUndefined();
  });

  it("falls back to a synthetic publish scope when no configured scope matches", async () => {
    const ctx = makeContext();
    releasePrState.diffOutput =
      "packages/a/package.json\npackages/b/package.json\n";
    ctx.config = Object.freeze({
      ...ctx.config,
      release: {
        ...ctx.config.release,
        pullRequest: {
          ...ctx.config.release.pullRequest,
          grouping: "independent",
        },
      },
    });

    const plan = await prepareReleasePrPublish(ctx, {
      beforeSha: "before",
      afterSha: "after",
    });

    expect(plan?.scope).toMatchObject({
      id: "publish",
      kind: "group",
      packageKeys: ["packages/a::js", "packages/b::js"],
      displayName: "publish",
      slug: "publish",
    });
  });

  it("runs scoped dry-run operations and restores runtime state", async () => {
    const ctx = makeContext();
    const originalConfig = ctx.config;
    const originalPlan = ctx.runtime.versionPlan;
    const originalRunner = ctx.runtime.pluginRunner;

    await runReleasePrDryRun(ctx, scope);

    expect(releasePrState.runOperationsCalls).toEqual([
      [
        {
          kind: "dry-run",
          args: [
            false,
            true,
            false,
            { packageKeys: new Set(["packages/a::js"]) },
          ],
        },
      ],
    ]);
    expect(ctx.config).toBe(originalConfig);
    expect(ctx.runtime.versionPlan).toBe(originalPlan);
    expect(ctx.runtime.pluginRunner).toBe(originalRunner);
  });

  it("passes edited release PR notes to GitHub Release creation", async () => {
    const ctx = makeContext();

    await publishReleasePr(ctx, {
      plan: {
        scope,
        versionPlan: {
          mode: "independent",
          packages: new Map([["packages/a::js", "1.1.0"]]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
        ],
      },
      releaseNotes: "edited release notes",
    });

    const githubReleaseOperation = releasePrState
      .runOperationsCalls[1]?.[0] as {
      args: unknown[];
    };
    expect(githubReleaseOperation.args[4]).toEqual({
      packageKeys: new Set(["packages/a::js"]),
      releaseNotes: {
        fixed: "edited release notes",
        byPackageKey: new Map([["packages/a::js", "edited release notes"]]),
      },
    });
  });

  it("splits edited grouped release PR notes by package heading", async () => {
    const ctx = makeContext();

    await publishReleasePr(ctx, {
      plan: {
        scope: {
          ...scope,
          packageKeys: ["packages/a::js", "packages/b::js"],
        },
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/a::js", "1.1.0"],
            ["packages/b::js", "2.1.0"],
          ]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
          {
            tagName: "@acme/b@2.1.0",
            version: "2.1.0",
            packageKeys: ["packages/b::js"],
            packageNames: ["@acme/b"],
          },
        ],
      },
      releaseNotes: [
        "### packages/a::js",
        "",
        "- edited a",
        "",
        "### packages/b::js",
        "",
        "- edited b",
      ].join("\n"),
    });

    const githubReleaseOperation = releasePrState
      .runOperationsCalls[1]?.[0] as {
      args: unknown[];
    };
    expect(githubReleaseOperation.args[4]).toEqual({
      packageKeys: new Set(["packages/a::js", "packages/b::js"]),
      releaseNotes: {
        fixed: [
          "### packages/a::js",
          "",
          "- edited a",
          "",
          "### packages/b::js",
          "",
          "- edited b",
        ].join("\n"),
        byPackageKey: new Map([
          ["packages/a::js", "- edited a"],
          ["packages/b::js", "- edited b"],
        ]),
      },
    });
  });

  it("falls back to shared edited notes when grouped headings do not match packages", async () => {
    const ctx = makeContext();
    const body = "### other-package\n\n- shared edited notes";

    await publishReleasePr(ctx, {
      plan: {
        scope: {
          ...scope,
          packageKeys: ["packages/a::js", "packages/b::js"],
        },
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/a::js", "1.1.0"],
            ["packages/b::js", "2.1.0"],
          ]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
          {
            tagName: "@acme/b@2.1.0",
            version: "2.1.0",
            packageKeys: ["packages/b::js"],
            packageNames: ["@acme/b"],
          },
        ],
      },
      releaseNotes: body,
    });

    const githubReleaseOperation = releasePrState
      .runOperationsCalls[1]?.[0] as {
      args: unknown[];
    };
    expect(githubReleaseOperation.args[4]).toEqual({
      packageKeys: new Set(["packages/a::js", "packages/b::js"]),
      releaseNotes: {
        fixed: body,
        byPackageKey: new Map([
          ["packages/a::js", body],
          ["packages/b::js", body],
        ]),
      },
    });
  });

  it("falls back to shared edited notes when package headings are empty", async () => {
    const ctx = makeContext();
    const body = "### packages/a::js";

    await publishReleasePr(ctx, {
      plan: {
        scope: {
          ...scope,
          packageKeys: ["packages/a::js", "packages/b::js"],
        },
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/a::js", "1.1.0"],
            ["packages/b::js", "2.1.0"],
          ]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
          {
            tagName: "@acme/b@2.1.0",
            version: "2.1.0",
            packageKeys: ["packages/b::js"],
            packageNames: ["@acme/b"],
          },
        ],
      },
      releaseNotes: body,
    });

    const githubReleaseOperation = releasePrState
      .runOperationsCalls[1]?.[0] as {
      args: unknown[];
    };
    expect(githubReleaseOperation.args[4]).toEqual({
      packageKeys: new Set(["packages/a::js", "packages/b::js"]),
      releaseNotes: {
        fixed: body,
        byPackageKey: new Map([
          ["packages/a::js", body],
          ["packages/b::js", body],
        ]),
      },
    });
  });

  it("ignores blank release PR note edits", async () => {
    const ctx = makeContext();

    await publishReleasePr(ctx, {
      plan: {
        scope,
        versionPlan: {
          mode: "independent",
          packages: new Map([["packages/a::js", "1.1.0"]]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
        ],
      },
      releaseNotes: "   ",
    });

    const githubReleaseOperation = releasePrState
      .runOperationsCalls[1]?.[0] as {
      args: unknown[];
    };
    expect(githubReleaseOperation.args[4]).toEqual({
      packageKeys: new Set(["packages/a::js"]),
      releaseNotes: undefined,
    });
  });

  it("normalizes object release PR note overrides", async () => {
    const ctx = makeContext();

    await publishReleasePr(ctx, {
      plan: {
        scope: {
          ...scope,
          packageKeys: ["packages/a::js", "packages/b::js"],
        },
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/a::js", "1.1.0"],
            ["packages/b::js", "2.1.0"],
          ]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
          {
            tagName: "@acme/b@2.1.0",
            version: "2.1.0",
            packageKeys: ["packages/b::js"],
            packageNames: ["@acme/b"],
          },
        ],
      },
      releaseNotes: {
        fixed: " fixed notes ",
        byPackageKey: {
          "packages/a::js": " package a notes ",
          "packages/b::js": " ",
        },
      },
    });

    const githubReleaseOperation = releasePrState
      .runOperationsCalls[1]?.[0] as {
      args: unknown[];
    };
    expect(githubReleaseOperation.args[4]).toEqual({
      packageKeys: new Set(["packages/a::js", "packages/b::js"]),
      releaseNotes: {
        fixed: "fixed notes",
        byPackageKey: new Map([["packages/a::js", "package a notes"]]),
      },
    });
  });

  it("normalizes map release PR note overrides without fixed notes", async () => {
    const ctx = makeContext();

    await publishReleasePr(ctx, {
      plan: {
        scope: {
          ...scope,
          packageKeys: ["packages/a::js", "packages/b::js"],
        },
        versionPlan: {
          mode: "independent",
          packages: new Map([
            ["packages/a::js", "1.1.0"],
            ["packages/b::js", "2.1.0"],
          ]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
          {
            tagName: "@acme/b@2.1.0",
            version: "2.1.0",
            packageKeys: ["packages/b::js"],
            packageNames: ["@acme/b"],
          },
        ],
      },
      releaseNotes: {
        byPackageKey: new Map([
          ["packages/a::js", " map a notes "],
          ["packages/b::js", " "],
        ]),
      },
    });

    const githubReleaseOperation = releasePrState
      .runOperationsCalls[1]?.[0] as {
      args: unknown[];
    };
    expect(githubReleaseOperation.args[4]).toEqual({
      packageKeys: new Set(["packages/a::js", "packages/b::js"]),
      releaseNotes: {
        byPackageKey: new Map([["packages/a::js", "map a notes"]]),
      },
    });
  });

  it("drops object release PR notes when every value is blank", async () => {
    const ctx = makeContext();

    await publishReleasePr(ctx, {
      plan: {
        scope,
        versionPlan: {
          mode: "independent",
          packages: new Map([["packages/a::js", "1.1.0"]]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
        ],
      },
      releaseNotes: {
        fixed: " ",
      },
    });

    const githubReleaseOperation = releasePrState
      .runOperationsCalls[1]?.[0] as {
      args: unknown[];
    };
    expect(githubReleaseOperation.args[4]).toEqual({
      packageKeys: new Set(["packages/a::js"]),
      releaseNotes: undefined,
    });
  });

  it("publishes scoped release PR plans with explicit tag pushes and restores state", async () => {
    const ctx = makeContext();
    const originalConfig = ctx.config;
    const originalPlan = ctx.runtime.versionPlan;
    const originalRunner = ctx.runtime.pluginRunner;

    await publishReleasePr(ctx, {
      plan: {
        scope,
        versionPlan: {
          mode: "independent",
          packages: new Map([["packages/a::js", "1.1.0"]]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
        ],
      },
    });

    expect(releasePrState.gitCalls.map((call) => call.name)).toEqual([
      "checkTagExist",
      "revParse",
      "createTag",
      "git",
    ]);
    expect(releasePrState.gitCalls.at(-1)?.args).toEqual([
      ["push", "origin", "@acme/a@1.1.0"],
    ]);
    expect(releasePrState.runOperationsCalls).toEqual([
      [
        {
          kind: "publish",
          args: [
            true,
            false,
            false,
            { packageKeys: new Set(["packages/a::js"]) },
          ],
        },
      ],
      [
        {
          kind: "github-release",
          args: [
            true,
            false,
            false,
            false,
            {
              packageKeys: new Set(["packages/a::js"]),
              releaseNotes: undefined,
            },
          ],
        },
      ],
    ]);
    expect(ctx.config).toBe(originalConfig);
    expect(ctx.runtime.versionPlan).toBe(originalPlan);
    expect(ctx.runtime.pluginRunner).toBe(originalRunner);
  });

  it("can publish without pushing tags or creating GitHub releases", async () => {
    const ctx = makeContext();

    await publishReleasePr(ctx, {
      plan: {
        scope,
        versionPlan: {
          mode: "independent",
          packages: new Map([["packages/a::js", "1.1.0"]]),
        },
        tagReferences: [
          {
            tagName: "@acme/a@1.1.0",
            version: "1.1.0",
            packageKeys: ["packages/a::js"],
            packageNames: ["@acme/a"],
          },
        ],
      },
      pushTags: false,
      createGitHubRelease: false,
    });

    expect(releasePrState.gitCalls.map((call) => call.name)).toEqual([
      "checkTagExist",
      "revParse",
      "createTag",
    ]);
    expect(releasePrState.runOperationsCalls).toEqual([
      [
        {
          kind: "publish",
          args: [
            true,
            false,
            false,
            { packageKeys: new Set(["packages/a::js"]) },
          ],
        },
      ],
    ]);
  });

  it("executes rollback when release PR publishing fails after tags are pushed", async () => {
    const ctx = makeContext();
    releasePrState.runOperationsError = new Error("publish failed");

    await expect(
      publishReleasePr(ctx, {
        plan: {
          scope,
          versionPlan: {
            mode: "independent",
            packages: new Map([["packages/a::js", "1.1.0"]]),
          },
          tagReferences: [
            {
              tagName: "@acme/a@1.1.0",
              version: "1.1.0",
              packageKeys: ["packages/a::js"],
              packageNames: ["@acme/a"],
            },
          ],
        },
      }),
    ).rejects.toThrow("publish failed");

    expect(ctx.runtime.rollback.add).toHaveBeenCalled();
    expect(ctx.runtime.rollback.execute).toHaveBeenCalledWith(ctx, {
      interactive: false,
    });
  });

  it("registers remote rollback immediately for each pushed release PR tag", async () => {
    const ctx = makeContext();
    releasePrState.failPushTag = "@acme/b@2.1.0";

    await expect(
      publishReleasePr(ctx, {
        plan: {
          scope: {
            ...scope,
            packageKeys: ["packages/a::js", "packages/b::js"],
          },
          versionPlan: {
            mode: "independent",
            packages: new Map([
              ["packages/a::js", "1.1.0"],
              ["packages/b::js", "2.1.0"],
            ]),
          },
          tagReferences: [
            {
              tagName: "@acme/a@1.1.0",
              version: "1.1.0",
              packageKeys: ["packages/a::js"],
              packageNames: ["@acme/a"],
            },
            {
              tagName: "@acme/b@2.1.0",
              version: "2.1.0",
              packageKeys: ["packages/b::js"],
              packageNames: ["@acme/b"],
            },
          ],
        },
      }),
    ).rejects.toThrow("push failed for @acme/b@2.1.0");

    expect(ctx.runtime.rollback.add).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'task.push.deleteRemoteTag {"tag":"@acme/a@1.1.0"}',
      }),
    );
    expect(ctx.runtime.rollback.add).not.toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'task.push.deleteRemoteTag {"tag":"@acme/b@2.1.0"}',
      }),
    );
    expect(ctx.runtime.rollback.execute).toHaveBeenCalledWith(ctx, {
      interactive: false,
    });
  });
});
