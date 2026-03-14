import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsCI,
  mockCalculateVersionBumps,
  mockConsoleError,
  mockCreateContext,
  mockGitInstance,
  mockGetStatus,
  mockLoadConfig,
  mockPubm,
  mockPubmVersion,
  mockRequiredMissingInformationTasks,
  mockResolveConfig,
  mockResolveOptions,
  mockNotifyNewVersion,
} = vi.hoisted(() => {
  const createMockContext = (config: any, options: any, cwd: string): any => ({
    config: config ?? {},
    options: options ?? {},
    cwd,
    runtime: {
      tag: options?.tag ?? "latest",
      promptEnabled: false,
      cleanWorkingTree: false,
      pluginRunner: { run: vi.fn() },
    },
  });

  return {
    mockIsCI: { isCI: false },
    mockCalculateVersionBumps: vi.fn(),
    mockConsoleError: vi.fn(),
    mockCreateContext: vi.fn(createMockContext),
    mockGitInstance: { latestTag: vi.fn() },
    mockGetStatus: vi.fn(() => ({
      hasChangesets: false,
      changesets: [] as string[],
    })),
    mockLoadConfig: vi.fn(),
    mockPubm: vi.fn(),
    mockPubmVersion: "1.0.0",
    mockRequiredMissingInformationTasks: vi.fn(() => ({ run: vi.fn() })),
    mockResolveConfig: vi.fn(async (raw: any) => ({
      plugins: [],
      packages: [
        {
          name: "default-pkg",
          version: "0.0.0",
          path: ".",
          registries: ["npm"],
          dependencies: [],
        },
      ],
      ...raw,
    })),
    mockResolveOptions: vi.fn((opts: any) => ({
      testScript: "test",
      buildScript: "build",
      branch: "main",
      tag: "latest",
      saveToken: true,
      ...opts,
    })),
    mockNotifyNewVersion: vi.fn(),
  };
});

vi.mock("std-env", () => mockIsCI);

vi.mock("@pubm/core", () => ({
  consoleError: mockConsoleError,
  AbstractError: class extends Error {},
  Git: vi.fn(function () {
    return mockGitInstance;
  }),
  calculateVersionBumps: mockCalculateVersionBumps,
  createContext: mockCreateContext,
  getStatus: mockGetStatus,
  loadConfig: mockLoadConfig,
  pubm: mockPubm,
  PUBM_VERSION: mockPubmVersion,
  requiredMissingInformationTasks: mockRequiredMissingInformationTasks,
  resolveConfig: mockResolveConfig,
  resolveOptions: mockResolveOptions,
  notifyNewVersion: mockNotifyNewVersion,
}));

vi.mock("../../src/commands/changesets.js", () => ({
  registerChangesetsCommand: vi.fn((_program: any, getConfig: () => any) => {
    getConfig();
  }),
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

vi.mock("../../src/commands/version-cmd.js", () => ({
  registerVersionCommand: vi.fn((_program: any, getConfig: () => any) => {
    getConfig();
  }),
}));

const mockShowSplash = vi.hoisted(() => vi.fn());
vi.mock("../../src/splash.js", () => ({
  showSplash: mockShowSplash,
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
  mockGitInstance.latestTag.mockReset();
  mockGetStatus.mockReturnValue({ hasChangesets: false, changesets: [] });
  mockCalculateVersionBumps.mockReset();
  mockLoadConfig.mockReset();
  mockPubm.mockResolvedValue(undefined);
  vi.spyOn(console, "clear").mockImplementation(() => {});
  process.exitCode = undefined;
});

describe("resolveCliOptions (tested through CLI action)", () => {
  it("sets the CLI version from package metadata", () => {
    const program = createProgram();

    expect(program.version()).toBe(mockPubmVersion);
  });

  it("should map --no-publish to skipPublish=true", async () => {
    await run("1.0.0", "--no-publish");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ skipPublish: true }),
    );
  });

  it("should map --no-tests to skipTests=true", async () => {
    await run("1.0.0", "--no-tests");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ skipTests: true }),
    );
  });

  it("should map --no-build to skipBuild=true", async () => {
    await run("1.0.0", "--no-build");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ skipBuild: true }),
    );
  });

  it("should map --no-release-draft to skipReleaseDraft=true", async () => {
    await run("1.0.0", "--no-release-draft");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ skipReleaseDraft: true }),
    );
  });

  it("should map --no-pre-check to skipPrerequisitesCheck=true", async () => {
    await run("1.0.0", "--no-pre-check");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ skipPrerequisitesCheck: true }),
    );
  });

  it("should map --no-condition-check to skipConditionsCheck=true", async () => {
    await run("1.0.0", "--no-condition-check");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ skipConditionsCheck: true }),
    );
  });

  it("renders trailing help text describing accepted version formats", () => {
    const program = createProgram();
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    program.outputHelp();

    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("Version can be:"),
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
      expect.objectContaining({
        runtime: expect.objectContaining({ tag: "latest" }),
      }),
    );
  });

  it("should call pubm with context containing version after interactive tasks", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });

    await run("1.2.3");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({ version: "1.2.3" }),
      }),
    );
  });

  it("should call console.clear at the start", async () => {
    const clearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});

    await run("1.0.0");

    expect(clearSpy).toHaveBeenCalled();
  });

  it("uses the default snapshot tag when --snapshot has no explicit value", async () => {
    await run("--snapshot");

    expect(mockNotifyNewVersion).toHaveBeenCalledOnce();
    expect(mockRequiredMissingInformationTasks).not.toHaveBeenCalled();
    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          version: "snapshot",
          tag: "snapshot",
        }),
      }),
    );
  });

  it("passes an explicit snapshot tag through to pubm", async () => {
    await run("--snapshot", "canary");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          version: "snapshot",
          tag: "canary",
        }),
      }),
    );
  });

  it("shows splash when stderr is a TTY and not CI", async () => {
    mockIsCI.isCI = false;
    const origTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      await run("1.0.0");
      expect(mockShowSplash).toHaveBeenCalledWith(mockPubmVersion);
    } finally {
      Object.defineProperty(process.stderr, "isTTY", {
        value: origTTY,
        configurable: true,
      });
    }
  });

  it("rejects --snapshot and --preflight when used together", async () => {
    await expect(run("--snapshot", "--preflight")).rejects.toThrow(
      "Cannot use --snapshot and --preflight together.",
    );
    expect(mockPubm).not.toHaveBeenCalled();
  });
});

