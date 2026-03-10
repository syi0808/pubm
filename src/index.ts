import { resolveConfig } from "./config/defaults.js";
import { loadConfig } from "./config/loader.js";
import { resolveOptions } from "./options.js";
import { PluginRunner } from "./plugin/runner.js";
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
  const config = await loadConfig();
  const plugins = config?.plugins ?? [];
  const pluginRunner = new PluginRunner(plugins);
  const configOptions: Partial<Options> = {};

  if (config) {
    const resolved = resolveConfig(config);
    if (resolved.packages) {
      configOptions.packages = resolved.packages;
    }
    if (!options.registries && resolved.registries) {
      configOptions.registries = resolved.registries;
    }
  }

  // CLI options spread last to take precedence over config.
  // resolveOptions filters undefined values, so config.packages survives.
  const resolvedOptions = resolveOptions({ ...configOptions, ...options });

  await run({ ...resolvedOptions, pluginRunner });
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
  buildChangelogEntries,
  calculateVersionBumps,
  deleteChangesetFiles,
  generateChangelog,
  generateChangesetContent,
  generateChangesetId,
  getStatus,
  migrateFromChangesets,
  parseChangelogSection,
  parseChangeset,
  readChangesets,
  writeChangelogToFile,
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
export type {
  AfterReleaseHookFn,
  ErrorHookFn,
  HookFn,
  HookName,
  PluginCommand,
  PluginCommandOption,
  PluginHooks,
  PluginSubcommand,
  PubmPlugin,
} from "./plugin/index.js";
export { PluginRunner } from "./plugin/index.js";
export type {
  ExternalVersionSyncOptions,
  JsonTarget,
  RegexTarget,
  SyncTarget,
} from "./plugins/external-version-sync/index.js";
// External version sync plugin
export { externalVersionSync } from "./plugins/external-version-sync/index.js";
export type { PreState, SnapshotOptions } from "./prerelease/index.js";
// Pre-release
export {
  enterPreMode,
  exitPreMode,
  generateSnapshotVersion,
  readPreState,
} from "./prerelease/index.js";
export type { ReleaseAsset, ReleaseContext } from "./tasks/github-release.js";
export type { Options } from "./types/options.js";
export type { Runtime } from "./utils/runtime.js";
export { detectRuntime, isBun } from "./utils/runtime.js";
export type { EntryPointError, ExtraneousFile } from "./validate/index.js";
// Validation
export {
  detectExtraneousFiles,
  validateEntryPoints,
} from "./validate/index.js";
