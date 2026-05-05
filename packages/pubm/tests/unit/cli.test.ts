import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsCI,
  mockChangesetSourceAnalyze,
  mockConventionalCommitSourceAnalyze,
  mockChangesetSourceCtor,
  mockConventionalCommitSourceCtor,
  mockMergeRecommendations,
  mockConsoleError,
  mockCreateContext,
  mockCreateVersionPlanFromManifestVersions,
  mockGitInstance,
  mockLoadConfig,
  mockApplyVersionSourcePlan,
  mockPubm,
  mockPubmVersion,
  mockRequiredMissingInformationTasks,
  mockResolveConfig,
  mockResolveOptions,
  mockNotifyNewVersion,
  sharedResolvedConfig,
} = vi.hoisted(() => {
  const mockChangesetSourceAnalyze = vi.fn(async () => []);
  const mockConventionalCommitSourceAnalyze = vi.fn(async () => []);
  const mockMergeRecommendations = vi.fn(() => []);
  const packageKey = (pkg: { path?: string; ecosystem?: string }) =>
    `${pkg.path ?? "."}::${pkg.ecosystem ?? "js"}`;
  const bumpVersion = (version: string, bump: string): string | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
    if (!match) return null;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (bump === "major") return `${major + 1}.0.0`;
    if (bump === "minor") return `${major}.${minor + 1}.0`;
    if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
    return `${major}.${minor}.${patch + 1}-0`;
  };
  const versioningMode = (config: any): "fixed" | "independent" | undefined =>
    config.release?.versioning?.mode ?? config.versioning;

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
        ecosystem: "js",
      },
    ],
  };

  const mockChangesetSourceCtor = vi.fn(function () {
    return { analyze: mockChangesetSourceAnalyze };
  });
  const mockConventionalCommitSourceCtor = vi.fn(function () {
    return { analyze: mockConventionalCommitSourceAnalyze };
  });
  const mockCreateVersionPlanFromManifestVersions = vi.fn((config: any) => {
    if (config.packages.length <= 1) {
      const pkg = config.packages[0];
      return {
        mode: "single",
        version: pkg?.version ?? "",
        packageKey: pkg ? packageKey(pkg) : ".",
      };
    }

    const packages = new Map(
      config.packages.map((pkg: any) => [packageKey(pkg), pkg.version]),
    );
    if (versioningMode(config) === "independent") {
      return { mode: "independent", packages };
    }
    return { mode: "fixed", version: [...packages.values()][0], packages };
  });
  const mockApplyVersionSourcePlan = vi.fn(async (ctx: any) => {
    const config = ctx.config;
    const sources = [
      new (mockChangesetSourceCtor as any)(),
      new (mockConventionalCommitSourceCtor as any)(),
    ];

    const sourceResults = [];
    for (const source of sources) {
      sourceResults.push(await source.analyze({ cwd: process.cwd() }));
    }
    const recommendations = mockMergeRecommendations(sourceResults);
    if (recommendations.length === 0) return;

    const packages = new Map<string, string>();
    for (const rec of recommendations) {
      const matchingPackages = config.packages.filter(
        (pkg: any) => pkg.path === rec.packagePath,
      );
      for (const pkg of matchingPackages) {
        const version = bumpVersion(pkg.version, rec.bumpType);
        if (version) packages.set(packageKey(pkg), version);
      }
    }

    if (packages.size === 1) {
      const [key, version] = [...packages.entries()][0];
      ctx.runtime.versionPlan = { mode: "single", version, packageKey: key };
    } else if (packages.size > 1) {
      ctx.runtime.versionPlan =
        versioningMode(config) === "fixed"
          ? { mode: "fixed", version: [...packages.values()][0], packages }
          : { mode: "independent", packages };
    }

    if (recommendations.some((rec: any) => rec.source === "changeset")) {
      ctx.runtime.changesetConsumed = true;
    }
  });

  return {
    mockIsCI: { isCI: false },
    mockChangesetSourceAnalyze,
    mockConventionalCommitSourceAnalyze,
    mockChangesetSourceCtor,
    mockConventionalCommitSourceCtor,
    mockMergeRecommendations,
    mockConsoleError: vi.fn(),
    mockCreateContext: vi.fn(createMockContext),
    mockCreateVersionPlanFromManifestVersions,
    mockGitInstance: { latestTag: vi.fn() },
    mockLoadConfig: vi.fn(),
    mockApplyVersionSourcePlan,
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

vi.mock("@cluvo/sdk", () => ({
  Reporter: vi.fn(function Reporter() {
    return {
      installExitHandler: vi.fn(),
      installGlobalHandlers: vi.fn(),
      reportError: vi.fn(async () => undefined),
      wrapCommand: vi.fn(async () => undefined),
    };
  }),
}));

vi.mock("@pubm/core", () => {
  return {
    consoleError: mockConsoleError,
    AbstractError: class extends Error {},
    Git: vi.fn(function () {
      return mockGitInstance;
    }),
    applyVersionSourcePlan: mockApplyVersionSourcePlan,
    createVersionPlanFromManifestVersions:
      mockCreateVersionPlanFromManifestVersions,
    ChangesetSource: mockChangesetSourceCtor,
    ConventionalCommitSource: mockConventionalCommitSourceCtor,
    mergeRecommendations: mockMergeRecommendations,
    createContext: mockCreateContext,
    initI18n: vi.fn(),
    loadConfig: mockLoadConfig,
    packageKey: vi.fn(
      (pkg: { path?: string; ecosystem?: string }) =>
        `${pkg.path ?? "."}::${pkg.ecosystem ?? "js"}`,
    ),
    pubm: mockPubm,
    PUBM_VERSION: mockPubmVersion,
    requiredMissingInformationTasks: mockRequiredMissingInformationTasks,
    resolveConfig: mockResolveConfig,
    resolveOptions: mockResolveOptions,
    resolvePhases: vi.fn((opts: any) => {
      if (
        opts.phase !== undefined &&
        opts.phase !== "prepare" &&
        opts.phase !== "publish"
      ) {
        throw new Error(
          `Invalid release phase "${opts.phase}". Use "prepare" or "publish".`,
        );
      }
      if (opts.phase) return [opts.phase];
      return ["prepare", "publish"];
    }),
    validateOptions: vi.fn((opts: any) => {
      if (
        opts.phase !== undefined &&
        opts.phase !== "prepare" &&
        opts.phase !== "publish"
      ) {
        throw new Error(
          `Invalid release phase "${opts.phase}". Use "prepare" or "publish".`,
        );
      }
    }),
    notifyNewVersion: mockNotifyNewVersion,
    t: vi.fn((key: string, values?: Record<string, unknown>) => {
      if (key === "cli.helpText.version") {
        return `Version can be: ${values?.types ?? ""}`;
      }
      if (key === "cli.option.phase") {
        return "Run one Split CI Release phase: prepare or publish. Omit for Direct Release.";
      }
      if (key === "error.cli.versionRequired") {
        return "Version must be set in the CI environment";
      }
      return values ? `${key} ${JSON.stringify(values)}` : key;
    }),
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

vi.mock("../../src/commands/workflow.js", () => ({
  registerWorkflowCommand: vi.fn(),
}));

vi.mock("../../src/commands/inspect.js", () => ({
  registerInspectCommand: vi.fn((_program: any, getConfig: () => any) => {
    getConfig();
  }),
}));

vi.mock("../../src/commands/migrate.js", () => ({
  registerMigrateCommand: vi.fn(),
}));

vi.mock("../../src/commands/setup-skills.js", () => ({
  registerSetupSkillsCommand: vi.fn(),
}));

vi.mock("../../src/commands/snapshot.js", () => ({
  registerSnapshotCommand: vi.fn((_program: any, getConfig: () => any) => {
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
  const program = createProgram(sharedResolvedConfig as any);
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
  mockChangesetSourceCtor.mockClear();
  mockConventionalCommitSourceCtor.mockClear();
  mockMergeRecommendations.mockReturnValue([]);
  mockApplyVersionSourcePlan.mockClear();
  mockCreateVersionPlanFromManifestVersions.mockClear();
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
      ecosystem: "js",
    },
  ];
  delete sharedResolvedConfig.versioning;
  delete sharedResolvedConfig.release;
});

describe("resolveCliOptions (tested through CLI action)", () => {
  it("sets the CLI version from package metadata", () => {
    const program = createProgram(sharedResolvedConfig as any);

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

  it("should keep GitHub Release enabled for Split CI Release publish", async () => {
    await run("--phase", "publish");

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "publish",
        skipReleaseDraft: false,
      }),
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
    const program = createProgram(sharedResolvedConfig as any);
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    program.outputHelp();

    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("Version can be:"),
    );
  });

  it("renders --phase as a Split CI Release phase selector", () => {
    const program = createProgram(sharedResolvedConfig as any);
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    program.outputHelp();

    const helpOutput = vi.mocked(writeSpy).mock.calls.join("\n");
    expect(helpOutput).toContain("--phase <phase>");
    expect(helpOutput).toContain("Run one Split CI Release phase");
    expect(helpOutput).not.toContain("--mode");
  });

  it("routes invalid --phase errors through formatted CLI reporting", async () => {
    await run("--phase", "bogus");

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Invalid release phase "bogus". Use "prepare" or "publish".',
      }),
    );
    expect(mockPubm).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("does not expose the legacy --create-pr option", () => {
    const program = createProgram(sharedResolvedConfig as any);
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as never);

    program.outputHelp();

    const helpOutput = vi.mocked(writeSpy).mock.calls.join("\n");
    expect(helpOutput).not.toContain("--create-pr");
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
      packageKey: ".::js",
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
        ecosystem: "js",
      },
      {
        name: "pkg-b",
        version: "1.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
    ];

    await run("2.0.0");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });
  });

  it("falls back to the root package key when explicit version is given without packages", async () => {
    mockIsCI.isCI = false;
    mockRequiredMissingInformationTasks.mockReturnValue({ run: vi.fn() });
    sharedResolvedConfig.packages = [];

    await run("2.0.0");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "2.0.0",
      packageKey: ".",
    });
  });
});

