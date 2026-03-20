import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@listr2/prompt-adapter-enquirer", () => ({
  ListrEnquirerPromptAdapter: vi.fn(),
}));
vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(),
      set: vi.fn(),
    };
  }),
}));
vi.mock("../../../src/utils/token.js", () => ({
  TOKEN_CONFIG: {
    npm: {
      envVar: "NODE_AUTH_TOKEN",
      dbKey: "npm-token",
      ghSecretName: "NODE_AUTH_TOKEN",
      promptLabel: "npm access token",
    },
    jsr: {
      envVar: "JSR_TOKEN",
      dbKey: "jsr-token",
      ghSecretName: "JSR_TOKEN",
      promptLabel: "jsr API token",
    },
    crates: {
      envVar: "CARGO_REGISTRY_TOKEN",
      dbKey: "cargo-token",
      ghSecretName: "CARGO_REGISTRY_TOKEN",
      promptLabel: "crates.io API token",
    },
  },
}));
vi.mock("../../../src/registry/npm.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/registry/npm.js")>();
  return {
    ...original,
    npmPackageRegistry: vi.fn(),
  };
});
vi.mock("../../../src/registry/jsr.js", () => ({
  jsrPackageRegistry: vi.fn(),
}));
vi.mock("../../../src/registry/crates.js", () => ({
  cratesPackageRegistry: vi.fn(),
}));
vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: vi.fn(),
}));

import { RustEcosystem } from "../../../src/ecosystem/rust.js";
import { cratesPackageRegistry } from "../../../src/registry/crates.js";
import { jsrPackageRegistry } from "../../../src/registry/jsr.js";
import { npmPackageRegistry } from "../../../src/registry/npm.js";
import {
  createCratesDryRunPublishTask,
  createJsrDryRunPublishTask,
  createNpmDryRunPublishTask,
} from "../../../src/tasks/dry-run-publish.js";
import { SecureStore } from "../../../src/utils/secure-store.js";

const mockedNpmRegistry = vi.mocked(npmPackageRegistry);
const mockedJsrRegistry = vi.mocked(jsrPackageRegistry);
const mockedCratesRegistry = vi.mocked(cratesPackageRegistry);
const mockedRustEcosystem = vi.mocked(RustEcosystem);
const mockedSecureStore = vi.mocked(SecureStore);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSecureStore.mockImplementation(function () {
    return { get: vi.fn(), set: vi.fn() } as any;
  });
});

describe("createNpmDryRunPublishTask", () => {
  it("has packagePath as initial title", () => {
    const task = createNpmDryRunPublishTask("packages/core");
    expect(task.title).toBe("packages/core");
  });

  it("calls dryRunPublish on npm registry with packagePath", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "test-package",
    } as any);

    const task = createNpmDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, { output: "" });
    expect(mockedNpmRegistry).toHaveBeenCalledWith("packages/core");
    expect(mockDryRun).toHaveBeenCalled();
  });
});

describe("createJsrDryRunPublishTask", () => {
  it("has packagePath as initial title", () => {
    const task = createJsrDryRunPublishTask("packages/core");
    expect(task.title).toBe("packages/core");
  });

  it("calls dryRunPublish on jsr registry with packagePath", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedJsrRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "@scope/test",
    } as any);

    const task = createJsrDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, { output: "" });
    expect(mockedJsrRegistry).toHaveBeenCalledWith("packages/core");
    expect(mockDryRun).toHaveBeenCalled();
  });
});

