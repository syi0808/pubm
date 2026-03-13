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
    // registries are now per-package, not global
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
  PackageVersionInfo,
  Release,
  Status,
  VersionBump,
} from "./changeset/index.js";
// Changeset workflow
export {
  buildChangelogEntries,
  calculateVersionBumps,
  deleteChangesetFiles,
  discoverCurrentVersions,
  discoverPackageInfos,
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
// Error
export { consoleError } from "./error.js";
// Git
export { Git } from "./git.js";
export type {
  DiscoveredPackage,
  DiscoverOptions,
  PackageNode,
  WorkspaceInfo,
} from "./monorepo/index.js";
// Monorepo
export {
  applyFixedGroup,
  applyLinkedGroup,
  buildDependencyGraph,
  detectWorkspace,
  discoverPackages,
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
export type { ReleaseAsset, ReleaseContext } from "./tasks/github-release.js";
export { syncGhSecrets } from "./tasks/preflight.js";
// Tasks
export { requiredMissingInformationTasks } from "./tasks/required-missing-information.js";
export type { Options } from "./types/options.js";
// Utils
export { exec } from "./utils/exec.js";
export { notifyNewVersion } from "./utils/notify-new-version.js";
export {
  getPackageJson,
  replaceVersion,
  replaceVersionAtPath,
  version,
} from "./utils/package.js";
export { getPackageManager } from "./utils/package-manager.js";
export { PUBM_ENGINES, PUBM_VERSION } from "./utils/pubm-metadata.js";
export type { Runtime } from "./utils/runtime.js";
export { detectRuntime, isBun } from "./utils/runtime.js";
export type { SnapshotOptions } from "./utils/snapshot.js";
export { generateSnapshotVersion } from "./utils/snapshot.js";
export { loadTokensFromDb } from "./utils/token.js";
export type { EntryPointError, ExtraneousFile } from "./validate/index.js";
// Validation
export {
  detectExtraneousFiles,
  validateEntryPoints,
} from "./validate/index.js";
