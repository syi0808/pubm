import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsCI = vi.hoisted(() => ({ value: false }));

const mockChangesetAnalyze = vi.fn().mockResolvedValue([]);
const mockConventionalAnalyze = vi.fn().mockResolvedValue([]);

vi.mock("std-env", () => ({
  get isCI() {
    return mockIsCI.value;
  },
}));
vi.mock("../../../src/version-source/index.js", () => {
  class MockChangesetSource {
    name = "changeset";
    analyze = mockChangesetAnalyze;
  }
  class MockConventionalCommitSource {
    name = "commit";
    analyze = mockConventionalAnalyze;
  }
  return {
    ChangesetSource: MockChangesetSource,
    ConventionalCommitSource: MockConventionalCommitSource,
    mergeRecommendations: (sourceResults: any[][]) => {
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const results of sourceResults) {
        for (const rec of results) {
          if (seen.has(rec.packagePath)) continue;
          seen.add(rec.packagePath);
          merged.push(rec);
        }
      }
      return merged;
    },
  };
});
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
vi.mock("../../../src/utils/filter-config.js", () => ({
  filterConfigPackages: vi.fn(),
}));

import { loadConfig } from "../../../src/config/loader.js";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import { registryCatalog } from "../../../src/registry/catalog.js";
import { requiredMissingInformationTasks } from "../../../src/tasks/required-missing-information.js";
import { filterConfigPackages } from "../../../src/utils/filter-config.js";
import { createListr } from "../../../src/utils/listr.js";

const mockedLoadConfig = vi.mocked(loadConfig);
const mockedRegistryCatalogGet = vi.mocked(registryCatalog.get);
const mockedCreateListr = vi.mocked(createListr);
const mockedFilterConfigPackages = vi.mocked(filterConfigPackages);

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
    ecosystem: overrides.ecosystem ?? "js",
    ...overrides,
  };
}

