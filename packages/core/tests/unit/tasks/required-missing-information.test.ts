import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/package.js", () => ({
  version: vi.fn(),
  getPackageJson: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));
vi.mock("../../../src/changeset/packages.js", () => ({
  discoverCurrentVersions: vi.fn(),
  discoverPackageInfos: vi.fn(),
}));
vi.mock("../../../src/changeset/status.js", () => ({
  getStatus: vi.fn(),
}));
vi.mock("../../../src/changeset/version.js", () => ({
  calculateVersionBumps: vi.fn(),
}));
vi.mock("../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));
vi.mock("../../../src/registry/npm.js", () => ({
  npmRegistry: vi.fn(),
}));
vi.mock("../../../src/registry/jsr.js", () => ({
  jsrRegistry: vi.fn(),
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

import { readFile } from "node:fs/promises";
import {
  discoverCurrentVersions,
  discoverPackageInfos,
} from "../../../src/changeset/packages.js";
import { getStatus } from "../../../src/changeset/status.js";
import { loadConfig } from "../../../src/config/loader.js";
import { jsrRegistry } from "../../../src/registry/jsr.js";
import { npmRegistry } from "../../../src/registry/npm.js";
import { requiredMissingInformationTasks } from "../../../src/tasks/required-missing-information.js";
import { createListr } from "../../../src/utils/listr.js";
import { version } from "../../../src/utils/package.js";

const mockedVersion = vi.mocked(version);
const mockedReadFile = vi.mocked(readFile);
const mockedDiscoverCurrentVersions = vi.mocked(discoverCurrentVersions);
const mockedDiscoverPackageInfos = vi.mocked(discoverPackageInfos);
const mockedGetStatus = vi.mocked(getStatus);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedNpmRegistry = vi.mocked(npmRegistry);
const mockedJsrRegistry = vi.mocked(jsrRegistry);
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

function isPackageJsonWithin(filePath: unknown, ...dirSegments: string[]): boolean {
  const normalized = path.normalize(String(filePath));

  return (
    path.basename(normalized) === "package.json" &&
    path.dirname(normalized).endsWith(path.join(...dirSegments))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedVersion.mockResolvedValue("1.0.0");
  mockedReadFile.mockResolvedValue(Buffer.from("{}"));
  mockedDiscoverCurrentVersions.mockResolvedValue(
    new Map([["my-pkg", "1.0.0"]]),
  );
  // Single package by default
  mockedDiscoverPackageInfos.mockResolvedValue([
    { name: "my-pkg", version: "1.0.0", path: "." },
  ]);
  mockedGetStatus.mockReturnValue({
    hasChangesets: false,
    packages: new Map(),
    changesets: [],
  } as any);
  mockedLoadConfig.mockResolvedValue(undefined as any);
  mockedNpmRegistry.mockResolvedValue({
    distTags: vi.fn().mockResolvedValue(["latest", "next", "beta"]),
  } as any);
  mockedJsrRegistry.mockResolvedValue({
    distTags: vi.fn().mockResolvedValue([]),
  } as any);
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
    it("skips when ctx.version is already set", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      expect(versionTask.skip({ version: "2.0.0" })).toBe(true);
    });

    it("does not skip when ctx.version is empty", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      expect(versionTask.skip({ version: "" })).toBe(false);
    });

    it("does not skip when ctx.version is undefined", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      expect(versionTask.skip({ version: undefined })).toBe(false);
    });

    it("has exitOnError set to true", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();

      expect(subtasks[0].exitOnError).toBe(true);
    });

    it("fetches the current version and prompts for semver increment", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = { version: undefined };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("1.1.0");

      await versionTask.task(ctx, mockTask);

      expect(mockedVersion).toHaveBeenCalledOnce();
      expect(mockTask.prompt).toHaveBeenCalled();
      expect(ctx.version).toBe("1.1.0");
    });

    it('prompts for custom version when user selects "specify"', async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = { version: undefined };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("3.0.0-alpha.1");

      await versionTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalledTimes(2);
      expect(ctx.version).toBe("3.0.0-alpha.1");
    });

    it("sets ctx.version to the selected semver version", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = { version: undefined };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("2.0.0");

      await versionTask.task(ctx, mockTask);

      expect(ctx.version).toBe("2.0.0");
    });

    it("includes a keep current version option in the manual prompt", async () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = { version: undefined };
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
      expect(ctx.version).toBe("1.0.0");
    });

    it("keeps the package summary visible while selecting independent versions", async () => {
      mockedDiscoverPackageInfos.mockResolvedValue([
        { name: "@pubm/core", version: "0.3.6", path: "packages/core" },
        { name: "pubm", version: "0.3.6", path: "packages/pubm" },
      ]);
      mockedDiscoverCurrentVersions.mockResolvedValue(
        new Map([
          ["@pubm/core", "0.3.6"],
          ["pubm", "0.3.6"],
        ]),
      );
      mockedLoadConfig.mockResolvedValue({ versioning: "independent" } as any);
      mockedReadFile.mockImplementation(async (filePath) => {
        if (isPackageJsonWithin(filePath, "packages", "core")) {
          return Buffer.from(
            JSON.stringify({ name: "@pubm/core", dependencies: {} }),
          );
        }

        if (isPackageJsonWithin(filePath, "packages", "pubm")) {
          return Buffer.from(
            JSON.stringify({
              name: "pubm",
              dependencies: {
                "@pubm/core": "workspace:*",
              },
            }),
          );
        }

        return Buffer.from("{}");
      });

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const versionTask = subtasks[0];

      const ctx: any = { version: undefined };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("0.3.7")
        .mockResolvedValueOnce("0.3.6");

      await versionTask.task(ctx, mockTask);

      expect(ctx.versions).toEqual(
        new Map([
          ["@pubm/core", "0.3.7"],
          ["pubm", "0.3.6"],
        ]),
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
            output.includes("💡 dependency @pubm/core bumped"),
        ),
      ).toBe(true);
      expect(mockTask.output).toContain("@pubm/core");
      expect(mockTask.output).toContain("pubm");
      expect(mockTask.output).toContain("0.3.7");
    });
  });

  describe("tag subtask", () => {
    it('skips when version is not a prerelease and tag is default ("latest")', () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      // not prerelease + tag is 'latest' (default) => skip
      expect(tagTask.skip({ version: "1.0.0", tag: "latest" })).toBe(true);
    });

    it("does not skip when version is a prerelease", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      // prerelease version => do not skip
      expect(tagTask.skip({ version: "1.0.0-beta.1", tag: "latest" })).toBe(
        false,
      );
    });

    it("does not skip when tag is not the default", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      // tag is not 'latest' => do not skip
      expect(tagTask.skip({ version: "1.0.0", tag: "next" })).toBe(false);
    });

    it("has exitOnError set to true", () => {
      requiredMissingInformationTasks();
      const subtasks = getSubtasks();

      expect(subtasks[1].exitOnError).toBe(true);
    });

    it("fetches dist-tags from both npm and jsr registries", async () => {
      const mockNpmDistTags = vi.fn().mockResolvedValue(["latest", "beta"]);
      const mockJsrDistTags = vi.fn().mockResolvedValue(["latest", "rc"]);
      mockedNpmRegistry.mockResolvedValue({ distTags: mockNpmDistTags } as any);
      mockedJsrRegistry.mockResolvedValue({ distTags: mockJsrDistTags } as any);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = { version: "2.0.0-beta.1", tag: "latest" };
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
      mockedNpmRegistry.mockResolvedValue({ distTags: mockNpmDistTags } as any);
      mockedJsrRegistry.mockResolvedValue({ distTags: mockJsrDistTags } as any);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = { version: "2.0.0-beta.1", tag: "latest" };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("beta");

      await tagTask.task(ctx, mockTask);

      // Verify prompt was called; choices should be deduplicated with 'latest' filtered
      expect(mockTask.prompt).toHaveBeenCalled();
      expect(ctx.tag).toBe("beta");
    });

    it('filters out "latest" from dist-tags choices', async () => {
      const mockNpmDistTags = vi.fn().mockResolvedValue(["latest", "beta"]);
      const mockJsrDistTags = vi.fn().mockResolvedValue([]);
      mockedNpmRegistry.mockResolvedValue({ distTags: mockNpmDistTags } as any);
      mockedJsrRegistry.mockResolvedValue({ distTags: mockJsrDistTags } as any);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = { version: "2.0.0-beta.1", tag: "latest" };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("beta");

      await tagTask.task(ctx, mockTask);

      // The prompt call should have choices without 'latest'
      expect(ctx.tag).toBe("beta");
    });

    it('defaults to ["next"] when no dist-tags remain after filtering', async () => {
      const mockNpmDistTags = vi.fn().mockResolvedValue(["latest"]);
      const mockJsrDistTags = vi.fn().mockResolvedValue([]);
      mockedNpmRegistry.mockResolvedValue({ distTags: mockNpmDistTags } as any);
      mockedJsrRegistry.mockResolvedValue({ distTags: mockJsrDistTags } as any);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = { version: "2.0.0-beta.1", tag: "latest" };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("next");

      await tagTask.task(ctx, mockTask);

      expect(ctx.tag).toBe("next");
    });

    it('prompts for custom tag when user selects "specify"', async () => {
      const mockNpmDistTags = vi.fn().mockResolvedValue(["latest", "beta"]);
      const mockJsrDistTags = vi.fn().mockResolvedValue([]);
      mockedNpmRegistry.mockResolvedValue({ distTags: mockNpmDistTags } as any);
      mockedJsrRegistry.mockResolvedValue({ distTags: mockJsrDistTags } as any);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = { version: "2.0.0-beta.1", tag: "latest" };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("canary");

      await tagTask.task(ctx, mockTask);

      expect(mockTask.prompt).toHaveBeenCalledTimes(2);
      expect(ctx.tag).toBe("canary");
    });

    it("sets ctx.tag to the selected tag", async () => {
      const mockNpmDistTags = vi
        .fn()
        .mockResolvedValue(["latest", "next", "beta"]);
      const mockJsrDistTags = vi.fn().mockResolvedValue([]);
      mockedNpmRegistry.mockResolvedValue({ distTags: mockNpmDistTags } as any);
      mockedJsrRegistry.mockResolvedValue({ distTags: mockJsrDistTags } as any);

      requiredMissingInformationTasks();
      const subtasks = getSubtasks();
      const tagTask = subtasks[1];

      const ctx: any = { version: "2.0.0-beta.1", tag: "latest" };
      const mockTask = createMockTask();
      mockTask._promptAdapter.run.mockResolvedValueOnce("beta");

      await tagTask.task(ctx, mockTask);

      expect(ctx.tag).toBe("beta");
    });
  });
});
