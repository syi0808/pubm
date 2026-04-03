import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsCI,
  mockChangesetSourceAnalyze,
  mockConventionalCommitSourceAnalyze,
  mockMergeRecommendations,
  mockConsoleError,
  mockCreateContext,
  mockGitInstance,
  mockLoadConfig,
  mockPubm,
  mockPubmVersion,
  mockRequiredMissingInformationTasks,
  mockResolveConfig,
  mockResolveOptions,
  mockNotifyNewVersion,
  sharedResolvedConfig,
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

  const sharedResolvedConfig: Record<string, any> = {
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
    versionSources: "all",
  };

  return {
    mockIsCI: { isCI: false },
    mockChangesetSourceAnalyze: vi.fn(async () => []),
    mockConventionalCommitSourceAnalyze: vi.fn(async () => []),
    mockMergeRecommendations: vi.fn(() => []),
    mockConsoleError: vi.fn(),
    mockCreateContext: vi.fn(createMockContext),
    mockGitInstance: { latestTag: vi.fn() },
    mockLoadConfig: vi.fn(),
    mockPubm: vi.fn(),
    mockPubmVersion: "1.0.0",
    mockRequiredMissingInformationTasks: vi.fn(() => ({ run: vi.fn() })),
    mockResolveConfig: vi.fn(async (_raw: any) => sharedResolvedConfig),
    mockResolveOptions: vi.fn((opts: any) => ({
      testScript: "test",
      buildScript: "build",
      branch: "main",
      tag: "latest",
      saveToken: true,
      ...opts,
    })),
    mockNotifyNewVersion: vi.fn(),
    sharedResolvedConfig,
  };
});

vi.mock("std-env", () => mockIsCI);

vi.mock("@pubm/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pubm/core")>();
  return {
    ...actual,
    consoleError: mockConsoleError,
    AbstractError: class extends Error {},
    Git: vi.fn(function () {
      return mockGitInstance;
    }),
    ChangesetSource: vi.fn(function () {
      return { analyze: mockChangesetSourceAnalyze };
    }),
    ConventionalCommitSource: vi.fn(function () {
      return { analyze: mockConventionalCommitSourceAnalyze };
    }),
    mergeRecommendations: mockMergeRecommendations,
    createContext: mockCreateContext,
    loadConfig: mockLoadConfig,
    pubm: mockPubm,
    PUBM_VERSION: mockPubmVersion,
    requiredMissingInformationTasks: mockRequiredMissingInformationTasks,
    resolveConfig: mockResolveConfig,
    resolveOptions: mockResolveOptions,
    resolvePhases: vi.fn((opts: any) => {
      const mode = opts.mode ?? "local";
      if (opts.prepare && opts.publish) {
        throw new Error("Cannot specify both --prepare and --publish.");
      }
      if (mode === "ci" && !opts.prepare && !opts.publish) {
        throw new Error("CI mode requires --prepare or --publish.");
      }
      if (opts.prepare) return ["prepare"];
      if (opts.publish) return ["publish"];
      return ["prepare", "publish"];
    }),
    validateOptions: vi.fn((opts: any) => {
      const mode = opts.mode ?? "local";
      if (opts.prepare && opts.publish) {
        throw new Error("Cannot specify both --prepare and --publish.");
      }
      if (mode === "ci" && !opts.prepare && !opts.publish) {
        throw new Error("CI mode requires --prepare or --publish.");
      }
    }),
    notifyNewVersion: mockNotifyNewVersion,
    ui: {
      success: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      hint: vi.fn(),
      labels: { DRY_RUN: "[dry-run]" },
      chalk: { level: 3 },
    },
  };
});

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

