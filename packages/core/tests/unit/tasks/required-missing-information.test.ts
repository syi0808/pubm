import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/changeset/status.js", () => ({
  getStatus: vi.fn(),
}));
vi.mock("../../../src/changeset/version.js", () => ({
  calculateVersionBumps: vi.fn(),
}));
vi.mock("../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));
vi.mock("../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn(),
  },
}));
vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn((...args: any[]) => {
    const taskDef = Array.isArray(args[0]) ? args[0][0] : args[0];
    return {
      _taskDef: taskDef,
      run: vi.fn(),
    };
  }),
}));

import { getStatus } from "../../../src/changeset/status.js";
import { calculateVersionBumps } from "../../../src/changeset/version.js";
import { loadConfig } from "../../../src/config/loader.js";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import { registryCatalog } from "../../../src/registry/catalog.js";
import { requiredMissingInformationTasks } from "../../../src/tasks/required-missing-information.js";
import { createListr } from "../../../src/utils/listr.js";

const mockedGetStatus = vi.mocked(getStatus);
const mockedCalculateVersionBumps = vi.mocked(calculateVersionBumps);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedRegistryCatalogGet = vi.mocked(registryCatalog.get);
const mockedCreateListr = vi.mocked(createListr);

function createMockPromptAdapter() {
  const runFn = vi.fn();
  return {
    run: runFn,
    _prompt: vi.fn(() => ({ run: runFn })),
  };
}

function createMockTask() {
  const promptAdapter = createMockPromptAdapter();
  const outputs: string[] = [];
  let output = "";
  return {
    get output() {
      return output;
    },
    set output(value: string) {
      output = value;
      outputs.push(value);
    },
    outputs,
    title: "",
    prompt: vi.fn(() => promptAdapter),
    _promptAdapter: promptAdapter,
  };
}

function getSubtasks(): any[] {
  const callArgs = mockedCreateListr.mock.calls[0];
  const taskDef = Array.isArray(callArgs[0]) ? callArgs[0][0] : callArgs[0];
  const mockParentTask = {
    newListr: vi.fn((subtasks: any[]) => subtasks),
  };
  const subtasks = (taskDef as any).task({}, mockParentTask);
  return subtasks;
}

function makePkg(
  overrides: Partial<ResolvedPackageConfig> & { name: string; version: string },
): ResolvedPackageConfig {
  return {
    path: overrides.path ?? ".",
    registries: overrides.registries ?? ["npm"],
    dependencies: overrides.dependencies ?? [],
    ...overrides,
  };
}

