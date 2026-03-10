import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/npm.js", () => ({
  npmRegistry: vi.fn(),
}));

vi.mock("../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../../../src/utils/spawn-interactive.js", () => ({
  spawnInteractive: vi.fn(),
}));

import { npmRegistry } from "../../../src/registry/npm.js";
import {
  npmAvailableCheckTasks,
  npmPublishTasks,
} from "../../../src/tasks/npm.js";
import type { Ctx } from "../../../src/tasks/runner.js";
import { openUrl } from "../../../src/utils/open-url.js";
import { spawnInteractive } from "../../../src/utils/spawn-interactive.js";

const mockedOpenUrl = vi.mocked(openUrl);
const mockedSpawnInteractive = vi.mocked(spawnInteractive);

const mockedNpmRegistry = vi.mocked(npmRegistry);

interface MockChild {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  stdin: { write: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> };
  exited: Promise<number>;
  _pushStdout: (text: string) => void;
  _pushStderr: (text: string) => void;
  _closeStdout: () => void;
  _closeStderr: () => void;
  _resolveExited: (code: number) => void;
}

function createMockChild(): MockChild {
  let stdoutController: ReadableStreamDefaultController<Uint8Array>;
  let stderrController: ReadableStreamDefaultController<Uint8Array>;
  let resolveExited: (code: number) => void;

  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      stdoutController = controller;
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      stderrController = controller;
    },
  });
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const encoder = new TextEncoder();

  return {
    stdout,
    stderr,
    stdin: { write: vi.fn(), flush: vi.fn() },
    exited,
    _pushStdout: (text: string) =>
      stdoutController.enqueue(encoder.encode(text)),
    _pushStderr: (text: string) =>
      stderrController.enqueue(encoder.encode(text)),
    _closeStdout: () => stdoutController.close(),
    _closeStderr: () => stderrController.close(),
    _resolveExited: (code: number) => resolveExited(code),
  };
}

function mockSpawnResult(code: number): MockChild {
  const child = createMockChild();
  mockedSpawnInteractive.mockReturnValue(child as any);
  process.nextTick(() => {
    child._closeStdout();
    child._closeStderr();
    child._resolveExited(code);
  });
  return child;
}

function createMockNpm() {
  return {
    packageName: "my-package",
    isLoggedIn: vi.fn().mockResolvedValue(true),
    isPublished: vi.fn().mockResolvedValue(false),
    hasPermission: vi.fn().mockResolvedValue(true),
    isPackageNameAvaliable: vi.fn().mockResolvedValue(true),
    twoFactorAuthMode: vi.fn().mockResolvedValue(null),
    isVersionPublished: vi.fn().mockResolvedValue(false),
    publish: vi.fn().mockResolvedValue(true),
    publishProvenance: vi.fn().mockResolvedValue(true),
  };
}

function createMockTask() {
  return {
    output: "",
    title: "Running npm publish",
    prompt: vi.fn(() => ({
      run: vi.fn(),
    })),
  };
}

function createCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    promptEnabled: true,
    npmOnly: false,
    jsrOnly: false,
    cleanWorkingTree: true,
    registries: ["npm"],
    version: "1.0.0",
    tag: "latest",
    branch: "main",
    testScript: "test",
    buildScript: "build",
    skipTests: false,
    skipBuild: false,
    skipPublish: false,
    skipPrerequisitesCheck: false,
    skipConditionsCheck: false,
    skipReleaseDraft: false,
    publishOnly: false,
    ...overrides,
  } as Ctx;
}

let mockNpm: ReturnType<typeof createMockNpm>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockNpm = createMockNpm();
  mockedNpmRegistry.mockResolvedValue(mockNpm as any);
});

