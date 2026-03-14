import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrPackageRegistry: vi.fn(),
  JsrClient: { token: null as string | null },
  JsrPackageRegistry: { reader: { invalidate: vi.fn() } },
}));

vi.mock("../../../src/registry/npm.js", () => ({
  npmPackageRegistry: vi.fn(),
}));

vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(),
}));

vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
    };
  }),
}));

vi.mock("../../../src/utils/package-name.js", () => ({
  isScopedPackage: vi.fn(),
  getScope: vi.fn(),
}));

vi.mock("../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../../../src/utils/rollback.js", () => ({
  addRollback: vi.fn(),
}));

import type { PubmContext } from "../../../src/context.js";
import { Git } from "../../../src/git.js";
import {
  JsrClient,
  JsrPackageRegistry,
  jsrPackageRegistry,
} from "../../../src/registry/jsr.js";
import { npmPackageRegistry } from "../../../src/registry/npm.js";
import {
  jsrAvailableCheckTasks,
  jsrPublishTasks,
} from "../../../src/tasks/jsr.js";
import { openUrl } from "../../../src/utils/open-url.js";
import { getScope, isScopedPackage } from "../../../src/utils/package-name.js";
import { addRollback } from "../../../src/utils/rollback.js";
import { SecureStore } from "../../../src/utils/secure-store.js";

const mockedGit = vi.mocked(Git);
const mockedJsrRegistry = vi.mocked(jsrPackageRegistry);
const mockedNpmRegistry = vi.mocked(npmPackageRegistry);
const mockedIsScopedPackage = vi.mocked(isScopedPackage);
const mockedGetScope = vi.mocked(getScope);
const mockedAddRollback = vi.mocked(addRollback);
const mockedOpenUrl = vi.mocked(openUrl);
const mockedJsrPackageRegistryReaderInvalidate = vi.mocked(
  JsrPackageRegistry.reader.invalidate,
);
const mockedDb = vi.mocked(SecureStore);

function createMockJsr() {
  return {
    packageName: "@scope/my-package",
    registry: "https://jsr.io",
    client: {
      user: vi.fn().mockResolvedValue({ id: "user-1" }),
      scopes: vi.fn().mockResolvedValue([]),
      package: vi.fn().mockResolvedValue(null),
      createScope: vi.fn().mockResolvedValue(true),
      createPackage: vi.fn().mockResolvedValue(true),
      deleteScope: vi.fn().mockResolvedValue(true),
      deletePackage: vi.fn().mockResolvedValue(true),
      scopePermission: vi.fn().mockResolvedValue(null),
    },
    isPublished: vi.fn().mockResolvedValue(false),
    isVersionPublished: vi.fn().mockResolvedValue(false),
    hasPermission: vi.fn().mockResolvedValue(true),
    isPackageNameAvailable: vi.fn().mockResolvedValue(true),
    publish: vi.fn().mockResolvedValue(true),
  };
}

