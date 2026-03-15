import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/npm.js", () => ({
  npmPackageRegistry: vi.fn(),
}));

import type { PubmContext } from "../../../src/context.js";
import { npmPackageRegistry } from "../../../src/registry/npm.js";
import { createNpmPublishTask } from "../../../src/tasks/npm.js";

const mockedNpmRegistry = vi.mocked(npmPackageRegistry);

function createMockNpm() {
  return {
    packageName: "my-package",
    isLoggedIn: vi.fn().mockResolvedValue(true),
    isPublished: vi.fn().mockResolvedValue(false),
    hasPermission: vi.fn().mockResolvedValue(true),
    isPackageNameAvailable: vi.fn().mockResolvedValue(true),
    twoFactorAuthMode: vi.fn().mockResolvedValue(null),
    isVersionPublished: vi.fn().mockResolvedValue(false),
    publish: vi.fn().mockResolvedValue(true),
    publishProvenance: vi.fn().mockResolvedValue(true),
  };
}

function createMockTask() {
  return {
    output: "",
    title: "",
    skip: vi.fn(),
    prompt: vi.fn(() => ({
      run: vi.fn(),
    })),
  };
}

function createCtx(
  overrides: {
    options?: Partial<PubmContext["options"]>;
    runtime?: Partial<PubmContext["runtime"]>;
  } = {},
): PubmContext {
  return {
    config: { packages: [{ path: ".", registries: ["npm"] }] },
    options: {
      testScript: "test",
      buildScript: "build",
      branch: "main",
      tag: "latest",
      saveToken: true,
      ...overrides.options,
    },
    cwd: process.cwd(),
    runtime: {
      version: "1.0.0",
      tag: "latest",
      promptEnabled: true,
      cleanWorkingTree: true,
      pluginRunner: {} as any,
      ...overrides.runtime,
    },
  } as PubmContext;
}

let mockNpm: ReturnType<typeof createMockNpm>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockNpm = createMockNpm();
  mockedNpmRegistry.mockResolvedValue(mockNpm as any);
});

