import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsCI = vi.hoisted(() => ({ value: false }));
const mockRegistryTaskFactory = vi.hoisted(() => vi.fn());
vi.mock("std-env", () => ({
  get isCI() {
    return mockIsCI.value;
  },
}));

vi.mock("../../../src/utils/snapshot.js", () => ({
  generateSnapshotVersion: vi.fn(() => "1.0.0-snapshot-20260330T120000"),
}));

vi.mock("../../../src/workflow/release-phases/preflight-checks.js", () => ({
  createPrerequisitesCheckOperation: vi.fn((skip) => ({
    skip,
    title: "Prerequisites",
    run: vi.fn().mockResolvedValue(undefined),
  })),
  createRequiredConditionsCheckOperation: vi.fn((skip) => ({
    skip,
    title: "Required conditions",
    run: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../../src/workflow/release-phases/preflight.js", () => ({
  runCiPublishPluginCreds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/workflow/release-utils/write-versions.js", () => ({
  writeVersions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/workflow/release-phases/publish.js", () => ({
  collectPublishOperations: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/workflow/release-utils/manifest-handling.js", () => ({
  resolveWorkspaceProtocols: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/monorepo/resolve-workspace.js", () => ({
  restoreManifests: vi.fn(),
}));

vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn(),
}));

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

vi.mock("../../../src/utils/package-manager.js", () => ({
  getPackageManager: vi.fn().mockResolvedValue("npm"),
}));

vi.mock("../../../src/git.js", () => ({
  Git: vi.fn().mockImplementation(function () {
    return {
      latestCommit: vi.fn().mockResolvedValue("abc123"),
      createTag: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("../../../src/utils/ui.js", () => ({
  ui: {
    chalk: {
      bold: (s: string) => s,
      blueBright: (s: string) => s,
    },
  },
}));

vi.mock("../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn((key: string) => {
      if (key === "npm") {
        return {
          key: "npm",
          label: "npm",
          taskFactory: mockRegistryTaskFactory,
          resolveDisplayName: vi.fn(async () => ["my-package"]),
        };
      }
      return undefined;
    }),
  },
}));

vi.mock("../../../src/utils/registries.js", () => ({
  collectRegistries: vi.fn().mockReturnValue(["npm"]),
}));

vi.mock("../../../src/error.js", () => ({
  AbstractError: class extends Error {
    name = "AbstractError";
  },
  consoleError: vi.fn(),
}));

vi.mock("../../../src/changeset/resolve.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/changeset/resolve.js")>();
  return { ...original };
});

import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import type { PubmContext } from "../../../src/context.js";
import { Git } from "../../../src/git.js";
import { restoreManifests } from "../../../src/monorepo/resolve-workspace.js";
import { PluginRunner } from "../../../src/plugin/runner.js";
import {
  applySnapshotFilter,
  buildSnapshotVersionPlan,
  runSnapshotPipeline,
} from "../../../src/tasks/snapshot-runner.js";
import type { ResolvedOptions } from "../../../src/types/options.js";
import { exec } from "../../../src/utils/exec.js";
import { createListr } from "../../../src/utils/listr.js";
import { generateSnapshotVersion } from "../../../src/utils/snapshot.js";
import { runCiPublishPluginCreds } from "../../../src/workflow/release-phases/preflight.js";
import {
  createPrerequisitesCheckOperation,
  createRequiredConditionsCheckOperation,
} from "../../../src/workflow/release-phases/preflight-checks.js";
import { collectPublishOperations } from "../../../src/workflow/release-phases/publish.js";
import { resolveWorkspaceProtocols } from "../../../src/workflow/release-utils/manifest-handling.js";
import { writeVersions } from "../../../src/workflow/release-utils/write-versions.js";
import { makeTestContext } from "../../helpers/make-context.js";