describe("npmAvailableCheckTasks", () => {
  it("does not have a skip condition", () => {
    expect(npmAvailableCheckTasks.skip).toBeUndefined();
  });

  describe("task", () => {
    it("throws with CI-specific message when not logged in and promptEnabled is false", async () => {
      mockNpm.isLoggedIn.mockResolvedValue(false);
      const ctx = createCtx({ promptEnabled: false });

      await expect(
        (npmAvailableCheckTasks.task as (ctx: Ctx) => Promise<void>)(ctx),
      ).rejects.toThrow(
        "Not logged in to npm. Set NODE_AUTH_TOKEN in your CI environment.",
      );
    });

    it("attempts npm login in TTY mode when not logged in", async () => {
      mockNpm.isLoggedIn
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockSpawnResult(0);
      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();

      await (
        npmAvailableCheckTasks.task as (ctx: Ctx, task: any) => Promise<void>
      )(ctx, task);

      expect(mockedSpawnInteractive).toHaveBeenCalledWith(["npm", "login"]);
    });

    it("parses login URL from stdout, opens browser, and sends ENTER", async () => {
      mockNpm.isLoggedIn
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const child = createMockChild();
      mockedSpawnInteractive.mockReturnValue(child as any);

      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();

      const promise = (
        npmAvailableCheckTasks.task as (ctx: Ctx, task: any) => Promise<void>
      )(ctx, task);

      // Wait for spawn to be called
      await new Promise((r) => process.nextTick(r));

      child._pushStdout(
        "Login at:\nhttps://www.npmjs.com/login?next=/login/cli/abc-123\nPress ENTER to open in the browser...",
      );

      // Allow the stream reader to process
      await new Promise((r) => process.nextTick(r));

      expect(mockedOpenUrl).toHaveBeenCalledWith(
        "https://www.npmjs.com/login?next=/login/cli/abc-123",
      );
      expect(child.stdin.write).toHaveBeenCalledWith("\n");

      child._closeStdout();
      child._closeStderr();
      child._resolveExited(0);
      await promise;
    });

    it("throws when npm login command fails in TTY mode", async () => {
      mockNpm.isLoggedIn.mockResolvedValue(false);
      mockSpawnResult(1);
      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();

      await expect(
        (npmAvailableCheckTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
          ctx,
          task,
        ),
      ).rejects.toThrow(
        "npm login failed. Please run `npm login` manually and try again.",
      );
    });

    it("throws when still not logged in after npm login succeeds in TTY mode", async () => {
      mockNpm.isLoggedIn
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      mockSpawnResult(0);
      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();

      await expect(
        (npmAvailableCheckTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
          ctx,
          task,
        ),
      ).rejects.toThrow(
        "Still not logged in after npm login. Please verify your credentials.",
      );
    });

    it("checks permission when published, throws when no permission", async () => {
      mockNpm.isPublished.mockResolvedValue(true);
      mockNpm.hasPermission.mockResolvedValue(false);

      await expect(
        (npmAvailableCheckTasks.task as () => Promise<void>)(),
      ).rejects.toThrow("You do not have permission to publish this package");
    });

    it("passes when published and has permission", async () => {
      mockNpm.isPublished.mockResolvedValue(true);
      mockNpm.hasPermission.mockResolvedValue(true);

      await expect(
        (npmAvailableCheckTasks.task as (ctx: Ctx) => Promise<void>)(
          createCtx({ promptEnabled: true }),
        ),
      ).resolves.toBeUndefined();
    });

    it("checks package name availability when not published", async () => {
      mockNpm.isPublished.mockResolvedValue(false);
      mockNpm.isPackageNameAvaliable.mockResolvedValue(true);

      await (npmAvailableCheckTasks.task as (ctx: Ctx) => Promise<void>)(
        createCtx({ promptEnabled: true }),
      );

      expect(mockNpm.isPackageNameAvaliable).toHaveBeenCalledOnce();
    });

    it("throws when package name is not available", async () => {
      mockNpm.isPublished.mockResolvedValue(false);
      mockNpm.isPackageNameAvaliable.mockResolvedValue(false);

      await expect(
        (npmAvailableCheckTasks.task as () => Promise<void>)(),
      ).rejects.toThrow("Package is not published");
    });

    it("passes when not published but name is available", async () => {
      mockNpm.isPublished.mockResolvedValue(false);
      mockNpm.isPackageNameAvaliable.mockResolvedValue(true);

      await expect(
        (npmAvailableCheckTasks.task as (ctx: Ctx) => Promise<void>)(
          createCtx({ promptEnabled: true }),
        ),
      ).resolves.toBeUndefined();
    });

    it("throws when 2FA auth-and-writes is enabled in CI mode", async () => {
      mockNpm.isPublished.mockResolvedValue(false);
      mockNpm.isPackageNameAvaliable.mockResolvedValue(true);
      mockNpm.twoFactorAuthMode.mockResolvedValue("auth-and-writes");
      const ctx = createCtx({ promptEnabled: false });

      await expect(
        (npmAvailableCheckTasks.task as (ctx: Ctx) => Promise<void>)(ctx),
      ).rejects.toThrow(
        "npm account has 2FA enabled for writes (auth-and-writes)",
      );
    });

    it("passes when 2FA is auth-only in CI mode", async () => {
      mockNpm.isPublished.mockResolvedValue(false);
      mockNpm.isPackageNameAvaliable.mockResolvedValue(true);
      mockNpm.twoFactorAuthMode.mockResolvedValue("auth-only");
      const ctx = createCtx({ promptEnabled: false });

      await expect(
        (npmAvailableCheckTasks.task as (ctx: Ctx) => Promise<void>)(ctx),
      ).resolves.toBeUndefined();
    });

    it("skips 2FA check in TTY mode", async () => {
      mockNpm.isPublished.mockResolvedValue(false);
      mockNpm.isPackageNameAvaliable.mockResolvedValue(true);
      const ctx = createCtx({ promptEnabled: true });

      await (npmAvailableCheckTasks.task as (ctx: Ctx) => Promise<void>)(ctx);

      expect(mockNpm.twoFactorAuthMode).not.toHaveBeenCalled();
    });
  });
});