vi.mock("../../src/commands/inspect.js", () => ({
  registerInspectCommand: vi.fn((_program: any, getConfig: () => any) => {
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
  mockChangesetSourceAnalyze.mockResolvedValue([]);
  mockConventionalCommitSourceAnalyze.mockResolvedValue([]);
  mockMergeRecommendations.mockReturnValue([]);
  mockLoadConfig.mockReset();
  mockPubm.mockResolvedValue(undefined);
  vi.spyOn(console, "clear").mockImplementation(() => {});
  process.exitCode = undefined;

  // Reset shared config to default single-package state
  sharedResolvedConfig.plugins = [];
  sharedResolvedConfig.packages = [
    {
      name: "default-pkg",
      version: "0.0.0",
      path: ".",
      registries: ["npm"],
      dependencies: [],
    },
  ];
  sharedResolvedConfig.versionSources = "all";
  delete sharedResolvedConfig.versioning;
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

  it("should map --skip-release to skipReleaseDraft=true", async () => {
    await run("1.0.0", "--skip-release");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ skipReleaseDraft: true }),
    );
  });

  it("should default skipReleaseDraft to false when no release flags are passed", async () => {
    await run("1.0.0");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ skipReleaseDraft: false }),
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

  it("sets NO_COLOR and chalk level to 0 when --no-color is passed", async () => {
    const { ui: mockUi } = await import("@pubm/core");
    const originalNoColor = process.env.NO_COLOR;

    await run("1.0.0", "--no-color");

    expect(process.env.NO_COLOR).toBe("1");
    expect(mockUi.chalk.level).toBe(0);

    // Restore
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
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

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "1.2.3",
      packagePath: ".",
    });
  });

  it("should call console.clear at the start", async () => {
    const clearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});

    await run("1.0.0");

    expect(clearSpy).toHaveBeenCalled();
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

  it("creates a fixed versionPlan for multi-package configs when version is given", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });
    sharedResolvedConfig.packages = [
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
    ];

    await run("2.0.0");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a", "2.0.0"],
        ["packages/b", "2.0.0"],
      ]),
    });
  });
});

describe("CLI action handler - CI mode", () => {
  it("should read version from manifest when --mode ci --phase publish is set", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "default-pkg",
        version: "2.0.0",
        path: ".",
        registries: ["npm"],
        dependencies: [],
      },
    ];

    await run("--mode", "ci", "--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "2.0.0",
      packagePath: ".",
    });
  });

  it("creates a fixed versionPlan from manifests for multi-package in --mode ci --phase publish", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "2.0.0",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
      },
      {
        name: "pkg-b",
        version: "2.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
      },
    ];

    await run("--mode", "ci", "--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a", "2.0.0"],
        ["packages/b", "2.0.0"],
      ]),
    });
  });

  it("creates an independent versionPlan from manifests for independent versioning in --mode ci --phase publish", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.versioning = "independent";
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
      },
      {
        name: "pkg-b",
        version: "2.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
      },
    ];

    await run("--mode", "ci", "--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a", "1.0.0"],
        ["packages/b", "2.0.0"],
      ]),
    });
  });

  it("should throw when version not provided and no phase set in CI", async () => {
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

    await run("--mode", "ci", "--phase", "publish");

    expect(mockNotifyNewVersion).not.toHaveBeenCalled();
  });

  it("should not call requiredMissingInformationTasks in CI mode", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("v2.0.0");

    await run("--mode", "ci", "--phase", "publish");

    expect(mockRequiredMissingInformationTasks).not.toHaveBeenCalled();
  });

  it("runs prepare phase prompts in CI mode with --mode ci --phase prepare", async () => {
    mockIsCI.isCI = true;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });

    await run("1.2.3", "--mode", "ci", "--phase", "prepare");

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({ tag: "latest" }),
      }),
    );
    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "1.2.3",
      packagePath: ".",
    });
  });

  it("derives the next version from a single pending changeset in CI", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: ".",
        registries: ["npm"],
        dependencies: [],
      },
    ];
    mockMergeRecommendations.mockReturnValue([
      { packagePath: ".", bumpType: "minor", source: "changeset" },
    ]);

    await run();

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.changesetConsumed).toBe(true);
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "1.1.0",
      packagePath: ".",
    });
  });

  it("passes synchronized versions to pubm for fixed-version workspaces in CI", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.versioning = "fixed";
    sharedResolvedConfig.packages = [
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
    ];
    mockMergeRecommendations.mockReturnValue([
      { packagePath: "packages/a", bumpType: "major", source: "changeset" },
      { packagePath: "packages/b", bumpType: "major", source: "changeset" },
    ]);

    await run();

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.changesetConsumed).toBe(true);
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a", "2.0.0"],
        ["packages/b", "2.0.0"],
      ]),
    });
  });

  it("keeps per-package versions for independent workspaces in CI", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.versioning = "independent";
    sharedResolvedConfig.packages = [
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
    ];
    mockMergeRecommendations.mockReturnValue([
      { packagePath: "packages/a", bumpType: "minor", source: "changeset" },
      { packagePath: "packages/b", bumpType: "patch", source: "changeset" },
    ]);

    await run();

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.changesetConsumed).toBe(true);
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a", "1.1.0"],
        ["packages/b", "2.3.1"],
      ]),
    });
  });

  it("falls back to defaults when packages array is empty in --phase publish", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [];

    await run("--mode", "ci", "--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "",
      packagePath: ".",
    });
  });

  it("skips recommendations for unknown package paths", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
      },
    ];
    mockMergeRecommendations.mockReturnValue([
      // unknown path not in currentVersions map — should be skipped
      {
        packagePath: "packages/unknown",
        bumpType: "major",
        source: "changeset",
      },
      // known path
      { packagePath: "packages/a", bumpType: "major", source: "changeset" },
    ]);

    await run();

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.changesetConsumed).toBe(true);
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "2.0.0",
      packagePath: "packages/a",
    });
  });

  it("allows explicit CI versions when pending changesets do not produce a bump", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: ".",
        registries: ["npm"],
        dependencies: [],
      },
    ];
    // mergeRecommendations returns empty — no recommendations
    mockMergeRecommendations.mockReturnValue([]);

    await run("3.4.5");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.changesetConsumed).toBeUndefined();
    expect(ctx.runtime.versionPlan).toMatchObject({ version: "3.4.5" });
  });
});

