import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock("../../../src/migrate/ci-advisor.js", () => ({
  scanCiWorkflows: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/migrate/cleanup.js", () => ({
  removeFiles: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/changeset/migrate.js", () => ({
  migrateFromChangesets: vi.fn(),
}));

vi.mock("../../../src/migrate/converter.js", () => ({
  convertToPublishConfig: vi.fn().mockReturnValue({ config: {}, warnings: [] }),
}));

import * as fs from "node:fs";
import path from "node:path";
import { migrateFromChangesets } from "../../../src/changeset/migrate.js";
import { scanCiWorkflows } from "../../../src/migrate/ci-advisor.js";
import { removeFiles } from "../../../src/migrate/cleanup.js";
import { convertToPublishConfig } from "../../../src/migrate/converter.js";
import {
  type ExecuteOptions,
  executeMigration,
} from "../../../src/migrate/pipeline.js";
import type {
  DetectResult,
  MigrationSource,
  ParsedMigrationConfig,
} from "../../../src/migrate/types.js";

const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockScanCiWorkflows = vi.mocked(scanCiWorkflows);
const mockRemoveFiles = vi.mocked(removeFiles);
const mockMigrateFromChangesets = vi.mocked(migrateFromChangesets);
const mockConvertToPublishConfig = vi.mocked(convertToPublishConfig);

function makeParsed(
  overrides?: Partial<ParsedMigrationConfig>,
): ParsedMigrationConfig {
  return {
    source: "np",
    unmappable: [],
    npm: { publish: true },
    ...overrides,
  };
}

function makeDetected(overrides?: Partial<DetectResult>): DetectResult {
  return {
    found: true,
    configFiles: ["/project/.np-config.json"],
    relatedFiles: [],
    ...overrides,
  };
}

function makeAdapter(
  parsedOverride?: Partial<ParsedMigrationConfig>,
): MigrationSource {
  return {
    name: "np",
    configFilePatterns: [".np-config.json"],
    detect: vi.fn(),
    parse: vi.fn().mockResolvedValue(makeParsed(parsedOverride)),
    convert: vi.fn(),
    getCleanupTargets: vi.fn().mockReturnValue(["/project/.np-config.json"]),
  };
}

function makeOptions(overrides?: Partial<ExecuteOptions>): ExecuteOptions {
  return {
    adapter: makeAdapter(),
    detected: makeDetected(),
    cwd: "/project",
    dryRun: false,
    clean: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockScanCiWorkflows.mockReturnValue([]);
  mockRemoveFiles.mockReturnValue([]);
  mockMigrateFromChangesets.mockReturnValue({
    success: true,
    migratedFiles: [],
    configMigrated: false,
  });
  mockConvertToPublishConfig.mockReturnValue({ config: {}, warnings: [] });
});

describe("executeMigration", () => {
  it("executes full pipeline and writes config file", async () => {
    const result = await executeMigration(makeOptions());

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join("/project", "pubm.config.ts"),
      expect.stringContaining("defineConfig"),
      "utf-8",
    );
    expect(result.configWritten).toBe(true);
    expect(result.source).toBe("np");
  });

  it("does not write files in dry-run mode", async () => {
    const result = await executeMigration(makeOptions({ dryRun: true }));

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(result.configWritten).toBe(false);
  });

  it("collects warnings from converter", async () => {
    mockConvertToPublishConfig.mockReturnValueOnce({
      config: {},
      warnings: [
        "Hook before:release requires manual conversion to pubm plugin",
      ],
    });

    const result = await executeMigration(makeOptions());

    expect(result.warnings).toContain(
      "Hook before:release requires manual conversion to pubm plugin",
    );
  });

  it("calls parse with correct arguments", async () => {
    const adapter = makeAdapter();
    const detected = makeDetected({
      configFiles: ["/project/.np-config.json", "/project/package.json"],
    });

    await executeMigration(makeOptions({ adapter, detected }));

    expect(adapter.parse).toHaveBeenCalledWith(
      ["/project/.np-config.json", "/project/package.json"],
      "/project",
    );
  });

  it("calls removeFiles when clean=true and not dryRun", async () => {
    const adapter = makeAdapter();

    const result = await executeMigration(
      makeOptions({ adapter, clean: true, dryRun: false }),
    );

    expect(adapter.getCleanupTargets).toHaveBeenCalledOnce();
    expect(mockRemoveFiles).toHaveBeenCalledWith(["/project/.np-config.json"]);
    expect(result.cleanedFiles).toEqual([]);
  });

  it("does not call removeFiles when clean=false", async () => {
    await executeMigration(makeOptions({ clean: false }));

    expect(mockRemoveFiles).not.toHaveBeenCalled();
  });

  it("does not call removeFiles when dryRun=true", async () => {
    await executeMigration(makeOptions({ clean: true, dryRun: true }));

    expect(mockRemoveFiles).not.toHaveBeenCalled();
  });

  it("includes ci advice from scanCiWorkflows", async () => {
    const advice = [
      {
        file: "/project/.github/workflows/release.yml",
        removeLine: "npx np",
        addLine: "npx pubm --phase publish",
      },
    ];
    mockScanCiWorkflows.mockReturnValue(advice);

    const result = await executeMigration(makeOptions());

    expect(mockScanCiWorkflows).toHaveBeenCalledWith("/project", "np");
    expect(result.ciAdvice).toEqual(advice);
  });

  it("passes changeset .md files from relatedFiles to converter", async () => {
    const detected = makeDetected({
      relatedFiles: [
        "/project/.changeset/feat-foo.md",
        "/project/.changeset/README.md",
        "/project/some-other-file.json",
      ],
    });

    await executeMigration(makeOptions({ detected }));

    expect(mockConvertToPublishConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        changesetFiles: [
          "/project/.changeset/feat-foo.md",
          "/project/.changeset/README.md",
        ],
      }),
    );
  });

  it("throws when pubm.config.ts already exists", async () => {
    mockExistsSync.mockReturnValue(true);

    await expect(executeMigration(makeOptions())).rejects.toThrow(
      "pubm.config.ts already exists",
    );
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("calls migrateFromChangesets when adapter is changesets", async () => {
    const adapter: MigrationSource = {
      name: "changesets",
      configFilePatterns: [],
      detect: vi.fn(),
      parse: vi.fn().mockResolvedValue(makeParsed()),
      convert: vi.fn(),
      getCleanupTargets: vi.fn().mockReturnValue([]),
    };

    await executeMigration(makeOptions({ adapter, clean: true }));

    expect(mockMigrateFromChangesets).toHaveBeenCalledWith("/project");
  });

  it("does not call migrateFromChangesets for non-changesets adapter", async () => {
    await executeMigration(makeOptions());

    expect(mockMigrateFromChangesets).not.toHaveBeenCalled();
  });
});
