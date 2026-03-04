import { resolveOptions } from "./options.js";
import { run } from "./tasks/runner.js";
import type { Options } from "./types/options.js";

/**
 * Runs the `pubm` function with the provided options.
 *
 * This function executes the publish process using the specified options.
 * The `version` field in the `options` parameter is required for the function
 * to run correctly.
 *
 * @async
 * @function
 */
export async function pubm(options: Options): Promise<void> {
  const resolvedOptions = resolveOptions({ ...options });

  await run(resolvedOptions);
}

export type { Options } from "./types/options.js";

// Config
export { defineConfig, loadConfig, resolveConfig } from "./config/index.js";
export type {
  PackageConfig,
  PubmConfig,
  ResolvedPubmConfig,
} from "./config/index.js";

// Changeset workflow
export {
  parseChangeset,
  writeChangeset,
  generateChangesetContent,
  generateChangesetId,
  readChangesets,
  getStatus,
  calculateVersionBumps,
  generateChangelog,
  migrateFromChangesets,
} from "./changeset/index.js";

export type {
  Changeset,
  Release,
  BumpType,
  PackageStatus,
  Status,
  VersionBump,
  ChangelogEntry,
  DependencyUpdate,
  MigrationResult,
} from "./changeset/index.js";

// Monorepo
export {
  detectWorkspace,
  buildDependencyGraph,
  topologicalSort,
  resolveGroups,
  applyFixedGroup,
  applyLinkedGroup,
} from "./monorepo/index.js";

export type { WorkspaceInfo, PackageNode } from "./monorepo/index.js";

// Pre-release
export {
  readPreState,
  enterPreMode,
  exitPreMode,
  generateSnapshotVersion,
} from "./prerelease/index.js";

export type { PreState, SnapshotOptions } from "./prerelease/index.js";

// Validation
export {
  validateEntryPoints,
  detectExtraneousFiles,
} from "./validate/index.js";

export type { EntryPointError, ExtraneousFile } from "./validate/index.js";