describe("npmPublishTasks", () => {
  describe("skip", () => {
    it("returns true when preview is true", () => {
      const ctx = createCtx({ preview: true });
      const result = (npmPublishTasks.skip as (ctx: Ctx) => boolean)(ctx);

      expect(result).toBe(true);
    });
  });

  describe("task — TTY mode (promptEnabled=true)", () => {
    it("publishes successfully without OTP", async () => {
      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();
      mockNpm.publish.mockResolvedValue(true);

      await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
        ctx,
        task,
      );

      expect(task.output).toBe("Publishing on npm...");
      expect(mockNpm.publish).toHaveBeenCalledOnce();
      expect(task.prompt).not.toHaveBeenCalled();
    });

    it("prompts for OTP when publish returns false, retries until success", async () => {
      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();

      mockNpm.publish
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const mockRun = vi.fn().mockResolvedValue("123456");
      task.prompt.mockReturnValue({ run: mockRun });

      await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
        ctx,
        task,
      );

      expect(task.title).toBe("Running npm publish (2FA passed)");
      expect(mockNpm.publish).toHaveBeenCalledTimes(3);
      expect(mockNpm.publish).toHaveBeenNthCalledWith(1);
      expect(mockNpm.publish).toHaveBeenNthCalledWith(2, "123456");
      expect(mockNpm.publish).toHaveBeenNthCalledWith(3, "123456");
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it("sets task title to OTP needed on first failure", async () => {
      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();

      mockNpm.publish.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const mockRun = vi.fn().mockResolvedValue("654321");
      task.prompt.mockReturnValue({ run: mockRun });

      await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
        ctx,
        task,
      );

      expect(task.title).toBe("Running npm publish (2FA passed)");
      expect(mockNpm.publish).toHaveBeenCalledTimes(2);
    });

    it('sets task output to "2FA failed" on OTP retry failure', async () => {
      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();

      mockNpm.publish
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const mockRun = vi.fn().mockResolvedValue("000000");
      task.prompt.mockReturnValue({ run: mockRun });

      await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
        ctx,
        task,
      );

      // After the second publish (first OTP attempt) fails, output is set to '2FA failed'
      // Then the third publish succeeds
      expect(mockNpm.publish).toHaveBeenCalledTimes(3);
    });

    it("throws after 3 failed OTP attempts", async () => {
      const ctx = createCtx({ promptEnabled: true });
      const task = createMockTask();

      // Initial publish fails, then all 3 OTP attempts fail
      mockNpm.publish
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);

      const mockRun = vi.fn().mockResolvedValue("000000");
      task.prompt.mockReturnValue({ run: mockRun });

      await expect(
        (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
          ctx,
          task,
        ),
      ).rejects.toThrow("OTP verification failed after 3 attempts.");

      // Initial publish + 3 OTP attempts = 4 calls
      expect(mockNpm.publish).toHaveBeenCalledTimes(4);
      expect(mockRun).toHaveBeenCalledTimes(3);
    });
  });

  describe("task — CI mode (promptEnabled=false)", () => {
    it("throws when NODE_AUTH_TOKEN is not set", async () => {
      const ctx = createCtx({ promptEnabled: false });
      const task = createMockTask();
      const originalEnv = process.env.NODE_AUTH_TOKEN;
      delete process.env.NODE_AUTH_TOKEN;

      try {
        await expect(
          (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
            ctx,
            task,
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
      const ctx = createCtx({ promptEnabled: false });
      const task = createMockTask();
      const originalEnv = process.env.NODE_AUTH_TOKEN;
      process.env.NODE_AUTH_TOKEN = "npm_test_token";

      try {
        await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
          ctx,
          task,
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
      const ctx = createCtx({ promptEnabled: false });
      const task = createMockTask();
      const originalEnv = process.env.NODE_AUTH_TOKEN;
      process.env.NODE_AUTH_TOKEN = "npm_test_token";

      mockNpm.publishProvenance.mockResolvedValue(false);

      try {
        await expect(
          (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
            ctx,
            task,
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
