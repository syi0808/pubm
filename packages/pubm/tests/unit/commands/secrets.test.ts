import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pubm/core", () => ({
  loadTokensFromDb: vi.fn(),
  syncGhSecrets: vi.fn(),
  consoleError: vi.fn(),
}));

import { consoleError, loadTokensFromDb, syncGhSecrets } from "@pubm/core";
import { Command } from "commander";

const mockedConsoleError = vi.mocked(consoleError);
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
  process.exitCode = undefined;
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

  it("reports sync errors without pretending the secrets were uploaded", async () => {
    const error = new Error("gh auth missing");
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockedLoadTokens.mockReturnValue({ npm: "tok-1" });
    mockedSyncGhSecrets.mockRejectedValue(error);

    await createParentAndParse("secrets", "sync");

    expect(mockedConsoleError).toHaveBeenCalledWith(error);
    expect(process.exitCode).toBe(1);
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      "Done! Tokens synced to GitHub Secrets.",
    );
  });
});