describe("createNpmPublishTask", () => {
  it("returns a task with packagePath as initial title", () => {
    const task = createNpmPublishTask("packages/core");
    expect(task.title).toBe("packages/core");
  });

  it("calls npmPackageRegistry with the provided packagePath", async () => {
    const task = createNpmPublishTask("packages/core");
    const ctx = createCtx({ runtime: { promptEnabled: true } });
    const mockTask = createMockTask();

    await (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
      ctx,
      mockTask,
    );

    expect(mockedNpmRegistry).toHaveBeenCalledWith("packages/core");
  });

  describe("skip", () => {
    it("returns true when preview is true", () => {
      const task = createNpmPublishTask("packages/core");
      const ctx = createCtx({ options: { preview: true } });
      const result = (task.skip as (ctx: PubmContext) => boolean)(ctx);

      expect(result).toBe(true);
    });
  });

  describe("task — TTY mode (promptEnabled=true)", () => {
    it("publishes successfully without OTP", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const mockTask = createMockTask();
      mockNpm.publish.mockResolvedValue(true);

      const task = createNpmPublishTask("packages/core");
      await (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
        ctx,
        mockTask,
      );

      expect(mockTask.output).toBe("Publishing on npm...");
      expect(mockNpm.publish).toHaveBeenCalledOnce();
      expect(mockTask.prompt).not.toHaveBeenCalled();
    });

    it("uses cached OTP from ctx.runtime.npmOtp", async () => {
      const ctx = createCtx({
        runtime: { promptEnabled: true, npmOtp: "111111" },
      });
      const mockTask = createMockTask();
      mockNpm.publish.mockResolvedValue(true);

      const task = createNpmPublishTask("packages/core");
      await (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
        ctx,
        mockTask,
      );

      expect(mockNpm.publish).toHaveBeenCalledWith("111111");
    });

    it("prompts for OTP when publish returns false, retries until success", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const mockTask = createMockTask();

      mockNpm.publish
        .mockResolvedValueOnce(false) // initial attempt (no OTP)
        .mockResolvedValueOnce(false) // first OTP attempt
        .mockResolvedValueOnce(true); // second OTP attempt

      const mockRun = vi.fn().mockResolvedValue("123456");
      mockTask.prompt.mockReturnValue({ run: mockRun });

      const task = createNpmPublishTask("packages/core");
      await (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
        ctx,
        mockTask,
      );

      expect(mockTask.title).toBe("my-package (2FA passed)");
      expect(mockNpm.publish).toHaveBeenCalledTimes(3);
      expect(mockRun).toHaveBeenCalledTimes(2);
      expect(ctx.runtime.npmOtp).toBe("123456");
    });

    it("sets task title to OTP needed on first failure", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const mockTask = createMockTask();

      mockNpm.publish.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const mockRun = vi.fn().mockResolvedValue("654321");
      mockTask.prompt.mockReturnValue({ run: mockRun });

      const task = createNpmPublishTask("packages/core");
      await (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
        ctx,
        mockTask,
      );

      expect(mockTask.title).toBe("my-package (2FA passed)");
      expect(mockNpm.publish).toHaveBeenCalledTimes(2);
    });

    it('sets task output to "2FA failed" on OTP retry failure', async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const mockTask = createMockTask();

      mockNpm.publish
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const mockRun = vi.fn().mockResolvedValue("000000");
      mockTask.prompt.mockReturnValue({ run: mockRun });

      const task = createNpmPublishTask("packages/core");
      await (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
        ctx,
        mockTask,
      );

      expect(mockNpm.publish).toHaveBeenCalledTimes(3);
    });

    it("throws after 3 failed OTP attempts", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const mockTask = createMockTask();

      // Initial publish fails, then all 3 OTP attempts fail
      mockNpm.publish
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);

      const mockRun = vi.fn().mockResolvedValue("000000");
      mockTask.prompt.mockReturnValue({ run: mockRun });

      const task = createNpmPublishTask("packages/core");
      await expect(
        (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
          ctx,
          mockTask,
        ),
      ).rejects.toThrow("OTP verification failed after 3 attempts.");

      // Initial publish + 3 OTP attempts = 4 calls
      expect(mockNpm.publish).toHaveBeenCalledTimes(4);
      expect(mockRun).toHaveBeenCalledTimes(3);
    });
  });

  describe("task — CI mode (promptEnabled=false)", () => {
    it("throws when NODE_AUTH_TOKEN is not set", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const mockTask = createMockTask();
      const originalEnv = process.env.NODE_AUTH_TOKEN;
      delete process.env.NODE_AUTH_TOKEN;

      try {
        const task = createNpmPublishTask("packages/core");
        await expect(
          (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
            ctx,
            mockTask,
          ),
        ).rejects.toThrow(
          "NODE_AUTH_TOKEN not found in environment variables. Set it in your CI configuration:",
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env.NODE_AUTH_TOKEN = originalEnv;
        }
      }
    });

    it("calls publishProvenance when NODE_AUTH_TOKEN is set", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const mockTask = createMockTask();
      const originalEnv = process.env.NODE_AUTH_TOKEN;
      process.env.NODE_AUTH_TOKEN = "npm_test_token";

      try {
        const task = createNpmPublishTask("packages/core");
        await (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
          ctx,
          mockTask,
        );

        expect(mockNpm.publishProvenance).toHaveBeenCalledOnce();
        expect(mockNpm.publish).not.toHaveBeenCalled();
      } finally {
        if (originalEnv !== undefined) {
          process.env.NODE_AUTH_TOKEN = originalEnv;
        } else {
          delete process.env.NODE_AUTH_TOKEN;
        }
      }
    });

    it("throws when publishProvenance returns false (2FA required)", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const mockTask = createMockTask();
      const originalEnv = process.env.NODE_AUTH_TOKEN;
      process.env.NODE_AUTH_TOKEN = "npm_test_token";

      mockNpm.publishProvenance.mockResolvedValue(false);

      try {
        const task = createNpmPublishTask("packages/core");
        await expect(
          (task.task as (ctx: PubmContext, task: any) => Promise<void>)(
            ctx,
            mockTask,
          ),
        ).rejects.toThrow(
          "In CI environment, publishing with 2FA is not allowed",
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env.NODE_AUTH_TOKEN = originalEnv;
        } else {
          delete process.env.NODE_AUTH_TOKEN;
        }
      }
    });
  });
});