function createMockNpm() {
  return {
    packageName: "@scope/my-package",
    isLoggedIn: vi.fn().mockResolvedValue(true),
    isPublished: vi.fn().mockResolvedValue(false),
    hasPermission: vi.fn().mockResolvedValue(true),
    isPackageNameAvailable: vi.fn().mockResolvedValue(true),
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
let mockNpm: ReturnType<typeof createMockNpm>;
let mockDbInstance: {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();

  mockJsr = createMockJsr();
  mockNpm = createMockNpm();
  mockDbInstance = { get: vi.fn().mockReturnValue(null), set: vi.fn() };

  mockedJsrRegistry.mockResolvedValue(mockJsr as any);
  mockedNpmRegistry.mockResolvedValue(mockNpm as any);
  mockedDb.mockImplementation(function () {
    return mockDbInstance as any;
  });
  mockedGit.mockImplementation(function () {
    return {
      userName: vi.fn().mockResolvedValue("gituser"),
    } as any;
  });

  // Default: package is scoped so we skip the complex scope resolution
  mockedIsScopedPackage.mockReturnValue(true);
  mockedGetScope.mockReturnValue("scope");

  // Reset JsrClient.token
  JsrClient.token = null;
});

describe("jsrAvailableCheckTasks", () => {
  describe("rollback registration", () => {
    it("registers a rollback function via addRollback", async () => {
      const ctx = createCtx();
      const task = createMockTask();

      JsrClient.token = "valid-token";

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(mockedAddRollback).toHaveBeenCalledOnce();
      expect(mockedAddRollback).toHaveBeenCalledWith(expect.any(Function), ctx);
    });

    it("rollback deletes package and scope when both were created", async () => {
      const ctx = createCtx();
      const task = createMockTask();

      JsrClient.token = "valid-token";

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      const rollbackFn = mockedAddRollback.mock.calls[0][0];
      const rollbackCtx = {
        runtime: { packageCreated: true, scopeCreated: true },
      };

      await rollbackFn(rollbackCtx);

      expect(mockJsr.client.deletePackage).toHaveBeenCalledWith(
        mockJsr.packageName,
      );
      expect(mockJsr.client.deleteScope).toHaveBeenCalled();
    });

    it("rollback does nothing when neither scope nor package was created", async () => {
      const ctx = createCtx();
      const task = createMockTask();

      JsrClient.token = "valid-token";

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      const rollbackFn = mockedAddRollback.mock.calls[0][0];

      await rollbackFn({ runtime: {} });

      expect(mockJsr.client.deletePackage).not.toHaveBeenCalled();
      expect(mockJsr.client.deleteScope).not.toHaveBeenCalled();
    });
  });

  describe("token handling", () => {
    it("skips token prompt when JsrClient.token is already set", async () => {
      const ctx = createCtx();
      const task = createMockTask();

      JsrClient.token = "existing-token";

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(task.prompt).not.toHaveBeenCalled();
    });

    it("TTY: prompts for token and retries on invalid token", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      // First token is invalid (user() returns null), second is valid
      mockJsr.client.user
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "user-1" });

      task._mockRun
        .mockResolvedValueOnce("bad-token")
        .mockResolvedValueOnce("good-token");

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(task.prompt).toHaveBeenCalledTimes(2);
      expect(JsrClient.token).toBe("good-token");
    });

    it("TTY: prompts for token and retries when user() throws non-network error", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      // First call throws a non-network error (catch block), second succeeds
      mockJsr.client.user
        .mockRejectedValueOnce(new Error("some error"))
        .mockResolvedValueOnce({ id: "user-1" });

      task._mockRun
        .mockResolvedValueOnce("bad-token")
        .mockResolvedValueOnce("good-token");

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(task.prompt).toHaveBeenCalledTimes(2);
      expect(JsrClient.token).toBe("good-token");
    });

    it("TTY: throws after 3 failed token attempts", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      // All three attempts return null (invalid token)
      mockJsr.client.user
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      task._mockRun
        .mockResolvedValueOnce("bad-token-1")
        .mockResolvedValueOnce("bad-token-2")
        .mockResolvedValueOnce("bad-token-3");

      await expect(
        (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task),
      ).rejects.toThrow("JSR token verification failed after 3 attempts.");

      expect(task.prompt).toHaveBeenCalledTimes(3);
    });

    it("TTY: throws immediately on network error during token validation", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      mockJsr.client.user.mockRejectedValueOnce(
        new Error("fetch failed: ENOTFOUND jsr.io"),
      );

      task._mockRun.mockResolvedValueOnce("some-token");

      await expect(
        (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task),
      ).rejects.toThrow(
        "JSR API is unreachable. Check your network connection.",
      );

      // Should only prompt once — network error causes immediate throw
      expect(task.prompt).toHaveBeenCalledTimes(1);
    });

    it("CI: reads JSR_TOKEN from environment", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const task = createMockTask();
      const originalEnv = process.env.JSR_TOKEN;
      process.env.JSR_TOKEN = "ci-jsr-token";

      try {
        await (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task);

        expect(JsrClient.token).toBe("ci-jsr-token");
        expect(task.prompt).not.toHaveBeenCalled();
      } finally {
        if (originalEnv !== undefined) {
          process.env.JSR_TOKEN = originalEnv;
        } else {
          delete process.env.JSR_TOKEN;
        }
      }
    });

    it("CI: throws when JSR_TOKEN is not set", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: false } });
      const task = createMockTask();
      const originalEnv = process.env.JSR_TOKEN;
      delete process.env.JSR_TOKEN;

      try {
        await expect(
          (
            jsrAvailableCheckTasks.task as (
              ctx: JsrCtx,
              task: any,
            ) => Promise<void>
          )(ctx, task),
        ).rejects.toThrow("JSR_TOKEN not found in the environment variables");
      } finally {
        if (originalEnv !== undefined) {
          process.env.JSR_TOKEN = originalEnv;
        }
      }
    });

    it("saves token via Db when ctx.saveToken is true", async () => {
      const ctx = createCtx({
        options: { saveToken: true },
        runtime: { promptEnabled: true },
      });
      const task = createMockTask();

      task._mockRun.mockResolvedValueOnce("new-token");
      mockJsr.client.user.mockResolvedValueOnce({ id: "user-1" });

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(mockDbInstance.set).toHaveBeenCalledWith("jsr-token", "new-token");
    });

    it("does not save token when ctx.saveToken is falsy", async () => {
      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      task._mockRun.mockResolvedValueOnce("new-token");
      mockJsr.client.user.mockResolvedValueOnce({ id: "user-1" });

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(mockDbInstance.set).not.toHaveBeenCalled();
    });
  });

  describe("scope resolution for non-scoped packages", () => {
    beforeEach(() => {
      JsrClient.token = "valid-token";
    });

    it("skips scope resolution for scoped packages", async () => {
      mockedIsScopedPackage.mockReturnValue(true);

      const ctx = createCtx();
      const task = createMockTask();

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(mockJsr.client.scopes).not.toHaveBeenCalled();
      expect(mockedJsrPackageRegistryReaderInvalidate).not.toHaveBeenCalled();
    });

    it("uses cached jsr name from Db when available", async () => {
      mockedIsScopedPackage
        .mockReturnValueOnce(false) // jsr.packageName is not scoped
        .mockReturnValue(true); // subsequent calls (npm check, etc.)

      mockDbInstance.get.mockReturnValue("@cached/my-package");
      mockJsr.client.scopes.mockResolvedValue(["cached"]);

      const ctx = createCtx();
      const task = createMockTask();

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(mockJsr.packageName).toBe("@cached/my-package");
      expect(mockedJsrPackageRegistryReaderInvalidate).toHaveBeenCalledWith(
        process.cwd(),
      );
      // Should NOT prompt because jsrName was found in Db
      expect(task.prompt).not.toHaveBeenCalled();
    });

    it("searches scopes for existing packages and prompts to select", async () => {
      mockedIsScopedPackage
        .mockReturnValueOnce(false) // jsr.packageName check
        .mockReturnValue(true); // npm.packageName and other checks

      mockDbInstance.get.mockReturnValue(null);
      mockJsr.packageName = "my-package";
      mockJsr.client.scopes.mockResolvedValue(["myscope"]);
      mockJsr.client.package.mockResolvedValue({
        scope: "myscope",
        name: "my-package",
      } as any);

      const ctx = createCtx();
      const task = createMockTask();

      // User selects the found package
      task._mockRun.mockResolvedValueOnce("@myscope/my-package");

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(mockJsr.client.scopes).toHaveBeenCalled();
      expect(mockJsr.packageName).toBe("@myscope/my-package");
      expect(mockedJsrPackageRegistryReaderInvalidate).toHaveBeenCalledWith(
        process.cwd(),
      );
    });

    it("creates scope and package when user selects a new scope", async () => {
      mockedIsScopedPackage
        .mockReturnValueOnce(false) // jsr.packageName check
        .mockReturnValue(true); // npm.packageName and other checks

      mockDbInstance.get.mockReturnValue(null);
      mockJsr.packageName = "my-package";
      mockJsr.client.scopes.mockResolvedValue([]);
      mockJsr.client.package.mockResolvedValue(null as any);

      const ctx = createCtx();
      const task = createMockTask();

      // No search results (empty scopes), so goes to scope selection prompt
      // User selects @my-package/my-package
      task._mockRun.mockResolvedValueOnce("@newscope/my-package");

      // The scope 'newscope' is not in scopes[], so createScope is called
      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(mockJsr.client.createScope).toHaveBeenCalledWith("newscope");
      expect(ctx.runtime.scopeCreated).toBe(true);
      expect(mockJsr.client.createPackage).toHaveBeenCalledWith(
        "@newscope/my-package",
      );
      expect(ctx.runtime.packageCreated).toBe(true);
    });

    it('handles "specify" option by prompting for custom package name', async () => {
      mockedIsScopedPackage
        .mockReturnValueOnce(false) // jsr.packageName check
        .mockImplementation((name: string) => {
          // Return true for the scoped name the user types in
          return name === "@custom/my-package";
        });

      mockDbInstance.get.mockReturnValue(null);
      mockJsr.packageName = "my-package";
      mockJsr.client.scopes.mockResolvedValue([]);
      mockJsr.client.package.mockResolvedValue(null as any);

      const ctx = createCtx();
      const task = createMockTask();

      // First prompt (scope selection): user selects 'specify'
      // Second prompt (input): user types a non-scoped name (invalid, loop continues)
      // Third prompt (input): user types a scoped name (valid)
      task._mockRun
        .mockResolvedValueOnce("specify")
        .mockResolvedValueOnce("not-scoped")
        .mockResolvedValueOnce("@custom/my-package");

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(task.prompt).toHaveBeenCalledTimes(3);
      expect(mockJsr.packageName).toBe("@custom/my-package");
    });

    it("filters out scopes matching packageName or userName in scope choices", async () => {
      mockedIsScopedPackage
        .mockReturnValueOnce(false) // jsr.packageName check
        .mockReturnValue(true); // npm.packageName and other checks

      mockDbInstance.get.mockReturnValue(null);
      mockJsr.packageName = "my-package";
      // Scopes include both the packageName and the userName — these are filtered
      // out of the extra choices but still appear as the first two dedicated options
      mockJsr.client.scopes.mockResolvedValue([
        "my-package",
        "gituser",
        "other-scope",
      ]);
      mockJsr.client.package.mockResolvedValue(null as any);

      const ctx = createCtx();
      const task = createMockTask();

      // User selects the @other-scope option (which comes from the flatMap)
      task._mockRun.mockResolvedValueOnce("@other-scope/my-package");

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      // Verify the scope already exists, so no createScope call
      expect(mockJsr.client.createScope).not.toHaveBeenCalled();
      expect(mockJsr.packageName).toBe("@other-scope/my-package");
    });

    it('user selects "none" from existing packages and goes to scope selection', async () => {
      mockedIsScopedPackage
        .mockReturnValueOnce(false) // jsr.packageName check
        .mockReturnValue(true); // npm.packageName and other checks

      mockDbInstance.get.mockReturnValue(null);
      mockJsr.packageName = "my-package";
      mockJsr.client.scopes.mockResolvedValue(["existingscope"]);
      // package search returns a match
      mockJsr.client.package.mockResolvedValue({
        scope: "existingscope",
        name: "my-package",
      } as any);

      const ctx = createCtx();
      const task = createMockTask();

      // First prompt: user selects 'none' from existing packages
      // Second prompt: user selects a scope
      task._mockRun
        .mockResolvedValueOnce("none")
        .mockResolvedValueOnce("@existingscope/my-package");

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(task.prompt).toHaveBeenCalledTimes(2);
      expect(mockJsr.packageName).toBe("@existingscope/my-package");
    });

    it("does not create scope when scope already exists in scopes list", async () => {
      mockedIsScopedPackage
        .mockReturnValueOnce(false) // jsr.packageName check
        .mockReturnValue(true); // npm.packageName and other checks

      mockDbInstance.get.mockReturnValue(null);
      mockJsr.packageName = "my-package";
      mockJsr.client.scopes.mockResolvedValue(["existingscope"]);
      mockJsr.client.package.mockResolvedValue(null as any);

      const ctx = createCtx();
      const task = createMockTask();

      // No search results match filter, goes to scope selection
      task._mockRun.mockResolvedValueOnce("@existingscope/my-package");

      await (
        jsrAvailableCheckTasks.task as (
          ctx: PubmContext,
          task: any,
        ) => Promise<void>
      )(ctx, task);

      expect(mockJsr.client.createScope).not.toHaveBeenCalled();
      expect(ctx.runtime.scopeCreated).toBeUndefined();
      // package doesn't exist yet so createPackage is called
      expect(mockJsr.client.createPackage).toHaveBeenCalledWith(
        "@existingscope/my-package",
      );
    });
  });

  describe("permission checks", () => {
    beforeEach(() => {
      JsrClient.token = "valid-token";
    });

    it("throws when scoped npm package but no jsr permission", async () => {
      mockedIsScopedPackage.mockReturnValue(true);
      mockNpm.packageName = "@scope/my-package";
      mockJsr.hasPermission.mockResolvedValue(false);

      const ctx = createCtx();
      const task = createMockTask();

      await expect(
        (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task),
      ).rejects.toThrow("You do not have permission to publish scope");
    });

    it("passes when scoped npm package and has jsr permission", async () => {
      mockedIsScopedPackage.mockReturnValue(true);
      mockNpm.packageName = "@scope/my-package";
      mockJsr.hasPermission.mockResolvedValue(true);
      mockJsr.isPublished.mockResolvedValue(false);
      mockJsr.isPackageNameAvailable.mockResolvedValue(true);

      const ctx = createCtx();
      const task = createMockTask();

      await expect(
        (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task),
      ).resolves.toBeUndefined();
    });

    it("passes when published and has permission", async () => {
      mockedIsScopedPackage.mockReturnValue(true);
      mockJsr.isPublished.mockResolvedValue(true);
      mockJsr.hasPermission.mockResolvedValue(true);

      const ctx = createCtx();
      const task = createMockTask();

      await expect(
        (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task),
      ).resolves.toBeUndefined();
    });

    it("throws when published but no permission", async () => {
      mockedIsScopedPackage.mockReturnValue(true);
      // npm packageName is not scoped so we skip the scope permission check
      mockNpm.packageName = "unscoped-package";
      mockedIsScopedPackage.mockImplementation((name: string) => {
        return name === "@scope/my-package";
      });
      mockJsr.isPublished.mockResolvedValue(true);
      mockJsr.hasPermission.mockResolvedValue(false);

      const ctx = createCtx();
      const task = createMockTask();

      await expect(
        (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task),
      ).rejects.toThrow("You do not have permission to publish this package");
    });

    it("throws when not published and package name not available", async () => {
      mockedIsScopedPackage.mockReturnValue(true);
      // npm packageName is not scoped so we skip scope permission check
      mockNpm.packageName = "unscoped-package";
      mockedIsScopedPackage.mockImplementation((name: string) => {
        return name === "@scope/my-package";
      });
      mockJsr.hasPermission.mockResolvedValue(true);
      mockJsr.isPublished.mockResolvedValue(false);
      mockJsr.isPackageNameAvailable.mockResolvedValue(false);

      const ctx = createCtx();
      const task = createMockTask();

      await expect(
        (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task),
      ).rejects.toThrow("Package is not published");
    });

    it("passes when not published but name is available", async () => {
      mockedIsScopedPackage.mockReturnValue(true);
      mockNpm.packageName = "unscoped-package";
      mockedIsScopedPackage.mockImplementation((name: string) => {
        return name === "@scope/my-package";
      });
      mockJsr.hasPermission.mockResolvedValue(true);
      mockJsr.isPublished.mockResolvedValue(false);
      mockJsr.isPackageNameAvailable.mockResolvedValue(true);

      const ctx = createCtx();
      const task = createMockTask();

      await expect(
        (
          jsrAvailableCheckTasks.task as (
            ctx: JsrCtx,
            task: any,
          ) => Promise<void>
        )(ctx, task),
      ).resolves.toBeUndefined();
    });
  });
});

