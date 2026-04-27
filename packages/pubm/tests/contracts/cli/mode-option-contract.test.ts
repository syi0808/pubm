import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SemanticSideEffect {
  kind: string;
  target: string;
  detail?: Record<string, unknown>;
}

interface SemanticEvent {
  name: string;
  target?: string;
  detail?: Record<string, unknown>;
}

interface SemanticFact {
  name: string;
  value: unknown;
}

interface SemanticLedger {
  events: SemanticEvent[];
  decisions: SemanticFact[];
  facts: SemanticFact[];
  sideEffects: SemanticSideEffect[];
  forbiddenSideEffects: SemanticSideEffect[];
  finalState: Record<string, unknown>;
}

interface ContractPackage {
  name: string;
  version: string;
  path: string;
  registries: string[];
  dependencies: string[];
  ecosystem: string;
}

interface CliContractScenario {
  id: string;
  description: string;
  argv: string[];
  env: {
    isCI: boolean;
  };
  config: Record<string, any>;
  recommendations?: {
    changesets?: Array<Record<string, unknown>>;
    commits?: Array<Record<string, unknown>>;
    merged?: Array<Record<string, unknown>>;
  };
  expected: {
    options: Record<string, unknown>;
    versionPlan?: Record<string, unknown>;
    registries?: Record<string, string[]>;
    rollback?: Record<string, unknown>;
    requiredTasksRun?: boolean;
    pubmCalled: boolean;
    exitCode?: number;
    errorMessage?: string;
    forbiddenSideEffects?: SemanticSideEffect[];
  };
}