const defaultPackages: ResolvedPackageConfig[] = [
  makePkg({ name: "my-pkg", version: "1.0.0" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCI.value = false;
  mockedFilterConfigPackages.mockClear();
  mockChangesetAnalyze.mockResolvedValue([]);
  mockConventionalAnalyze.mockResolvedValue([]);
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

      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "2.0.0",
      });
    });

    it("accepts a single-package changeset recommendation and marks it consumed", async () => {
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: ".",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Add feature" }, { summary: "Fix bug" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.1.0",
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
      expect(mockTask.prompt).toHaveBeenCalledTimes(1);
    });

    it("accepts changeset guidance even when package name is empty", async () => {
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: ".",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: {
          packages: [makePkg({ name: "", version: "1.0.0" })],
        },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.0.1",
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
    });

    it("falls back to manual selection when a changeset recommendation is customized", async () => {
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: ".",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("customize")
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("1.2.0");

      await versionTask.task(ctx, mockTask);

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
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // First prompt: edit (no recommendations found), then per-package
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit") // accept/edit/skip
        .mockResolvedValueOnce("0.3.7")
        .mockResolvedValueOnce("0.3.6");

      await versionTask.task(ctx, mockTask);

      // pubm selected "keep current" (0.3.6), so it must be filtered out
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
        packages: new Map([["packages/core::js", "0.3.7"]]),
      });
      expect(ctx.runtime.versionPlan?.packages.has("packages/pubm::js")).toBe(
        false,
      );
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
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/core",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix core" }],
        },
        {
          packagePath: "packages/pubm",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Add feature" }, { summary: "More" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
        packages: new Map([
          ["packages/core::js", "0.3.7"],
          ["packages/pubm::js", "0.4.0"],
        ]),
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
      expect(mockTask.output).toContain("Version Recommendations");
    });

    it("shows recommendation summary for multi-package changeset bumps", async () => {
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
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/core",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix" }],
        },
        {
          packagePath: "packages/pubm",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Feature" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(
        mockTask.outputs.some((o) => o.includes("Version Recommendations")),
      ).toBe(true);
      expect(mockTask.outputs.some((o) => o.includes("packages/pubm"))).toBe(
        true,
      );
    });

    it("falls back to edit mode when no recommendations exist", async () => {
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

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "fixed", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // edit (no accept option since 0 recommendations), then fixed mode version
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.0.1");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "fixed",
        version: "1.0.1",
        packages: new Map([
          ["packages/core::js", "1.0.1"],
          ["packages/pubm::js", "1.0.1"],
        ]),
      });
    });

    it("supports fixed versioning via edit mode", async () => {
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
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "fixed", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit") // accept/edit/skip
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "fixed",
        version: "2.0.0",
        packages: new Map([
          ["packages/core::js", "2.0.0"],
          ["packages/pubm::js", "2.0.0"],
        ]),
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
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "fixed", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // First: edit (no recommendations), then fixed mode version
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("2.0.1");

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalledTimes(2);
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
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit") // accept/edit/skip
        .mockResolvedValueOnce("0.4.0")
        .mockResolvedValueOnce("0.3.6")
        .mockResolvedValueOnce("patch");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
        packages: new Map([
          ["packages/core::js", "0.4.0"],
          ["packages/pubm::js", "0.3.7"],
        ]),
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
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit") // accept/edit/skip
        .mockResolvedValueOnce("0.4.0")
        .mockResolvedValueOnce("0.3.6")
        .mockResolvedValueOnce("0.3.6")
        .mockResolvedValueOnce("skip");

      await versionTask.task(ctx, mockTask);

      // pkg-a and pkg-b selected "keep current" (0.3.6), so they must be filtered out
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
        packages: new Map([["packages/core::js", "0.4.0"]]),
      });
      expect(ctx.runtime.versionPlan?.packages.has("packages/pkg-a::js")).toBe(
        false,
      );
      expect(ctx.runtime.versionPlan?.packages.has("packages/pkg-b::js")).toBe(
        false,
      );
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
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit") // accept/edit/skip
        .mockResolvedValueOnce("1.0.1")
        .mockResolvedValueOnce("2.0.1")
        .mockResolvedValueOnce("3.0.0")
        .mockResolvedValueOnce("patch");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
        packages: new Map([
          ["packages/core::js", "1.0.1"],
          ["packages/utils::js", "2.0.1"],
          ["packages/app::js", "3.0.1"],
        ]),
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

      // pubm selected "keep current" (0.3.6), so it must be filtered out
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "independent",
        packages: new Map([["packages/core::js", "0.4.0"]]),
      });
      expect(ctx.runtime.versionPlan?.packages.has("packages/pubm::js")).toBe(
        false,
      );
    });

    it("independent mode: carries last selected bump type as initial for next prompt", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "pkg-a",
          version: "1.0.0",
          path: "packages/a",
          dependencies: [],
        }),
        makePkg({
          name: "pkg-b",
          version: "2.0.0",
          path: "packages/b",
          dependencies: [],
        }),
        makePkg({
          name: "pkg-c",
          version: "3.0.0",
          path: "packages/c",
          dependencies: [],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { versionPlan: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // First: edit (accept/edit/skip), then pkg-a: patch (1.0.1), pkg-b: minor (2.1.0), pkg-c: major (4.0.0)
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.0.1")
        .mockResolvedValueOnce("2.1.0")
        .mockResolvedValueOnce("4.0.0");

      await versionTask.task(ctx, mockTask);

      const calls = mockTask._promptAdapter.run.mock.calls;
      // calls[0]: accept/edit/skip
      // calls[1]: pkg-a version: no lastBumpType → initial defaults to 0
      expect(calls[1][0].initial).toBe(0);
      // calls[2]: pkg-b: lastBumpType = "patch" → RELEASE_TYPES index 4, +1 for "Keep current" = 5
      expect(calls[2][0].initial).toBe(5);
      // calls[3]: pkg-c: lastBumpType = "minor" → RELEASE_TYPES index 2, +1 for "Keep current" = 3
      expect(calls[3][0].initial).toBe(3);
    });

    it("independent mode: resets initial to 0 when 'Keep current' is selected", async () => {
      const packages: ResolvedPackageConfig[] = [
        makePkg({
          name: "pkg-a",
          version: "1.0.0",
          path: "packages/a",
          dependencies: [],
        }),
        makePkg({
          name: "pkg-b",
          version: "2.0.0",
          path: "packages/b",
          dependencies: [],
        }),
      ];

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { versionPlan: undefined },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // pkg-a: keep current (1.0.0), pkg-b: any
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("1.0.0")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      const calls = mockTask._promptAdapter.run.mock.calls;
      // Second prompt: lastBumpType = undefined (kept current) → initial 0
      expect(calls[1][0].initial).toBe(0);
    });

    it("no-changeset independent: excludes packages with unchanged versions from versionPlan and config", async () => {
      // No changesets — edit mode goes to independent per-package prompts
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
        runtime: { versionPlan: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // edit, then pkgA: bump to 1.1.0; pkgB: keep at 2.0.0 (keep current)
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      // Only pkgA (changed) should appear in the plan
      expect(ctx.runtime.versionPlan?.packages.has("packages/core::js")).toBe(
        true,
      );
      expect(ctx.runtime.versionPlan?.packages.has("packages/pubm::js")).toBe(
        false,
      );
      // filterConfigPackages must be called with only pkgA's packageKey
      expect(mockedFilterConfigPackages).toHaveBeenCalledWith(
        ctx,
        new Set(["packages/core::js"]),
      );
    });

    it("prompts packages in given order in edit mode", async () => {
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
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // edit, then per-package in given order: app -> @pubm/utils -> @pubm/core
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.0.1") // app
        .mockResolvedValueOnce("1.0.1") // @pubm/utils
        .mockResolvedValueOnce("1.0.1"); // @pubm/core

      await versionTask.task(ctx, mockTask);

      // First active package should be app (first in given order)
      const firstActiveOutput = mockTask.outputs.find((output) =>
        output.includes("> "),
      );
      expect(firstActiveOutput).toContain("> app");
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

    it("shows recommendation notes in edit mode for fixed versioning", async () => {
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
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/core",
          bumpType: "minor",
          source: "changeset",
          entries: [
            { summary: "Feature A" },
            { summary: "Feature B" },
            { summary: "Feature C" },
          ],
        },
        {
          packagePath: "packages/pubm",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "fixed", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // edit from recommendations, then fixed mode version
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0");

      await versionTask.task(ctx, mockTask);

      // The summary should show recommendation details
      expect(
        mockTask.outputs.some(
          (output) =>
            output.includes("Version Recommendations") &&
            output.includes("packages/core"),
        ),
      ).toBe(true);
    });

    it("shows recommendation notes in independent edit mode per-package prompts", async () => {
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
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/core",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Feature A" }, { summary: "Feature B" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // edit from recommendations, then per-package versions
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
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
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/core",
          bumpType: "major",
          source: "changeset",
          entries: [{ summary: "Breaking change" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit") // accept/edit/skip
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

    it("shows recommendations in summary table", async () => {
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
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/pubm",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix" }],
        },
        {
          packagePath: "packages/core",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Feature" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      // The summary table should include both packages
      const summaryOutput = mockTask.outputs.find((output) =>
        output.includes("Version Recommendations"),
      );
      expect(summaryOutput).toBeDefined();
      expect(summaryOutput).toContain("packages/pubm");
      expect(summaryOutput).toContain("packages/core");
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
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/core",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Feature" }],
        },
        {
          packagePath: "packages/pubm",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: true },
        config: { versioning: "fixed", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      // edit from recommendations, then version in fixed mode
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
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

  describe("CI auto-accept vs local prompt (regression)", () => {
    it("single package: shows prompt even when promptEnabled is false (non-CI local)", async () => {
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: ".",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Add feature" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: false },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalled();
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.1.0",
      });
    });

    it("single package: auto-accepts without prompt in actual CI", async () => {
      mockIsCI.value = true;
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: ".",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Add feature" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { version: undefined, promptEnabled: false },
        config: { packages: defaultPackages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).not.toHaveBeenCalled();
      expect(ctx.runtime.versionPlan).toMatchObject({
        mode: "single",
        version: "1.1.0",
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
    });

    it("multi package: shows prompt even when promptEnabled is false (non-CI local)", async () => {
      const packages = [
        makePkg({
          name: "@scope/a",
          version: "1.0.0",
          path: "packages/a",
        }),
        makePkg({
          name: "@scope/b",
          version: "2.0.0",
          path: "packages/b",
        }),
      ];
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/a",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix bug" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { versionPlan: undefined, promptEnabled: false },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalled();
    });

    it("multi package: auto-accepts without prompt in actual CI", async () => {
      mockIsCI.value = true;
      const packages = [
        makePkg({
          name: "@scope/a",
          version: "1.0.0",
          path: "packages/a",
        }),
        makePkg({
          name: "@scope/b",
          version: "2.0.0",
          path: "packages/b",
        }),
      ];
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/a",
          bumpType: "patch",
          source: "changeset",
          entries: [{ summary: "Fix bug" }],
        },
      ]);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        runtime: { versionPlan: undefined, promptEnabled: false },
        config: { versioning: "independent", packages },
        cwd: "/tmp",
      };
      const mockTask = createMockTask();

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).not.toHaveBeenCalled();
      expect(ctx.runtime.versionPlan).toBeDefined();
      expect(ctx.runtime.changesetConsumed).toBe(true);
    });
  });

  describe("unified prompt — accept", () => {
    const pkgA = makePkg({
      name: "@scope/a",
      version: "1.0.0",
      path: "packages/a",
    });
    const pkgB = makePkg({
      name: "@scope/b",
      version: "2.0.0",
      path: "packages/b",
    });
    const twoPackages = [pkgA, pkgB];

    function makeTwoPkgCtx() {
      return {
        config: { packages: twoPackages, versioning: undefined },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      } as any;
    }

    beforeEach(() => {
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/a",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Feature" }],
        },
      ]);
    });

    it("shows accept, edit, skip choices when recommendations exist", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      const promptCall = mockTask._promptAdapter.run.mock.calls[0];
      const choiceNames = promptCall[0].choices.map((c: any) => c.name);
      expect(choiceNames).toEqual(["accept", "edit", "skip"]);
    });

    it("accept: sets versionPlan with recommended packages", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toEqual({
        mode: "independent",
        packages: new Map([["packages/a::js", "1.1.0"]]),
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
    });

    it("accept: does not call filterConfigPackages", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(mockedFilterConfigPackages).not.toHaveBeenCalled();
    });

    it("accept: respects versioning fixed — creates FixedVersionPlan", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      ctx.config.versioning = "fixed";
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("accept");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toEqual({
        mode: "fixed",
        version: "1.1.0",
        packages: new Map([["packages/a::js", "1.1.0"]]),
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
    });
  });

  describe("unified prompt — edit", () => {
    const pkgA = makePkg({
      name: "@scope/a",
      version: "1.0.0",
      path: "packages/a",
    });
    const pkgB = makePkg({
      name: "@scope/b",
      version: "2.0.0",
      path: "packages/b",
    });
    const twoPackages = [pkgA, pkgB];

    function makeTwoPkgCtx() {
      return {
        config: { packages: twoPackages, versioning: "independent" as const },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      } as any;
    }

    beforeEach(() => {
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/a",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Feature" }],
        },
      ]);
    });

    it("edit: delegates to independent mode for per-package prompts", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      const mockTask = createMockTask();

      // edit → pkgA: 1.1.0 (bump), pkgB: 2.1.0 (bump)
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.1.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan?.packages.get("packages/a::js")).toBe(
        "1.1.0",
      );
      expect(ctx.runtime.versionPlan?.packages.get("packages/b::js")).toBe(
        "2.1.0",
      );
      expect(ctx.runtime.changesetConsumed).toBe(true);
    });

    it("edit: excludes packages with unchanged versions", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      const mockTask = createMockTask();

      // pkgB → keep current version "2.0.0"
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan?.packages.has("packages/b::js")).toBe(
        false,
      );
      expect(mockedFilterConfigPackages).toHaveBeenCalledWith(
        ctx,
        new Set(["packages/a::js"]),
      );
    });

    it("edit: sets changesetConsumed when changeset recommendations exist", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.changesetConsumed).toBe(true);
    });

    it("edit: does not set changesetConsumed when user keeps all packages at current version", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      const mockTask = createMockTask();
      // User selects edit but keeps both packages at current versions
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.0.0") // pkgA: keep current
        .mockResolvedValueOnce("2.0.0"); // pkgB: keep current

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.changesetConsumed).toBeFalsy();
    });

    it("edit: shows recommendation notes for packages with changeset bumps", async () => {
      const pkgANoDep = makePkg({
        name: "@scope/a",
        version: "1.0.0",
        path: "packages/a",
        dependencies: [],
      });
      const pkgBDependsOnA = makePkg({
        name: "@scope/b",
        version: "2.0.0",
        path: "packages/b",
        dependencies: ["@scope/a"],
      });

      const ctx: any = {
        config: {
          packages: [pkgANoDep, pkgBDependsOnA],
          versioning: "independent",
        },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      };

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const mockTask = createMockTask();

      // edit → pkgA: 1.1.0, pkgB: keep current
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      // Task output should have been set with recommendation summary
      expect(mockTask.outputs.length).toBeGreaterThan(0);
      expect(ctx.runtime.changesetConsumed).toBe(true);
    });

    it("edit: cascade prompt fires when a bumped package has unbumped dependents", async () => {
      const pkgANoDep = makePkg({
        name: "@scope/a",
        version: "1.0.0",
        path: "packages/a",
        dependencies: [],
      });
      const pkgBDepsA = makePkg({
        name: "@scope/b",
        version: "2.0.0",
        path: "packages/b",
        dependencies: ["@scope/a"],
      });
      const pkgCDepsB = makePkg({
        name: "@scope/c",
        version: "3.0.0",
        path: "packages/c",
        dependencies: ["@scope/b"],
      });

      const ctx: any = {
        config: {
          packages: [pkgANoDep, pkgBDepsA, pkgCDepsB],
          versioning: "independent",
        },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      };

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const mockTask = createMockTask();

      // edit → pkgA: 1.1.0, pkgB: 2.1.0, pkgC: 3.0.0 (keep) → cascade: patch
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0") // pkgA
        .mockResolvedValueOnce("2.1.0") // pkgB bumped
        .mockResolvedValueOnce("3.0.0") // pkgC keep current → cascade trigger
        .mockResolvedValueOnce("patch"); // cascade accepted

      await versionTask.task(ctx, mockTask);

      // pkgC should be in the versionPlan with 3.0.1 (patch bump)
      expect(ctx.runtime.versionPlan?.packages.get("packages/c::js")).toBe(
        "3.0.1",
      );
      expect(mockedFilterConfigPackages).toHaveBeenCalledWith(
        ctx,
        new Set(["packages/a::js", "packages/b::js", "packages/c::js"]),
      );
    });

    it("edit: cascade skipped when user declines", async () => {
      const pkgANoDep = makePkg({
        name: "@scope/a",
        version: "1.0.0",
        path: "packages/a",
        dependencies: [],
      });
      const pkgBDepsA = makePkg({
        name: "@scope/b",
        version: "2.0.0",
        path: "packages/b",
        dependencies: ["@scope/a"],
      });
      const pkgCDepsB = makePkg({
        name: "@scope/c",
        version: "3.0.0",
        path: "packages/c",
        dependencies: ["@scope/b"],
      });

      const ctx: any = {
        config: {
          packages: [pkgANoDep, pkgBDepsA, pkgCDepsB],
          versioning: "independent",
        },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      };

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const mockTask = createMockTask();

      // edit → pkgA: 1.1.0, pkgB: 2.1.0, pkgC: 3.0.0 (keep) → cascade: skip
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.1.0")
        .mockResolvedValueOnce("3.0.0")
        .mockResolvedValueOnce("skip");

      await versionTask.task(ctx, mockTask);

      // pkgC should NOT be in the versionPlan (cascade declined)
      expect(ctx.runtime.versionPlan?.packages.has("packages/c::js")).toBe(
        false,
      );
      expect(mockedFilterConfigPackages).toHaveBeenCalledWith(
        ctx,
        new Set(["packages/a::js", "packages/b::js"]),
      );
    });

    it("edit: carries last selected bump type as initial for next prompt", async () => {
      const pkgANoDep = makePkg({
        name: "@scope/a",
        version: "1.0.0",
        path: "packages/a",
        dependencies: [],
      });
      const pkgBNoDep = makePkg({
        name: "@scope/b",
        version: "2.0.0",
        path: "packages/b",
        dependencies: [],
      });
      const pkgCNoDep = makePkg({
        name: "@scope/c",
        version: "3.0.0",
        path: "packages/c",
        dependencies: [],
      });

      const ctx: any = {
        config: {
          packages: [pkgANoDep, pkgBNoDep, pkgCNoDep],
          versioning: "independent",
        },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      };

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const mockTask = createMockTask();

      // edit → pkgA: patch (1.0.1) → pkgB: patch (2.0.1) → pkgC: minor (3.1.0)
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.0.1") // pkgA: patch
        .mockResolvedValueOnce("2.0.1") // pkgB: patch
        .mockResolvedValueOnce("3.1.0"); // pkgC: minor

      await versionTask.task(ctx, mockTask);

      const calls = mockTask._promptAdapter.run.mock.calls;
      // calls[0]: edit prompt
      // calls[1]: pkgA version prompt — no lastBumpType → initial 0
      expect(calls[1][0].initial).toBe(0);
      // calls[2]: pkgB version prompt — lastBumpType = "patch" → RELEASE_TYPES index 4, +1 = 5
      expect(calls[2][0].initial).toBe(5);
    });

    it("edit: uses pkg.path as display name when package has no name", async () => {
      const pkgANoName = {
        path: "packages/a",
        version: "1.0.0",
        registries: ["npm"],
        dependencies: [],
      } as any;
      const pkgBDepsA = makePkg({
        name: "@scope/b",
        version: "2.0.0",
        path: "packages/b",
        dependencies: ["packages/a"],
      });

      const ctx: any = {
        config: {
          packages: [pkgANoName, pkgBDepsA],
          versioning: "independent",
        },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      };

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const mockTask = createMockTask();

      // edit → pkgA: 1.1.0, pkgB: keep current
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.changesetConsumed).toBe(true);
    });

    it("edit: respects versioning fixed — creates FixedVersionPlan", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx();
      ctx.config.versioning = "fixed";
      const mockTask = createMockTask();

      // edit → fixed mode version
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("2.1.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan).toEqual({
        mode: "fixed",
        version: "2.1.0",
        packages: new Map([
          ["packages/a::js", "2.1.0"],
          ["packages/b::js", "2.1.0"],
        ]),
      });
      expect(ctx.runtime.changesetConsumed).toBe(true);
    });
  });

  describe("unified prompt — skip and edit edge cases", () => {
    const pkgA = makePkg({
      name: "@scope/a",
      version: "1.0.0",
      path: "packages/a",
    });
    const pkgB = makePkg({
      name: "@scope/b",
      version: "2.0.0",
      path: "packages/b",
    });

    function makeTwoPkgCtx(versioning?: "fixed" | "independent") {
      return {
        config: { packages: [pkgA, pkgB], versioning },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      } as any;
    }

    beforeEach(() => {
      mockChangesetAnalyze.mockResolvedValue([
        {
          packagePath: "packages/a",
          bumpType: "minor",
          source: "changeset",
          entries: [{ summary: "Feature" }],
        },
      ]);
    });

    it("edit → independent: excludes packages with unchanged versions from versionPlan and config", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx("independent");
      const mockTask = createMockTask();

      // edit → pkgA: "1.1.0" (bump), pkgB: "2.0.0" (keep current)
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan?.packages.has("packages/a::js")).toBe(
        true,
      );
      expect(ctx.runtime.versionPlan?.packages.has("packages/b::js")).toBe(
        false,
      );

      const filterArg = mockedFilterConfigPackages.mock
        .calls[0][1] as Set<string>;
      expect(filterArg.has("packages/a::js")).toBe(true);
      expect(filterArg.has("packages/b::js")).toBe(false);
    });

    it("edit → fixed: does NOT call filterConfigPackages", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx("fixed");
      const mockTask = createMockTask();

      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0");

      await versionTask.task(ctx, mockTask);

      expect(mockedFilterConfigPackages).not.toHaveBeenCalled();
    });

    it("edit → independent: sets changesetConsumed when changeset source present", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx("independent");
      const mockTask = createMockTask();

      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0")
        .mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.changesetConsumed).toBe(true);
    });

    it("edit → independent: applies filter in edit mode", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];
      const ctx = makeTwoPkgCtx("independent");
      const mockTask = createMockTask();

      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0") // pkgA
        .mockResolvedValueOnce("2.0.0"); // pkgB keep current

      await versionTask.task(ctx, mockTask);

      expect(mockedFilterConfigPackages).toHaveBeenCalled();
      const filterArg = mockedFilterConfigPackages.mock
        .calls[0][1] as Set<string>;
      expect(filterArg.has("packages/b::js")).toBe(false);
    });

    it("edit → independent: cascade-accepted packages are included in versionPlan and filterConfigPackages", async () => {
      const pkgAWithNoDeps = makePkg({
        name: "@scope/a",
        version: "1.0.0",
        path: "packages/a",
        dependencies: [],
      });
      const pkgC = makePkg({
        name: "@scope/c",
        version: "2.0.0",
        path: "packages/c",
        dependencies: ["@scope/a"],
      });

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = {
        config: { packages: [pkgAWithNoDeps, pkgC], versioning: "independent" },
        runtime: {
          versionPlan: undefined,
          changesetConsumed: undefined,
          promptEnabled: true,
        },
        cwd: "/cwd",
        options: {},
      };
      const mockTask = createMockTask();

      // edit → pkgA: "1.1.0" (bump), pkgC: "2.0.0" (keep current → cascade prompt)
      // cascade prompt: user accepts with "patch" → pkgC gets 2.0.1
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("1.1.0") // pkgA version
        .mockResolvedValueOnce("2.0.0") // pkgC keep current → triggers cascade
        .mockResolvedValueOnce("patch"); // cascade accepted

      await versionTask.task(ctx, mockTask);

      expect(ctx.runtime.versionPlan?.packages.has("packages/a::js")).toBe(
        true,
      );
      expect(ctx.runtime.versionPlan?.packages.get("packages/a::js")).toBe(
        "1.1.0",
      );
      expect(ctx.runtime.versionPlan?.packages.has("packages/c::js")).toBe(
        true,
      );
      expect(ctx.runtime.versionPlan?.packages.get("packages/c::js")).toBe(
        "2.0.1",
      );

      const filterArg = mockedFilterConfigPackages.mock
        .calls[0][1] as Set<string>;
      expect(filterArg.has("packages/a::js")).toBe(true);
      expect(filterArg.has("packages/c::js")).toBe(true);
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