describe("jsrPublishTasks", () => {
  describe("task", () => {
    it("publishes via jsr.publish()", async () => {
      JsrClient.token = "valid-token";

      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      await (
        jsrPublishTasks.task as (ctx: PubmContext, task: any) => Promise<void>
      )(ctx, task);

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
        await (
          jsrPublishTasks.task as (ctx: PubmContext, task: any) => Promise<void>
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
        await (
          jsrPublishTasks.task as (ctx: PubmContext, task: any) => Promise<void>
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
        await expect(
          (
            jsrPublishTasks.task as (
              ctx: PubmContext,
              task: any,
            ) => Promise<void>
          )(ctx, task),
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
        // Should not throw because the env check is skipped when promptEnabled
        await (
          jsrPublishTasks.task as (ctx: PubmContext, task: any) => Promise<void>
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

      await (
        jsrPublishTasks.task as (ctx: PubmContext, task: any) => Promise<void>
      )(ctx, task);

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

      await expect(
        (
          jsrPublishTasks.task as (ctx: PubmContext, task: any) => Promise<void>
        )(ctx, task),
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

      await expect(
        (
          jsrPublishTasks.task as (ctx: PubmContext, task: any) => Promise<void>
        )(ctx, task),
      ).rejects.toThrow("https://jsr.io/new?scope=scope&package=my-package");

      expect(task.prompt).not.toHaveBeenCalled();
      expect(mockedOpenUrl).not.toHaveBeenCalled();
    });

    it("skips the task when jsr reports the version is already published during publish", async () => {
      JsrClient.token = "valid-token";
      mockJsr.publish.mockRejectedValue(new Error("already published"));

      const ctx = createCtx({ runtime: { promptEnabled: true } });
      const task = createMockTask();

      await (
        jsrPublishTasks.task as (ctx: PubmContext, task: any) => Promise<void>
      )(ctx, task);

      expect(task.title).toBe("[SKIPPED] jsr: v1.0.0 already published");
      expect(task.output).toContain("@scope/my-package@1.0.0");
      expect(task.skip).toHaveBeenCalledOnce();
    });
  });
});
