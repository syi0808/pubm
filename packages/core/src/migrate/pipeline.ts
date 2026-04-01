import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
    writeFileSync(join(cwd, "pubm.config.ts"), configString, "utf-8");
  }

  // Step 6: Clean up source files (unless dry-run or clean=false)
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