describe("createCratesDryRunPublishTask", () => {
  it("includes package path in title", () => {
    const task = createCratesDryRunPublishTask("packages/my-crate");
    expect(task.title).toBe("Dry-run crates.io publish (packages/my-crate)");
  });

  it("calls dryRunPublish with no args", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedRustEcosystem.mockImplementation(function () {
      return {
        packageName: vi.fn().mockResolvedValue("my-crate"),
        dependencies: vi.fn().mockResolvedValue([]),
      } as any;
    });
    mockedCratesRegistry.mockResolvedValue({
      packageName: "my-crate",
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
    } as any);

    const task = createCratesDryRunPublishTask("packages/my-crate");
    await (task as any).task({ runtime: {} }, { output: "" });
    expect(mockDryRun).toHaveBeenCalledWith();
  });

  it("proactively skips when sibling dependency is not published on crates.io", async () => {
    mockedRustEcosystem.mockImplementation(function (this: any, p: string) {
      const name = p.includes("my-lib") ? "my-lib" : "my-cli";
      return {
        packageName: vi.fn().mockResolvedValue(name),
        dependencies: vi.fn().mockResolvedValue(["my-lib", "serde"]),
      } as any;
    });
    mockedCratesRegistry.mockImplementation((path: string) => {
      const name = path === "packages/my-lib" ? "my-lib" : "my-cli";
      return Promise.resolve({
        packageName: name,
        isPublished: vi.fn().mockResolvedValue(name !== "my-lib"),
        isVersionPublished: vi.fn().mockResolvedValue(false),
        dryRunPublish: vi.fn(),
      } as any);
    });

    const mockTask = { output: "", title: "" };
    const task = createCratesDryRunPublishTask("packages/my-cli", [
      "packages/my-lib",
      "packages/my-cli",
    ]);
    await (task as any).task({ runtime: {} }, mockTask);
    expect(mockTask.title).toContain("skipped");
    expect(mockTask.title).toContain("my-lib");
  });

  it("proceeds with dry-run when all sibling dependencies are published", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedRustEcosystem.mockImplementation(function () {
      return {
        packageName: vi.fn().mockResolvedValue("my-cli"),
        dependencies: vi.fn().mockResolvedValue(["my-lib"]),
      } as any;
    });
    mockedCratesRegistry.mockImplementation((path: string) => {
      const name = path === "packages/my-lib" ? "my-lib" : "my-cli";
      return Promise.resolve({
        packageName: name,
        isPublished: vi.fn().mockResolvedValue(true),
        isVersionPublished: vi.fn().mockResolvedValue(false),
        dryRunPublish: mockDryRun,
      } as any);
    });

    const mockTask = { output: "" };
    const task = createCratesDryRunPublishTask("packages/my-cli", [
      "packages/my-lib",
      "packages/my-cli",
    ]);
    await (task as any).task({ runtime: {} }, mockTask);
    expect(mockDryRun).toHaveBeenCalledWith();
  });

  it("reactive fallback: skips when dry-run fails with sibling error", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "no matching package named `my-lib` found\nlocation searched: crates.io index",
        ),
      );
    mockedRustEcosystem.mockImplementation(function (this: any, p: string) {
      const name = p.includes("my-lib") ? "my-lib" : "my-cli";
      return {
        packageName: vi.fn().mockResolvedValue(name),
        dependencies: vi.fn().mockResolvedValue([]),
      } as any;
    });
    mockedCratesRegistry.mockImplementation((path: string) => {
      const name = path === "packages/my-lib" ? "my-lib" : "my-cli";
      return Promise.resolve({
        packageName: name,
        isPublished: vi.fn().mockResolvedValue(true),
        isVersionPublished: vi.fn().mockResolvedValue(false),
        dryRunPublish: mockDryRun,
      } as any);
    });

    const mockTask = { output: "", title: "" };
    const task = createCratesDryRunPublishTask("packages/my-cli", [
      "packages/my-lib",
      "packages/my-cli",
    ]);
    await (task as any).task({ runtime: {} }, mockTask);
    expect(mockTask.title).toContain("skipped");
    expect(mockTask.title).toContain("my-lib");
  });

  it("throws when error is about a non-sibling missing crate", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "no matching package named `unknown-crate` found\nlocation searched: crates.io index",
        ),
      );
    mockedRustEcosystem.mockImplementation(function () {
      return {
        packageName: vi.fn().mockResolvedValue("my-cli"),
        dependencies: vi.fn().mockResolvedValue([]),
      } as any;
    });
    mockedCratesRegistry.mockImplementation((path: string) => {
      const name = path === "packages/my-lib" ? "my-lib" : "my-cli";
      return Promise.resolve({
        packageName: name,
        isPublished: vi.fn().mockResolvedValue(true),
        isVersionPublished: vi.fn().mockResolvedValue(false),
        dryRunPublish: mockDryRun,
      } as any);
    });

    const mockTask = { output: "" };
    const task = createCratesDryRunPublishTask("packages/my-cli", [
      "packages/my-lib",
      "packages/my-cli",
    ]);
    await expect((task as any).task({ runtime: {} }, mockTask)).rejects.toThrow(
      "unknown-crate",
    );
  });

  it("throws when no siblingPaths provided", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValue(new Error("no matching package named `my-lib` found"));
    mockedRustEcosystem.mockImplementation(function () {
      return {
        packageName: vi.fn().mockResolvedValue("my-cli"),
      } as any;
    });
    mockedCratesRegistry.mockResolvedValue({
      packageName: "my-cli",
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
    } as any);

    const mockTask = { output: "" };
    const task = createCratesDryRunPublishTask("packages/my-cli");
    await expect((task as any).task({ runtime: {} }, mockTask)).rejects.toThrow(
      "my-lib",
    );
  });
});