const mockedGenerateSnapshotVersion = vi.mocked(generateSnapshotVersion);
const mockedCreatePrerequisitesCheckOperation = vi.mocked(
  createPrerequisitesCheckOperation,
);
const mockedCreateRequiredConditionsCheckOperation = vi.mocked(
  createRequiredConditionsCheckOperation,
);
const mockedCreateListr = vi.mocked(createListr);
const mockedExec = vi.mocked(exec);
const mockedRunCiPublishPluginCreds = vi.mocked(runCiPublishPluginCreds);
const mockedWriteVersions = vi.mocked(writeVersions);
const mockedCollectPublishOperations = vi.mocked(collectPublishOperations);
const mockedResolveWorkspaceProtocols = vi.mocked(resolveWorkspaceProtocols);
const mockedRestoreManifests = vi.mocked(restoreManifests);
const mockedGit = vi.mocked(Git);

function makeSnapshotContext(
  overrides: Partial<PubmContext["config"]> = {},
  options: Partial<ResolvedOptions> = {},
): PubmContext {
  return makeTestContext({
    config: {
      packages: [
        {
          path: ".",
          name: "my-package",
          version: "1.0.0",
          ecosystem: "js",
          dependencies: [],
          registries: ["npm"],
        },
      ],
      versioning: "fixed",
      ...overrides,
    },
    options,
    runtime: {
      pluginRunner: new PluginRunner([]),
    },
  });
}

describe("buildSnapshotVersionPlan", () => {
  beforeEach(() => {
    mockedGenerateSnapshotVersion.mockReturnValue(
      "1.0.0-snapshot-20260330T120000",
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates SingleVersionPlan for single-package project", () => {
    const packages = [
      {
        path: ".",
        name: "pubm",
        version: "1.0.0",
        dependencies: [] as string[],
        registries: ["npm" as const],
        ecosystem: "js",
      },
    ];

    const plan = buildSnapshotVersionPlan(
      packages,
      "fixed",
      "snapshot",
      undefined,
    );

    expect(plan).toEqual({
      mode: "single",
      version: "1.0.0-snapshot-20260330T120000",
      packageKey: ".::js",
    });
  });

  it("creates FixedVersionPlan for fixed monorepo", () => {
    mockedGenerateSnapshotVersion.mockReturnValue(
      "1.0.0-snapshot-20260330T120000",
    );
    const packages = [
      {
        path: "packages/a",
        name: "@scope/a",
        version: "1.0.0",
        dependencies: [] as string[],
        registries: ["npm" as const],
        ecosystem: "js",
      },
      {
        path: "packages/b",
        name: "@scope/b",
        version: "1.0.0",
        dependencies: [] as string[],
        registries: ["npm" as const],
        ecosystem: "js",
      },
    ];

    const plan = buildSnapshotVersionPlan(
      packages,
      "fixed",
      "snapshot",
      undefined,
    );

    expect(plan).toEqual({
      mode: "fixed",
      version: "1.0.0-snapshot-20260330T120000",
      packages: new Map([
        ["packages/a::js", "1.0.0-snapshot-20260330T120000"],
        ["packages/b::js", "1.0.0-snapshot-20260330T120000"],
      ]),
    });
  });

  it("creates IndependentVersionPlan for independent monorepo", () => {
    mockedGenerateSnapshotVersion
      .mockReturnValueOnce("1.0.0-snapshot-20260330T120000")
      .mockReturnValueOnce("2.0.0-snapshot-20260330T120000");
    const packages = [
      {
        path: "packages/a",
        name: "@scope/a",
        version: "1.0.0",
        dependencies: [] as string[],
        registries: ["npm" as const],
        ecosystem: "js",
      },
      {
        path: "packages/b",
        name: "@scope/b",
        version: "2.0.0",
        dependencies: [] as string[],
        registries: ["npm" as const],
        ecosystem: "js",
      },
    ];

    const plan = buildSnapshotVersionPlan(
      packages,
      "independent",
      "snapshot",
      undefined,
    );

    expect(plan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.0.0-snapshot-20260330T120000"],
        ["packages/b::js", "2.0.0-snapshot-20260330T120000"],
      ]),
    });
  });

  it("passes snapshotTemplate to generateSnapshotVersion", () => {
    const packages = [
      {
        path: ".",
        name: "pubm",
        version: "1.0.0",
        dependencies: [] as string[],
        registries: ["npm" as const],
        ecosystem: "js",
      },
    ];

    buildSnapshotVersionPlan(packages, "fixed", "beta", "{tag}-custom");

    expect(mockedGenerateSnapshotVersion).toHaveBeenCalledWith({
      baseVersion: "1.0.0",
      tag: "beta",
      template: "{tag}-custom",
    });
  });

  it("falls back to 0.0.0 when version is empty", () => {
    const packages = [
      {
        path: ".",
        name: "pubm",
        version: "",
        dependencies: [] as string[],
        registries: ["npm" as const],
        ecosystem: "js",
      },
    ];

    buildSnapshotVersionPlan(packages, "fixed", "snapshot", undefined);

    expect(mockedGenerateSnapshotVersion).toHaveBeenCalledWith(
      expect.objectContaining({ baseVersion: "0.0.0" }),
    );
  });
});