const mockState = vi.hoisted(() => {
  const createLedger = (): SemanticLedger => ({
    events: [],
    decisions: [],
    facts: [],
    sideEffects: [],
    forbiddenSideEffects: [],
    finalState: {},
  });

  const packageKey = (pkg: { path?: string; ecosystem?: string }) =>
    `${pkg.path ?? "."}::${pkg.ecosystem ?? "js"}`;

  const normalizeMap = (map: Map<string, string>) =>
    Object.fromEntries(
      [...map.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );

  const normalizeVersionPlan = (plan: any) => {
    if (!plan) return undefined;
    if (plan.mode === "single") {
      return {
        mode: "single",
        version: plan.version,
        packageKey: plan.packageKey,
      };
    }
    if (plan.mode === "fixed") {
      return {
        mode: "fixed",
        version: plan.version,
        packages: normalizeMap(plan.packages),
      };
    }
    return {
      mode: "independent",
      packages: normalizeMap(plan.packages),
    };
  };

  const normalizeRegistries = (packages: any[] = []) =>
    Object.fromEntries(
      packages.map((pkg) => [packageKey(pkg), [...pkg.registries]]),
    );

  const normalizeOptions = (options: Record<string, unknown> = {}) =>
    Object.fromEntries(
      Object.entries(options)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

  const state = {
    isCI: false,
    rawConfig: {} as Record<string, unknown>,
    resolvedConfig: {
      plugins: [],
      packages: [],
      rollback: { dangerouslyAllowUnpublish: false },
      versionSources: "all",
    } as Record<string, any>,
    changesetRecommendations: [] as Array<Record<string, unknown>>,
    commitRecommendations: [] as Array<Record<string, unknown>>,
    mergedRecommendations: undefined as
      | Array<Record<string, unknown>>
      | undefined,
    ledger: createLedger(),
    lastContext: undefined as any,
  };

  const recordEvent = (event: SemanticEvent) => {
    state.ledger.events.push(event);
  };

  const recordDecision = (name: string, value: unknown) => {
    state.ledger.decisions.push({ name, value });
  };

  const recordSideEffect = (effect: SemanticSideEffect) => {
    state.ledger.sideEffects.push(effect);
  };

  const resetForScenario = () => {
    state.rawConfig = {};
    state.resolvedConfig = {
      plugins: [],
      packages: [],
      rollback: { dangerouslyAllowUnpublish: false },
      versionSources: "all",
    };
    state.changesetRecommendations = [];
    state.commitRecommendations = [];
    state.mergedRecommendations = undefined;
    state.ledger = createLedger();
    state.lastContext = undefined;
  };

  const snapshotFinalState = () => {
    const ctx = state.lastContext;
    state.ledger.finalState = {
      options: ctx ? normalizeOptions(ctx.options) : undefined,
      versionPlan: ctx
        ? normalizeVersionPlan(ctx.runtime.versionPlan)
        : undefined,
      registries: ctx ? normalizeRegistries(ctx.config.packages) : undefined,
      rollback: ctx?.config.rollback,
      requiredTaskRuns: state.ledger.sideEffects.filter(
        (effect) => effect.kind === "requiredTasks.run",
      ).length,
      pubmCalls: state.ledger.sideEffects.filter(
        (effect) => effect.kind === "pubm.call",
      ).length,
      exitCode: process.exitCode ?? 0,
    };
  };

  return {
    packageKey,
    normalizeOptions,
    normalizeVersionPlan,
    recordDecision,
    recordEvent,
    recordSideEffect,
    resetForScenario,
    snapshotFinalState,
    state,
  };
});

vi.mock("@cluvo/sdk", () => ({
  Reporter: vi.fn(function Reporter() {
    return {
      installExitHandler: vi.fn(),
      installGlobalHandlers: vi.fn(),
      reportError: vi.fn(async (error: Error) => {
        mockState.recordEvent({
          name: "reporter.error",
          detail: { message: error.message },
        });
      }),
      wrapCommand: vi.fn(async (command: () => Promise<void>) => {
        await command();
      }),
    };
  }),
}));

vi.mock("std-env", () => ({
  get isCI() {
    return mockState.state.isCI;
  },
}));

vi.mock("@pubm/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pubm/core")>();
  return {
    ...actual,
    ChangesetSource: vi.fn(function ChangesetSource() {
      mockState.recordEvent({
        name: "versionSource.created",
        target: "changesets",
      });
      return {
        analyze: vi.fn(async () => {
          mockState.recordEvent({
            name: "versionSource.analyze",
            target: "changesets",
          });
          return mockState.state.changesetRecommendations;
        }),
      };
    }),
    ConventionalCommitSource: vi.fn(function ConventionalCommitSource(
      types?: unknown,
    ) {
      mockState.recordEvent({
        name: "versionSource.created",
        target: "commits",
        detail: { types },
      });
      return {
        analyze: vi.fn(async () => {
          mockState.recordEvent({
            name: "versionSource.analyze",
            target: "commits",
          });
          return mockState.state.commitRecommendations;
        }),
      };
    }),
    PUBM_VERSION: "0.0.0-contract",
    consoleError: vi.fn((error: Error) => {
      mockState.recordEvent({
        name: "error.reported",
        detail: { message: error.message },
      });
    }),
    createContext: vi.fn((config: any, options: any, cwd: string) => {
      const ctx = {
        config,
        cwd,
        options,
        runtime: {
          cleanWorkingTree: false,
          pluginRunner: { run: vi.fn() },
          promptEnabled: false,
          tag: options.tag ?? "latest",
        },
      };
      mockState.state.lastContext = ctx;
      mockState.recordEvent({
        name: "context.created",
        detail: {
          cwd,
          options: mockState.normalizeOptions(options),
        },
      });
      return ctx;
    }),
    initI18n: vi.fn((input: unknown) => {
      mockState.recordEvent({ name: "i18n.init", detail: { input } });
    }),
    loadConfig: vi.fn(async (cwd: string, configPath?: string) => {
      mockState.recordEvent({
        name: "config.load",
        detail: { configPath, cwd },
      });
      return mockState.state.rawConfig;
    }),
    mergeRecommendations: vi.fn((recommendationSets: unknown[]) => {
      mockState.recordEvent({
        name: "recommendations.merge",
        detail: { sourceCount: recommendationSets.length },
      });
      return (
        mockState.state.mergedRecommendations ??
        (recommendationSets as Array<Array<Record<string, unknown>>>).flat()
      );
    }),
    notifyNewVersion: vi.fn(async () => {
      mockState.recordEvent({ name: "version.notify" });
    }),
    packageKey: vi.fn(mockState.packageKey),
    pubm: vi.fn(async (ctx: any) => {
      mockState.recordSideEffect({
        kind: "pubm.call",
        target: "publish.pipeline",
        detail: {
          options: mockState.normalizeOptions(ctx.options),
          registries: Object.fromEntries(
            ctx.config.packages.map((pkg: any) => [
              mockState.packageKey(pkg),
              [...pkg.registries],
            ]),
          ),
          versionPlan: mockState.normalizeVersionPlan(ctx.runtime.versionPlan),
        },
      });
    }),
    requiredMissingInformationTasks: vi.fn(() => ({
      run: vi.fn(async (ctx: any) => {
        mockState.recordSideEffect({
          kind: "requiredTasks.run",
          target: "missing-information",
          detail: {
            versionPlan: mockState.normalizeVersionPlan(
              ctx.runtime.versionPlan,
            ),
          },
        });
      }),
    })),
    resolveConfig: vi.fn(async (_raw: unknown, _cwd: string) => {
      mockState.recordEvent({ name: "config.resolve" });
      return mockState.state.resolvedConfig;
    }),
    resolveOptions: vi.fn((options: Record<string, unknown>) => {
      const resolved = actual.resolveOptions(options);
      mockState.recordDecision(
        "options.resolved",
        mockState.normalizeOptions(resolved),
      );
      return resolved;
    }),
    resolvePhases: vi.fn((options: any) => {
      const phases = actual.resolvePhases(options);
      mockState.recordDecision("phases.resolved", phases);
      return phases;
    }),
    t: vi.fn((key: string, values?: Record<string, unknown>) => {
      if (key === "error.cli.versionRequired") {
        return "Version must be set in the CI environment.";
      }
      return values ? `${key} ${JSON.stringify(values)}` : key;
    }),
    ui: {
      badges: {},
      chalk: { level: 3 },
      error: vi.fn(),
      hint: vi.fn(),
      info: vi.fn(),
      labels: { DRY_RUN: "[dry-run]" },
      success: vi.fn(),
      warn: vi.fn(),
    },
    validateOptions: vi.fn((options: any) => {
      actual.validateOptions(options);
      mockState.recordEvent({
        name: "options.validated",
        detail: { options: mockState.normalizeOptions(options) },
      });
    }),
  };
});

