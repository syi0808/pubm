import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext, VersionPlan } from "../../../../src/context.js";
import {
  createGitHubReleaseOperation,
  createPushOperation,
} from "../../../../src/workflow/release-phases/push-release.js";

vi.mock("@pubm/runner", () => ({
  prompt: vi.fn(),
}));

const pushState = vi.hoisted(() => ({
  git: {
    pushResult: true,
    branch: "main",
    calls: [] as Array<{ name: string; args: unknown[] }>,
  },
  token: undefined as undefined | { token: string; source: string },
  releaseResults: [] as unknown[],
  releaseCalls: [] as unknown[],
  deleteReleaseCalls: [] as string[],
  openUrls: [] as string[],
  savedTokens: [] as string[],
  assetUploadError: undefined as Error | undefined,
  uploadAssets: true,
  tempDir: "",
  truncateResults: [] as Array<{
    body: string;
    clipboardCopied: boolean;
    truncated: boolean;
  }>,
}));

vi.mock("../../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../../src/git.js", () => ({
  Git: class MockGit {
    async revParse(...args: string[]): Promise<string> {
      pushState.git.calls.push({ name: "revParse", args });
      return "sha-before";
    }

    async push(...args: string[]): Promise<boolean> {
      pushState.git.calls.push({ name: "push", args });
      return pushState.git.pushResult;
    }

    async branch(): Promise<string> {
      pushState.git.calls.push({ name: "branch", args: [] });
      return pushState.git.branch;
    }

    async forcePush(...args: string[]): Promise<void> {
      pushState.git.calls.push({ name: "forcePush", args });
    }

    async pushDelete(...args: string[]): Promise<void> {
      pushState.git.calls.push({ name: "pushDelete", args });
    }

    async createBranch(...args: string[]): Promise<void> {
      pushState.git.calls.push({ name: "createBranch", args });
    }

    async switch(...args: string[]): Promise<void> {
      pushState.git.calls.push({ name: "switch", args });
    }

    async pushNewBranch(...args: string[]): Promise<void> {
      pushState.git.calls.push({ name: "pushNewBranch", args });
    }

    async repository(): Promise<string> {
      pushState.git.calls.push({ name: "repository", args: [] });
      return "git@github.com:acme/repo.git";
    }
  },
}));

vi.mock("../../../../src/tasks/github-release.js", () => ({
  createGitHubRelease: vi.fn(async (_ctx: PubmContext, input: unknown) => {
    pushState.releaseCalls.push(input);
    return pushState.releaseResults.length > 0
      ? pushState.releaseResults.shift()
      : {
          assets: [],
          displayLabel: "pkg-a",
          releaseId: "release-1",
          releaseUrl: "https://github.test/releases/v1.2.0",
          tag: "v1.2.0",
          version: "1.2.0",
        };
  }),
  deleteGitHubRelease: vi.fn(async (releaseId: string) => {
    pushState.deleteReleaseCalls.push(releaseId);
  }),
}));

vi.mock("../../../../src/tasks/release-notes.js", () => ({
  buildReleaseBody: vi.fn(async () => "release body"),
  truncateForUrl: vi.fn(
    async (body: string) =>
      pushState.truncateResults.shift() ?? {
        body,
        clipboardCopied: false,
        truncated: false,
      },
  ),
}));

vi.mock("../../../../src/tasks/create-version-pr.js", () => ({
  closeVersionPr: vi.fn(async () => undefined),
  createVersionPr: vi.fn(async () => ({
    number: 42,
    url: "https://github.test/pull/42",
  })),
}));

vi.mock("../../../../src/utils/github-token.js", () => ({
  resolveGitHubToken: vi.fn(() => pushState.token),
  saveGitHubToken: vi.fn((token: string) => {
    pushState.savedTokens.push(token);
  }),
}));

vi.mock("../../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(async (url: string) => {
    pushState.openUrls.push(url);
  }),
}));

vi.mock("../../../../src/utils/ui.js", () => ({
  ui: {
    chalk: {
      blueBright: (value: string) => value,
      bold: (value: string) => value,
    },
    link: (label: string, url: string) => `${label}:${url}`,
  },
}));

vi.mock("../../../../src/workflow/release-utils/manifest-handling.js", () => ({
  prepareReleaseAssets: vi.fn(async () => ({
    assets: [{ name: "asset.tgz", sha256: "sha256" }],
    tempDir: pushState.tempDir,
  })),
}));

