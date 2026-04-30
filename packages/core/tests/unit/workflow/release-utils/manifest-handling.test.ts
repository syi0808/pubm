import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../../src/context.js";
import {
  applyVersionsForDryRun,
  prepareReleaseAssets,
  resolveWorkspaceProtocols,
} from "../../../../src/workflow/release-utils/manifest-handling.js";

const manifestState = vi.hoisted(() => ({
  workspaceVersions: new Map<string, string>(),
  backups: new Map<string, string>(),
  resolvedAssets: [] as unknown[],
  assetHooks: {} as Record<string, unknown>,
  pipelineCalls: [] as unknown[],
  writeVersionCalls: [] as Array<Map<string, string>>,
}));

vi.mock("../../../../src/assets/resolver.js", () => ({
  normalizeConfig: vi.fn((groups: unknown[]) => groups),
  resolveAssets: vi.fn((group: { files?: unknown[] }) => {
    manifestState.resolvedAssets = group.files ?? [];
    return manifestState.resolvedAssets;
  }),
}));

vi.mock("../../../../src/assets/pipeline.js", () => ({
  runAssetPipeline: vi.fn(async (...args: unknown[]) => {
    manifestState.pipelineCalls.push(args);
    return [{ name: "asset.tgz", sha256: "sha" }];
  }),
}));

vi.mock("../../../../src/monorepo/resolve-workspace.js", () => ({
  collectWorkspaceVersions: vi.fn(() => manifestState.workspaceVersions),
}));

vi.mock("../../../../src/ecosystem/catalog.js", () => ({
  ecosystemCatalog: {
    get: vi.fn(() => ({
      ecosystemClass: class MockEcosystem {
        constructor(readonly packagePath: string) {}

        async resolvePublishDependencies(): Promise<Map<string, string>> {
          return manifestState.backups;
        }
      },
    })),
  },
}));

vi.mock("../../../../src/workflow/release-utils/write-versions.js", () => ({
  writeVersions: vi.fn(
    async (_ctx: PubmContext, versions: Map<string, string>) => {
      manifestState.writeVersionCalls.push(new Map(versions));
      return [];
    },
  ),
}));

function createContext(overrides: Partial<PubmContext> = {}): PubmContext {
  return {
    cwd: "/repo",
    config: {
      compress: undefined,
      packages: [
        {
          ecosystem: "js",
          name: "@scope/pkg-a",
          path: "packages/a",
          registries: ["npm"],
          version: "1.0.0",
        },
        {
          ecosystem: "js",
          name: "pkg-b",
          path: "packages/b",
          registries: ["npm"],
          version: "2.0.0",
        },
      ],
      releaseAssets: [
        { files: ["global.tgz"] },
        { files: ["package.tgz"], packagePath: "packages/a" },
      ],
    },
    options: {},
    runtime: {
      cleanWorkingTree: true,
      pluginRunner: {
        collectAssetHooks: vi.fn(() => manifestState.assetHooks),
      } as unknown as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: false,
      rollback: {
        add: vi.fn(),
      } as unknown as PubmContext["runtime"]["rollback"],
      tag: "latest",
    },
    ...overrides,
  } as PubmContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  manifestState.workspaceVersions = new Map();
  manifestState.backups = new Map();
  manifestState.resolvedAssets = [];
  manifestState.assetHooks = {};
  manifestState.pipelineCalls = [];
  manifestState.writeVersionCalls = [];
});

describe("prepareReleaseAssets", () => {
  it("returns no assets when release assets are not configured", async () => {
    const ctx = createContext({
      config: { releaseAssets: [], packages: [] },
    } as never);

    await expect(prepareReleaseAssets(ctx, "pkg", "1.0.0")).resolves.toEqual({
      assets: [],
      tempDir: "",
    });
  });

  it("uses package-specific assets and strips npm scope for pipeline metadata", async () => {
    const ctx = createContext();

    const result = await prepareReleaseAssets(
      ctx,
      "@scope/pkg-a",
      "1.0.0",
      "packages/a",
    );

    expect(result.assets).toEqual([{ name: "asset.tgz", sha256: "sha" }]);
    expect(manifestState.resolvedAssets).toEqual(["package.tgz"]);
    expect(manifestState.pipelineCalls[0]?.[2]).toMatchObject({
      name: "pkg-a",
      pubmContext: ctx,
      version: "1.0.0",
    });
    expect(ctx.runtime.tempDir).toContain("pubm-assets-");
  });
});

describe("resolveWorkspaceProtocols", () => {
  it("returns early when cwd or workspace versions are missing", async () => {
    await resolveWorkspaceProtocols(createContext({ cwd: "" }));
    await resolveWorkspaceProtocols(createContext());

    expect(manifestState.backups.size).toBe(0);
  });

  it("registers rollback before resolving package dependency backups", async () => {
    manifestState.workspaceVersions = new Map([["pkg-b", "2.0.0"]]);
    manifestState.backups = new Map([["/repo/packages/a/package.json", "{}"]]);
    const rollbackItems: Array<{ label: string; fn: () => Promise<void> }> = [];
    const ctx = createContext({
      runtime: {
        ...createContext().runtime,
        rollback: {
          add: (item: (typeof rollbackItems)[number]) =>
            rollbackItems.push(item),
        } as unknown as PubmContext["runtime"]["rollback"],
      },
    });

    await resolveWorkspaceProtocols(ctx);

    expect(ctx.runtime.workspaceBackups).toEqual(manifestState.backups);
    expect(rollbackItems[0]?.label).toBe(
      "Restore workspace protocol dependencies",
    );
  });
});

describe("applyVersionsForDryRun", () => {
  it("does nothing when no version plan is present", async () => {
    const ctx = createContext();

    await applyVersionsForDryRun(ctx);

    expect(manifestState.writeVersionCalls).toEqual([]);
  });

  it("writes single-plan versions and records original versions for restore", async () => {
    const ctx = createContext();
    ctx.runtime.versionPlan = {
      mode: "single",
      packageKey: "packages/a::js",
      version: "9.0.0",
    };

    await applyVersionsForDryRun(ctx);

    expect(ctx.runtime.dryRunVersionBackup).toEqual(
      new Map([
        ["packages/a::js", "1.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    );
    expect(manifestState.writeVersionCalls[0]).toEqual(
      new Map([
        ["packages/a::js", "9.0.0"],
        ["packages/b::js", "9.0.0"],
      ]),
    );
  });

  it("writes package map versions for fixed and independent plans", async () => {
    const ctx = createContext();
    ctx.runtime.versionPlan = {
      mode: "fixed",
      packages: new Map([
        ["packages/a::js", "3.0.0"],
        ["packages/b::js", "3.0.0"],
      ]),
      version: "3.0.0",
    };

    await applyVersionsForDryRun(ctx);

    expect(manifestState.writeVersionCalls[0]).toEqual(
      new Map([
        ["packages/a::js", "3.0.0"],
        ["packages/b::js", "3.0.0"],
      ]),
    );
  });
});
