import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("CLI bootstrap", () => {
  it("registers plugin subcommands from config before parsing argv", async () => {
    const checkAction = vi.fn();
    const pingAction = vi.fn();

    process.argv = ["node", "pubm", "ops", "check", "--dry-run"];

    vi.doMock("std-env", () => ({ isCI: false }));
    vi.doMock("@pubm/core", async () => {
      return {
        applyVersionSourcePlan: vi.fn(),
        calculateVersionBumps: vi.fn(),
        consoleError: vi.fn(),
        createContext: vi.fn((config: any, options: any, cwd: string) => ({
          config: config ?? {},
          options: options ?? {},
          cwd,
          runtime: {
            tag: "latest",
            promptEnabled: false,
            cleanWorkingTree: false,
            pluginRunner: { run: vi.fn() },
          },
        })),
        createVersionPlanFromManifestVersions: vi.fn(() => ({
          mode: "single",
          version: "1.0.0",
          packageKey: ".::js",
        })),
        Git: vi.fn(),
        getStatus: vi.fn(() => ({ hasChangesets: false, changesets: [] })),
        initI18n: vi.fn(),
        loadConfig: vi.fn().mockResolvedValue({
          plugins: [
            {},
            {
              commands: [
                { name: "legacy" },
                {
                  name: "misc",
                  subcommands: [
                    {
                      name: "ping",
                      description: "ping the plugin",
                      action: pingAction,
                    },
                  ],
                },
                {
                  name: "ops",
                  description: "plugin operations",
                  subcommands: [
                    {
                      name: "check",
                      description: "validate publish prerequisites",
                      options: [
                        {
                          name: "--dry-run",
                          description: "preview the sync result",
                        },
                      ],
                      action: checkAction,
                    },
                  ],
                },
              ],
            },
          ],
        }),
        notifyNewVersion: vi.fn(),
        packageKey: vi.fn(() => ".::js"),
        PUBM_VERSION: "1.0.0",
        pubm: vi.fn(),
        requiredMissingInformationTasks: vi.fn(() => ({ run: vi.fn() })),
        resolveConfig: vi.fn(async (raw: any) => ({
          plugins: [],
          ...raw,
        })),
        resolveOptions: vi.fn((opts: any) => ({
          testScript: "test",
          buildScript: "build",
          branch: "main",
          tag: "latest",
          saveToken: true,
          ...opts,
        })),
        resolvePhases: vi.fn(() => ["prepare", "publish"]),
        t: vi.fn((key: string) => key),
        ui: { chalk: { level: 3 } },
        validateOptions: vi.fn(),
      };
    });

    vi.doMock("../../src/commands/changesets.js", () => ({
      registerChangesetsCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/init.js", () => ({
      registerInitCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/inspect.js", () => ({
      registerInspectCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/migrate.js", () => ({
      registerMigrateCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/setup-skills.js", () => ({
      registerSetupSkillsCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/snapshot.js", () => ({
      registerSnapshotCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/update.js", () => ({
      registerUpdateCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/secrets.js", () => ({
      registerSecretsCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/sync.js", () => ({
      registerSyncCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/version-cmd.js", () => ({
      registerVersionCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/workflow.js", () => ({
      registerWorkflowCommand: vi.fn(),
    }));

    await import("../../src/cli.js");

    await vi.waitFor(() => {
      expect(checkAction).toHaveBeenCalled();
    });
    expect(checkAction.mock.calls[0]?.[0]).toMatchObject({ dryRun: true });
    expect(pingAction).not.toHaveBeenCalled();
  });

  it("uses early argv parsing for --locale and --config before command parsing", async () => {
    const checkAction = vi.fn();
    const initI18n = vi.fn();
    const loadConfig = vi.fn().mockResolvedValue(undefined);
    const resolveConfig = vi.fn(async (_raw: any) => ({
      locale: "de",
      plugins: [
        {
          commands: [
            {
              name: "ops",
              description: "plugin operations",
              subcommands: [
                {
                  name: "check",
                  description: "validate publish prerequisites",
                  action: checkAction,
                },
              ],
            },
          ],
        },
      ],
    }));

    process.argv = [
      "node",
      "pubm",
      "--config",
      "pubm.custom.config.js",
      "--locale",
      "ko",
      "ops",
      "check",
    ];

    vi.doMock("@cluvo/sdk", () => ({
      Reporter: vi.fn(function Reporter() {
        return {
          installExitHandler: vi.fn(),
          installGlobalHandlers: vi.fn(),
          reportError: vi.fn(async () => undefined),
          wrapCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
        };
      }),
    }));
    vi.doMock("std-env", () => ({ isCI: false }));
    vi.doMock("@pubm/core", async () => {
      return {
        applyVersionSourcePlan: vi.fn(),
        consoleError: vi.fn(),
        createContext: vi.fn(),
        createVersionPlanFromManifestVersions: vi.fn(),
        initI18n,
        loadConfig,
        notifyNewVersion: vi.fn(),
        packageKey: vi.fn(() => ".::js"),
        PUBM_VERSION: "1.0.0",
        pubm: vi.fn(),
        requiredMissingInformationTasks: vi.fn(() => ({ run: vi.fn() })),
        resolveConfig,
        resolveOptions: vi.fn((opts: any) => ({
          testScript: "test",
          buildScript: "build",
          branch: "main",
          tag: "latest",
          saveToken: true,
          ...opts,
        })),
        resolvePhases: vi.fn(() => ["prepare", "publish"]),
        t: vi.fn((key: string) => key),
        ui: { chalk: { level: 3 } },
        validateOptions: vi.fn(),
      };
    });

    vi.doMock("../../src/commands/changesets.js", () => ({
      registerChangesetsCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/init.js", () => ({
      registerInitCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/inspect.js", () => ({
      registerInspectCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/migrate.js", () => ({
      registerMigrateCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/setup-skills.js", () => ({
      registerSetupSkillsCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/snapshot.js", () => ({
      registerSnapshotCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/update.js", () => ({
      registerUpdateCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/secrets.js", () => ({
      registerSecretsCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/sync.js", () => ({
      registerSyncCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/version-cmd.js", () => ({
      registerVersionCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/workflow.js", () => ({
      registerWorkflowCommand: vi.fn(),
    }));

    await import("../../src/cli.js");

    await vi.waitFor(() => {
      expect(checkAction).toHaveBeenCalled();
    });
    expect(loadConfig).toHaveBeenCalledWith(
      process.cwd(),
      "pubm.custom.config.js",
    );
    expect(resolveConfig).toHaveBeenCalledWith({}, process.cwd());
    expect(initI18n).toHaveBeenNthCalledWith(1, { flag: "ko" });
    expect(initI18n).toHaveBeenNthCalledWith(2, {
      flag: "ko",
      configLocale: "de",
    });
  });
});
