import {
  applyReleaseOverride,
  buildReleasePrScopes,
  type PubmContext,
  prepareReleasePr,
  type ReleasePrBumpOverride,
  type ReleasePrOverride,
  type ReleasePrOverrideError,
  type ReleasePrScope,
  renderReleasePrBranch,
  renderReleasePrTitle,
  resolveReleasePrOverride,
  runReleasePrDryRun,
  type SlashCommandComment,
  scopeVersionPlan,
} from "@pubm/core";

export interface PlannedReleasePrScope {
  scope: ReleasePrScope;
  branchName: string;
  title: string;
  version: string;
}

export function planReleasePrScopes(ctx: PubmContext): PlannedReleasePrScope[] {
  const plan = ctx.runtime.versionPlan;
  if (!plan) return [];

  return buildReleasePrScopes(ctx, plan).map((scope) => {
    const scopedPlan = scopeVersionPlan(plan, scope);
    const version = releasePrVersion(scopedPlan);
    const pullRequest = ctx.config.release.pullRequest;
    return {
      scope,
      version,
      branchName: renderReleasePrBranch({
        ctx,
        scope,
        version,
        template: pullRequest.branchTemplate,
      }),
      title: renderReleasePrTitle({
        ctx,
        scope,
        version,
        template: pullRequest.titleTemplate,
      }),
    };
  });
}

export async function materializeReleasePrScope(
  ctx: PubmContext,
  scope: ReleasePrScope,
  override?: ReleasePrOverride,
) {
  return await prepareReleasePr(ctx, { scope, override });
}

export async function dryRunReleasePrScope(
  ctx: PubmContext,
  scope: ReleasePrScope,
  override?: ReleasePrOverride,
): Promise<void> {
  const originalPlan = ctx.runtime.versionPlan;
  if (override && originalPlan) {
    ctx.runtime.versionPlan = applyReleaseOverride(
      ctx,
      originalPlan,
      scope,
      override,
    );
  }

  try {
    await runReleasePrDryRun(ctx, scope);
  } finally {
    ctx.runtime.versionPlan = originalPlan;
  }
}

export function resolveReleasePrActionOverride(input: {
  labels?: readonly string[];
  comments?: readonly SlashCommandComment[];
  bumpLabels?: Partial<Record<ReleasePrBumpOverride, string>>;
}): {
  override?: ReleasePrOverride;
  errors: ReleasePrOverrideError[];
} {
  return resolveReleasePrOverride(input);
}

function releasePrVersion(plan: PubmContext["runtime"]["versionPlan"]): string {
  if (!plan) return "";
  if (plan.mode === "single") return plan.version;
  if (plan.mode === "fixed") return plan.version;
  const versions = new Set(plan.packages.values());
  return versions.size === 1 ? [...versions][0] : "multiple";
}
