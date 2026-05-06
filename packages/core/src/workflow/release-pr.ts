import path from "node:path";
import micromatch from "micromatch";
import { gt, valid } from "semver";
import type { ResolvedPubmConfig } from "../config/types.js";
import type { PubmContext, VersionPlan } from "../context.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { Git } from "../git.js";
import { PluginRunner } from "../plugin/runner.js";
import { buildReleaseBody } from "../tasks/release-notes.js";
import { packageKey, pathFromKey } from "../utils/package-key.js";
import type { ReleaseOperationContext } from "./release-operation.js";
import { runReleaseOperations } from "./release-operation.js";
import { createDryRunOperations } from "./release-phases/dry-run.js";
import {
  prepareVersionMaterialization,
  writeReleaseFiles,
} from "./release-phases/materialize.js";
import { createPublishOperations } from "./release-phases/publish.js";
import { createGitHubReleaseOperation } from "./release-phases/push-release.js";
import {
  commitReleaseFiles,
  createLocalReleaseTags,
  ensureReleaseTagsAvailable,
} from "./release-phases/tags.js";
import {
  parseReleasePrReleaseNotes,
  RELEASE_PR_BODY_MARKER,
  RELEASE_PR_RELEASE_NOTES_END_MARKER,
  RELEASE_PR_RELEASE_NOTES_START_MARKER,
  renderReleasePrMetadataMarker,
} from "./release-utils/release-pr-metadata.js";
import {
  renderReleasePrBranch,
  renderReleasePrTitle,
} from "./release-utils/release-pr-naming.js";
import {
  applyReleaseOverride,
  type ReleasePrOverride,
} from "./release-utils/release-pr-overrides.js";
import {
  formatTag,
  registerRemoteTagRollbackForTag,
} from "./release-utils/rollback-handlers.js";
import {
  buildReleasePrScopes,
  type ReleasePrScope,
} from "./release-utils/scope.js";
import {
  createWorkflowVersionTagReferences,
  type WorkflowVersionTagReference,
} from "./version-step-output.js";

export interface PrepareReleasePrInput {
  scope: ReleasePrScope;
  override?: ReleasePrOverride;
  commit?: boolean;
}

export interface PreparedReleasePr {
  scope: ReleasePrScope;
  versionPlan: VersionPlan;
  versionSummary: string;
  branchName: string;
  title: string;
  body: string;
  changedFiles: string[];
  commitSha?: string;
}

export interface PrepareReleasePrPublishInput {
  beforeSha: string;
  afterSha: string;
}

export interface ReleasePrPublishPlan {
  scope: ReleasePrScope;
  versionPlan: VersionPlan;
  tagReferences: WorkflowVersionTagReference[];
}

export interface PublishReleasePrInput {
  plan: ReleasePrPublishPlan;
  pushTags?: boolean;
  createGitHubRelease?: boolean;
  releaseNotes?: ReleasePrReleaseNotesInput | string;
}

export interface ReleasePrReleaseNotesInput {
  fixed?: string;
  byPackageKey?: ReadonlyMap<string, string> | Record<string, string>;
}