vi.mock("../../../src/commands/add.js", () => ({
  registerAddCommand: vi.fn(),
}));

vi.mock("../../../src/commands/changesets.js", () => ({
  registerChangesetsCommand: vi.fn(),
}));

vi.mock("../../../src/commands/changelog.js", () => ({
  registerChangelogCommand: vi.fn(),
}));

vi.mock("../../../src/commands/init.js", () => ({
  registerInitCommand: vi.fn(),
}));

vi.mock("../../../src/commands/inspect.js", () => ({
  registerInspectCommand: vi.fn(),
}));

vi.mock("../../../src/commands/migrate.js", () => ({
  registerMigrateCommand: vi.fn(),
}));

vi.mock("../../../src/commands/secrets.js", () => ({
  registerSecretsCommand: vi.fn(),
}));

vi.mock("../../../src/commands/setup-skills.js", () => ({
  registerSetupSkillsCommand: vi.fn(),
}));

vi.mock("../../../src/commands/snapshot.js", () => ({
  registerSnapshotCommand: vi.fn(),
}));

vi.mock("../../../src/commands/sync.js", () => ({
  registerSyncCommand: vi.fn(),
}));

vi.mock("../../../src/commands/update.js", () => ({
  registerUpdateCommand: vi.fn(),
}));

vi.mock("../../../src/commands/version-cmd.js", () => ({
  registerVersionCommand: vi.fn(),
}));

vi.mock("../../../src/splash.js", () => ({
  showSplash: vi.fn(),
}));

const originalArgv = [...process.argv];

const pkg = (overrides: Partial<ContractPackage>): ContractPackage => ({
  name: "contract-pkg",
  version: "1.0.0",
  path: ".",
  registries: ["npm"],
  dependencies: [],
  ecosystem: "js",
  ...overrides,
});

const config = (overrides: Record<string, any> = {}) => ({
  plugins: [],
  packages: [pkg({})],
  rollback: { dangerouslyAllowUnpublish: false },
  versionSources: "all",
  ...overrides,
});

