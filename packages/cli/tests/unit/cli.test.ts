import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsCI,
  mockConsoleError,
  mockGitInstance,
  mockPubm,
  mockRequiredMissingInformationTasks,
  mockNotifyNewVersion,
} = vi.hoisted(() => {
  return {
    mockIsCI: { isCI: false },
    mockConsoleError: vi.fn(),
    mockGitInstance: { latestTag: vi.fn() },
    mockPubm: vi.fn(),
    mockRequiredMissingInformationTasks: vi.fn(() => ({ run: vi.fn() })),
    mockNotifyNewVersion: vi.fn(),
  };
});

vi.mock("std-env", () => mockIsCI);

vi.mock("@pubm/core", () => ({
  consoleError: mockConsoleError,
  AbstractError: class extends Error {},
  Git: vi.fn(() => mockGitInstance),
  pubm: mockPubm,
  requiredMissingInformationTasks: mockRequiredMissingInformationTasks,
  notifyNewVersion: mockNotifyNewVersion,
  version: vi.fn().mockResolvedValue("1.0.0"),
  calculateVersionBumps: vi.fn(),
  discoverCurrentVersions: vi.fn(),
  getStatus: vi.fn(() => ({ hasChangesets: false, changesets: [] })),
  loadConfig: vi.fn(),
}));

vi.mock("../../src/commands/changesets.js", () => ({
  registerChangesetsCommand: vi.fn(),
}));

vi.mock("../../src/commands/init.js", () => ({
  registerInitCommand: vi.fn(),
}));

vi.mock("../../src/commands/update.js", () => ({
  registerUpdateCommand: vi.fn(),
}));

vi.mock("../../src/commands/secrets.js", () => ({
  registerSecretsCommand: vi.fn(),
}));

vi.mock("../../src/commands/sync.js", () => ({
  registerSyncCommand: vi.fn(),
}));

import type { Command } from "commander";
import { createProgram } from "../../src/cli.js";

async function run(...args: string[]): Promise<Command> {
  const program = createProgram();
  program.exitOverride();
  await program.parseAsync(["node", "pubm", ...args]);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCI.isCI = false;
  vi.spyOn(console, "clear").mockImplementation(() => {});
  process.exitCode = undefined;
});

describe("resolveCliOptions (tested through CLI action)", () => {
  it("should map --no-publish to skipPublish=true", async () => {
    await run("1.0.0", "--no-publish");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipPublish: true }),
    );
  });

  it("should map --no-tests to skipTests=true", async () => {
    await run("1.0.0", "--no-tests");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipTests: true }),
    );
  });

  it("should map --no-build to skipBuild=true", async () => {
    await run("1.0.0", "--no-build");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipBuild: true }),
    );
  });

  it("should map --no-release-draft to skipReleaseDraft=true", async () => {
    await run("1.0.0", "--no-release-draft");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipReleaseDraft: true }),
    );
  });

  it("should map --no-pre-check to skipPrerequisitesCheck=true", async () => {
    await run("1.0.0", "--no-pre-check");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipPrerequisitesCheck: true }),
    );
  });

  it("should map --no-condition-check to skipConditionsCheck=true", async () => {
    await run("1.0.0", "--no-condition-check");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipConditionsCheck: true }),
    );
  });

  it("should split comma-separated registry string into array", async () => {
    await run("1.0.0", "--registry", "npm,jsr,https://custom.registry.com");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        registries: ["npm", "jsr", "https://custom.registry.com"],
      }),
    );
  });

  it("should use default registry value when --registry is not provided", async () => {
    await run("1.0.0");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        registries: ["npm", "jsr"],
      }),
    );
  });
});

describe("CLI action handler - non-CI mode", () => {
  it("should call notifyNewVersion when not in CI", async () => {
    mockIsCI.isCI = false;

    await run("1.0.0");

    expect(mockNotifyNewVersion).toHaveBeenCalledOnce();
  });

  it("should run requiredMissingInformationTasks when not in CI", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });

    await run("1.0.0");

    expect(mockRequiredMissingInformationTasks).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "latest" }),
    );
  });

  it("should call pubm with resolved options after interactive tasks", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });

    await run("1.2.3");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ version: "1.2.3" }),
    );
  });

  it("should call console.clear at the start", async () => {
    const clearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});

    await run("1.0.0");

    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("CLI action handler - CI mode", () => {
  it("should get version from latest git tag when --publish-only is set", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("v2.0.0");

    await run("--publish-only");

    expect(mockGitInstance.latestTag).toHaveBeenCalled();
    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ version: "2.0.0" }),
    );
  });

  it("should throw when no latest tag exists in --publish-only mode", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue(null);

    await run("--publish-only");

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Cannot find the latest tag"),
      }),
    );
  });

  it("should throw when latest tag is not valid semver in --publish-only mode", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("vnot-semver");

    await run("--publish-only");

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Cannot parse the latest tag"),
      }),
    );
  });

  it("should throw when version not provided and not --publish-only in CI", async () => {
    mockIsCI.isCI = true;

    await run();

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Version must be set in the CI environment",
        ),
      }),
    );
  });

  it("should not call notifyNewVersion in CI mode", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("v2.0.0");

    await run("--publish-only");

    expect(mockNotifyNewVersion).not.toHaveBeenCalled();
  });

  it("should not call requiredMissingInformationTasks in CI mode", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("v2.0.0");

    await run("--publish-only");

    expect(mockRequiredMissingInformationTasks).not.toHaveBeenCalled();
  });
});

describe("CLI action handler - error handling", () => {
  it("should call consoleError when pubm throws", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });
    const error = new Error("publish failed");
    mockPubm.mockRejectedValue(error);

    await run("1.0.0");

    expect(mockConsoleError).toHaveBeenCalledWith(error);
  });

  it("should set process.exitCode to 1 when an error occurs", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });
    const error = new Error("publish failed");
    mockPubm.mockRejectedValue(error);

    await run("1.0.0");

    expect(process.exitCode).toBe(1);
  });

  it("should call consoleError when requiredMissingInformationTasks throws", async () => {
    mockIsCI.isCI = false;
    const error = new Error("interactive task failed");
    mockRequiredMissingInformationTasks.mockReturnValue({
      run: vi.fn().mockRejectedValue(error),
    });

    await run("1.0.0");

    expect(mockConsoleError).toHaveBeenCalledWith(error);
  });
});