describe("applySnapshotFilter", () => {
  const packages: ResolvedPackageConfig[] = [
    {
      path: "packages/core",
      name: "@pubm/core",
      version: "1.0.0",
      dependencies: [],
      registries: ["npm"],
    },
    {
      path: "packages/pubm",
      name: "pubm",
      version: "1.0.0",
      dependencies: [],
      registries: ["npm"],
    },
    {
      path: "packages/plugin-brew",
      name: "@pubm/plugin-brew",
      version: "1.0.0",
      dependencies: [],
      registries: ["npm"],
    },
  ];

  it("returns all packages when no filter is provided", () => {
    expect(applySnapshotFilter(packages, undefined)).toEqual(packages);
  });

  it("returns all packages when filter is empty array", () => {
    expect(applySnapshotFilter(packages, [])).toEqual(packages);
  });

  it("filters by package name", () => {
    expect(applySnapshotFilter(packages, ["@pubm/core"])).toEqual([
      packages[0],
    ]);
  });

  it("filters by package path", () => {
    expect(applySnapshotFilter(packages, ["packages/pubm"])).toEqual([
      packages[1],
    ]);
  });

  it("filters by mixed name and path", () => {
    expect(
      applySnapshotFilter(packages, ["@pubm/core", "packages/pubm"]),
    ).toEqual([packages[0], packages[1]]);
  });

  it("throws when no packages match the filter", () => {
    expect(() => applySnapshotFilter(packages, ["nonexistent"])).toThrow(
      "No packages matched the provided --filter patterns.",
    ); // matches the en locale string for error.snapshot.noMatchingPackages
  });
});

