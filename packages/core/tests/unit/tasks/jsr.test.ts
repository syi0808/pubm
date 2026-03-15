import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrPackageRegistry: vi.fn(),
  JsrClient: { token: null as string | null },
  JsrPackageRegistry: { reader: { invalidate: vi.fn() } },
}));

vi.mock("../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(),
}));

import type { PubmContext } from "../../../src/context.js";
import { JsrClient, jsrPackageRegistry } from "../../../src/registry/jsr.js";
import { createJsrPublishTask } from "../../../src/tasks/jsr.js";
import { openUrl } from "../../../src/utils/open-url.js";

const mockedJsrRegistry = vi.mocked(jsrPackageRegistry);
const mockedOpenUrl = vi.mocked(openUrl);

function createMockJsr() {
  return {
    packageName: "@scope/my-package",
    registry: "https://jsr.io",
    client: {
      user: vi.fn().mockResolvedValue({ id: "user-1" }),
    },
    isVersionPublished: vi.fn().mockResolvedValue(false),
    publish: vi.fn().mockResolvedValue(true),
  };
}

function createMockTask() {
  const mockRun = vi.fn();
  return {
    output: "",
    title: "",
    skip: vi.fn(),
    prompt: vi.fn(() => ({
      run: mockRun,
    })),
    _mockRun: mockRun,
  };
}

