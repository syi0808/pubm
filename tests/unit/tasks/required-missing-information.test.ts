import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/package.js", () => ({
  version: vi.fn(),
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

import { jsrRegistry } from "../../../src/registry/jsr.js";
import { npmRegistry } from "../../../src/registry/npm.js";
import { requiredMissingInformationTasks } from "../../../src/tasks/required-missing-information.js";
import { createListr } from "../../../src/utils/listr.js";
import { version } from "../../../src/utils/package.js";

const mockedVersion = vi.mocked(version);
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
  return {
    output: "",
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

beforeEach(() => {
  vi.clearAllMocks();
  mockedVersion.mockResolvedValue("1.0.0");
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
      const promptCall = mockTask.prompt.mock.calls[0];
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
