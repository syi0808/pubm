import micromatch from "micromatch";
import type { PubmContext, VersionPlan } from "../context.js";
import { AbstractError } from "../error.js";
import { packageKey, pathFromKey } from "../utils/package-key.js";

export const WORKFLOW_VERSION_STEP_OUTPUT_KIND =
  "pubm.workflow.version-step-output.v1";

export type WorkflowVersionPlanMode = VersionPlan["mode"] | "unknown";

export interface WorkflowVersionPackageDecision {
  packageKey: string;
  packageName: string;
  version: string;
}

export interface WorkflowVersionTagReference {
  tagName: string;
  version: string;
  packageKeys: readonly string[];
  packageNames: readonly string[];
}

export interface WorkflowVersionStepOutput {
  kind: typeof WORKFLOW_VERSION_STEP_OUTPUT_KIND;
  versionPlanMode: WorkflowVersionPlanMode;
  summary: string;
  packageDecisions: readonly WorkflowVersionPackageDecision[];
  tagReferences: readonly WorkflowVersionTagReference[];
}

export interface WorkflowVersionTagReferenceOptions {
  strictQualifiedTags?: boolean;
}

export function createWorkflowVersionStepOutput(
  ctx: PubmContext,
): WorkflowVersionStepOutput {
  const plan = ctx.runtime.versionPlan;
  if (!plan) {
    return {
      kind: WORKFLOW_VERSION_STEP_OUTPUT_KIND,
      versionPlanMode: "unknown",
      summary: "",
      packageDecisions: [],
      tagReferences: [],
    };
  }

  const versionMap = createWorkflowVersionMap(ctx, plan);
  const tagReferences = createWorkflowVersionTagReferences(ctx, plan);
  return createWorkflowVersionStepOutputFromParts(
    ctx,
    plan,
    versionMap,
    tagReferences,
  );
}

export function createWorkflowVersionStepOutputFromParts(
  ctx: PubmContext,
  plan: VersionPlan,
  versionMap: readonly (readonly [string, string])[],
  tagReferences: readonly WorkflowVersionTagReference[],
): WorkflowVersionStepOutput {
  return cloneWorkflowVersionStepOutput({
    kind: WORKFLOW_VERSION_STEP_OUTPUT_KIND,
    versionPlanMode: plan.mode,
    summary: formatWorkflowVersionSummaryForPlan(ctx, plan),
    packageDecisions: versionMap.map(([key, version]) =>
      packageDecision(ctx, key, version),
    ),
    tagReferences,
  });
}

export function formatWorkflowVersionSummary(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (!plan) return "";
  return formatWorkflowVersionSummaryForPlan(ctx, plan);
}

export function pinWorkflowVersionStepOutput(
  ctx: PubmContext,
  output: WorkflowVersionStepOutput,
): void {
  workflowVersionRuntime(ctx).workflowVersionStepOutput =
    cloneWorkflowVersionStepOutput(output);
}

export function readPinnedWorkflowVersionStepOutput(
  ctx: PubmContext,
): WorkflowVersionStepOutput | undefined {
  const output = workflowVersionRuntime(ctx).workflowVersionStepOutput;
  return isWorkflowVersionStepOutput(output)
    ? cloneWorkflowVersionStepOutput(output)
    : undefined;
}

function formatWorkflowVersionSummaryForPlan(
  ctx: PubmContext,
  plan: VersionPlan,
): string {
  if (plan.mode === "independent") {
    return [...plan.packages]
      .map(
        ([key, version]) => `${workflowPackageNameForKey(ctx, key)}@${version}`,
      )
      .join(", ");
  }
  return `v${plan.version}`;
}

export function isWorkflowVersionStepOutput(
  output: unknown,
): output is WorkflowVersionStepOutput {
  if (!output || typeof output !== "object") return false;
  const candidate = output as Partial<WorkflowVersionStepOutput>;
  return (
    candidate.kind === WORKFLOW_VERSION_STEP_OUTPUT_KIND &&
    typeof candidate.versionPlanMode === "string" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.packageDecisions) &&
    candidate.packageDecisions.every(isWorkflowPackageDecision) &&
    Array.isArray(candidate.tagReferences) &&
    candidate.tagReferences.every(isWorkflowTagReference)
  );
}

function isWorkflowPackageDecision(
  decision: unknown,
): decision is WorkflowVersionStepOutput["packageDecisions"][number] {
  if (!decision || typeof decision !== "object") return false;
  const candidate = decision as Partial<
    WorkflowVersionStepOutput["packageDecisions"][number]
  >;
  return (
    typeof candidate.packageKey === "string" &&
    typeof candidate.packageName === "string" &&
    typeof candidate.version === "string"
  );
}