function createCtx(
  overrides: {
    options?: Partial<PubmContext["options"]>;
    runtime?: Partial<PubmContext["runtime"]>;
  } = {},
): PubmContext {
  return {
    config: { packages: [{ path: ".", registries: ["jsr"] }] },
    options: {
      testScript: "test",
      buildScript: "build",
      branch: "main",
      tag: "latest",
      saveToken: false,
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

let mockJsr: ReturnType<typeof createMockJsr>;

beforeEach(() => {
  vi.clearAllMocks();

  mockJsr = createMockJsr();

  mockedJsrRegistry.mockResolvedValue(mockJsr as any);

  // Reset JsrClient.token
  JsrClient.token = null;
});

describe("createJsrPublishTask", () => {
  it("calls jsrPackageRegistry with the given packagePath", async () => {
    JsrClient.token = "valid-token";

    const ctx = createCtx({ runtime: { promptEnabled: true } });
    const task = createMockTask();

    const listrTask = createJsrPublishTask("packages/core");
    await (listrTask.task as (ctx: PubmContext, task: any) => Promise<void>)(
      ctx,
      task,
    );

    expect(mockedJsrRegistry).toHaveBeenCalledWith("packages/core");
  });

  it("sets task title to packagePath initially, then to packageName", async () => {
    JsrClient.token = "valid-token";

    const listrTask = createJsrPublishTask("packages/core");
    expect(listrTask.title).toBe("packages/core");

    const ctx = createCtx({ runtime: { promptEnabled: true } });
    const task = createMockTask();

    await (listrTask.task as (ctx: PubmContext, task: any) => Promise<void>)(
      ctx,
      task,
    );

    expect(task.title).toBe("@scope/my-package");
  });

  describe("task", () => {
    it("publishes via jsr.publish()", async () => {
      JsrClient.token = "valid-token";

      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      const listrTask = createJsrPublishTask("packages/core");
      await (listrTask.task as (ctx: PubmContext, task: any) => Promise<void>)(
        ctx,
        task,
      );

      expect(task.output).toBe("Publishing on jsr...");
      expect(mockJsr.publish).toHaveBeenCalledOnce();
    });

    it("uses existing JsrClient.token without reading env", async () => {
      JsrClient.token = "already-set";
      const originalEnv = process.env.JSR_TOKEN;
      delete process.env.JSR_TOKEN;

      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const task = createMockTask();

      try {
        const listrTask = createJsrPublishTask("packages/core");
        await (
          listrTask.task as (ctx: PubmContext, task: any) => Promise<void>
        )(ctx, task);

        expect(mockJsr.publish).toHaveBeenCalledOnce();
        expect(JsrClient.token).toBe("already-set");
      } finally {
        if (originalEnv !== undefined) {
          process.env.JSR_TOKEN = originalEnv;
        }
      }
    });

    it("CI: reads JSR_TOKEN when no token and not prompt mode", async () => {
      JsrClient.token = null;
      const originalEnv = process.env.JSR_TOKEN;
      process.env.JSR_TOKEN = "ci-token";

      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const task = createMockTask();

      try {
        const listrTask = createJsrPublishTask("packages/core");
        await (
          listrTask.task as (ctx: PubmContext, task: any) => Promise<void>
        )(ctx, task);

        expect(JsrClient.token).toBe("ci-token");
        expect(mockJsr.publish).toHaveBeenCalledOnce();
      } finally {
        if (originalEnv !== undefined) {
          process.env.JSR_TOKEN = originalEnv;
        } else {
          delete process.env.JSR_TOKEN;
        }
      }
    });

    it("CI: throws when JSR_TOKEN is not set and no token exists", async () => {
      JsrClient.token = null;
      const originalEnv = process.env.JSR_TOKEN;
      delete process.env.JSR_TOKEN;

      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const task = createMockTask();

      try {
        const listrTask = createJsrPublishTask("packages/core");
        await expect(
          (listrTask.task as (ctx: PubmContext, task: any) => Promise<void>)(
            ctx,
            task,
          ),
        ).rejects.toThrow("JSR_TOKEN not found in the environment variables");
      } finally {
        if (originalEnv !== undefined) {
          process.env.JSR_TOKEN = originalEnv;
        }
      }
    });

    it("does not check env token when promptEnabled is true and token is null", async () => {
      JsrClient.token = null;
      const originalEnv = process.env.JSR_TOKEN;
      delete process.env.JSR_TOKEN;

      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      try {
        const listrTask = createJsrPublishTask("packages/core");
        // Should not throw because the env check is skipped when promptEnabled
        await (
          listrTask.task as (ctx: PubmContext, task: any) => Promise<void>
        )(ctx, task);

        expect(mockJsr.publish).toHaveBeenCalledOnce();
      } finally {
        if (originalEnv !== undefined) {
          process.env.JSR_TOKEN = originalEnv;
        }
      }
    });

    it("opens package creation URLs and retries publish until the package exists", async () => {
      JsrClient.token = "valid-token";
      mockJsr.packageCreationUrls = [
        "https://jsr.io/new?scope=scope&package=my-package",
      ];
      mockJsr.publish
        .mockResolvedValueOnce(false)
        .mockImplementationOnce(async () => {
          mockJsr.packageCreationUrls = [
            "https://jsr.io/new?scope=scope&package=my-package",
          ];
          return false;
        })
        .mockImplementationOnce(async () => {
          mockJsr.packageCreationUrls = undefined;
          return true;
        });

      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();
      task._mockRun.mockResolvedValue("");

      const listrTask = createJsrPublishTask("packages/core");
      await (listrTask.task as (ctx: PubmContext, task: any) => Promise<void>)(
        ctx,
        task,
      );

      expect(mockedOpenUrl).toHaveBeenCalledWith(
        "https://jsr.io/new?scope=scope&package=my-package",
      );
      expect(task.prompt).toHaveBeenCalledTimes(2);
      expect(mockJsr.publish).toHaveBeenCalledTimes(3);
      expect(task.title).toBe("Running jsr publish (package created)");
    });

    it("fails after three retries when the package is still missing on jsr", async () => {
      JsrClient.token = "valid-token";
      mockJsr.packageCreationUrls = [
        "https://jsr.io/new?scope=scope&package=my-package",
      ];
      mockJsr.publish.mockResolvedValue(false);

      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();
      task._mockRun.mockResolvedValue("");

      const listrTask = createJsrPublishTask("packages/core");
      await expect(
        (listrTask.task as (ctx: PubmContext, task: any) => Promise<void>)(
          ctx,
          task,
        ),
      ).rejects.toThrow("Package creation not completed after 3 attempts.");

      expect(task.prompt).toHaveBeenCalledTimes(3);
      expect(mockedOpenUrl).toHaveBeenCalledOnce();
    });

    it("fails fast in non-interactive mode when package creation is required", async () => {
      JsrClient.token = "valid-token";
      mockJsr.packageCreationUrls = [
        "https://jsr.io/new?scope=scope&package=my-package",
      ];
      mockJsr.publish.mockResolvedValue(false);

      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const task = createMockTask();

      const listrTask = createJsrPublishTask("packages/core");
      await expect(
        (listrTask.task as (ctx: PubmContext, task: any) => Promise<void>)(
          ctx,
          task,
        ),
      ).rejects.toThrow("https://jsr.io/new?scope=scope&package=my-package");

      expect(task.prompt).not.toHaveBeenCalled();
      expect(mockedOpenUrl).not.toHaveBeenCalled();
    });

    it("skips the task when jsr reports the version is already published during publish", async () => {
      JsrClient.token = "valid-token";
      mockJsr.publish.mockRejectedValue(new Error("already published"));

      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      const listrTask = createJsrPublishTask("packages/core");
      await (listrTask.task as (ctx: PubmContext, task: any) => Promise<void>)(
        ctx,
        task,
      );

      expect(task.title).toBe("[SKIPPED] jsr: v1.0.0 already published");
      expect(task.output).toContain("@scope/my-package@1.0.0");
      expect(task.skip).toHaveBeenCalledOnce();
    });
  });
});
