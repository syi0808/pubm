import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/token.js", () => ({
  loadTokensFromDb: vi.fn(),
}));
vi.mock("../../../src/tasks/preflight.js", () => ({
  syncGhSecrets: vi.fn(),
}));

import { syncGhSecrets } from "../../../src/tasks/preflight.js";
import { loadTokensFromDb } from "../../../src/utils/token.js";

const mockedLoadTokens = vi.mocked(loadTokensFromDb);
const mockedSyncGhSecrets = vi.mocked(syncGhSecrets);

// We need to test the command action directly
// Import registerSecretsCommand and create a mock CAC instance
import { registerSecretsCommand } from "../../../src/commands/secrets.js";

function createMockCli() {
  let registeredAction: any;
  const cmd = {
    option: vi.fn().mockReturnThis(),
    action: vi.fn((fn: any) => {
      registeredAction = fn;
      return cmd;
    }),
  };
  const cli = {
    command: vi.fn().mockReturnValue(cmd),
  };
  return { cli, cmd, getAction: () => registeredAction };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerSecretsCommand", () => {
  it("registers 'secrets sync' command", () => {
    const { cli } = createMockCli();
    registerSecretsCommand(cli as any);
    expect(cli.command).toHaveBeenCalledWith(
      "secrets sync",
      expect.any(String),
    );
  });

  it("syncs all stored tokens when no registry filter", async () => {
    const { cli, getAction } = createMockCli();
    registerSecretsCommand(cli as any);

    mockedLoadTokens.mockReturnValue({ npm: "tok-1", jsr: "tok-2" });
    mockedSyncGhSecrets.mockResolvedValue(undefined);

    await getAction()({});

    expect(mockedLoadTokens).toHaveBeenCalledWith(["npm", "jsr", "crates"]);
    expect(mockedSyncGhSecrets).toHaveBeenCalledWith({
      npm: "tok-1",
      jsr: "tok-2",
    });
  });

  it("filters registries when --registry is specified", async () => {
    const { cli, getAction } = createMockCli();
    registerSecretsCommand(cli as any);

    mockedLoadTokens.mockReturnValue({ npm: "tok-1" });
    mockedSyncGhSecrets.mockResolvedValue(undefined);

    await getAction()({ registry: "npm" });

    expect(mockedLoadTokens).toHaveBeenCalledWith(["npm"]);
  });

  it("shows message when no tokens found", async () => {
    const { cli, getAction } = createMockCli();
    registerSecretsCommand(cli as any);

    mockedLoadTokens.mockReturnValue({});
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await getAction()({});

    expect(mockedSyncGhSecrets).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("No stored tokens"),
    );

    consoleSpy.mockRestore();
  });
});
