import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCore = vi.hoisted(() => ({
  consoleError: vi.fn(),
  detectMigrationSources: vi.fn(),
  executeMigration: vi.fn(),
  ui: {
    error: vi.fn(),
    hint: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@pubm/core", () => ({
  changesetsAdapter: { name: "changesets" },
  consoleError: mockCore.consoleError,
  detectMigrationSources: mockCore.detectMigrationSources,
  executeMigration: mockCore.executeMigration,
  npAdapter: { name: "np" },
  releaseItAdapter: { name: "release-it" },
  semanticReleaseAdapter: { name: "semantic-release" },
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  ui: mockCore.ui,
}));

import { registerMigrateCommand } from "../../../src/commands/migrate.js";

let originalIsTty: boolean | undefined;

async function runMigrate(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerMigrateCommand(program);
  await program.parseAsync(["node", "pubm", "migrate", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  originalIsTty = process.stdout.isTTY;
  process.stdout.isTTY = true;
  process.exitCode = undefined;
  mockCore.detectMigrationSources.mockResolvedValue([
    {
      adapter: { name: "semantic-release" },
      result: { configFiles: ["/repo/.releaserc"] },
    },
  ]);
  mockCore.executeMigration.mockResolvedValue({
    warnings: [],
    ciAdvice: [],
  });
});

afterEach(() => {
  process.stdout.isTTY = originalIsTty;
});

describe("migrate command contract", () => {
  it("rejects invalid sources before scanning or mutating", async () => {
    await runMigrate("--from", "unknown");

    expect(mockCore.ui.error).toHaveBeenCalledWith(
      'Invalid source "unknown". Valid options: semantic-release, release-it, changesets, np',
    );
    expect(mockCore.detectMigrationSources).not.toHaveBeenCalled();
    expect(mockCore.executeMigration).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("allows non-TTY migration only in dry-run mode and passes the dry-run boundary to the engine", async () => {
    process.stdout.isTTY = false;

    await runMigrate("--from", "semantic-release", "--dry-run");

    expect(mockCore.detectMigrationSources).toHaveBeenCalledWith(
      process.cwd(),
      expect.any(Array),
      "semantic-release",
    );
    expect(mockCore.executeMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        clean: false,
      }),
    );
    expect(mockCore.ui.hint).toHaveBeenCalledWith("cmd.migrate.dryRun");
    expect(process.exitCode).toBeUndefined();
  });

  it("forbids non-TTY migration when it would write files", async () => {
    process.stdout.isTTY = false;

    await runMigrate("--from", "release-it");

    expect(mockCore.ui.error).toHaveBeenCalledWith("cmd.migrate.ciNonTty");
    expect(mockCore.detectMigrationSources).not.toHaveBeenCalled();
    expect(mockCore.executeMigration).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
