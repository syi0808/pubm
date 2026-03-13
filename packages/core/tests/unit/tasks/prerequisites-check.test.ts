import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("std-env", () => ({ isCI: false }));

vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(),
}));

vi.mock("../../../src/utils/listr.js", () => ({
  createListr: vi.fn((taskDef: any) => {
    return { _taskDef: taskDef, run: vi.fn() };
  }),
  createCiListrOptions: vi.fn(),
}));

import type { PubmContext } from "../../../src/context.js";
import { makeTestContext } from "../../helpers/make-context.js";

function createCtx(
  overrides: {
    config?: Partial<PubmContext["config"]>;
    options?: Partial<PubmContext["options"]>;
    runtime?: Partial<PubmContext["runtime"]>;
  } = {},
): PubmContext {
  return makeTestContext({
    config: overrides.config,
    options: {
      anyBranch: false,
      ...overrides.options,
    },
    runtime: {
      version: "1.0.0",
      promptEnabled: true,
      cleanWorkingTree: true,
      ...overrides.runtime,
    },
  });
}

function createMockTask(promptResponses: any[] = []) {
  let promptIndex = 0;
  return {
    output: "",
    title: "",
    prompt: vi.fn(() => ({
      run: vi.fn(async () => promptResponses[promptIndex++]),
    })),
  };
}

let mockGitInstance: Record<string, ReturnType<typeof vi.fn>>;
let capturedSubtasks: any[];

async function getSubtasks() {
  const { prerequisitesCheckTask } = await import(
    "../../../src/tasks/prerequisites-check.js"
  );
  const listrResult = prerequisitesCheckTask();
  const taskDef = (listrResult as any)._taskDef;

  const mockParentTask = {
    newListr: vi.fn((subtasks: any[]) => {
      capturedSubtasks = subtasks;
      return subtasks;
    }),
  };

  taskDef.task({}, mockParentTask);

  return capturedSubtasks;
}

beforeEach(async () => {
  vi.clearAllMocks();

  // Reset the module registry so we get fresh imports
  vi.resetModules();

  // Re-apply mocks after resetModules
  vi.doMock("../../../src/git.js", () => ({
    Git: vi.fn(),
  }));

  vi.doMock("../../../src/utils/listr.js", () => ({
    createListr: vi.fn((taskDef: any) => {
      return { _taskDef: taskDef, run: vi.fn() };
    }),
    createCiListrOptions: vi.fn(),
  }));

  mockGitInstance = {
    branch: vi.fn().mockResolvedValue("main"),
    switch: vi.fn().mockResolvedValue(true),
    dryFetch: vi.fn().mockResolvedValue(""),
    fetch: vi.fn().mockResolvedValue(true),
    revisionDiffsCount: vi.fn().mockResolvedValue(0),
    pull: vi.fn().mockResolvedValue(true),
    status: vi.fn().mockResolvedValue(""),
    latestTag: vi.fn().mockResolvedValue("v0.9.0"),
    commits: vi
      .fn()
      .mockResolvedValue([{ id: "abc123", message: "feat: something" }]),
    checkTagExist: vi.fn().mockResolvedValue(false),
    deleteTag: vi.fn().mockResolvedValue(true),
  };

  const { Git: MockedGit } = await import("../../../src/git.js");
  vi.mocked(MockedGit).mockImplementation(function () {
    return mockGitInstance as any;
  });
});