const scenarios: CliContractScenario[] = [
  {
    id: "local-explicit-version-single",
    description:
      "local explicit version resolves a single-package version plan before publish",
    argv: ["1.2.3"],
    env: { isCI: false },
    config: config({
      packages: [pkg({ name: "single", version: "1.0.0", path: "." })],
    }),
    expected: {
      options: {
        mode: "local",
        skipDryRun: false,
        skipPublish: false,
      },
      versionPlan: {
        mode: "single",
        version: "1.2.3",
        packageKey: ".::js",
      },
      requiredTasksRun: true,
      pubmCalled: true,
    },
  },
  {
    id: "local-explicit-version-fixed-monorepo",
    description:
      "local explicit version resolves every workspace package to the requested fixed version",
    argv: ["2.0.0"],
    env: { isCI: false },
    config: config({
      packages: [
        pkg({ name: "pkg-a", version: "1.0.0", path: "packages/a" }),
        pkg({ name: "pkg-b", version: "1.0.0", path: "packages/b" }),
      ],
      versioning: "fixed",
    }),
    expected: {
      options: {
        mode: "local",
        skipDryRun: false,
        skipPublish: false,
      },
      versionPlan: {
        mode: "fixed",
        version: "2.0.0",
        packages: {
          "packages/a::js": "2.0.0",
          "packages/b::js": "2.0.0",
        },
      },
      requiredTasksRun: true,
      pubmCalled: true,
    },
  },
  {
    id: "ci-publish-manifest-versions",
    description:
      "CI publish phase uses manifest versions without interactive missing-information tasks",
    argv: ["--mode", "ci", "--phase", "publish"],
    env: { isCI: true },
    config: config({
      packages: [
        pkg({ name: "pkg-a", version: "1.4.0", path: "packages/a" }),
        pkg({ name: "pkg-b", version: "2.5.0", path: "packages/b" }),
      ],
      versioning: "independent",
    }),
    expected: {
      options: {
        mode: "ci",
        publish: true,
        skipDryRun: false,
      },
      versionPlan: {
        mode: "independent",
        packages: {
          "packages/a::js": "1.4.0",
          "packages/b::js": "2.5.0",
        },
      },
      requiredTasksRun: false,
      pubmCalled: true,
    },
  },
  {
    id: "local-publish-only-manifest-versions",
    description:
      "local publish phase reads fixed workspace versions from manifests",
    argv: ["--phase", "publish"],
    env: { isCI: false },
    config: config({
      packages: [
        pkg({ name: "pkg-a", version: "3.1.0", path: "packages/a" }),
        pkg({ name: "pkg-b", version: "3.1.0", path: "packages/b" }),
      ],
      versioning: "fixed",
    }),
    expected: {
      options: {
        mode: "local",
        publish: true,
        skipDryRun: false,
      },
      versionPlan: {
        mode: "fixed",
        version: "3.1.0",
        packages: {
          "packages/a::js": "3.1.0",
          "packages/b::js": "3.1.0",
        },
      },
      requiredTasksRun: false,
      pubmCalled: true,
    },
  },
  {
    id: "registry-filtering",
    description:
      "--registry narrows each package registry list before the publish boundary",
    argv: ["1.2.3", "--registry", "npm, jsr"],
    env: { isCI: false },
    config: config({
      packages: [
        pkg({
          name: "filtered",
          version: "1.0.0",
          path: ".",
          registries: ["npm", "jsr", "crates"],
        }),
      ],
    }),
    expected: {
      options: {
        mode: "local",
        skipDryRun: false,
      },
      registries: {
        ".::js": ["npm", "jsr"],
      },
      versionPlan: {
        mode: "single",
        version: "1.2.3",
        packageKey: ".::js",
      },
      requiredTasksRun: true,
      pubmCalled: true,
    },
  },
  {
    id: "dangerously-allow-unpublish-override",
    description:
      "--dangerously-allow-unpublish overrides rollback config at the publish boundary",
    argv: ["1.2.3", "--dangerously-allow-unpublish"],
    env: { isCI: false },
    config: config({
      rollback: { dangerouslyAllowUnpublish: false },
    }),
    expected: {
      options: {
        mode: "local",
        skipDryRun: false,
      },
      rollback: {
        dangerouslyAllowUnpublish: true,
      },
      versionPlan: {
        mode: "single",
        version: "1.2.3",
        packageKey: ".::js",
      },
      requiredTasksRun: true,
      pubmCalled: true,
    },
  },
  {
    id: "config-skip-dry-run-override",
    description:
      "config skipDryRun forces the resolved CLI option when the CLI did not skip dry-run validation",
    argv: ["1.2.3"],
    env: { isCI: false },
    config: config({
      skipDryRun: true,
    }),
    expected: {
      options: {
        mode: "local",
        skipDryRun: true,
      },
      versionPlan: {
        mode: "single",
        version: "1.2.3",
        packageKey: ".::js",
      },
      requiredTasksRun: true,
      pubmCalled: true,
    },
  },
  {
    id: "ci-no-version-no-recommendation-failure",
    description:
      "detected CI without explicit version or recommendations fails before pubm",
    argv: [],
    env: { isCI: true },
    config: config({
      packages: [pkg({ name: "ci-no-version", version: "1.0.0", path: "." })],
      versionSources: "all",
    }),
    recommendations: {
      changesets: [],
      commits: [],
      merged: [],
    },
    expected: {
      options: {
        mode: "local",
        skipDryRun: false,
      },
      requiredTasksRun: false,
      pubmCalled: false,
      exitCode: 1,
      errorMessage: "Version must be set in the CI environment.",
      forbiddenSideEffects: [
        {
          kind: "pubm.call",
          target: "publish.pipeline",
        },
      ],
    },
  },
];

