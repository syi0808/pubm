import micromatch from "micromatch";
import type { PubmContext, VersionPlan } from "../../context.js";
import { packageKey } from "../../utils/package-key.js";
import { slugifyReleasePrToken } from "./release-pr-naming.js";

export type ReleasePrScopeKind = "single" | "fixed" | "group" | "package";
export type ReleasePrGrouping = "fixed" | "independent";

export interface ReleasePrScope {
  id: string;
  kind: ReleasePrScopeKind;
  packageKeys: string[];
  displayName: string;
  slug: string;
}

interface ReleasePrConfigLike {
  grouping: ReleasePrGrouping;
  fixed?: string[][];
  linked?: string[][];
}

export function buildReleasePrScopes(
  ctx: PubmContext,
  plan: VersionPlan,
): ReleasePrScope[] {
  const pendingKeys = packageKeysForPlan(ctx, plan);

  if (plan.mode === "single") {
    return [createScope("single", "single", pendingKeys, "release")];
  }

  if (releasePrGrouping(ctx) === "fixed") {
    return [createScope("fixed", "fixed", pendingKeys, "release")];
  }

  return buildIndependentScopes(ctx, pendingKeys);
}

function buildIndependentScopes(
  ctx: PubmContext,
  pendingKeys: string[],
): ReleasePrScope[] {
  const pending = new Set(pendingKeys);
  const scoped = new Set<string>();
  const scopes: ReleasePrScope[] = [];

  const releasePrConfig = releasePrConfigFor(ctx);

  for (const group of releasePrConfig.fixed ?? []) {
    const groupKeys = resolveConfiguredGroup(ctx, group);
    const pendingGroupKeys = groupKeys.filter((key) => pending.has(key));
    if (pendingGroupKeys.length === 0) continue;
    const keys = pendingGroupKeys.filter((key) => !scoped.has(key));
    if (keys.length === 0) continue;
    for (const key of keys) scoped.add(key);
    scopes.push(
      createScope("fixed", scopeId("fixed", keys), keys, groupLabel(ctx, keys)),
    );
  }

  for (const group of releasePrConfig.linked ?? []) {
    const groupKeys = resolveConfiguredGroup(ctx, group);
    const keys = groupKeys.filter(
      (key) => pending.has(key) && !scoped.has(key),
    );
    if (keys.length === 0) continue;
    for (const key of keys) scoped.add(key);
    scopes.push(
      createScope("group", scopeId("group", keys), keys, groupLabel(ctx, keys)),
    );
  }

  for (const key of pendingKeys) {
    if (scoped.has(key)) continue;
    scoped.add(key);
    scopes.push(createPackageScope(ctx, key));
  }

  return scopes;
}

function packageKeysForPlan(ctx: PubmContext, plan: VersionPlan): string[] {
  if (plan.mode === "single") {
    if (
      ctx.config.packages.length > 1 &&
      ctx.config.packages.some((pkg) => packageKey(pkg) === plan.packageKey)
    ) {
      return [plan.packageKey];
    }
    return ctx.config.packages.map((pkg) => packageKey(pkg));
  }
  return [...plan.packages.keys()];
}

function releasePrGrouping(ctx: PubmContext): ReleasePrGrouping {
  return releasePrConfigFor(ctx).grouping;
}

function releasePrConfigFor(ctx: PubmContext): ReleasePrConfigLike {
  const releasePr = ctx.config.release.pullRequest;

  return {
    grouping: releasePr.grouping,
    fixed: releasePr.fixed,
    linked: releasePr.linked,
  };
}

function resolveConfiguredGroup(ctx: PubmContext, group: string[]): string[] {
  const keys = new Set<string>();
  for (const ref of group) {
    const normalizedRef = normalizeScopeRef(ref);
    for (const pkg of ctx.config.packages) {
      const key = packageKey(pkg);
      const aliases = [key, pkg.path, pkg.name].filter(Boolean) as string[];
      if (
        aliases.some((alias) => {
          const normalizedAlias = normalizeScopeRef(alias);
          return (
            alias === ref ||
            normalizedAlias === normalizedRef ||
            micromatch.isMatch(normalizedAlias, normalizedRef)
          );
        })
      ) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

function normalizeScopeRef(value: string): string {
  return value.replace(/\\/g, "/");
}

function createPackageScope(ctx: PubmContext, key: string): ReleasePrScope {
  const displayName = packageDisplayName(ctx, key);
  return createScope("package", key, [key], displayName);
}

function createScope(
  kind: ReleasePrScopeKind,
  id: string,
  packageKeys: string[],
  displayName: string,
): ReleasePrScope {
  const sortedKeys = [...packageKeys].sort();
  const slugSource = kind === "package" ? sortedKeys[0] : displayName;
  return {
    id,
    kind,
    packageKeys: sortedKeys,
    displayName,
    slug: slugifyReleasePrToken(slugSource),
  };
}

function groupLabel(ctx: PubmContext, keys: string[]): string {
  return keys
    .map((key) => packageDisplayName(ctx, key))
    .sort()
    .join(", ");
}

function packageDisplayName(ctx: PubmContext, key: string): string {
  return (
    ctx.config.packages.find((pkg) => packageKey(pkg) === key)?.name ?? key
  );
}

function scopeId(prefix: "fixed" | "group", keys: string[]): string {
  return `${prefix}:${[...keys].sort().join("+")}`;
}