export async function prepareReleasePr(
  ctx: PubmContext,
  input: PrepareReleasePrInput,
): Promise<PreparedReleasePr> {
  const originalPlan = requireRuntimeVersionPlan(ctx);
  const planWithOverride = input.override
    ? applyReleaseOverride(ctx, originalPlan, input.scope, input.override)
    : originalPlan;
  const scopedPlan = scopeVersionPlan(planWithOverride, input.scope);
  const originalConfig = ctx.config;
  const originalRuntimePlan = ctx.runtime.versionPlan;
  const workflowRuntime = ctx.runtime as {
    workflowVersionStepOutput?: unknown;
  };
  const hadWorkflowVersionStepOutput =
    "workflowVersionStepOutput" in workflowRuntime;
  const originalWorkflowVersionStepOutput =
    workflowRuntime.workflowVersionStepOutput;
  const packageKeys = new Set(input.scope.packageKeys);

  ctx.config = filterConfigForPackageKeys(ctx.config, packageKeys);
  ctx.runtime.versionPlan = scopedPlan;

  try {
    const task = createActionSafeOperationContext();
    const prepared = await prepareVersionMaterialization(ctx, task);
    await writeReleaseFiles(ctx, task, prepared, {
      dryRun: false,
      consumeChangesets: "scope",
      packageKeys,
    });
    const changedFiles = await readChangedFiles();
    const commitSha =
      input.commit === false
        ? undefined
        : await commitReleaseFiles(
            ctx,
            task,
            prepared.versionMap,
            prepared.tagReferences,
          );
    const versionSummary = releasePrVersionSummary(scopedPlan);
    const releaseNotesPreview = await buildReleasePrReleaseNotesPreview(
      ctx,
      scopedPlan,
    );

    return {
      scope: input.scope,
      versionPlan: scopedPlan,
      versionSummary,
      branchName: renderReleasePrBranch({
        ctx,
        scope: input.scope,
        version: versionSummary,
        template: ctx.config.release.pullRequest.branchTemplate,
      }),
      title: renderReleasePrTitle({
        ctx,
        scope: input.scope,
        version: versionSummary,
        template: ctx.config.release.pullRequest.titleTemplate,
      }),
      body: renderReleasePrBody(
        input.scope,
        scopedPlan,
        releaseNotesPreview,
        input.override,
      ),
      changedFiles,
      ...(commitSha ? { commitSha } : {}),
    };
  } finally {
    ctx.config = originalConfig;
    ctx.runtime.versionPlan = originalRuntimePlan;
    if (hadWorkflowVersionStepOutput) {
      workflowRuntime.workflowVersionStepOutput =
        originalWorkflowVersionStepOutput;
    } else {
      delete workflowRuntime.workflowVersionStepOutput;
    }
  }
}

export async function prepareReleasePrPublish(
  ctx: PubmContext,
  input: PrepareReleasePrPublishInput,
): Promise<ReleasePrPublishPlan | undefined> {
  const changedPackageKeys = await findChangedVersionPackageKeys(ctx, input);
  if (changedPackageKeys.size === 0) return undefined;

  const fullPlan = createVersionPlanFromManifestVersions(ctx.config);
  const scope = matchReleasePrScopeForPackageKeys(
    ctx,
    fullPlan,
    changedPackageKeys,
  );
  const versionPlan = scopeVersionPlan(fullPlan, scope);
  return {
    scope,
    versionPlan,
    tagReferences: createWorkflowVersionTagReferences(ctx, versionPlan, {
      strictQualifiedTags: true,
    }),
  };
}

export async function runReleasePrDryRun(
  ctx: PubmContext,
  scope: ReleasePrScope,
): Promise<void> {
  const originalConfig = ctx.config;
  const originalPlan = ctx.runtime.versionPlan;
  const originalPluginRunner = ctx.runtime.pluginRunner;
  const packageKeys = new Set(scope.packageKeys);
  ctx.config = filterConfigForPackageKeys(ctx.config, packageKeys);
  ctx.runtime.versionPlan = scopeVersionPlan(requireRuntimeVersionPlan(ctx), {
    packageKeys: scope.packageKeys,
  });
  ensurePluginRunner(ctx);

  try {
    await runReleaseOperations(
      ctx,
      createDryRunOperations(false, true, false, { packageKeys }),
    );
  } finally {
    ctx.config = originalConfig;
    ctx.runtime.versionPlan = originalPlan;
    ctx.runtime.pluginRunner = originalPluginRunner;
  }
}

