declare module "@pubm/core" {
  export type BumpType = "patch" | "minor" | "major";
  export type ReleasePrBumpOverride = BumpType | "prerelease";

  export interface ChangesetRelease {
    path: string;
    ecosystem?: string;
    type: BumpType;
  }

  export interface Changeset {
    id: string;
    releases: ChangesetRelease[];
    summary: string;
  }

  export interface PackageConfig {
    name: string;
    path: string;
    version: string;
    ecosystem: string;
    [key: string]: unknown;
  }

  export interface ResolvedPubmConfig {
    branch: string;
    tag?: string;
    packages: PackageConfig[];
    plugins: unknown[];
    release: {
      versioning: {
        mode: "fixed" | "independent";
        fixed: string[][];
        linked: string[][];
        updateInternalDependencies: "patch" | "minor";
      };
      changesets: {
        directory: string;
      };
      commits: {
        format: "conventional";
        types: Record<string, BumpType | false>;
      };
      changelog: boolean | string;
      pullRequest: {
        label: string;
        branchTemplate?: string;
        titleTemplate?: string;
        bumpLabels: Partial<Record<ReleasePrBumpOverride, string>>;
        grouping: "fixed" | "independent";
        fixed: string[][];
        linked: string[][];
        unversionedChanges: "ignore" | "warn" | "fail";
        [key: string]: unknown;
      };
    };
    [key: string]: unknown;
  }

  export type VersionPlan =
    | { mode: "single"; version: string; packageKey: string }
    | { mode: "fixed"; version: string; packages: Map<string, string> }
    | { mode: "independent"; packages: Map<string, string> };

  export interface PubmContext {
    cwd: string;
    config: ResolvedPubmConfig;
    runtime: {
      versionPlan?: VersionPlan;
      releaseAnalysis?: {
        recommendations: unknown[];
        unversionedChanges: UnversionedChange[];
      };
      promptEnabled?: boolean;
      cleanWorkingTree?: boolean;
      pluginRunner?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export interface UnversionedChange {
    hash: string;
    summary: string;
    files: string[];
    reason: "non-conventional" | "ignored-type" | "unmatched-package";
    packagePath?: string;
    type?: string;
  }

  export interface ReleasePrScope {
    id: string;
    kind: "single" | "fixed" | "group" | "package";
    packageKeys: string[];
    displayName: string;
    slug: string;
  }

  export interface ReleasePrBodyMetadata {
    isReleasePr: boolean;
    scopeId?: string;
    packageKeys: string[];
    schemaVersion?: 1;
  }

  export type ReleasePrOverride =
    | {
        source: "label" | "slash";
        kind: "bump";
        bump: ReleasePrBumpOverride;
      }
    | {
        source: "slash";
        kind: "release-as";
        version: string;
      };

  export interface ReleasePrOverrideError {
    message: string;
    command?: string;
  }

  export interface SlashCommandComment {
    body: string;
    createdAt?: string | number | Date;
  }

  export class PluginRunner {
    constructor(plugins: unknown[]);
  }

  export function loadConfig(
    cwd: string,
  ): Promise<Record<string, unknown> | undefined>;
  export function resolveConfig(
    config: Record<string, unknown>,
    cwd: string,
  ): Promise<ResolvedPubmConfig>;
  export function createKeyResolver(
    packages: PackageConfig[],
  ): (key: string) => string;
  export function resolveOptions(options: Record<string, unknown>): unknown;
  export function createContext(
    config: ResolvedPubmConfig,
    options: unknown,
    cwd: string,
  ): PubmContext;
  export function parseChangeset(
    content: string,
    fileName: string,
    resolveKey?: (key: string) => string | undefined,
  ): Changeset;
  export function applyVersionSourcePlan(ctx: PubmContext): Promise<void>;
  export function buildReleasePrScopes(
    ctx: PubmContext,
    plan: VersionPlan,
  ): ReleasePrScope[];
  export function scopeVersionPlan(
    plan: VersionPlan,
    scope: Pick<ReleasePrScope, "packageKeys">,
  ): VersionPlan;
  export function renderReleasePrBranch(input: {
    ctx: PubmContext;
    scope: ReleasePrScope;
    version: string;
    template?: string;
  }): string;
  export function renderReleasePrTitle(input: {
    ctx: PubmContext;
    scope: ReleasePrScope;
    version: string;
    template?: string;
  }): string;
  export function parseReleasePrBodyMetadata(
    body: string | undefined | null,
  ): ReleasePrBodyMetadata;
  export function sameReleasePrScope(
    scope: ReleasePrScope,
    metadata: ReleasePrBodyMetadata,
  ): boolean;
  export function prepareReleasePr(
    ctx: PubmContext,
    input: {
      scope: ReleasePrScope;
      override?: ReleasePrOverride;
      commit?: boolean;
    },
  ): Promise<{
    scope: ReleasePrScope;
    versionPlan: VersionPlan;
    versionSummary: string;
    branchName: string;
    title: string;
    body: string;
    changedFiles: string[];
    commitSha?: string;
  }>;
  export function applyReleaseOverride(
    ctx: PubmContext,
    plan: VersionPlan,
    scope: ReleasePrScope,
    override: ReleasePrOverride,
  ): VersionPlan;
  export function resolveReleasePrOverride(input: {
    labels?: readonly string[];
    bumpLabels?: Partial<Record<ReleasePrBumpOverride, string>>;
    comments?: readonly SlashCommandComment[];
  }): { override?: ReleasePrOverride; errors: ReleasePrOverrideError[] };
  export function runReleasePrDryRun(
    ctx: PubmContext,
    scope: ReleasePrScope,
  ): Promise<void>;
  export function prepareReleasePrPublish(
    ctx: PubmContext,
    input: { beforeSha: string; afterSha: string },
  ): Promise<
    | {
        scope: ReleasePrScope;
        versionPlan: VersionPlan;
        tagReferences: unknown[];
      }
    | undefined
  >;
  export function publishReleasePr(
    ctx: PubmContext,
    input: {
      plan: unknown;
      pushTags?: boolean;
      createGitHubRelease?: boolean;
    },
  ): Promise<void>;
}