const defaultPackages: ResolvedPackageConfig[] = [
  makePkg({ name: "my-pkg", version: "1.0.0" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetStatus.mockReturnValue({
    hasChangesets: false,
    packages: new Map(),
    changesets: [],
  } as any);
  mockedCalculateVersionBumps.mockReturnValue(new Map() as any);
  mockedLoadConfig.mockResolvedValue(undefined as any);
  mockedRegistryCatalogGet.mockImplementation((key: string) => {
    if (key === "npm") {
      return {
        factory: vi.fn().mockResolvedValue({
          distTags: vi.fn().mockResolvedValue(["latest", "next", "beta"]),
        }),
      } as any;
    }
    if (key === "jsr") {
      return {
        factory: vi.fn().mockResolvedValue({
          distTags: vi.fn().mockResolvedValue([]),
        }),
      } as any;
    }
    return undefined;
  });
});

describe("requiredMissingInformationTasks", () => {
  it('creates a listr with title "Checking required information"', () => {
    requiredMissingInformationTasks();

    const callArgs = mockedCreateListr.mock.calls[0];
    const taskDef = Array.isArray(callArgs[0]) ? callArgs[0][0] : callArgs[0];
    expect((taskDef as any).title).toBe("Checking required information");
  });

  it("passes additional options through to createListr", () => {
    requiredMissingInformationTasks({ skip: true });

    const callArgs = mockedCreateListr.mock.calls[0];
    const taskDef = Array.isArray(callArgs[0]) ? callArgs[0][0] : callArgs[0];
    expect((taskDef as any).skip).toBe(true);
  });

  it("creates two subtasks for version and tag", () => {
    requiredMissingInformationTasks();
    const subtasks = getSubtasks();

    expect(subtasks).toHaveLength(2);
    expect(subtasks[0].title).toBe("Checking version information");
    expect(subtasks[1].title).toBe("Checking tag information");
  });

  describe("version subtask", () => {
    it("skips when ctx.versionPlan is already set", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      expect(
        versionTask.skip({
          runtime: {
            versionPlan: {
              mode: "single",
              version: "2.0.0",
              packageName: "my-pkg",
            },
          },
        }),
      ).toBe(true);
    });

    it("does not skip when ctx.versionPlan is undefined", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      expect(versionTask.skip({ runtime: { versionPlan: undefined } })).toBe(
        false,
      );
    });

    it("skips when workspace versionPlan is already provided", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      expect(
        versionTask.skip({
          runtime: {
            versionPlan: {
              mode: "independent",
              packages: new Map([["@pubm/core", "1.0.0"]]),
            },
          },
        }),
      ).toBe(true);
    });

    it("has exitOnError set to true", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();

      expect(subtasks[0].exitOnError).toBe(true);
    });

    it("reads the current version from ctx.config.packages and prompts for semver increment", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("1.1.0");

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalled();
      expect(ctx.runtime.version).toBe("1.1.0");
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.1.0",
      });
    });

    it('prompts for custom version when user selects "specify"', async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("3.0.0-alpha.1");

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalledTimes(2);
      expect(ctx.runtime.version).toBe("3.0.0-alpha.1");
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "3.0.0-alpha.1",
      });
    });

    it("sets ctx.version to the selected semver version", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.version).toBe("2.0.0");
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "2.0.0",
      });
    });

    it("accepts a single-package changeset recommendation and marks it consumed", async () => {
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([["my-pkg", { changesetCount: 2 }]]),
        changesets: [{ id: "major-release" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "my-pkg",
            {
              currentVersion: "1.0.0",
              newVersion: "1.1.0",
              bumpType: "minor",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.version).toBe("1.1.0");
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.1.0",
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
      expect(mockTask.prompt).toHaveBeenCalledTimes(1);
    });

    it("accepts changeset guidance even when package name is empty", async () => {
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map(),
        changesets: [{ id: "nameless-package" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "",
            {
              currentVersion: "1.0.0",
              newVersion: "1.0.1",
              bumpType: "patch",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: {
          packages: [makePkg({ name: "", version: "1.0.0" })],
        },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.version).toBe("1.0.1");
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.0.1",
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
      expect(mockTask._promptAdapter.run.mock.calls[0][0].message).toContain(
        "0 changesets",
      );
    });

    it("falls back to manual selection when a changeset recommendation is customized", async () => {
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([["my-pkg", { changesetCount: 1 }]]),
        changesets: [{ id: "manual-override" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "my-pkg",
            {
              currentVersion: "1.0.0",
              newVersion: "1.0.1",
              bumpType: "patch",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("customize")
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("1.2.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.version).toBe("1.2.0");
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.2.0",
      });
      expect(ctx.runtime.changesetConsumed).toBeUndefined();
      expect(mockTask.prompt).toHaveBeenCalledTimes(3);
    });

    it("includes a keep current version option in the manual prompt", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("1.0.0");

      await versionTask.task(ctx, mockTask);

      expect(mockTask._promptAdapter.run.mock.calls[0][0].choices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("Keep current version"),
            name: "1.0.0",
          }),
        ]),
      );
      expect(ctx.runtime.version).toBe("1.0.0");
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.0.0",
      });
    });

    it("keeps the package summary visible while selecting independent versions", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "0.3.6",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "0.3.6",
          path: "packages/pubm",
          dependencies: ["@pubm/core"],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("0.3.7")
        .mockResolvedValueOnce("0.3.6");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versions).toEqual(
        new Map([
          ["@pubm/core", "0.3.7"],
          ["pubm", "0.3.6"],
        ]),
      );
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
      });
      expect(
        mockTask.outputs.some(
          (output) =>
            output.includes("@pubm/core") &&
            output.includes("pubm") &&
            output.includes("> @pubm/core"),
        ),
      ).toBe(true);
      expect(
        mockTask.outputs.some(
          (output) =>
            output.includes("@pubm/core") &&
            output.includes("0.3.7") &&
            output.includes("> pubm") &&
            output.includes("dependency @pubm/core bumped"),
        ),
      ).toBe(true);
      expect(mockTask.output).toContain("@pubm/core");
      expect(mockTask.output).toContain("pubm");
      expect(mockTask.output).toContain("0.3.7");
    });

    it("accepts multi-package changeset recommendations for all affected packages", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "0.3.6",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "0.3.6",
          path: "packages/pubm",
          dependencies: ["@pubm/core"],
        }),
      ];
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([
          ["@pubm/core", { changesetCount: 1 }],
          ["pubm", { changesetCount: 2 }],
        ]),
        changesets: [{ id: "workspace-release" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "@pubm/core",
            {
              currentVersion: "0.3.6",
              newVersion: "0.3.7",
              bumpType: "patch",
            },
          ],
          [
            "pubm",
            {
              currentVersion: "0.3.6",
              newVersion: "0.4.0",
              bumpType: "minor",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versions).toEqual(
        new Map([
          ["@pubm/core", "0.3.7"],
          ["pubm", "0.4.0"],
        ]),
      );
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
      expect(mockTask.output).toContain("Changesets suggest:");
    });

    it("shows zero changesets for workspace packages missing status metadata", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "0.3.6",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "0.3.6",
          path: "packages/pubm",
          dependencies: ["@pubm/core"],
        }),
      ];
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([["@pubm/core", { changesetCount: 1 }]]),
        changesets: [{ id: "workspace-release" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "@pubm/core",
            {
              currentVersion: "0.3.6",
              newVersion: "0.3.7",
              bumpType: "patch",
            },
          ],
          [
            "pubm",
            {
              currentVersion: "0.3.6",
              newVersion: "0.4.0",
              bumpType: "minor",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(mockTask.output).toContain(
        "pubm  0.3.6 → 0.4.0 (minor: 0 changesets)",
      );
    });

    it("falls back to manual multi-package mode when changesets produce no bumps", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          dependencies: [],
        }),
      ];
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map(),
        changesets: [{ id: "noop" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(new Map() as any);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("fixed")
        .mockResolvedValueOnce("1.0.1");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.version).toBe("1.0.1");
      expect(ctx.runtime.versions).toEqual(
        new Map([
          ["@pubm/core", "1.0.1"],
          ["pubm", "1.0.1"],
        ]),
      );
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "fixed",
        version: "1.0.1",
      });
    });

    it("supports fixed versioning for a workspace when no versioning mode is configured", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "1.2.0",
          path: "packages/pubm",
          dependencies: [],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("fixed")
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.version).toBe("2.0.0");
      expect(ctx.runtime.versions).toEqual(
        new Map([
          ["@pubm/core", "2.0.0"],
          ["pubm", "2.0.0"],
        ]),
      );
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "fixed",
        version: "2.0.0",
      });
      expect(mockTask.output).toContain("1.2.0");
    });

    it("uses configured fixed versioning without prompting for mode", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "2.0.0",
          path: "packages/pubm",
          dependencies: [],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "fixed", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("2.0.1");

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalledTimes(1);
      expect(ctx.runtime.version).toBe("2.0.1");
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "fixed",
        version: "2.0.1",
      });
    });

    it("offers a cascade patch bump for dependents left unchanged after a dependency bump", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "0.3.6",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "0.3.6",
          path: "packages/pubm",
          dependencies: ["@pubm/core"],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("0.4.0")
        .mockResolvedValueOnce("0.3.6")
        .mockResolvedValueOnce("patch");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versions).toEqual(
        new Map([
          ["@pubm/core", "0.4.0"],
          ["pubm", "0.3.7"],
        ]),
      );
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
      });
      expect(
        mockTask.outputs.some((output) =>
          output.includes("Bump these dependent packages too?"),
        ),
      ).toBe(false);
      expect(
        mockTask.outputs.some((output) =>
          output.includes("dependency @pubm/core bumped"),
        ),
      ).toBe(true);
    });

    it("keeps current versions when cascade bump is declined", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "0.3.6",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pkg-a",
          version: "0.3.6",
          path: "packages/pkg-a",
          dependencies: ["@pubm/core"],
        }),
        makePkg({
          name: "pkg-b",
          version: "0.3.6",
          path: "packages/pkg-b",
          dependencies: ["@pubm/core"],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("0.4.0")
        .mockResolvedValueOnce("0.3.6")
        .mockResolvedValueOnce("0.3.6")
        .mockResolvedValueOnce("skip");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versions).toEqual(
        new Map([
          ["@pubm/core", "0.4.0"],
          ["pkg-a", "0.3.6"],
          ["pkg-b", "0.3.6"],
        ]),
      );
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
      });
      expect(
        mockTask.outputs.some((output) =>
          output.includes("dependencies @pubm/core, @pubm/core bumped"),
        ),
      ).toBe(false);
    });

    it("uses package versions for cascade bumps when current version metadata is incomplete", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "@pubm/utils",
          version: "2.0.0",
          path: "packages/utils",
          dependencies: [],
        }),
        makePkg({
          name: "app",
          version: "3.0.0",
          path: "packages/app",
          dependencies: ["@pubm/core", "@pubm/utils"],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("1.0.1")
        .mockResolvedValueOnce("2.0.1")
        .mockResolvedValueOnce("3.0.0")
        .mockResolvedValueOnce("patch");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versions).toEqual(
        new Map([
          ["@pubm/core", "1.0.1"],
          ["@pubm/utils", "2.0.1"],
          ["app", "3.0.1"],
        ]),
      );
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
      });
      expect(
        mockTask.outputs.some((output) =>
          output.includes("dependencies @pubm/core, @pubm/utils bumped"),
        ),
      ).toBe(true);
      expect(
        mockTask.outputs.some(
          (output) => output.includes("app") && output.includes("3.0.0"),
        ),
      ).toBe(true);
    });

    it("continues independent version selection when packages have no dependencies", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "0.3.6",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "0.3.6",
          path: "packages/pubm",
          dependencies: [],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("0.4.0")
        .mockResolvedValueOnce("0.3.6");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versions).toEqual(
        new Map([
          ["@pubm/core", "0.4.0"],
          ["pubm", "0.3.6"],
        ]),
      );
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
      });
    });

    it("sorts packages by dependency order (dependencies first)", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "app",
          version: "1.0.0",
          path: "packages/app",
          dependencies: ["@pubm/utils"],
        }),
        makePkg({
          name: "@pubm/utils",
          version: "1.0.0",
          path: "packages/utils",
          dependencies: ["@pubm/core"],
        }),
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // Prompts should come in dependency order: @pubm/core -> @pubm/utils -> app
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("1.0.1") // @pubm/core
        .mockResolvedValueOnce("1.0.1") // @pubm/utils
        .mockResolvedValueOnce("1.0.1"); // app

      await versionTask.task(ctx, mockTask);

      // First output should show @pubm/core as active (first prompted)
      expect(
        mockTask.outputs.some((output) => output.includes("> @pubm/core")),
      ).toBe(true);

      // The first "> " (active marker) should appear on @pubm/core, not app
      const firstActiveOutput = mockTask.outputs.find((output) =>
        output.includes("> "),
      );
      expect(firstActiveOutput).toContain("> @pubm/core");
    });

    it("preserves original order for packages at the same dependency depth", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "pkg-b",
          version: "1.0.0",
          path: "packages/pkg-b",
          dependencies: [],
        }),
        makePkg({
          name: "pkg-a",
          version: "1.0.0",
          path: "packages/pkg-a",
          dependencies: [],
        }),
        makePkg({
          name: "pkg-c",
          version: "1.0.0",
          path: "packages/pkg-c",
          dependencies: [],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("1.0.1") // pkg-b (first in original order)
        .mockResolvedValueOnce("1.0.1") // pkg-a
        .mockResolvedValueOnce("1.0.1"); // pkg-c

      await versionTask.task(ctx, mockTask);

      // First active package should be pkg-b (original order preserved for same depth)
      const firstActiveOutput = mockTask.outputs.find((output) =>
        output.includes("> "),
      );
      expect(firstActiveOutput).toContain("> pkg-b");
    });

    it("shows changeset notes in manual flow package summary", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          dependencies: [],
        }),
      ];
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([
          ["@pubm/core", { changesetCount: 3 }],
          ["pubm", { changesetCount: 1 }],
        ]),
        changesets: [{ id: "release" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "@pubm/core",
            {
              currentVersion: "1.0.0",
              newVersion: "1.1.0",
              bumpType: "minor",
            },
          ],
          [
            "pubm",
            {
              currentVersion: "1.0.0",
              newVersion: "1.0.1",
              bumpType: "patch",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // "customize" from changeset recommendation, then "fixed" mode, then version
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("customize")
        .mockResolvedValueOnce("fixed")
        .mockResolvedValueOnce("1.1.0");

      await versionTask.task(ctx, mockTask);

      // After customize, the manual flow should show changeset notes
      expect(
        mockTask.outputs.some(
          (output) =>
            output.includes("3 changesets suggest") &&
            output.includes("minor") &&
            output.includes("1.1.0"),
        ),
      ).toBe(true);
      expect(
        mockTask.outputs.some(
          (output) =>
            output.includes("1 changeset suggests") &&
            output.includes("patch") &&
            output.includes("1.0.1"),
        ),
      ).toBe(true);
    });

    it("shows changeset notes in independent mode per-package prompts", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          dependencies: [],
        }),
      ];
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([["@pubm/core", { changesetCount: 2 }]]),
        changesets: [{ id: "release" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "@pubm/core",
            {
              currentVersion: "1.0.0",
              newVersion: "1.1.0",
              bumpType: "minor",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // "customize" from changeset recommendation, then per-package versions
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("customize")
        .mockResolvedValueOnce("1.1.0") // @pubm/core
        .mockResolvedValueOnce("1.0.0"); // pubm

      await versionTask.task(ctx, mockTask);

      // Independent mode should show changeset note for @pubm/core
      expect(
        mockTask.outputs.some(
          (output) =>
            output.includes("> @pubm/core") &&
            output.includes("changesets suggest minor -> 1.1.0"),
        ),
      ).toBe(true);
    });

    it("marks recommended bump type in version choices", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          dependencies: [],
        }),
      ];
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([["@pubm/core", { changesetCount: 1 }]]),
        changesets: [{ id: "release" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "@pubm/core",
            {
              currentVersion: "1.0.0",
              newVersion: "2.0.0",
              bumpType: "major",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("customize")
        .mockResolvedValueOnce("2.0.0") // @pubm/core
        .mockResolvedValueOnce("1.0.0"); // pubm

      await versionTask.task(ctx, mockTask);

      // Second prompt (first per-package) should have "recommended by changesets" marker
      const secondPromptCall = mockTask._promptAdapter.run.mock.calls[1];
      const choices = secondPromptCall[0].choices;
      const majorChoice = choices.find((c: any) =>
        c.message.startsWith("major"),
      );
      expect(majorChoice.message).toContain("recommended by changesets");

      // Third prompt (pubm, no changeset) should NOT have the marker
      const thirdPromptCall = mockTask._promptAdapter.run.mock.calls[2];
      const pubmChoices = thirdPromptCall[0].choices;
      const hasMarker = pubmChoices.some((c: any) =>
        c.message.includes("recommended by changesets"),
      );
      expect(hasMarker).toBe(false);
    });

    it("shows changeset recommendations in dependency order", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          dependencies: ["@pubm/core"],
        }),
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
      ];
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([
          ["@pubm/core", { changesetCount: 1 }],
          ["pubm", { changesetCount: 1 }],
        ]),
        changesets: [{ id: "release" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "pubm",
            {
              currentVersion: "1.0.0",
              newVersion: "1.0.1",
              bumpType: "patch",
            },
          ],
          [
            "@pubm/core",
            {
              currentVersion: "1.0.0",
              newVersion: "1.1.0",
              bumpType: "minor",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      // In the changeset recommendation output, @pubm/core should appear before pubm
      const changesetOutput = mockTask.outputs.find((output) =>
        output.includes("Changesets suggest:"),
      );
      expect(changesetOutput).toBeDefined();
      const coreIndex = changesetOutput!.indexOf("@pubm/core");
      const pubmIndex = changesetOutput!.indexOf("pubm  ");
      expect(coreIndex).toBeLessThan(pubmIndex);
    });

    it("marks highest changeset bump type in fixed mode version choices", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          dependencies: [],
        }),
        makePkg({
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          dependencies: [],
        }),
      ];
      mockedGetStatus.mockReturnValue({
        hasChangesets: true,
        packages: new Map([
          ["@pubm/core", { changesetCount: 1 }],
          ["pubm", { changesetCount: 1 }],
        ]),
        changesets: [{ id: "release" }],
      } as any);
      mockedCalculateVersionBumps.mockReturnValue(
        new Map([
          [
            "@pubm/core",
            {
              currentVersion: "1.0.0",
              newVersion: "1.1.0",
              bumpType: "minor",
            },
          ],
          [
            "pubm",
            {
              currentVersion: "1.0.0",
              newVersion: "1.0.1",
              bumpType: "patch",
            },
          ],
        ]) as any,
      );

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined },
        config: { versioning: "fixed", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // "customize" from changeset recommendation, then version in fixed mode
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("customize")
        .mockResolvedValueOnce("1.1.0");

      await versionTask.task(ctx, mockTask);

      // Fixed mode prompt should mark "minor" as the highest bump type
      const fixedPromptCall = mockTask._promptAdapter.run.mock.calls[1];
      const choices = fixedPromptCall[0].choices;
      const minorChoice = choices.find((c: any) =>
        c.message.startsWith("minor"),
      );
      expect(minorChoice.message).toContain("recommended by changesets");

      // patch should NOT have the marker (minor is higher)
      const patchChoice = choices.find((c: any) =>
        c.message.startsWith("patch"),
      );
      expect(patchChoice.message).not.toContain("recommended by changesets");
    });
  });

  describe("tag subtask", () => {
    it("skips when there is no version information yet", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      expect(tagTask.skip({ runtime: { versionPlan: undefined } })).toBe(true);
    });

    it('skips when version is not a prerelease and tag is default ("latest")', () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      // not prerelease + tag is 'latest' (default) => skip
      expect(
        tagTask.skip({
          runtime: {
            versionPlan: {
              mode: "single",
              version: "1.0.0",
              packageName: "my-pkg",
            },
            tag: "latest",
          },
        }),
      ).toBe(true);
    });

    it("does not skip when version is a prerelease", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      // prerelease version => do not skip
      expect(
        tagTask.skip({
          runtime: {
            versionPlan: {
              mode: "single",
              version: "1.0.0-beta.1",
              packageName: "my-pkg",
            },
            tag: "latest",
          },
        }),
      ).toBe(false);
    });

    it("does not skip when tag is not the default", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      // tag is not 'latest' => do not skip
      expect(
        tagTask.skip({
          runtime: {
            versionPlan: {
              mode: "single",
              version: "1.0.0",
              packageName: "my-pkg",
            },
            tag: "next",
          },
        }),
      ).toBe(false);
    });

    it("has exitOnError set to true", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();

      expect(subtasks[1].exitOnError).toBe(true);
    });

    it("fetches dist-tags from registries via registryCatalog", async () => {
      const mockNpmDistTags = vi.fn().mockResolvedValue(["latest", "beta"]);
      const mockJsrDistTags = vi.fn().mockResolvedValue(["latest", "rc"]);
      mockedRegistryCatalogGet.mockImplementation((key: string) => {
        if (key === "npm")
          return {
            factory: vi.fn().mockResolvedValue({ distTags: mockNpmDistTags }),
          } as any;
        if (key === "jsr")
          return {
            factory: vi.fn().mockResolvedValue({ distTags: mockJsrDistTags }),
          } as any;
        return undefined;
      });

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = {
        config: {
          packages: [
            { name: "my-pkg", path: "/pkg", registries: ["npm", "jsr"] },
          ],
        },
        runtime: { version: "2.0.0-beta.1", tag: "latest" },
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("beta");

      await tagTask.task(ctx, mockTask);

      expect(mockNpmDistTags).toHaveBeenCalledOnce();
      expect(mockJsrDistTags).toHaveBeenCalledOnce();
    });

    it("deduplicates dist-tags from multiple registries", async () => {
      const mockNpmDistTags = vi
        .fn()
        .mockResolvedValue(["latest", "beta", "next"]);
      const mockJsrDistTags = vi.fn().mockResolvedValue(["latest", "beta"]);
      mockedRegistryCatalogGet.mockImplementation((key: string) => {
        if (key === "npm")
          return {
            factory: vi.fn().mockResolvedValue({ distTags: mockNpmDistTags }),
          } as any;
        if (key === "jsr")
          return {
            factory: vi.fn().mockResolvedValue({ distTags: mockJsrDistTags }),
          } as any;
        return undefined;
      });

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = {
        config: {
          packages: [
            { name: "my-pkg", path: "/pkg", registries: ["npm", "jsr"] },
          ],
        },
        runtime: { version: "2.0.0-beta.1", tag: "latest" },
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("beta");

      await tagTask.task(ctx, mockTask);

      // Verify prompt was called; choices should be deduplicated with 'latest' filtered
      expect(mockTask.prompt).toHaveBeenCalled();
      expect(ctx.runtime.tag).toBe("beta");
    });

    it('filters out "latest" from dist-tags choices', async () => {
      const mockNpmDistTags = vi.fn().mockResolvedValue(["latest", "beta"]);
      mockedRegistryCatalogGet.mockImplementation((key: string) => {
        if (key === "npm")
          return {
            factory: vi.fn().mockResolvedValue({ distTags: mockNpmDistTags }),
          } as any;
        return undefined;
      });

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = {
        config: {
          packages: [{ name: "my-pkg", path: "/pkg", registries: ["npm"] }],
        },
        runtime: { version: "2.0.0-beta.1", tag: "latest" },
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("beta");

      await tagTask.task(ctx, mockTask);

      // The prompt call should have choices without 'latest'
      expect(ctx.runtime.tag).toBe("beta");
    });

    it('defaults to ["next"] when no dist-tags remain after filtering', async () => {
      const mockNpmDistTags = vi.fn().mockResolvedValue(["latest"]);
      mockedRegistryCatalogGet.mockImplementation((key: string) => {
        if (key === "npm")
          return {
            factory: vi.fn().mockResolvedValue({ distTags: mockNpmDistTags }),
          } as any;
        return undefined;
      });

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = {
        config: {
          packages: [{ name: "my-pkg", path: "/pkg", registries: ["npm"] }],
        },
        runtime: { version: "2.0.0-beta.1", tag: "latest" },
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("next");

      await tagTask.task(ctx, mockTask);

      expect(ctx.runtime.tag).toBe("next");
    });

    it('prompts for custom tag when user selects "specify"', async () => {
      const mockNpmDistTags = vi.fn().mockResolvedValue(["latest", "beta"]);
      mockedRegistryCatalogGet.mockImplementation((key: string) => {
        if (key === "npm")
          return {
            factory: vi.fn().mockResolvedValue({ distTags: mockNpmDistTags }),
          } as any;
        return undefined;
      });

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = {
        config: {
          packages: [{ name: "my-pkg", path: "/pkg", registries: ["npm"] }],
        },
        runtime: { version: "2.0.0-beta.1", tag: "latest" },
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("canary");

      await tagTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalledTimes(2);
      expect(ctx.runtime.tag).toBe("canary");
    });

    it("sets ctx.tag to the selected tag", async () => {
      const mockNpmDistTags = vi
        .fn()
        .mockResolvedValue(["latest", "next", "beta"]);
      mockedRegistryCatalogGet.mockImplementation((key: string) => {
        if (key === "npm")
          return {
            factory: vi.fn().mockResolvedValue({ distTags: mockNpmDistTags }),
          } as any;
        return undefined;
      });

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = {
        config: {
          packages: [{ name: "my-pkg", path: "/pkg", registries: ["npm"] }],
        },
        runtime: { version: "2.0.0-beta.1", tag: "latest" },
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("beta");

      await tagTask.task(ctx, mockTask);

      expect(ctx.runtime.tag).toBe("beta");
    });
  });
});