describe("CLI action handler - local publish-only mode", () => {
  it("reads version from manifest for single package with --phase publish", async () => {
    sharedResolvedConfig.packages = [
      {
        name: "my-pkg",
        version: "3.0.0",
        path: ".",
        registries: ["npm"],
        dependencies: [],
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "3.0.0",
      packagePath: ".",
    });
  });

  it("creates an independent versionPlan for independent versioning with --phase publish", async () => {
    sharedResolvedConfig.versioning = "independent";
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
      },
      {
        name: "pkg-b",
        version: "2.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a", "1.0.0"],
        ["packages/b", "2.0.0"],
      ]),
    });
  });

  it("creates a fixed versionPlan for multi-package with --phase publish", async () => {
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "4.0.0",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
      },
      {
        name: "pkg-b",
        version: "4.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "4.0.0",
      packages: new Map([
        ["packages/a", "4.0.0"],
        ["packages/b", "4.0.0"],
      ]),
    });
  });

  it("falls back to defaults when packages array is empty with --phase publish", async () => {
    sharedResolvedConfig.packages = [];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "",
      packagePath: ".",
    });
  });
});

describe("CLI action handler - dangerouslyAllowUnpublish", () => {
  it("sets dangerouslyAllowUnpublish on config when flag is passed", async () => {
    mockIsCI.isCI = false;
    mockRequiredMissingInformationTasks.mockReturnValue({ run: vi.fn() });

    await run("1.0.0", "--dangerously-allow-unpublish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.config.rollback?.dangerouslyAllowUnpublish).toBe(true);
  });
});

describe("CLI action handler - registry filtering", () => {
  it("filters package registries when --registry is passed", async () => {
    mockIsCI.isCI = false;
    mockRequiredMissingInformationTasks.mockReturnValue({ run: vi.fn() });
    sharedResolvedConfig.packages = [
      {
        name: "my-pkg",
        version: "1.0.0",
        path: ".",
        registries: ["npm", "jsr", "crates"],
        dependencies: [],
      },
    ];

    await run("1.0.0", "--registry", "npm,jsr");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.config.packages[0].registries).toEqual(["npm", "jsr"]);
  });
});

describe("CLI action handler - version source variants", () => {
  it("only creates ChangesetSource when versionSources is 'changesets'", async () => {
    const { ChangesetSource, ConventionalCommitSource } = await import(
      "@pubm/core"
    );
    mockIsCI.isCI = true;
    sharedResolvedConfig.versionSources = "changesets";
    mockMergeRecommendations.mockReturnValue([]);

    await run();

    expect(ChangesetSource).toHaveBeenCalled();
    expect(ConventionalCommitSource).not.toHaveBeenCalled();
  });

  it("only creates ConventionalCommitSource when versionSources is 'commits'", async () => {
    const { ChangesetSource, ConventionalCommitSource } = await import(
      "@pubm/core"
    );
    mockIsCI.isCI = true;
    sharedResolvedConfig.versionSources = "commits";
    mockMergeRecommendations.mockReturnValue([]);

    await run();

    expect(ChangesetSource).not.toHaveBeenCalled();
    expect(ConventionalCommitSource).toHaveBeenCalled();
  });

  it("does not set changesetConsumed when recommendations come from non-changeset source", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: ".",
        registries: ["npm"],
        dependencies: [],
      },
    ];
    mockMergeRecommendations.mockReturnValue([
      { packagePath: ".", bumpType: "minor", source: "conventional-commit" },
    ]);

    await run();

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.changesetConsumed).toBeUndefined();
  });
});

describe("CLI action handler - splash screen", () => {
  it("does not show splash when stderr is not a TTY", async () => {
    mockIsCI.isCI = false;
    const origTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", {
      value: false,
      configurable: true,
    });
    try {
      await run("1.0.0");
      expect(mockShowSplash).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stderr, "isTTY", {
        value: origTTY,
        configurable: true,
      });
    }
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