function createContext(
  plan: VersionPlan,
  overrides: {
    options?: Partial<PubmContext["options"]>;
    config?: Record<string, unknown>;
    promptEnabled?: boolean;
  } = {},
): PubmContext & {
  rollbackItems: Array<{
    label: string;
    fn: () => Promise<void>;
    confirm?: boolean;
  }>;
  afterReleaseResults: unknown[];
} {
  const rollbackItems: Array<{
    label: string;
    fn: () => Promise<void>;
    confirm?: boolean;
  }> = [];
  const afterReleaseResults: unknown[] = [];

  return {
    rollbackItems,
    afterReleaseResults,
    cwd: "/repo",
    options: {
      releaseDraft: true,
      ...overrides.options,
    },
    config: {
      branch: "main",
      excludeRelease: [],
      packages: [
        {
          ecosystem: "js",
          name: "pkg-a",
          path: "packages/a",
          registries: ["npm"],
        },
        {
          ecosystem: "js",
          name: "pkg-b",
          path: "packages/b",
          registries: ["npm"],
        },
      ],
      ...overrides.config,
    },
    runtime: {
      cleanWorkingTree: true,
      pluginRunner: {
        collectAssetHooks: vi.fn(() =>
          pushState.uploadAssets
            ? {
                uploadAssets: pushState.assetUploadError
                  ? vi.fn(async () => {
                      throw pushState.assetUploadError;
                    })
                  : vi.fn(async () => [
                      {
                        name: "extra.tgz",
                        platform: "darwin",
                        sha256: "extra-sha",
                        url: "https://assets.test/extra.tgz",
                      },
                    ]),
              }
            : {},
        ),
        runAfterReleaseHook: vi.fn(
          async (_ctx: PubmContext, result: unknown) => {
            afterReleaseResults.push(result);
          },
        ),
        runHook: vi.fn(async () => undefined),
      } as unknown as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: overrides.promptEnabled ?? false,
      rollback: {
        add: (item: (typeof rollbackItems)[number]) => rollbackItems.push(item),
      } as unknown as PubmContext["runtime"]["rollback"],
      tag: "latest",
      versionPlan: plan,
    },
  } as PubmContext & {
    rollbackItems: typeof rollbackItems;
    afterReleaseResults: typeof afterReleaseResults;
  };
}

function createTask(promptResponses: unknown[] = []) {
  return {
    title: "",
    output: "",
    skip: vi.fn(),
    prompt: () => ({
      run: vi.fn(async () => promptResponses.shift()),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pushState.git = { branch: "main", calls: [], pushResult: true };
  pushState.token = undefined;
  pushState.releaseResults = [];
  pushState.releaseCalls = [];
  pushState.deleteReleaseCalls = [];
  pushState.openUrls = [];
  pushState.savedTokens = [];
  pushState.assetUploadError = undefined;
  pushState.uploadAssets = true;
  pushState.tempDir = "";
  pushState.truncateResults = [];
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe("createPushOperation", () => {
  it("registers remote tag and force-push rollback after a successful direct push", async () => {
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });

    await createPushOperation(true, false).run?.(ctx, createTask() as never);

    expect(pushState.git.calls.map((call) => call.name)).toEqual([
      "revParse",
      "push",
      "branch",
    ]);
    expect(ctx.rollbackItems.map((item) => item.label)).toEqual([
      'task.push.deleteRemoteTag {"tag":"v1.2.0"}',
      'task.push.forceRevert {"branch":"main"}',
    ]);
    await ctx.rollbackItems[1]?.fn();
    expect(pushState.git.calls.at(-1)).toEqual({
      name: "forcePush",
      args: ["origin", "sha-before:main"],
    });
  });

  it("fails without creating a version PR when direct push fails", async () => {
    pushState.git.pushResult = false;
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });

    await expect(
      createPushOperation(true, false).run?.(ctx, createTask() as never),
    ).rejects.toThrow("git push --follow-tags failed");

    expect(pushState.git.calls.map((call) => call.name)).toEqual(
      expect.arrayContaining(["revParse", "push"]),
    );
    expect(pushState.git.calls.map((call) => call.name)).not.toContain(
      "createBranch",
    );
    expect(pushState.git.calls.map((call) => call.name)).not.toContain(
      "pushNewBranch",
    );
    expect(ctx.rollbackItems).toEqual([]);
  });
});

