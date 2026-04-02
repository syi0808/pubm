import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrateFromChangesets } from "../changeset/migrate.js";
import { scanCiWorkflows } from "./ci-advisor.js";
import { removeFiles } from "./cleanup.js";
import { generateConfigString } from "./config-writer.js";
import { convertToPublishConfig } from "./converter.js";
import type {
  DetectResult,
  MigrationPipelineResult,
  MigrationSource,
} from "./types.js";

export interface ExecuteOptions {
  adapter: MigrationSource;
  detected: DetectResult;
  cwd: string;
  dryRun: boolean;
  clean: boolean;
}

export async function executeMigration(
  options: ExecuteOptions,
): Promise<MigrationPipelineResult> {
  const { adapter, detected, cwd, dryRun, clean } = options;

  // Step 1: Parse config files
  const parsed = await adapter.parse(detected.configFiles, cwd);

  // Step 2: Convert to pubm config
  const changesetFiles = detected.relatedFiles.filter((f) => f.endsWith(".md"));
  const convertResult = convertToPublishConfig(parsed, { changesetFiles });

  // Step 3: Generate config string
  const configString = generateConfigString(convertResult.config);

  // Step 4: Scan CI workflows
  const ciAdvice = scanCiWorkflows(cwd, adapter.name);

  // Step 5: Write config file (unless dry-run)
  if (!dryRun) {
    const outFile = join(cwd, "pubm.config.ts");
    if (existsSync(outFile)) {
      throw new Error(
        "pubm.config.ts already exists. Remove or rename it before migrating.",
      );
    }
    writeFileSync(outFile, configString, "utf-8");
  }

  // Step 6: Migrate changeset files before cleanup (so they aren't lost)
  if (!dryRun && adapter.name === "changesets") {
    migrateFromChangesets(cwd);
  }

  // Step 7: Clean up source files (unless dry-run or clean=false)
  let cleanedFiles: string[] = [];
  if (!dryRun && clean) {
    cleanedFiles = removeFiles(adapter.getCleanupTargets(detected));
  }

  return {
    source: adapter.name,
    configWritten: !dryRun,
    cleanedFiles,
    warnings: convertResult.warnings,
    ciAdvice,
  };
}