describe("CLI action handler - CI mode", () => {
  it("should read version from manifest when --phase publish is set", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "default-pkg",
        version: "2.0.0",
        path: ".",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "2.0.0",
      packageKey: ".::js",
    });
  });

  it("creates a fixed versionPlan from manifests for multi-package in --phase publish", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "2.0.0",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
      {
        name: "pkg-b",
        version: "2.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });
  });

  it("creates an independent versionPlan from manifests for independent versioning in --phase publish", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.versioning = "independent";
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
      {
        name: "pkg-b",
        version: "2.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });
  });

  it("prefers release.versioning.mode over legacy versioning in --phase publish mocks", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.versioning = "fixed";
    sharedResolvedConfig.release = {
      versioning: { mode: "independent" },
    };
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "1.0.0",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
      {
        name: "pkg-b",
        version: "2.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.0.0"],
        ["packages/b::js", "2.0.0"],
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

    await run("--phase", "publish");

    expect(mockNotifyNewVersion).not.toHaveBeenCalled();
  });

  it("should not call requiredMissingInformationTasks in CI mode", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("v2.0.0");

    await run("--phase", "publish");

    expect(mockRequiredMissingInformationTasks).not.toHaveBeenCalled();
  });

  it("runs prepare phase prompts in CI mode with --phase prepare", async () => {
    mockIsCI.isCI = true;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });

    await run("1.2.3", "--phase", "prepare");

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({ tag: "latest" }),
      }),
    );
    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "1.2.3",
      packageKey: ".::js",
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
        ecosystem: "js",
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
      packageKey: ".::js",
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
        ecosystem: "js",
      },
      {
        name: "pkg-b",
        version: "1.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
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
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
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
        ecosystem: "js",
      },
      {
        name: "pkg-b",
        version: "2.3.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
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
        ["packages/a::js", "1.1.0"],
        ["packages/b::js", "2.3.1"],
      ]),
    });
  });

  it("falls back to defaults when packages array is empty in --phase publish", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "",
      packageKey: ".",
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
        ecosystem: "js",
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
      packageKey: "packages/a::js",
    });
  });

  it("skips packages with invalid versions that produce null from semver.inc", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "pkg-a",
        version: "invalid",
        path: "packages/a",
        registries: ["npm"],
        dependencies: [],
      },
    ];
    mockMergeRecommendations.mockReturnValue([
      { packagePath: "packages/a", bumpType: "patch", source: "changeset" },
    ]);

    await run();

    expect(mockPubm).not.toHaveBeenCalled();
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Version must be set"),
      }),
    );
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
    expect(mockRequiredMissingInformationTasks).not.toHaveBeenCalled();
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
        ecosystem: "js",
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "single",
      version: "3.0.0",
      packageKey: ".::js",
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
        ecosystem: "js",
      },
      {
        name: "pkg-b",
        version: "2.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.0.0"],
        ["packages/b::js", "2.0.0"],
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
        ecosystem: "js",
      },
      {
        name: "pkg-b",
        version: "4.0.0",
        path: "packages/b",
        registries: ["npm"],
        dependencies: [],
        ecosystem: "js",
      },
    ];

    await run("--phase", "publish");

    const ctx = mockPubm.mock.calls[0][0];
    expect(ctx.runtime.versionPlan).toEqual({
      mode: "fixed",
      version: "4.0.0",
      packages: new Map([
        ["packages/a::js", "4.0.0"],
        ["packages/b::js", "4.0.0"],
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
      packageKey: ".",
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

  it("builds publish version plans from the overridden context config", async () => {
    mockIsCI.isCI = true;
    sharedResolvedConfig.packages = [
      {
        name: "my-pkg",
        version: "1.0.0",
        path: ".",
        registries: ["npm", "jsr", "crates"],
        dependencies: [],
        ecosystem: "js",
      },
    ];

    await run("--phase", "publish", "--registry", "npm");

    const ctx = mockPubm.mock.calls[0][0];
    expect(mockCreateVersionPlanFromManifestVersions).toHaveBeenCalledWith(
      ctx.config,
    );
    expect(ctx.config.packages[0].registries).toEqual(["npm"]);
  });
});

describe("CLI action handler - release sources", () => {
  it("always creates changeset and conventional commit sources", async () => {
    const { ChangesetSource, ConventionalCommitSource } = await import(
      "@pubm/core"
    );
    mockIsCI.isCI = true;
    mockMergeRecommendations.mockReturnValue([]);

    await run();

    expect(ChangesetSource).toHaveBeenCalled();
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