describe("CLI action handler - CI mode", () => {
  it("should get version from latest git tag when --publish-only is set", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("v2.0.0");

    await run("--publish-only");

    expect(mockGitInstance.latestTag).toHaveBeenCalled();
    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({ version: "2.0.0" }),
      }),
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

  it("runs preflight prompts even in CI mode", async () => {
    mockIsCI.isCI = true;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });

    await run("1.2.3", "--preflight");

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({ version: "1.2.3", tag: "latest" }),
      }),
    );
    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({ version: "1.2.3" }),
      }),
    );
  });

  it("derives the next version from a single pending changeset in CI", async () => {
    mockIsCI.isCI = true;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGetStatus.mockReturnValue({
      hasChangesets: true,
      changesets: ["a.md"],
    });
    mockResolveConfig.mockResolvedValue({
      plugins: [],
      packages: [
        {
          name: "pkg-a",
          version: "1.0.0",
          path: ".",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    });
    mockCalculateVersionBumps.mockReturnValue(
      new Map([
        [
          "pkg-a",
          { currentVersion: "1.0.0", newVersion: "1.1.0", bumpType: "minor" },
        ],
      ]),
    );

    await run();

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          version: "1.1.0",
          changesetConsumed: true,
        }),
      }),
    );
    // versions should not be set for single-package
    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versions).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith("Changesets detected:");
    expect(logSpy).toHaveBeenCalledWith("  pkg-a: 1.0.0 → 1.1.0 (minor)");
  });

  it("passes synchronized versions to pubm for fixed-version workspaces in CI", async () => {
    mockIsCI.isCI = true;
    mockGetStatus.mockReturnValue({
      hasChangesets: true,
      changesets: ["a.md"],
    });
    mockCalculateVersionBumps.mockReturnValue(
      new Map([
        [
          "pkg-a",
          { currentVersion: "1.0.0", newVersion: "2.0.0", bumpType: "major" },
        ],
        [
          "pkg-b",
          { currentVersion: "1.0.0", newVersion: "2.0.0", bumpType: "major" },
        ],
      ]),
    );
    mockResolveConfig.mockResolvedValue({
      plugins: [],
      versioning: "fixed",
      packages: [
        {
          name: "pkg-a",
          version: "1.0.0",
          path: "packages/a",
          registries: ["npm"],
          dependencies: [],
        },
        {
          name: "pkg-b",
          version: "1.0.0",
          path: "packages/b",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    });

    await run();

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          version: "2.0.0",
          changesetConsumed: true,
          versions: new Map([
            ["pkg-a", "2.0.0"],
            ["pkg-b", "2.0.0"],
          ]),
        }),
      }),
    );
  });

  it("keeps per-package versions for independent workspaces in CI", async () => {
    mockIsCI.isCI = true;
    mockGetStatus.mockReturnValue({
      hasChangesets: true,
      changesets: ["a.md"],
    });
    mockCalculateVersionBumps.mockReturnValue(
      new Map([
        [
          "pkg-a",
          { currentVersion: "1.0.0", newVersion: "1.1.0", bumpType: "minor" },
        ],
        [
          "pkg-b",
          { currentVersion: "2.3.0", newVersion: "2.3.1", bumpType: "patch" },
        ],
      ]),
    );
    mockResolveConfig.mockResolvedValue({
      plugins: [],
      versioning: "independent",
      packages: [
        {
          name: "pkg-a",
          version: "1.0.0",
          path: "packages/a",
          registries: ["npm"],
          dependencies: [],
        },
        {
          name: "pkg-b",
          version: "2.3.0",
          path: "packages/b",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    });

    await run();

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          version: "1.1.0",
          changesetConsumed: true,
          versions: new Map([
            ["pkg-a", "1.1.0"],
            ["pkg-b", "2.3.1"],
          ]),
        }),
      }),
    );
  });

  it("allows explicit CI versions when pending changesets do not produce a bump", async () => {
    mockIsCI.isCI = true;
    mockGetStatus.mockReturnValue({
      hasChangesets: true,
      changesets: ["a.md"],
    });
    mockResolveConfig.mockResolvedValue({
      plugins: [],
      packages: [
        {
          name: "pkg-a",
          version: "1.0.0",
          path: ".",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    });
    mockCalculateVersionBumps.mockReturnValue(new Map());

    await run("3.4.5");

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          version: "3.4.5",
        }),
      }),
    );
    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.changesetConsumed).toBeUndefined();
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