async function runScenario(
  scenario: CliContractScenario,
): Promise<SemanticLedger> {
  mockState.resetForScenario();
  mockState.state.isCI = scenario.env.isCI;
  mockState.state.resolvedConfig = scenario.config;
  mockState.state.changesetRecommendations =
    scenario.recommendations?.changesets ?? [];
  mockState.state.commitRecommendations =
    scenario.recommendations?.commits ?? [];
  mockState.state.mergedRecommendations = scenario.recommendations?.merged;
  mockState.state.ledger.forbiddenSideEffects =
    scenario.expected.forbiddenSideEffects ?? [];

  process.argv = ["node", "pubm", ...scenario.argv];

  await import("../../../src/cli.js");

  mockState.snapshotFinalState();
  return mockState.state.ledger;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "clear").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  process.argv = [...originalArgv];
  process.exitCode = undefined;
});

describe("CLI mode and option contracts", () => {
  it.each(scenarios)("$id: $description", async (scenario) => {
    const ledger = await runScenario(scenario);

    expect(ledger.finalState.options).toMatchObject(scenario.expected.options);
    expect(ledger.finalState.exitCode).toBe(scenario.expected.exitCode ?? 0);
    expect(ledger.finalState.pubmCalls).toBe(
      scenario.expected.pubmCalled ? 1 : 0,
    );

    if (scenario.expected.versionPlan) {
      expect(ledger.finalState.versionPlan).toEqual(
        scenario.expected.versionPlan,
      );
    }

    if (scenario.expected.registries) {
      expect(ledger.finalState.registries).toEqual(
        scenario.expected.registries,
      );
    }

    if (scenario.expected.rollback) {
      expect(ledger.finalState.rollback).toMatchObject(
        scenario.expected.rollback,
      );
    }

    if (scenario.expected.requiredTasksRun !== undefined) {
      expect(ledger.finalState.requiredTaskRuns).toBe(
        scenario.expected.requiredTasksRun ? 1 : 0,
      );
    }

    if (scenario.expected.errorMessage) {
      expect(ledger.events).toContainEqual(
        expect.objectContaining({
          name: "error.reported",
          detail: expect.objectContaining({
            message: scenario.expected.errorMessage,
          }),
        }),
      );
    }

    for (const forbidden of ledger.forbiddenSideEffects) {
      expect(ledger.sideEffects).not.toContainEqual(
        expect.objectContaining(forbidden),
      );
    }
  });
});