describe("isAuthError detection", () => {
  it("detects EOTP error as auth error and triggers retry", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("EOTP: This operation requires a one-time password"),
      )
      .mockResolvedValueOnce(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "test-package",
    } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    const task = createNpmDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, mockTask);

    expect(mockDryRun).toHaveBeenCalledTimes(2);
    delete process.env.NODE_AUTH_TOKEN;
  });

  it("detects 'invalid token' error as auth error", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("invalid token provided"))
      .mockResolvedValueOnce(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "test-package",
    } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    const task = createNpmDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, mockTask);

    expect(mockDryRun).toHaveBeenCalledTimes(2);
    delete process.env.NODE_AUTH_TOKEN;
  });

  it("treats non-Error values as auth errors via String() conversion", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValueOnce("403 Forbidden")
      .mockResolvedValueOnce(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "test-package",
    } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    const task = createNpmDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, mockTask);

    expect(mockDryRun).toHaveBeenCalledTimes(2);
    delete process.env.NODE_AUTH_TOKEN;
  });
});

describe("withTokenRetry", () => {
  it("retries npm on auth error with new token", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      .mockResolvedValueOnce(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "test-package",
    } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    const task = createNpmDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, mockTask);

    expect(mockDryRun).toHaveBeenCalledTimes(2);
    expect(process.env.NODE_AUTH_TOKEN).toBe("new-token");

    // cleanup
    delete process.env.NODE_AUTH_TOKEN;
  });

  it("throws non-auth errors without retry", async () => {
    const mockDryRun = vi.fn().mockRejectedValue(new Error("network timeout"));
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "test-package",
    } as any);

    const mockTask = { output: "", prompt: vi.fn() };

    const task = createNpmDryRunPublishTask("packages/core");
    await expect((task as any).task({ runtime: {} }, mockTask)).rejects.toThrow(
      "network timeout",
    );

    expect(mockDryRun).toHaveBeenCalledTimes(1);
    expect(mockTask.prompt).not.toHaveBeenCalled();
  });

  it("shares retry promise between concurrent tasks", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      .mockResolvedValueOnce(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "test-package",
    } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("shared-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    // First task triggers retry
    const sharedRuntime = { tokenRetryPromises: {} } as any;
    const task = createNpmDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: sharedRuntime }, mockTask);

    // The retry entry should exist on the runtime
    expect(sharedRuntime.tokenRetryPromises.npm).toBeDefined();
    delete process.env.NODE_AUTH_TOKEN;
  });

  it("saves new token to Db on retry", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("403 forbidden"))
      .mockResolvedValueOnce(undefined);
    mockedJsrRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
      packageName: "@scope/test",
    } as any);

    const mockDbSet = vi.fn();
    mockedSecureStore.mockImplementation(function () {
      return { get: vi.fn(), set: mockDbSet } as any;
    });

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("fresh-jsr-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    const task = createJsrDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, mockTask);

    expect(mockDbSet).toHaveBeenCalledWith("jsr-token", "fresh-jsr-token");

    // cleanup
    delete process.env.JSR_TOKEN;
  });
});