describe("createGitHubReleaseOperation", () => {
  it("prompts for a token locally and saves it before creating the release", async () => {
    const ctx = createContext(
      {
        mode: "single",
        packageKey: "packages/a::js",
        version: "1.2.0",
      },
      { promptEnabled: true },
    );

    await createGitHubReleaseOperation(true, false, true, false).run?.(
      ctx,
      createTask(["enter", "token-from-prompt"]) as never,
    );

    expect(process.env.GITHUB_TOKEN).toBe("token-from-prompt");
    expect(pushState.savedTokens).toEqual(["token-from-prompt"]);
    expect(pushState.releaseCalls[0]).toMatchObject({
      displayLabel: "pkg-a",
      tag: "v1.2.0",
      version: "1.2.0",
    });
  });

  it("falls back to a browser draft when an entered local token is empty", async () => {
    const ctx = createContext(
      {
        mode: "single",
        packageKey: "packages/a::js",
        version: "1.2.0",
      },
      { promptEnabled: true },
    );

    await createGitHubReleaseOperation(true, false, true, false).run?.(
      ctx,
      createTask(["enter", ""]) as never,
    );

    expect(pushState.savedTokens).toEqual([]);
    expect(pushState.releaseCalls).toEqual([]);
    expect(pushState.openUrls).toHaveLength(1);
    expect(pushState.openUrls[0]).toContain("tag=v1.2.0");
  });

  it("falls back to a browser draft when a local user chooses the browser option", async () => {
    const ctx = createContext(
      {
        mode: "fixed",
        packages: new Map([["packages/a::js", "1.2.0"]]),
        version: "1.2.0",
      },
      { promptEnabled: true },
    );

    await createGitHubReleaseOperation(true, false, true, false).run?.(
      ctx,
      createTask(["browser"]) as never,
    );

    expect(pushState.releaseCalls).toEqual([]);
    expect(pushState.openUrls).toHaveLength(1);
  });

  it("registers release deletion before upload hooks can fail", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    pushState.assetUploadError = new Error("upload failed");
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });

    await expect(
      createGitHubReleaseOperation(true, false, false, false).run?.(
        ctx,
        createTask() as never,
      ),
    ).rejects.toThrow("upload failed");

    expect(ctx.rollbackItems).toHaveLength(1);
    await ctx.rollbackItems[0]?.fn();
    expect(pushState.deleteReleaseCalls).toEqual(["release-1"]);
  });

  it("handles an existing independent release result without running release hooks", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    pushState.releaseResults = [null];
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "1.2.0"]]),
    });
    const task = createTask();

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      task as never,
    );

    expect(task.output).toBe(
      'task.release.alreadyExists {"tag":"pkg-a@1.2.0"}',
    );
    expect(ctx.rollbackItems).toEqual([]);
    expect(ctx.afterReleaseResults).toEqual([]);
  });

  it("creates an independent release without deletion rollback when no release id is returned", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    pushState.releaseResults = [
      {
        assets: [],
        displayLabel: "pkg-a",
        releaseUrl: "https://github.test/releases/pkg-a-1.2.0",
        tag: "pkg-a@1.2.0",
        version: "1.2.0",
      },
    ];
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "1.2.0"]]),
    });

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(ctx.rollbackItems).toEqual([]);
    expect(ctx.afterReleaseResults).toHaveLength(1);
  });

  it("creates an independent release without upload hooks when omitted", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    pushState.uploadAssets = false;
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "1.2.0"]]),
    });

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.releaseCalls[0]).toMatchObject({
      assets: [{ name: "asset.tgz", sha256: "sha256" }],
    });
    expect(ctx.afterReleaseResults).toHaveLength(1);
  });

  it("uses registry-qualified tags for independent GitHub releases", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    const ctx = createContext(
      {
        mode: "independent",
        packages: new Map([["packages/a::js", "1.2.0"]]),
      },
      { config: { registryQualifiedTags: true } },
    );

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.releaseCalls[0]).toMatchObject({
      tag: "npm/pkg-a@1.2.0",
    });
  });

  it("creates GitHub releases only for scoped independent package keys", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    const ctx = createContext({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.2.0"],
        ["packages/b::js", "2.3.0"],
      ]),
    });

    await createGitHubReleaseOperation(true, false, false, false, {
      packageKeys: new Set(["packages/b::js"]),
    }).run?.(ctx, createTask() as never);

    expect(pushState.releaseCalls).toHaveLength(1);
    expect(pushState.releaseCalls[0]).toMatchObject({
      displayLabel: "pkg-b",
      tag: "pkg-b@2.3.0",
      version: "2.3.0",
    });
    expect(ctx.afterReleaseResults).toHaveLength(1);
  });

  it("cleans a prepared asset temp directory after an independent release", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    pushState.tempDir = "/tmp/pubm-core-test-missing-temp-dir";
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "1.2.0"]]),
    });

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.releaseCalls).toHaveLength(1);
  });

  it("uses an empty display label when a fixed release has no configured packages", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    const ctx = createContext(
      {
        mode: "fixed",
        packages: new Map([["packages/a::js", "1.2.0"]]),
        version: "1.2.0",
      },
      { config: { packages: [] } },
    );

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.releaseCalls[0]).toMatchObject({
      displayLabel: "",
      tag: "v1.2.0",
    });
  });

  it("handles an existing fixed release result without running release hooks", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    pushState.releaseResults = [null];
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });
    const task = createTask();

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      task as never,
    );

    expect(task.output).toBe('task.release.alreadyExists {"tag":"v1.2.0"}');
    expect(ctx.rollbackItems).toEqual([]);
    expect(ctx.afterReleaseResults).toEqual([]);
  });

  it("creates a fixed release without deletion rollback or upload hooks when omitted", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    pushState.uploadAssets = false;
    pushState.releaseResults = [
      {
        assets: [],
        displayLabel: "pkg-a",
        releaseUrl: "https://github.test/releases/v1.2.0",
        tag: "v1.2.0",
        version: "1.2.0",
      },
    ];
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(ctx.rollbackItems).toEqual([]);
    expect(ctx.afterReleaseResults).toHaveLength(1);
  });

  it("cleans a prepared asset temp directory after a fixed release", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    pushState.tempDir = "/tmp/pubm-core-test-missing-fixed-temp-dir";
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.releaseCalls).toHaveLength(1);
  });

  it("creates independent releases and skips excluded packages", async () => {
    pushState.token = { source: "env", token: "gh-token" };
    const ctx = createContext(
      {
        mode: "independent",
        packages: new Map([
          ["packages/a::js", "1.2.0"],
          ["packages/b::js", "2.0.0"],
        ]),
      },
      { config: { excludeRelease: ["packages/b"] } },
    );

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.releaseCalls).toHaveLength(1);
    expect(pushState.releaseCalls[0]).toMatchObject({
      displayLabel: "pkg-a",
      tag: "pkg-a@1.2.0",
    });
    expect(ctx.afterReleaseResults).toHaveLength(1);
  });

  it("opens only the first independent browser draft when no token is available", async () => {
    const ctx = createContext({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.2.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.releaseCalls).toEqual([]);
    expect(pushState.openUrls).toHaveLength(1);
    expect(pushState.openUrls[0]).toContain("/releases/new");
    expect(pushState.openUrls[0]).toContain("tag=pkg-a%401.2.0");
  });

  it("opens the first non-excluded independent browser draft", async () => {
    const ctx = createContext(
      {
        mode: "independent",
        packages: new Map([
          ["packages/a::js", "1.2.0"],
          ["packages/b::js", "2.0.0"],
        ]),
      },
      { config: { excludeRelease: ["packages/a"] } },
    );

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.openUrls).toHaveLength(1);
    expect(pushState.openUrls[0]).toContain("tag=pkg-b%402.0.0");
  });

  it("reports copied release notes for the first independent browser draft", async () => {
    pushState.truncateResults = [
      { body: "release body", clipboardCopied: true, truncated: false },
    ];
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "1.2.0"]]),
    });
    const task = createTask();

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      task as never,
    );

    expect(task.output).toContain("task.release.copiedToClipboard");
  });

  it("reports truncated release notes for the first independent browser draft", async () => {
    pushState.truncateResults = [
      { body: "release body", clipboardCopied: false, truncated: true },
    ];
    const ctx = createContext({
      mode: "independent",
      packages: new Map([["packages/a::js", "1.2.0"]]),
    });
    const task = createTask();

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      task as never,
    );

    expect(task.output).toContain("task.release.truncated");
  });

  it("opens a fixed browser draft without a package path", async () => {
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      createTask() as never,
    );

    expect(pushState.openUrls).toHaveLength(1);
    expect(pushState.openUrls[0]).toContain("tag=v1.2.0");
  });

  it("reports copied release notes for a fixed browser draft", async () => {
    pushState.truncateResults = [
      { body: "release body", clipboardCopied: true, truncated: false },
    ];
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });
    const task = createTask();

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      task as never,
    );

    expect(task.output).toContain("task.release.copiedToClipboard");
  });

  it("reports truncated release notes for a fixed browser draft", async () => {
    pushState.truncateResults = [
      { body: "release body", clipboardCopied: false, truncated: true },
    ];
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });
    const task = createTask();

    await createGitHubReleaseOperation(true, false, false, false).run?.(
      ctx,
      task as never,
    );

    expect(task.output).toContain("task.release.truncated");
  });

  it("lets an interactive local user skip GitHub release creation", async () => {
    const ctx = createContext(
      {
        mode: "fixed",
        packages: new Map([["packages/a::js", "1.2.0"]]),
        version: "1.2.0",
      },
      { promptEnabled: true },
    );
    const task = createTask(["skip"]);

    await createGitHubReleaseOperation(true, false, true, false).run?.(
      ctx,
      task as never,
    );

    expect(task.skip).toHaveBeenCalledWith("task.release.skippedByUser");
    expect(pushState.releaseCalls).toEqual([]);
  });
});
