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
      const actual =
        await vi.importActual<typeof import("@pubm/core")>("@pubm/core");
      return {
        ...actual,
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
        Git: vi.fn(),
        getStatus: vi.fn(() => ({ hasChangesets: false, changesets: [] })),
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
        validateOptions: vi.fn(),
      };
    });

    vi.doMock("../../src/commands/changesets.js", () => ({
      registerChangesetsCommand: vi.fn(),
    }));
    vi.doMock("../../src/commands/init.js", () => ({
      registerInitCommand: vi.fn(),
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

    await import("../../src/cli.js");

    await vi.waitFor(() => {
      expect(checkAction).toHaveBeenCalled();
    });
    expect(checkAction.mock.calls[0]?.[0]).toMatchObject({ dryRun: true });
    expect(pingAction).not.toHaveBeenCalled();
  });
});