export async function publishReleasePr(
  ctx: PubmContext,
  input: PublishReleasePrInput,
): Promise<void> {
  const originalConfig = ctx.config;
  const originalPlan = ctx.runtime.versionPlan;
  const originalPluginRunner = ctx.runtime.pluginRunner;
  const packageKeys = new Set(input.plan.scope.packageKeys);
  ctx.config = filterConfigForPackageKeys(ctx.config, packageKeys);
  ctx.runtime.versionPlan = input.plan.versionPlan;
  ensurePluginRunner(ctx);

  try {
    const task = createActionSafeOperationContext();
    await ensureReleaseTagsAvailable(ctx, task, input.plan.tagReferences);
    const head = await new Git().revParse("HEAD");
    await createLocalReleaseTags(ctx, task, head, input.plan.tagReferences);
    if (input.pushTags !== false) {
      await pushReleaseTags(ctx, input.plan.tagReferences);
    }
    await runReleaseOperations(
      ctx,
      createPublishOperations(true, false, false, { packageKeys }),
    );
    if (input.createGitHubRelease !== false) {
      await runReleaseOperations(
        ctx,
        createGitHubReleaseOperation(true, false, false, false, {
          packageKeys,
          releaseNotes: normalizeReleaseNotesInput(
            input.releaseNotes,
            input.plan.scope,
          ),
        }),
      );
    }
  } catch (error) {
    await ctx.runtime.rollback.execute(ctx, {
      interactive: ctx.runtime.promptEnabled,
    });
    throw error;
  } finally {
    ctx.config = originalConfig;
    ctx.runtime.versionPlan = originalPlan;
    ctx.runtime.pluginRunner = originalPluginRunner;
  }
}

export function createVersionPlanFromManifestVersions(
  config: ResolvedPubmConfig,
): VersionPlan {
  const packages = new Map(
    config.packages.map((pkg) => [packageKey(pkg), pkg.version]),
  );

  if (packages.size > 0 && config.versioning === "fixed") {
    const version =
      highestManifestVersion(config.packages.map((pkg) => pkg.version)) ?? "";
    return {
      mode: "fixed",
      version,
      packages: new Map([...packages.keys()].map((key) => [key, version])),
    };
  }

  if (config.packages.length <= 1) {
    const pkg = config.packages[0];
    return {
      mode: "single",
      version: pkg?.version ?? "",
      packageKey: pkg ? packageKey(pkg) : ".",
    };
  }

  return { mode: "independent", packages };
}

function highestManifestVersion(
  versions: readonly string[],
): string | undefined {
  let highest: string | undefined;
  for (const version of versions) {
    if (!valid(version)) continue;
    if (!highest || gt(version, highest)) highest = version;
  }
  return highest;
}

export function scopeVersionPlan(
  plan: VersionPlan,
  scope: Pick<ReleasePrScope, "packageKeys">,
): VersionPlan {
  const packageKeys = new Set(scope.packageKeys);

  if (plan.mode === "single") return plan;

  const packages = new Map(
    [...plan.packages].filter(([key]) => packageKeys.has(key)),
  );

  if (plan.mode === "fixed") {
    return {
      mode: "fixed",
      version: [...packages.values()][0] ?? plan.version,
      packages,
    };
  }

  return { mode: "independent", packages };
}

function requireRuntimeVersionPlan(ctx: PubmContext): VersionPlan {
  const plan = ctx.runtime.versionPlan;
  if (!plan) throw new Error("Version plan is required for release PR.");
  return plan;
}

function filterConfigForPackageKeys(
  config: ResolvedPubmConfig,
  packageKeys: ReadonlySet<string>,
): ResolvedPubmConfig {
  const releaseVersioning = {
    ...config.release.versioning,
    fixed: prunePackageGroups(
      config,
      config.release.versioning.fixed,
      packageKeys,
    ),
    linked: prunePackageGroups(
      config,
      config.release.versioning.linked,
      packageKeys,
    ),
  };
  const releasePullRequest = {
    ...config.release.pullRequest,
    fixed: prunePackageGroups(
      config,
      config.release.pullRequest.fixed,
      packageKeys,
    ),
    linked: prunePackageGroups(
      config,
      config.release.pullRequest.linked,
      packageKeys,
    ),
  };

  return Object.freeze({
    ...config,
    packages: config.packages.filter((pkg) => packageKeys.has(packageKey(pkg))),
    fixed: releaseVersioning.fixed,
    linked: releaseVersioning.linked,
    release: {
      ...config.release,
      versioning: releaseVersioning,
      pullRequest: releasePullRequest,
    },
  });
}

function prunePackageGroups(
  config: ResolvedPubmConfig,
  groups: readonly (readonly string[])[],
  packageKeys: ReadonlySet<string>,
): string[][] {
  return groups
    .map((group) =>
      resolveGroupPackageKeys(config, group).filter((key) =>
        packageKeys.has(key),
      ),
    )
    .filter((group) => group.length > 0);
}

