import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDetectMigrationSources,
  mockExecuteMigration,
  mockConsoleError,
  mockUi,
} = vi.hoisted(() => ({
  mockDetectMigrationSources: vi.fn(),
  mockExecuteMigration: vi.fn(),
  mockConsoleError: vi.fn(),
  mockUi: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    hint: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@pubm/core", () => ({
  changesetsAdapter: { name: "changesets" },
  npAdapter: { name: "np" },
  releaseItAdapter: { name: "release-it" },
  semanticReleaseAdapter: { name: "semantic-release" },
  consoleError: mockConsoleError,
  detectMigrationSources: mockDetectMigrationSources,
  executeMigration: mockExecuteMigration,
  t: (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return `${key}(${JSON.stringify(params)})`;
    }
    return key;
  },
  ui: mockUi,
}));

const { registerMigrateCommand } = await import(
  "../../../src/commands/migrate.js"
);

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  return program;
}

async function run(program: Command, ...args: string[]): Promise<void> {
  await program.parseAsync(["node", "pubm", "migrate", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.exitCode = undefined;
  // Default: TTY mode on
  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("registerMigrateCommand", () => {
  describe("--from validation", () => {
    it("rejects an invalid --from source and sets exitCode to 1", async () => {
      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program, "--from", "invalid");

      expect(mockUi.error).toHaveBeenCalledWith(
        expect.stringContaining("invalid"),
      );
      expect(process.exitCode).toBe(1);
      expect(mockDetectMigrationSources).not.toHaveBeenCalled();
    });
  });

  describe("non-TTY guard", () => {
    beforeEach(() => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        configurable: true,
      });
    });

    it("rejects non-TTY without --dry-run and sets exitCode to 1", async () => {
      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program);

      expect(mockUi.error).toHaveBeenCalledWith("cmd.migrate.ciNonTty");
      expect(process.exitCode).toBe(1);
      expect(mockDetectMigrationSources).not.toHaveBeenCalled();
    });

    it("allows non-TTY with --dry-run and calls executeMigration", async () => {
      mockDetectMigrationSources.mockResolvedValue([
        {
          adapter: { name: "semantic-release" },
          result: { configFiles: ["/project/config.js"] },
        },
      ]);
      mockExecuteMigration.mockResolvedValue({ warnings: [], ciAdvice: [] });

      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program, "--dry-run");

      expect(mockUi.error).not.toHaveBeenCalledWith("cmd.migrate.ciNonTty");
      expect(mockExecuteMigration).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
      );
      expect(mockUi.hint).toHaveBeenCalledWith("cmd.migrate.dryRun");
      expect(process.exitCode).not.toBe(1);
    });
  });

  describe("no sources detected", () => {
    it("errors when detectMigrationSources returns empty array", async () => {
      mockDetectMigrationSources.mockResolvedValue([]);

      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program);

      expect(mockUi.error).toHaveBeenCalledWith("cmd.migrate.noSource");
      expect(process.exitCode).toBe(1);
      expect(mockExecuteMigration).not.toHaveBeenCalled();
    });
  });

  describe("single source detected", () => {
    it("runs migration and shows success message", async () => {
      mockDetectMigrationSources.mockResolvedValue([
        {
          adapter: { name: "semantic-release" },
          result: {
            configFiles: [path.join(process.cwd(), "release.config.js")],
          },
        },
      ]);
      mockExecuteMigration.mockResolvedValue({ warnings: [], ciAdvice: [] });

      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program);

      expect(mockExecuteMigration).toHaveBeenCalledWith(
        expect.objectContaining({
          adapter: { name: "semantic-release" },
          dryRun: false,
          clean: false,
        }),
      );
      expect(mockUi.success).toHaveBeenCalledWith(
        expect.stringContaining("cmd.migrate.complete"),
      );
    });
  });

  describe("multiple sources detected", () => {
    it("logs each detected source and uses the first", async () => {
      mockDetectMigrationSources.mockResolvedValue([
        {
          adapter: { name: "semantic-release" },
          result: {
            configFiles: [path.join(process.cwd(), "release.config.js")],
          },
        },
        {
          adapter: { name: "release-it" },
          result: {
            configFiles: [path.join(process.cwd(), ".release-it.json")],
          },
        },
      ]);
      mockExecuteMigration.mockResolvedValue({ warnings: [], ciAdvice: [] });

      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program);

      expect(mockUi.info).toHaveBeenCalledWith("cmd.migrate.detectedMultiple");
      expect(mockExecuteMigration).toHaveBeenCalledWith(
        expect.objectContaining({ adapter: { name: "semantic-release" } }),
      );
    });
  });

  describe("warnings and CI advice", () => {
    it("prints warnings when result has warnings", async () => {
      mockDetectMigrationSources.mockResolvedValue([
        {
          adapter: { name: "changesets" },
          result: {
            configFiles: [path.join(process.cwd(), ".changeset/config.json")],
          },
        },
      ]);
      mockExecuteMigration.mockResolvedValue({
        warnings: ["Check your CI config", "Token may be missing"],
        ciAdvice: [],
      });

      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program);

      expect(mockUi.hint).toHaveBeenCalledWith("cmd.migrate.warningsTitle");
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Check your CI config"),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Token may be missing"),
      );
    });

    it("prints CI advice when result has ciAdvice", async () => {
      mockDetectMigrationSources.mockResolvedValue([
        {
          adapter: { name: "np" },
          result: { configFiles: [path.join(process.cwd(), "package.json")] },
        },
      ]);
      mockExecuteMigration.mockResolvedValue({
        warnings: [],
        ciAdvice: [
          {
            file: path.join(process.cwd(), ".github/workflows/release.yml"),
            removeLine: "npx np --no-publish",
            addLine: "npx pubm 1.0.0",
          },
        ],
      });

      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program);

      expect(mockUi.info).toHaveBeenCalledWith("cmd.migrate.ciAdvice");
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("npx np --no-publish"),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("npx pubm 1.0.0"),
      );
    });
  });

  describe("error handling", () => {
    it("calls consoleError and sets exitCode to 1 when detectMigrationSources throws", async () => {
      const error = new Error("detection failed");
      mockDetectMigrationSources.mockRejectedValue(error);

      const program = makeProgram();
      registerMigrateCommand(program);

      await run(program);

      expect(mockConsoleError).toHaveBeenCalledWith(error);
      expect(process.exitCode).toBe(1);
    });
  });
});
