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

export type {
  BumpType,
  ChangelogEntry,
  Changeset,
  DependencyUpdate,
  MigrationResult,
  PackageStatus,
  Release,
  Status,
  VersionBump,
} from "./changeset/index.js";
// Changeset workflow
export {
  calculateVersionBumps,
  generateChangelog,
  generateChangesetContent,
  generateChangesetId,
  getStatus,
  migrateFromChangesets,
  parseChangeset,
  readChangesets,
  writeChangeset,
} from "./changeset/index.js";
export type {
  PackageConfig,
  PubmConfig,
  ResolvedPubmConfig,
} from "./config/index.js";
// Config
export { defineConfig, loadConfig, resolveConfig } from "./config/index.js";
export type { PackageNode, WorkspaceInfo } from "./monorepo/index.js";

// Monorepo
export {
  applyFixedGroup,
  applyLinkedGroup,
  buildDependencyGraph,
  detectWorkspace,
  resolveGroups,
  topologicalSort,
} from "./monorepo/index.js";
export type { PreState, SnapshotOptions } from "./prerelease/index.js";

// Pre-release
export {
  enterPreMode,
  exitPreMode,
  generateSnapshotVersion,
  readPreState,
} from "./prerelease/index.js";
export type { Options } from "./types/options.js";
export type { EntryPointError, ExtraneousFile } from "./validate/index.js";
// Validation
export {
  detectExtraneousFiles,
  validateEntryPoints,
} from "./validate/index.js";