function isWorkflowTagReference(
  reference: unknown,
): reference is WorkflowVersionStepOutput["tagReferences"][number] {
  if (!reference || typeof reference !== "object") return false;
  const candidate = reference as Partial<
    WorkflowVersionStepOutput["tagReferences"][number]
  >;
  return (
    typeof candidate.tagName === "string" &&
    typeof candidate.version === "string" &&
    Array.isArray(candidate.packageKeys) &&
    candidate.packageKeys.every((key) => typeof key === "string") &&
    Array.isArray(candidate.packageNames) &&
    candidate.packageNames.every((name) => typeof name === "string")
  );
}

export function cloneWorkflowVersionStepOutput(
  output: WorkflowVersionStepOutput,
): WorkflowVersionStepOutput {
  return {
    ...output,
    packageDecisions: output.packageDecisions.map((decision) => ({
      ...decision,
    })),
    tagReferences: output.tagReferences.map((reference) => ({
      ...reference,
      packageKeys: [...reference.packageKeys],
      packageNames: [...reference.packageNames],
    })),
  };
}

export function createWorkflowVersionMap(
  ctx: PubmContext,
  plan: VersionPlan,
): [string, string][] {
  if (plan.mode === "single") {
    return ctx.config.packages.map((pkg) => [packageKey(pkg), plan.version]);
  }

  return [...plan.packages];
}

export function createWorkflowVersionTagReferences(
  ctx: PubmContext,
  plan: VersionPlan,
  options: WorkflowVersionTagReferenceOptions = {},
): WorkflowVersionTagReference[] {
  if (plan.mode === "single") {
    const packageKeys = ctx.config.packages.map((pkg) => packageKey(pkg));
    return [
      releaseTagReference(ctx, `v${plan.version}`, plan.version, packageKeys),
    ];
  }

  if (plan.mode === "fixed") {
    const packageKeys = [...plan.packages.keys()];
    return [
      releaseTagReference(ctx, `v${plan.version}`, plan.version, packageKeys),
    ];
  }

  return [...plan.packages]
    .filter(([key]) => !isWorkflowReleaseExcluded(ctx.config, pathFromKey(key)))
    .flatMap(([key, version]) => {
      const tagName = resolveWorkflowReleaseTag(ctx, key, version, options);
      return tagName ? [releaseTagReference(ctx, tagName, version, [key])] : [];
    });
}

export function isWorkflowReleaseExcluded(
  config: { excludeRelease?: string[] },
  pkgPath: string,
): boolean {
  const patterns = config.excludeRelease;
  if (!patterns?.length) return false;
  return micromatch.isMatch(pkgPath, patterns);
}

export function formatWorkflowReleaseTag(
  ctx: PubmContext,
  key: string,
  version: string,
): string {
  return resolveWorkflowReleaseTag(ctx, key, version, {
    strictQualifiedTags: true,
  }) as string;
}

function resolveWorkflowReleaseTag(
  ctx: PubmContext,
  key: string,
  version: string,
  options: WorkflowVersionTagReferenceOptions,
): string | undefined {
  const pkgName = workflowPackageNameForKey(ctx, key);
  const qualified =
    ctx.config.registryQualifiedTags || ctx.runtime.registryQualifiedTags;
  if (qualified) {
    const pkg = ctx.config.packages.find((pkg) => packageKey(pkg) === key);
    const registry = pkg?.registries[0];
    if (!registry) {
      if (!options.strictQualifiedTags) return undefined;
      throw new AbstractError(
        `Package "${pkgName}" has no registries defined but registryQualifiedTags is enabled`,
      );
    }
    return `${registry}/${pkgName}@${version}`;
  }
  return `${pkgName}@${version}`;
}

function packageDecision(
  ctx: PubmContext,
  key: string,
  version: string,
): WorkflowVersionPackageDecision {
  return {
    packageKey: key,
    packageName: workflowPackageNameForKey(ctx, key),
    version,
  };
}

function releaseTagReference(
  ctx: PubmContext,
  tagName: string,
  version: string,
  packageKeys: readonly string[],
): WorkflowVersionTagReference {
  return {
    tagName,
    version,
    packageKeys: [...packageKeys],
    packageNames: packageKeys.map((key) => workflowPackageNameForKey(ctx, key)),
  };
}

interface WorkflowVersionRuntime {
  workflowVersionStepOutput?: unknown;
}

function workflowVersionRuntime(ctx: PubmContext): WorkflowVersionRuntime {
  return ctx.runtime as WorkflowVersionRuntime;
}

export function workflowPackageNameForKey(
  ctx: PubmContext,
  key: string,
): string {
  return (
    ctx.config.packages.find((pkg) => packageKey(pkg) === key)?.name ??
    pathFromKey(key)
  );
}
