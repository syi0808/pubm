import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/token.js", () => ({
  loadTokensFromDb: vi.fn(),
}));
vi.mock("../../../src/tasks/preflight.js", () => ({
  syncGhSecrets: vi.fn(),
}));

import { Command } from "commander";
import { syncGhSecrets } from "../../../src/tasks/preflight.js";
import { loadTokensFromDb } from "../../../src/utils/token.js";

const mockedLoadTokens = vi.mocked(loadTokensFromDb);
const mockedSyncGhSecrets = vi.mocked(syncGhSecrets);

import { registerSecretsCommand } from "../../../src/commands/secrets.js";

function createParentAndParse(...args: string[]) {
  const parent = new Command();
  parent.exitOverride();
  registerSecretsCommand(parent);
  return parent.parseAsync(["node", "test", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerSecretsCommand", () => {
  it("registers 'secrets' command with 'sync' subcommand", () => {
    const parent = new Command();
    registerSecretsCommand(parent);
    const secrets = parent.commands.find((c) => c.name() === "secrets");
    expect(secrets).toBeDefined();
    const sync = secrets!.commands.find((c) => c.name() === "sync");
    expect(sync).toBeDefined();
  });

  it("syncs all stored tokens when no registry filter", async () => {
    mockedLoadTokens.mockReturnValue({ npm: "tok-1", jsr: "tok-2" });
    mockedSyncGhSecrets.mockResolvedValue(undefined);

    await createParentAndParse("secrets", "sync");

    expect(mockedLoadTokens).toHaveBeenCalledWith(["npm", "jsr", "crates"]);
    expect(mockedSyncGhSecrets).toHaveBeenCalledWith({
      npm: "tok-1",
      jsr: "tok-2",
    });
  });

  it("filters registries when --registry is specified", async () => {
    mockedLoadTokens.mockReturnValue({ npm: "tok-1" });
    mockedSyncGhSecrets.mockResolvedValue(undefined);

    await createParentAndParse("secrets", "sync", "--registry", "npm");

    expect(mockedLoadTokens).toHaveBeenCalledWith(["npm"]);
  });

  it("shows message when no tokens found", async () => {
    mockedLoadTokens.mockReturnValue({});
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createParentAndParse("secrets", "sync");

    expect(mockedSyncGhSecrets).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("No stored tokens"),
    );

    consoleSpy.mockRestore();
  });
});
