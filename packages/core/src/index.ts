import type { PubmContext } from "./context.js";
import { PluginRunner } from "./plugin/runner.js";
import { run } from "./workflow/runner-entry.js";

/**
 * Runs the pubm publish pipeline with the provided context.
 *
 * @async
 * @function
 */
export async function pubm(ctx: PubmContext): Promise<void> {
  if (ctx.config.discoveryEmpty) {
    throw new Error(
      "[pubm] No publishable packages found. Add a pubm.config.ts with a packages array, or ensure your workspace contains non-private packages.",
    );
  }

  ctx.runtime.pluginRunner = new PluginRunner(ctx.config.plugins);
  await run(ctx);
}

// External re-exports
export { color } from "@pubm/runner";
export type {
  AssetPipelineHooks,
  CompressedAsset,
  CompressFormat,
  CompressOption,
  ParsedPlatform,
  PreparedAsset,
  ReleaseAsset,
  ReleaseAssetEntry,
  ReleaseAssetFileConfig,
  ReleaseAssetGroupConfig,
  ReleaseContext,
  ResolvedAsset,
  ResolvedAssetFileConfig,
  TransformedAsset,
  UploadedAsset,
} from "./assets/index.js";
export {
  normalizeConfig,
  parsePlatform,
  resolveAssets,
  runAssetPipeline,
} from "./assets/index.js";
// Changelog (new module)
export { ChangesetChangelogWriter } from "./changelog/changeset-writer.js";
export { ConventionalCommitChangelogWriter } from "./changelog/conventional-commit-writer.js";
export type { BumpGroup } from "./changelog/renderer.js";
export { renderChangelog } from "./changelog/renderer.js";
export type { ChangelogSection, ChangelogWriter } from "./changelog/types.js";
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
  createKeyResolver,
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
  RollbackConfig,
} from "./config/index.js";
// Config
export { defineConfig, loadConfig, resolveConfig } from "./config/index.js";
export type { ResolvedPackageConfig } from "./config/types.js";
export type {
  FixedVersionPlan,
  IndependentVersionPlan,
  PubmContext,
  SingleVersionPlan,
  VersionPlan,
} from "./context.js";
// Context
export { createContext, getPackageVersion, resolveVersion } from "./context.js";
// Conventional commit
export {
  analyzeCommits,
  findLastReleaseRef,
  getCommitsSinceRef,
  parseConventionalCommit,
  resolveCommitPackages,
} from "./conventional-commit/index.js";
export type {
  CommitTypeMapping,
  ConventionalCommit,
} from "./conventional-commit/types.js";
// Registry catalog
export type { EcosystemKey } from "./ecosystem/catalog.js";
export { ecosystemCatalog } from "./ecosystem/catalog.js";
// Ecosystem
export { EcosystemDescriptor } from "./ecosystem/descriptor.js";
export type { Ecosystem } from "./ecosystem/ecosystem.js";
export { JsEcosystemDescriptor } from "./ecosystem/js-descriptor.js";
export { RustEcosystemDescriptor } from "./ecosystem/rust-descriptor.js";
// Error
export { consoleError } from "./error.js";
// Git
export { extractPrefix, extractVersion, Git } from "./git.js";
export type { SupportedLocale } from "./i18n/index.js";
// i18n
export {
  getLocale,
  initI18n,
  resolveLocale,
  SUPPORTED_LOCALES,
  t,
} from "./i18n/index.js";
export type { InspectPackagesResult } from "./inspect.js";
// Inspect
export { inspectPackages } from "./inspect.js";
// Manifest
export {
  ManifestReader,
  type ManifestSchema,
  type PackageManifest,
  writeVersionsForEcosystem,
} from "./manifest/index.js";
export type {
  CiAdvice,
  ConvertResult,
  DetectedSource,
  DetectResult,
  ExecuteOptions,
  MigrationOptions,
  MigrationPipelineResult,
  MigrationSource,
  MigrationSourceName,
  ParsedMigrationConfig,
} from "./migrate/index.js";
// Migration
export {
  changesetsAdapter,
  convertToPublishConfig,
  detectMigrationSources,
  executeMigration,
  generateConfigString,
  npAdapter,
  releaseItAdapter,
  removeFiles,
  scanCiWorkflows,
  semanticReleaseAdapter,
} from "./migrate/index.js";
export type {
  DiscoverOptions,
  PackageNode,
  ResolvedPackage,
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
// Options
export { resolveOptions } from "./options.js";
export type {
  AfterReleaseHookFn,
  ErrorHookFn,
  HookFn,
  HookName,
  PluginCheck,
  PluginCommand,
  PluginCommandOption,
  PluginCredential,
  PluginHooks,
  PluginSubcommand,
  PluginTaskContext,
  PubmPlugin,
} from "./plugin/index.js";
export { PluginRunner } from "./plugin/index.js";
// Plugin registry definition (external interface)
export type { PluginRegistryDefinition } from "./plugin/types.js";
export type {
  RegistryDescriptor,
  TokenEntry,
} from "./registry/catalog.js";
export { RegistryCatalog, registryCatalog } from "./registry/catalog.js";
export type {
  CloseVersionPrOptions,
  CreateVersionPrOptions,
  CreateVersionPrResult,
} from "./tasks/create-version-pr.js";
// Tasks
export {
  closeVersionPr,
  createVersionPr,
} from "./tasks/create-version-pr.js";
export type { GhSecretEntry } from "./tasks/preflight.js";
export { collectPluginCredentials, syncGhSecrets } from "./tasks/preflight.js";
export { requiredMissingInformationTasks } from "./tasks/required-missing-information.js";
export type { SnapshotRunnerOptions } from "./tasks/snapshot-runner.js";
export {
  applySnapshotFilter,
  buildSnapshotVersionPlan,
  runSnapshotPipeline,
} from "./tasks/snapshot-runner.js";
// Task factory
export type { RegistryTaskFactory } from "./tasks/task-factory.js";
export type {
  BuildVersionPrBodyOptions,
  VersionPrPackageInfo,
} from "./tasks/version-pr-body.js";
export { buildVersionPrBody } from "./tasks/version-pr-body.js";
export type { Options, ReleaseMode, ResolvedOptions } from "./types/options.js";
// Utils
export { exec } from "./utils/exec.js";
export type { GitHubTokenResult } from "./utils/github-token.js";
export { resolveGitHubToken, saveGitHubToken } from "./utils/github-token.js";
export { notifyNewVersion } from "./utils/notify-new-version.js";
export { packageKey, pathFromKey } from "./utils/package-key.js";
export { getPackageManager } from "./utils/package-manager.js";
export { PUBM_ENGINES, PUBM_VERSION } from "./utils/pubm-metadata.js";
export type { ReleasePhase } from "./utils/resolve-phases.js";
export { resolvePhases, validateOptions } from "./utils/resolve-phases.js";
export type {
  RollbackAction,
  RollbackExecuteOptions,
  RollbackResult,
} from "./utils/rollback.js";
export { RollbackTracker } from "./utils/rollback.js";
export type { Runtime } from "./utils/runtime.js";
export { detectRuntime, isBun } from "./utils/runtime.js";
export type { SnapshotOptions } from "./utils/snapshot.js";
export { generateSnapshotVersion } from "./utils/snapshot.js";
export { injectPluginTokensToEnv, loadTokensFromDb } from "./utils/token.js";
export { ui } from "./utils/ui.js";
export type { EntryPointError, ExtraneousFile } from "./validate/index.js";
// Validation
export {
  detectExtraneousFiles,
  validateEntryPoints,
} from "./validate/index.js";
// Version source
export { ChangesetSource } from "./version-source/changeset-source.js";
export { ConventionalCommitSource } from "./version-source/conventional-commit-source.js";
export { mergeRecommendations } from "./version-source/merge.js";
export type {
  VersionEntry,
  VersionRecommendation,
  VersionSource,
  VersionSourceContext,
} from "./version-source/types.js";