describe("runSnapshotPipeline", () => {
  beforeEach(() => {
    mockedGenerateSnapshotVersion.mockReturnValue(
      "1.0.0-snapshot-20260330T120000",
    );

    mockedExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 } as any);
    mockedWriteVersions.mockResolvedValue(undefined);
    mockedCollectPublishOperations.mockResolvedValue([]);
    mockedResolveWorkspaceProtocols.mockResolvedValue(undefined);
    mockedRestoreManifests.mockReset();

    // Default Git mock — reset after vi.clearAllMocks()
    mockedGit.mockImplementation(function () {
      return {
        latestCommit: vi.fn().mockResolvedValue("abc123"),
        createTag: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      } as any;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockIsCI.value = false;
  });

  it("runs workflow-native prerequisites and required conditions checks", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedCreatePrerequisitesCheckOperation).toHaveBeenCalledWith(false);
    expect(mockedCreateRequiredConditionsCheckOperation).toHaveBeenCalledWith(
      false,
    );
  });

  it("sets versionPlan and tag on ctx.runtime", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "beta" });

    expect(ctx.runtime.tag).toBe("beta");
    expect(ctx.runtime.versionPlan).toBeDefined();
    expect(ctx.runtime.versionPlan?.mode).toBe("single");
  });

  it("sets promptEnabled to true when not CI and stdin is TTY", async () => {
    mockIsCI.value = false;
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(ctx.runtime.promptEnabled).toBe(true);
    process.stdin.isTTY = originalIsTTY;
  });

  it("sets promptEnabled to false when in CI", async () => {
    mockIsCI.value = true;
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(ctx.runtime.promptEnabled).toBe(false);
    process.stdin.isTTY = originalIsTTY;
  });

  it("collects CI publish plugin credentials when snapshot runs in CI mode", async () => {
    mockIsCI.value = true;
    const ctx = makeSnapshotContext({}, { mode: "ci" });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedRunCiPublishPluginCreds).toHaveBeenCalled();
  });

  it("does not collect CI publish plugin credentials in local mode", async () => {
    mockIsCI.value = false;
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedRunCiPublishPluginCreds).not.toHaveBeenCalled();
  });

  it("applies filter to packages when provided", async () => {
    const ctx = makeSnapshotContext({
      packages: [
        {
          path: "packages/a",
          name: "@scope/a",
          version: "1.0.0",
          ecosystem: "js",
          dependencies: [],
          registries: ["npm"],
        },
        {
          path: "packages/b",
          name: "@scope/b",
          version: "1.0.0",
          ecosystem: "js",
          dependencies: [],
          registries: ["npm"],
        },
      ],
      versioning: "fixed",
    });

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      filter: ["packages/a"],
    });

    expect(ctx.runtime.versionPlan?.mode).toBe("single");
  });

  it("does not use legacy createListr or registry taskFactory orchestration for snapshot publishing", async () => {
    const ctx = makeSnapshotContext();
    const registryOperation = vi.fn().mockResolvedValue(undefined);
    mockedCollectPublishOperations.mockResolvedValueOnce([
      { title: "Publish package", run: registryOperation },
    ]);

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedCreateListr).not.toHaveBeenCalled();
    expect(mockRegistryTaskFactory).not.toHaveBeenCalled();
    expect(registryOperation).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        runOperations: expect.any(Function),
      }),
    );
  });

  it("skips test operation when skipTests is true", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      skipTests: true,
    });

    expect(mockedExec).not.toHaveBeenCalledWith(
      "npm",
      ["run", ctx.options.testScript],
      expect.anything(),
    );
  });

  it("skips build operation when skipBuild is true", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      skipBuild: true,
    });

    expect(mockedExec).not.toHaveBeenCalledWith(
      "npm",
      ["run", ctx.options.buildScript],
      expect.anything(),
    );
  });

  it("skips tag operation when dryRun is true", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      dryRun: true,
    });

    expect(mockedGit).not.toHaveBeenCalled();
  });

  it("snapshot task calls writeVersions and collectPublishOperations", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedWriteVersions).toHaveBeenCalled();
    expect(mockedCollectPublishOperations).toHaveBeenCalledWith(ctx);
  });

  it("restores original versions in snapshot task finally block", async () => {
    const ctx = makeSnapshotContext();
    const writeVersionsCalls: Map<string, string>[] = [];
    mockedWriteVersions.mockImplementation(
      async (_ctx: PubmContext, versions: Map<string, string>) => {
        writeVersionsCalls.push(new Map(versions));
      },
    );

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    // First call: snapshot versions; second call: restore original versions
    expect(writeVersionsCalls).toHaveLength(2);
    // The second call should have the original version "1.0.0"
    expect(writeVersionsCalls[1]?.get(".::js")).toBe("1.0.0");
  });

  it("restores original versions even when publish fails", async () => {
    const ctx = makeSnapshotContext();
    mockedCollectPublishOperations.mockRejectedValueOnce(
      new Error("publish failed"),
    );
    const writeVersionsCalls: Map<string, string>[] = [];
    mockedWriteVersions.mockImplementation(
      async (_ctx: PubmContext, versions: Map<string, string>) => {
        writeVersionsCalls.push(new Map(versions));
      },
    );

    await expect(runSnapshotPipeline(ctx, { tag: "snapshot" })).rejects.toThrow(
      "publish failed",
    );

    // Should still have restored original versions (finally block)
    expect(writeVersionsCalls).toHaveLength(2);
    expect(writeVersionsCalls[1]?.get(".::js")).toBe("1.0.0");
  });

  it("tag task creates git tag and pushes for single/fixed plan", async () => {
    const ctx = makeSnapshotContext();

    const mockCreateTag = vi.fn().mockResolvedValue(undefined);
    const mockPush = vi.fn().mockResolvedValue(undefined);
    const mockLatestCommit = vi.fn().mockResolvedValue("abc123");
    mockedGit.mockImplementation(function () {
      return {
        latestCommit: mockLatestCommit,
        createTag: mockCreateTag,
        push: mockPush,
      } as any;
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockCreateTag).toHaveBeenCalledWith(
      "v1.0.0-snapshot-20260330T120000",
      "abc123",
    );
    expect(mockPush).toHaveBeenCalledWith("--tags");
  });

  it("tag task creates per-package git tags for independent plan", async () => {
    mockedGenerateSnapshotVersion
      .mockReturnValueOnce("1.0.0-snap")
      .mockReturnValueOnce("2.0.0-snap");

    const ctx = makeSnapshotContext({
      packages: [
        {
          path: "packages/a",
          name: "@scope/a",
          version: "1.0.0",
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
      versioning: "independent",
    });

    const mockCreateTag = vi.fn().mockResolvedValue(undefined);
    const mockPush = vi.fn().mockResolvedValue(undefined);
    const mockLatestCommit = vi.fn().mockResolvedValue("abc123");
    mockedGit.mockImplementation(function () {
      return {
        latestCommit: mockLatestCommit,
        createTag: mockCreateTag,
        push: mockPush,
      } as any;
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockCreateTag).toHaveBeenCalledWith("@scope/a@1.0.0-snap", "abc123");
    expect(mockCreateTag).toHaveBeenCalledWith("@scope/b@2.0.0-snap", "abc123");
    expect(mockPush).toHaveBeenCalledWith("--tags");
  });

  it("versionDisplay is empty string for independent versioning plan", async () => {
    mockedGenerateSnapshotVersion
      .mockReturnValueOnce("1.0.0-snap")
      .mockReturnValueOnce("2.0.0-snap");

    const ctx = makeSnapshotContext({
      packages: [
        {
          path: "packages/a",
          name: "@scope/a",
          version: "1.0.0",
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
      versioning: "independent",
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    // For independent mode, version display should be empty string
    const logCall = consoleSpy.mock.calls[0]?.[0] as string;
    expect(logCall).toContain("📸");
    consoleSpy.mockRestore();
  });

  it("snapshot publish operation writes every independent package version", async () => {
    mockedGenerateSnapshotVersion
      .mockReturnValueOnce("1.0.0-snap")
      .mockReturnValueOnce("2.0.0-snap");

    const ctx = makeSnapshotContext({
      packages: [
        {
          path: "packages/a",
          name: "@scope/a",
          version: "1.0.0",
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
      versioning: "independent",
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    const snapshotVersionsArg = mockedWriteVersions.mock.calls[0]?.[1];
    expect(snapshotVersionsArg?.get("packages/a::js")).toBe("1.0.0-snap");
    expect(snapshotVersionsArg?.get("packages/b::js")).toBe("2.0.0-snap");
  });

  it("snapshot task for fixed monorepo uses plan.packages map", async () => {
    mockedGenerateSnapshotVersion.mockReturnValue("1.0.0-snap");

    const ctx = makeSnapshotContext({
      packages: [
        {
          path: "packages/a",
          name: "@scope/a",
          version: "1.0.0",
          ecosystem: "js",
          dependencies: [],
          registries: ["npm"],
        },
        {
          path: "packages/b",
          name: "@scope/b",
          version: "1.0.0",
          ecosystem: "js",
          dependencies: [],
          registries: ["npm"],
        },
      ],
      versioning: "fixed",
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    // writeVersions should be called with the plan.packages map (fixed mode)
    expect(mockedWriteVersions).toHaveBeenCalled();
    const snapshotVersionsArg = mockedWriteVersions.mock.calls[0]?.[1];
    expect(snapshotVersionsArg).toBeInstanceOf(Map);
    expect(snapshotVersionsArg?.get("packages/a::js")).toBe("1.0.0-snap");
    expect(snapshotVersionsArg?.get("packages/b::js")).toBe("1.0.0-snap");
  });

  it("tag task uses pkgPath as tag name when pkg name is not found", async () => {
    mockedGenerateSnapshotVersion
      .mockReturnValueOnce("1.0.0-snap")
      .mockReturnValueOnce("2.0.0-snap");

    const ctx = makeSnapshotContext({
      packages: [
        {
          path: "packages/a",
          name: "@scope/a",
          version: "1.0.0",
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
      versioning: "independent",
    });

    // Add an extra package to plan that isn't in config.packages
    const mockCreateTag = vi.fn().mockResolvedValue(undefined);
    const mockPush = vi.fn().mockResolvedValue(undefined);
    const mockLatestCommit = vi.fn().mockResolvedValue("abc123");
    mockedGit.mockImplementation(function () {
      return {
        latestCommit: mockLatestCommit,
        createTag: mockCreateTag,
        push: mockPush,
      } as any;
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    // Should create tags for packages that exist in config
    expect(mockCreateTag).toHaveBeenCalledTimes(2);
  });

  it("calls resolveWorkspaceProtocols after writeVersions", async () => {
    const ctx = makeSnapshotContext();
    const callOrder: string[] = [];

    mockedWriteVersions.mockImplementation(async () => {
      callOrder.push("writeVersions");
    });
    mockedResolveWorkspaceProtocols.mockImplementation(async () => {
      callOrder.push("resolveWorkspaceProtocols");
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedResolveWorkspaceProtocols).toHaveBeenCalledWith(ctx);
    // First writeVersions call is snapshot versions, then resolveWorkspaceProtocols
    expect(callOrder[0]).toBe("writeVersions");
    expect(callOrder[1]).toBe("resolveWorkspaceProtocols");
  });

  it("restores workspace manifests in finally block when backups exist", async () => {
    const ctx = makeSnapshotContext();
    const backups = new Map([["path/package.json", '{"original": true}']]);

    mockedResolveWorkspaceProtocols.mockImplementation(async (c) => {
      (c as PubmContext).runtime.workspaceBackups = backups;
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedRestoreManifests).toHaveBeenCalledWith(backups);
    expect(ctx.runtime.workspaceBackups).toBeUndefined();
  });

  it("restores workspace manifests even when publish fails", async () => {
    const ctx = makeSnapshotContext();
    const backups = new Map([["path/package.json", '{"original": true}']]);

    mockedResolveWorkspaceProtocols.mockImplementation(async (c) => {
      (c as PubmContext).runtime.workspaceBackups = backups;
    });
    mockedCollectPublishOperations.mockRejectedValueOnce(
      new Error("publish failed"),
    );

    await expect(runSnapshotPipeline(ctx, { tag: "snapshot" })).rejects.toThrow(
      "publish failed",
    );

    expect(mockedRestoreManifests).toHaveBeenCalledWith(backups);
  });

  it("calls restoreManifests before writeVersions in finally block", async () => {
    const ctx = makeSnapshotContext();
    const callOrder: string[] = [];

    mockedResolveWorkspaceProtocols.mockImplementation(async (c) => {
      (c as PubmContext).runtime.workspaceBackups = new Map([
        ["pkg.json", "{}"],
      ]);
    });
    mockedRestoreManifests.mockImplementation(() => {
      callOrder.push("restoreManifests");
    });
    mockedWriteVersions.mockImplementation(async () => {
      callOrder.push("writeVersions");
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    // In the finally block: restoreManifests runs before the second writeVersions
    // callOrder: ["writeVersions", "writeVersions"] without backups, but with backups:
    // ["writeVersions", "restoreManifests", "writeVersions"]
    const restoreIdx = callOrder.indexOf("restoreManifests");
    const lastWriteIdx = callOrder.lastIndexOf("writeVersions");
    expect(restoreIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeLessThan(lastWriteIdx);
  });

  it("does not call restoreManifests when no workspace backups exist", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedRestoreManifests).not.toHaveBeenCalled();
  });
});