describe("prerequisitesCheckTask", () => {
  describe("createListr call", () => {
    it("creates a listr with the correct title", async () => {
      const { createListr } = await import("../../../src/utils/listr.js");
      const { prerequisitesCheckTask } = await import(
        "../../../src/tasks/prerequisites-check.js"
      );

      prerequisitesCheckTask();

      expect(createListr).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Prerequisites check (for deployment reliability)",
          exitOnError: true,
        }),
      );
    });

    it("spreads additional options into the task definition", async () => {
      const { createListr } = await import("../../../src/utils/listr.js");
      const { prerequisitesCheckTask } = await import(
        "../../../src/tasks/prerequisites-check.js"
      );

      prerequisitesCheckTask({ skip: true });

      expect(createListr).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: true,
        }),
      );
    });

    it("produces 5 subtasks", async () => {
      const subtasks = await getSubtasks();

      expect(subtasks).toHaveLength(5);
    });
  });

  describe("Subtask 1: Branch verification", () => {
    it("skips when ctx.anyBranch is true", async () => {
      const subtasks = await getSubtasks();
      const branchTask = subtasks[0];
      const ctx = createCtx({ options: { anyBranch: true } });

      expect(branchTask.skip(ctx)).toBe(true);
    });

    it("does not skip when ctx.anyBranch is false", async () => {
      const subtasks = await getSubtasks();
      const branchTask = subtasks[0];
      const ctx = createCtx({ options: { anyBranch: false } });

      expect(branchTask.skip(ctx)).toBe(false);
    });

    it("passes silently when on the correct branch", async () => {
      const subtasks = await getSubtasks();
      const branchTask = subtasks[0];
      const ctx = createCtx({ options: { branch: "main" } });
      const task = createMockTask();

      mockGitInstance.branch.mockResolvedValue("main");

      await branchTask.task(ctx, task);

      expect(task.prompt).not.toHaveBeenCalled();
      expect(mockGitInstance.switch).not.toHaveBeenCalled();
    });

    it("prompts and switches branch when user confirms", async () => {
      const subtasks = await getSubtasks();
      const branchTask = subtasks[0];
      const ctx = createCtx({ options: { branch: "main" } });
      const task = createMockTask([true]);

      mockGitInstance.branch.mockResolvedValue("develop");

      await branchTask.task(ctx, task);

      expect(task.prompt).toHaveBeenCalledOnce();
      expect(task.output).toBe("Switching branch to main...");
      expect(mockGitInstance.switch).toHaveBeenCalledWith("main");
    });

    it("throws PrerequisitesCheckError when user declines branch switch", async () => {
      const subtasks = await getSubtasks();
      const branchTask = subtasks[0];
      const ctx = createCtx({ options: { branch: "main" } });
      const task = createMockTask([false]);

      mockGitInstance.branch.mockResolvedValue("develop");

      await expect(branchTask.task(ctx, task)).rejects.toThrow(
        "The current HEAD branch is not the release target branch",
      );
    });
  });

  describe("Subtask 2: Remote history check", () => {
    it("passes silently when fetch is clean and no revision diffs", async () => {
      const subtasks = await getSubtasks();
      const remoteTask = subtasks[1];
      const ctx = createCtx();
      const task = createMockTask();

      mockGitInstance.dryFetch.mockResolvedValue("");
      mockGitInstance.revisionDiffsCount.mockResolvedValue(0);

      await remoteTask.task(ctx, task);

      expect(task.prompt).not.toHaveBeenCalled();
    });

    it("passes when fetch is clean with whitespace-only output", async () => {
      const subtasks = await getSubtasks();
      const remoteTask = subtasks[1];
      const ctx = createCtx();
      const task = createMockTask();

      mockGitInstance.dryFetch.mockResolvedValue("   \n  ");
      mockGitInstance.revisionDiffsCount.mockResolvedValue(0);

      await remoteTask.task(ctx, task);

      expect(task.prompt).not.toHaveBeenCalled();
    });

    it("prompts fetch when dry fetch returns content, fetches on confirm", async () => {
      const subtasks = await getSubtasks();
      const remoteTask = subtasks[1];
      const ctx = createCtx();
      const task = createMockTask([true]);

      mockGitInstance.dryFetch.mockResolvedValue("some updates");
      mockGitInstance.revisionDiffsCount.mockResolvedValue(0);

      await remoteTask.task(ctx, task);

      expect(task.prompt).toHaveBeenCalledOnce();
      expect(mockGitInstance.fetch).toHaveBeenCalledOnce();
    });

    it("throws when user declines fetch", async () => {
      const subtasks = await getSubtasks();
      const remoteTask = subtasks[1];
      const ctx = createCtx();
      const task = createMockTask([false]);

      mockGitInstance.dryFetch.mockResolvedValue("some updates");

      await expect(remoteTask.task(ctx, task)).rejects.toThrow(
        "Local history is outdated. Please run `git fetch` to update.",
      );
    });

    it("prompts pull when revision diffs > 0, pulls on confirm", async () => {
      const subtasks = await getSubtasks();
      const remoteTask = subtasks[1];
      const ctx = createCtx();
      const task = createMockTask([true]);

      mockGitInstance.dryFetch.mockResolvedValue("");
      mockGitInstance.revisionDiffsCount.mockResolvedValue(3);

      await remoteTask.task(ctx, task);

      expect(task.prompt).toHaveBeenCalledOnce();
      expect(mockGitInstance.pull).toHaveBeenCalledOnce();
    });

    it("throws when user declines pull", async () => {
      const subtasks = await getSubtasks();
      const remoteTask = subtasks[1];
      const ctx = createCtx();
      const task = createMockTask([false]);

      mockGitInstance.dryFetch.mockResolvedValue("");
      mockGitInstance.revisionDiffsCount.mockResolvedValue(3);

      await expect(remoteTask.task(ctx, task)).rejects.toThrow(
        "Local history is outdated. Please run `git pull` to synchronize",
      );
    });

    it("prompts both fetch and pull when both outdated, succeeds when both confirmed", async () => {
      const subtasks = await getSubtasks();
      const remoteTask = subtasks[1];
      const ctx = createCtx();
      const task = createMockTask([true, true]);

      mockGitInstance.dryFetch.mockResolvedValue("updates available");
      mockGitInstance.revisionDiffsCount.mockResolvedValue(5);

      await remoteTask.task(ctx, task);

      expect(task.prompt).toHaveBeenCalledTimes(2);
      expect(mockGitInstance.fetch).toHaveBeenCalledOnce();
      expect(mockGitInstance.pull).toHaveBeenCalledOnce();
    });
  });

  describe("Subtask 3: Working tree check", () => {
    it("sets ctx.cleanWorkingTree to true when working tree is clean", async () => {
      const subtasks = await getSubtasks();
      const workingTreeTask = subtasks[2];
      const ctx = createCtx();
      const task = createMockTask();

      mockGitInstance.status.mockResolvedValue("");

      await workingTreeTask.task(ctx, task);

      expect(ctx.runtime.cleanWorkingTree).toBe(true);
      expect(task.prompt).not.toHaveBeenCalled();
    });

    it("sets ctx.cleanWorkingTree to false when dirty and user skips", async () => {
      const subtasks = await getSubtasks();
      const workingTreeTask = subtasks[2];
      const ctx = createCtx();
      const task = createMockTask([true]);

      mockGitInstance.status.mockResolvedValue("M src/index.ts");

      await workingTreeTask.task(ctx, task);

      expect(ctx.runtime.cleanWorkingTree).toBe(false);
      expect(task.prompt).toHaveBeenCalledOnce();
    });

    it("throws when dirty and user declines to skip", async () => {
      const subtasks = await getSubtasks();
      const workingTreeTask = subtasks[2];
      const ctx = createCtx();
      const task = createMockTask([false]);

      mockGitInstance.status.mockResolvedValue("M src/index.ts");

      await expect(workingTreeTask.task(ctx, task)).rejects.toThrow(
        "Local working tree is not clean",
      );
    });

    it("sets task output when working tree is dirty", async () => {
      const subtasks = await getSubtasks();
      const workingTreeTask = subtasks[2];
      const ctx = createCtx();
      const task = createMockTask([true]);

      mockGitInstance.status.mockResolvedValue("M package.json");

      await workingTreeTask.task(ctx, task);

      expect(task.output).toBe("Local working tree is not clean.");
    });
  });

  describe("Subtask 4: Commits since last release", () => {
    it("appends title when no tags exist and returns early", async () => {
      const subtasks = await getSubtasks();
      const commitsTask = subtasks[3];
      const ctx = createCtx();
      const task = createMockTask();
      task.title = "Checking if commits exist since the last release";

      mockGitInstance.latestTag.mockResolvedValue(null);

      await commitsTask.task(ctx, task);

      expect(task.title).toContain("Tag has not been pushed to GitHub");
      expect(mockGitInstance.commits).not.toHaveBeenCalled();
      expect(task.prompt).not.toHaveBeenCalled();
    });

    it("passes when there are commits since the latest tag", async () => {
      const subtasks = await getSubtasks();
      const commitsTask = subtasks[3];
      const ctx = createCtx();
      const task = createMockTask();

      mockGitInstance.latestTag.mockResolvedValue("v0.9.0");
      mockGitInstance.commits.mockResolvedValue([
        { id: "abc123", message: "feat: new feature" },
      ]);

      await commitsTask.task(ctx, task);

      expect(mockGitInstance.commits).toHaveBeenCalledWith("v0.9.0", "HEAD");
      expect(task.prompt).not.toHaveBeenCalled();
    });

    it("prompts when no commits exist, passes when user skips", async () => {
      const subtasks = await getSubtasks();
      const commitsTask = subtasks[3];
      const ctx = createCtx();
      const task = createMockTask([true]);

      mockGitInstance.latestTag.mockResolvedValue("v1.0.0");
      mockGitInstance.commits.mockResolvedValue([]);

      await commitsTask.task(ctx, task);

      expect(task.prompt).toHaveBeenCalledOnce();
    });

    it("throws when no commits and user declines to skip", async () => {
      const subtasks = await getSubtasks();
      const commitsTask = subtasks[3];
      const ctx = createCtx();
      const task = createMockTask([false]);

      mockGitInstance.latestTag.mockResolvedValue("v1.0.0");
      mockGitInstance.commits.mockResolvedValue([]);

      await expect(commitsTask.task(ctx, task)).rejects.toThrow(
        "No commits exist from the latest tag",
      );
    });
  });

  describe("Subtask 5: Tag existence check", () => {
    it("passes silently when tag does not exist", async () => {
      const subtasks = await getSubtasks();
      const tagTask = subtasks[4];
      const ctx = createCtx({ runtime: { version: "1.0.0" } });
      const task = createMockTask();

      mockGitInstance.checkTagExist.mockResolvedValue(false);

      await tagTask.task(ctx, task);

      expect(mockGitInstance.checkTagExist).toHaveBeenCalledWith("v1.0.0");
      expect(task.prompt).not.toHaveBeenCalled();
      expect(mockGitInstance.deleteTag).not.toHaveBeenCalled();
    });

    it("prompts and deletes tag when user confirms", async () => {
      const subtasks = await getSubtasks();
      const tagTask = subtasks[4];
      const ctx = createCtx({ runtime: { version: "2.0.0" } });
      const task = createMockTask([true]);

      mockGitInstance.checkTagExist.mockResolvedValue(true);

      await tagTask.task(ctx, task);

      expect(task.prompt).toHaveBeenCalledOnce();
      expect(task.output).toBe("Deleting git tag v2.0.0...");
      expect(mockGitInstance.deleteTag).toHaveBeenCalledWith("v2.0.0");
    });

    it("throws when tag exists and user declines delete", async () => {
      const subtasks = await getSubtasks();
      const tagTask = subtasks[4];
      const ctx = createCtx({ runtime: { version: "2.0.0" } });
      const task = createMockTask([false]);

      mockGitInstance.checkTagExist.mockResolvedValue(true);

      await expect(tagTask.task(ctx, task)).rejects.toThrow(
        "The Git tag 'v2.0.0' already exists",
      );
    });

    it("constructs the correct tag format from ctx.version", async () => {
      const subtasks = await getSubtasks();
      const tagTask = subtasks[4];
      const ctx = createCtx({ runtime: { version: "3.1.4-beta.1" } });
      const task = createMockTask();

      mockGitInstance.checkTagExist.mockResolvedValue(false);

      await tagTask.task(ctx, task);

      expect(mockGitInstance.checkTagExist).toHaveBeenCalledWith(
        "v3.1.4-beta.1",
      );
    });
  });
});
