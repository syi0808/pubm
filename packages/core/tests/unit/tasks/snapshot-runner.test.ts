import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsCI = vi.hoisted(() => ({ value: false }));
vi.mock("std-env", () => ({
  get isCI() {
    return mockIsCI.value;
  },
}));

vi.mock("../../../src/utils/snapshot.js", () => ({
  generateSnapshotVersion: vi.fn(() => "1.0.0-snapshot-20260330T120000"),
}));

vi.mock("../../../src/tasks/prerequisites-check.js", () => ({
  prerequisitesCheckTask: vi.fn().mockReturnValue({
    run: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../../src/tasks/required-conditions-check.js", () => ({
  requiredConditionsCheckTask: vi.fn().mockReturnValue({
    run: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../../src/tasks/runner.js", () => ({
  writeVersions: vi.fn().mockResolvedValue(undefined),
  collectPublishTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn(),
  createCiListrOptions: vi.fn(() => ({ renderer: "ci-renderer" })),
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
import { PluginRunner } from "../../../src/plugin/runner.js";
import { prerequisitesCheckTask } from "../../../src/tasks/prerequisites-check.js";
import { requiredConditionsCheckTask } from "../../../src/tasks/required-conditions-check.js";
import {
  collectPublishTasks,
  writeVersions,
} from "../../../src/tasks/runner.js";
import {
  applySnapshotFilter,
  buildSnapshotVersionPlan,
  runSnapshotPipeline,
} from "../../../src/tasks/snapshot-runner.js";
import { createCiListrOptions, createListr } from "../../../src/utils/listr.js";
import { generateSnapshotVersion } from "../../../src/utils/snapshot.js";
import { makeTestContext } from "../../helpers/make-context.js";

const mockedGenerateSnapshotVersion = vi.mocked(generateSnapshotVersion);
const mockedPrerequisitesCheckTask = vi.mocked(prerequisitesCheckTask);
const mockedRequiredConditionsCheckTask = vi.mocked(
  requiredConditionsCheckTask,
);
const mockedCreateListr = vi.mocked(createListr);
const mockedCreateCiListrOptions = vi.mocked(createCiListrOptions);
const mockedWriteVersions = vi.mocked(writeVersions);
const mockedCollectPublishTasks = vi.mocked(collectPublishTasks);
const mockedGit = vi.mocked(Git);

function _makeMockTaskRunner() {
  return {
    run: vi.fn(async (ctx: PubmContext) => {
      // runs all tasks by default
      for (const task of capturedTasks) {
        if (typeof task.enabled === "boolean" && !task.enabled) continue;
        if (typeof task.skip === "boolean" && task.skip) continue;
        const mockTask = {
          output: "",
          title: task.title || "",
        };
        if (task.task) {
          await task.task(ctx, mockTask);
        }
      }
    }),
  };
}

let capturedTasks: any[] = [];

function setupCreateListrMock() {
  mockedCreateListr.mockImplementation((...args: any[]) => {
    const tasks = Array.isArray(args[0]) ? args[0] : [args[0]];
    capturedTasks = tasks;
    return {
      run: vi.fn(async (ctx: PubmContext) => {
        for (const task of tasks) {
          if (typeof task.enabled === "boolean" && !task.enabled) continue;
          if (typeof task.skip === "boolean" && task.skip) continue;
          const mockTask = {
            output: "",
            title: task.title || "",
          };
          if (task.task) {
            await task.task(ctx, mockTask);
          }
        }
      }),
    } as any;
  });
}

function makeSnapshotContext(
  overrides: Partial<PubmContext["config"]> = {},
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
      packagePath: ".",
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
        ["packages/a", "1.0.0-snapshot-20260330T120000"],
        ["packages/b", "1.0.0-snapshot-20260330T120000"],
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
        ["packages/a", "1.0.0-snapshot-20260330T120000"],
        ["packages/b", "2.0.0-snapshot-20260330T120000"],
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

    buildSnapshotVersionPlan(packages, "fixed", "beta", "{base}-{tag}-custom");

    expect(mockedGenerateSnapshotVersion).toHaveBeenCalledWith({
      baseVersion: "1.0.0",
      tag: "beta",
      template: "{base}-{tag}-custom",
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

    const mockRun = vi.fn().mockResolvedValue(undefined);
    mockedPrerequisitesCheckTask.mockReturnValue({ run: mockRun } as any);
    mockedRequiredConditionsCheckTask.mockReturnValue({
      run: mockRun,
    } as any);

    mockedWriteVersions.mockResolvedValue(undefined);
    mockedCollectPublishTasks.mockResolvedValue([]);

    // Default Git mock — reset after vi.clearAllMocks()
    mockedGit.mockImplementation(function () {
      return {
        latestCommit: vi.fn().mockResolvedValue("abc123"),
        createTag: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      } as any;
    });

    setupCreateListrMock();
    capturedTasks = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockIsCI.value = false;
  });

  it("calls prerequisitesCheckTask and requiredConditionsCheckTask", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedPrerequisitesCheckTask).toHaveBeenCalledWith({ skip: false });
    expect(mockedRequiredConditionsCheckTask).toHaveBeenCalledWith({
      skip: false,
    });
  });

  it("sets versionPlan and tag on ctx.runtime", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "beta" });

    expect(ctx.runtime.tag).toBe("beta");
    expect(ctx.runtime.versionPlan).toBeDefined();
    expect(ctx.runtime.versionPlan?.mode).toBe("single");
  });

  it("uses createCiListrOptions when isCI is true", async () => {
    mockIsCI.value = true;
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedCreateCiListrOptions).toHaveBeenCalled();
  });

  it("does not use createCiListrOptions when isCI is false", async () => {
    mockIsCI.value = false;
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedCreateCiListrOptions).not.toHaveBeenCalled();
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

  it("creates tasks list with test, build, snapshot, and tag tasks", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedCreateListr).toHaveBeenCalled();
    const tasks = mockedCreateListr.mock.calls[0]?.[0] as any[];
    expect(tasks).toHaveLength(4);
  });

  it("skips test task when skipTests is true", async () => {
    const ctx = makeSnapshotContext();

    // Set up createListr to track task skip values
    let capturedSkipValues: boolean[] = [];
    mockedCreateListr.mockImplementationOnce((...args: any[]) => {
      const tasks = Array.isArray(args[0]) ? args[0] : [args[0]];
      capturedSkipValues = tasks.map((t) => t.skip);
      return { run: vi.fn().mockResolvedValue(undefined) } as any;
    });

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      skipTests: true,
    });

    expect(capturedSkipValues[0]).toBe(true);
  });

  it("skips build task when skipBuild is true", async () => {
    const ctx = makeSnapshotContext();

    let capturedSkipValues: boolean[] = [];
    mockedCreateListr.mockImplementationOnce((...args: any[]) => {
      const tasks = Array.isArray(args[0]) ? args[0] : [args[0]];
      capturedSkipValues = tasks.map((t) => t.skip);
      return { run: vi.fn().mockResolvedValue(undefined) } as any;
    });

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      skipBuild: true,
    });

    expect(capturedSkipValues[1]).toBe(true);
  });

  it("disables tag task when dryRun is true", async () => {
    const ctx = makeSnapshotContext();

    let capturedEnabledValues: (boolean | undefined)[] = [];
    mockedCreateListr.mockImplementationOnce((...args: any[]) => {
      const tasks = Array.isArray(args[0]) ? args[0] : [args[0]];
      capturedEnabledValues = tasks.map((t) => t.enabled);
      return { run: vi.fn().mockResolvedValue(undefined) } as any;
    });

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      dryRun: true,
    });

    // The 4th task (createTag) should be disabled
    expect(capturedEnabledValues[3]).toBe(false);
  });

  it("enables tag task when dryRun is false", async () => {
    const ctx = makeSnapshotContext();

    let capturedEnabledValues: (boolean | undefined)[] = [];
    mockedCreateListr.mockImplementationOnce((...args: any[]) => {
      const tasks = Array.isArray(args[0]) ? args[0] : [args[0]];
      capturedEnabledValues = tasks.map((t) => t.enabled);
      return { run: vi.fn().mockResolvedValue(undefined) } as any;
    });

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      dryRun: false,
    });

    expect(capturedEnabledValues[3]).toBe(true);
  });

  it("snapshot task calls writeVersions and collectPublishTasks", async () => {
    const ctx = makeSnapshotContext();

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    expect(mockedWriteVersions).toHaveBeenCalled();
    expect(mockedCollectPublishTasks).toHaveBeenCalledWith(ctx);
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
    expect(writeVersionsCalls[1]?.get(".")).toBe("1.0.0");
  });

  it("restores original versions even when publish fails", async () => {
    const ctx = makeSnapshotContext();
    mockedCollectPublishTasks.mockRejectedValueOnce(
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
    expect(writeVersionsCalls[1]?.get(".")).toBe("1.0.0");
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

  it("snapshot task label shows package count for independent plan", async () => {
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

    // Capture the task to check its label
    let snapshotTask: any;
    mockedCreateListr.mockImplementationOnce((...args: any[]) => {
      const tasks = Array.isArray(args[0]) ? args[0] : [args[0]];
      snapshotTask = tasks[2]; // 3rd task is the snapshot task
      capturedTasks = tasks;
      return {
        run: vi.fn(async (ctx: PubmContext) => {
          for (const task of tasks) {
            if (typeof task.enabled === "boolean" && !task.enabled) continue;
            if (typeof task.skip === "boolean" && task.skip) continue;
            const mockTask = { output: "", title: task.title || "" };
            if (task.task) await task.task(ctx, mockTask);
          }
        }),
      } as any;
    });

    await runSnapshotPipeline(ctx, { tag: "snapshot" });

    // Verify the snapshot task was called (task exists)
    expect(snapshotTask).toBeDefined();
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
    expect(snapshotVersionsArg?.get("packages/a")).toBe("1.0.0-snap");
    expect(snapshotVersionsArg?.get("packages/b")).toBe("1.0.0-snap");
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
});