function resolveGroupPackageKeys(
  config: ResolvedPubmConfig,
  group: readonly string[],
): string[] {
  const keys = new Set<string>();
  for (const ref of group) {
    for (const pkg of config.packages) {
      const key = packageKey(pkg);
      const aliases = [key, pkg.path, pkg.name].filter(Boolean) as string[];
      if (
        aliases.some((alias) => alias === ref || micromatch.isMatch(alias, ref))
      ) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

function createActionSafeOperationContext(): ReleaseOperationContext {
  return {
    title: "",
    output: "",
    prompt: () => ({
      run: async () => {
        throw new Error("Release PR core APIs cannot prompt for input.");
      },
    }),
    runOperations: async () => {
      throw new Error("Release PR core APIs do not run nested operations.");
    },
    runTasks: async () => {
      throw new Error("Release PR core APIs do not run nested tasks.");
    },
    skip: (message?: string) => {
      throw new Error(message ?? "Release PR operation skipped.");
    },
  };
}

function ensurePluginRunner(ctx: PubmContext): void {
  ctx.runtime.pluginRunner = new PluginRunner(ctx.config.plugins);
}

async function readChangedFiles(): Promise<string[]> {
  const status = await new Git().status();
  return status
    .split("\n")
    .map((line) => line.trim().slice(3))
    .filter(Boolean);
}

function releasePrVersionSummary(plan: VersionPlan): string {
  if (plan.mode === "single") return plan.version;
  if (plan.mode === "fixed") return plan.version;
  const versions = new Set(plan.packages.values());
  return versions.size === 1 ? [...versions][0] : "multiple";
}

function matchReleasePrScopeForPackageKeys(
  ctx: PubmContext,
  plan: VersionPlan,
  packageKeys: ReadonlySet<string>,
): ReleasePrScope {
  const sortedPackageKeys = [...packageKeys].sort();
  const scopes = buildReleasePrScopes(ctx, plan);
  const matchedScope = scopes.find((scope) =>
    samePackageKeySet(scope.packageKeys, sortedPackageKeys),
  );
  if (matchedScope) return matchedScope;

  return {
    id: "publish",
    kind:
      plan.mode === "single"
        ? "single"
        : plan.mode === "fixed"
          ? "fixed"
          : sortedPackageKeys.length === 1
            ? "package"
            : "group",
    packageKeys: sortedPackageKeys,
    displayName: "publish",
    slug: "publish",
  };
}

function samePackageKeySet(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((key, index) => key === sortedB[index]);
}

async function pushReleaseTags(
  ctx: PubmContext,
  tagReferences: readonly WorkflowVersionTagReference[],
): Promise<void> {
  const git = new Git();
  for (const reference of tagReferences) {
    await git.git(["push", "origin", reference.tagName]);
    registerRemoteTagRollbackForTag(ctx, reference.tagName);
  }
}

export { parseReleasePrReleaseNotes };

async function buildReleasePrReleaseNotesPreview(
  ctx: PubmContext,
  plan: VersionPlan,
): Promise<string> {
  const repositoryUrl = await resolveRepositoryUrl();

  if (plan.mode === "independent") {
    const sections = await Promise.all(
      [...plan.packages].map(async ([key, version]) => {
        const body = await buildReleaseBody(ctx, {
          pkgPath: pathFromKey(key),
          version,
          tag: formatTag(ctx, key, version),
          repositoryUrl,
        });
        return plan.packages.size === 1 ? body : `### ${key}\n\n${body}`.trim();
      }),
    );
    return sections.join("\n\n");
  }

  const version = plan.version;
  return buildReleaseBody(ctx, {
    pkgPath: plan.mode === "single" ? pathFromKey(plan.packageKey) : undefined,
    version,
    tag: `v${version}`,
    repositoryUrl,
  });
}

async function resolveRepositoryUrl(): Promise<string> {
  return (await new Git().repository())
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

function renderReleasePrBody(
  scope: ReleasePrScope,
  plan: VersionPlan,
  releaseNotesPreview: string,
  override?: ReleasePrOverride,
): string {
  const versions =
    plan.mode === "single"
      ? [[plan.packageKey, plan.version]]
      : [...plan.packages];

  return [
    RELEASE_PR_BODY_MARKER,
    renderReleasePrMetadataMarker(scope),
    "",
    "This release PR is managed by pubm. Do not edit the release branch directly.",
    "",
    "## Release Notes Preview",
    "",
    "<details open>",
    "<summary><strong>Content copied to GitHub Release</strong></summary>",
    "",
    RELEASE_PR_RELEASE_NOTES_START_MARKER,
    releaseNotesPreview,
    RELEASE_PR_RELEASE_NOTES_END_MARKER,
    "",
    "</details>",
    "",
    "Edit only the preview above when you want to customize the final GitHub Release notes.",
    "",
    "## Scope",
    "",
    `- ${scope.displayName}`,
    "",
    "## Versions",
    "",
    ...versions.map(([key, version]) => `- ${key}: ${version}`),
    "",
    "## Override",
    "",
    override ? `- ${override.source}: ${override.kind}` : "- none",
    "",
  ].join("\n");
}

function normalizeReleaseNotesInput(
  input: ReleasePrReleaseNotesInput | string | undefined,
  scope: ReleasePrScope,
): ReleasePrReleaseNotesInput | undefined {
  if (!input) return undefined;

  if (typeof input === "string") {
    const body = input.trim();
    if (!body) return undefined;
    const byPackageKey =
      splitReleaseNotesByPackageSections(body, scope.packageKeys) ??
      new Map(scope.packageKeys.map((key) => [key, body]));
    return {
      fixed: body,
      byPackageKey,
    };
  }

  const fixed = input.fixed?.trim();
  const byPackageKey = normalizePackageNoteMap(input.byPackageKey);
  if (!fixed && (!byPackageKey || byPackageKey.size === 0)) return undefined;

  return {
    ...(fixed ? { fixed } : {}),
    ...(byPackageKey ? { byPackageKey } : {}),
  };
}

function normalizePackageNoteMap(
  input: ReleasePrReleaseNotesInput["byPackageKey"],
): ReadonlyMap<string, string> | undefined {
  if (!input) return undefined;

  const entries =
    input instanceof Map ? [...input.entries()] : Object.entries(input);
  const normalized = new Map<string, string>();
  for (const [key, body] of entries) {
    const value = body.trim();
    if (value) normalized.set(key, value);
  }

  return normalized.size > 0 ? normalized : undefined;
}

function splitReleaseNotesByPackageSections(
  body: string,
  packageKeys: readonly string[],
): ReadonlyMap<string, string> | undefined {
  if (packageKeys.length < 2) return undefined;

  const packageKeySet = new Set(packageKeys);
  const headingPattern = /^###\s+(.+)$/gm;
  const matches = [...body.matchAll(headingPattern)]
    .map((match) => ({
      key: match[1]?.trim() ?? "",
      start: match.index ?? 0,
      contentStart: (match.index ?? 0) + match[0].length,
    }))
    .filter((match) => packageKeySet.has(match.key));
  if (matches.length === 0) return undefined;

  const sections = new Map<string, string>();
  for (const [index, match] of matches.entries()) {
    const next = matches[index + 1];
    const end = next?.start ?? body.length;
    const section = body.slice(match.contentStart, end).trim();
    if (section) sections.set(match.key, section);
  }

  return sections.size > 0 ? sections : undefined;
}

async function findChangedVersionPackageKeys(
  ctx: PubmContext,
  input: PrepareReleasePrPublishInput,
): Promise<Set<string>> {
  const git = new Git();
  const raw = await git.git([
    "diff",
    "--name-only",
    input.beforeSha,
    input.afterSha,
  ]);
  const changedFiles = raw.split("\n").filter(Boolean);
  const result = new Set<string>();

  for (const pkg of ctx.config.packages) {
    const descriptor = ecosystemCatalog.get(pkg.ecosystem);
    if (!descriptor) continue;
    const manifestFiles = new descriptor.ecosystemClass(
      path.resolve(ctx.cwd, pkg.path),
    )
      .manifestFiles()
      .map((file) => path.join(pkg.path, file).replace(/\\/g, "/"));
    if (changedFiles.some((file) => manifestFiles.includes(file))) {
      result.add(packageKey(pkg));
    }
  }

  return result;
}
