import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@listr2/prompt-adapter-enquirer", () => ({
  ListrEnquirerPromptAdapter: vi.fn(),
}));
vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
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
vi.mock("../../../src/registry/npm.js", () => ({
  npmRegistry: vi.fn(),
}));
vi.mock("../../../src/registry/jsr.js", () => ({
  jsrRegistry: vi.fn(),
}));
vi.mock("../../../src/registry/crates.js", () => ({
  CratesRegistry: vi.fn(),
}));
vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: vi.fn(),
}));

import { RustEcosystem } from "../../../src/ecosystem/rust.js";
import { CratesRegistry } from "../../../src/registry/crates.js";
import { jsrRegistry } from "../../../src/registry/jsr.js";
import { npmRegistry } from "../../../src/registry/npm.js";
import {
  cratesDryRunPublishTask,
  createCratesDryRunPublishTask,
  jsrDryRunPublishTask,
  npmDryRunPublishTask,
} from "../../../src/tasks/dry-run-publish.js";
import { Db } from "../../../src/utils/db.js";

const mockedNpmRegistry = vi.mocked(npmRegistry);
const mockedJsrRegistry = vi.mocked(jsrRegistry);
const mockedCratesRegistry = vi.mocked(CratesRegistry);
const mockedRustEcosystem = vi.mocked(RustEcosystem);
const mockedDb = vi.mocked(Db);

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.mockImplementation(() => ({ get: vi.fn(), set: vi.fn() }) as any);
});

describe("npmDryRunPublishTask", () => {
  it("has correct title", () => {
    expect(npmDryRunPublishTask.title).toBe("Dry-run npm publish");
  });

  it("calls dryRunPublish on npm registry", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
    } as any);

    await (npmDryRunPublishTask as any).task({}, { output: "" });
    expect(mockDryRun).toHaveBeenCalled();
  });
});

describe("jsrDryRunPublishTask", () => {
  it("has correct title", () => {
    expect(jsrDryRunPublishTask.title).toBe("Dry-run jsr publish");
  });

  it("calls dryRunPublish on jsr registry", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedJsrRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
    } as any);

    await (jsrDryRunPublishTask as any).task({}, { output: "" });
    expect(mockDryRun).toHaveBeenCalled();
  });
});

describe("cratesDryRunPublishTask", () => {
  it("has correct title", () => {
    expect(cratesDryRunPublishTask.title).toBe("Dry-run crates.io publish");
  });
});

describe("createCratesDryRunPublishTask", () => {
  it("includes package path in title", () => {
    const task = createCratesDryRunPublishTask("packages/my-crate");
    expect(task.title).toBe("Dry-run crates.io publish (packages/my-crate)");
  });

  it("calls dryRunPublish with manifestDir", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedRustEcosystem.mockImplementation(
      () =>
        ({
          packageName: vi.fn().mockResolvedValue("my-crate"),
        }) as any,
    );
    mockedCratesRegistry.mockImplementation(
      () => ({ dryRunPublish: mockDryRun }) as any,
    );

    const task = createCratesDryRunPublishTask("packages/my-crate");
    await (task as any).task({}, { output: "" });
    expect(mockDryRun).toHaveBeenCalledWith("packages/my-crate");
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
    } as any);

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await (npmDryRunPublishTask as any).task({}, mockTask);

    expect(mockDryRun).toHaveBeenCalledTimes(2);
    expect(process.env.NODE_AUTH_TOKEN).toBe("new-token");

    // cleanup
    delete process.env.NODE_AUTH_TOKEN;
  });

  it("throws non-auth errors without retry", async () => {
    const mockDryRun = vi.fn().mockRejectedValue(new Error("network timeout"));
    mockedNpmRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
    } as any);

    const mockTask = { output: "", prompt: vi.fn() };

    await expect(
      (npmDryRunPublishTask as any).task({}, mockTask),
    ).rejects.toThrow("network timeout");

    expect(mockDryRun).toHaveBeenCalledTimes(1);
    expect(mockTask.prompt).not.toHaveBeenCalled();
  });

  it("saves new token to Db on retry", async () => {
    const mockDryRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("403 forbidden"))
      .mockResolvedValueOnce(undefined);
    mockedJsrRegistry.mockResolvedValue({
      dryRunPublish: mockDryRun,
    } as any);

    const mockDbSet = vi.fn();
    mockedDb.mockImplementation(
      () => ({ get: vi.fn(), set: mockDbSet }) as any,
    );

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("fresh-jsr-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    await (jsrDryRunPublishTask as any).task({}, mockTask);

    expect(mockDbSet).toHaveBeenCalledWith("jsr-token", "fresh-jsr-token");

    // cleanup
    delete process.env.JSR_TOKEN;
  });
});
