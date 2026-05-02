import micromatch from "micromatch";
import type { PubmContext, VersionPlan } from "../../context.js";
import { packageKey } from "../../utils/package-key.js";
import { slugifyReleasePrToken } from "./release-pr-naming.js";

export type ReleasePrScopeKind = "single" | "fixed" | "group" | "package";
export type ReleasePrGrouping = "auto" | "single" | "independent";

export interface ReleasePrScope {
  id: string;
  kind: ReleasePrScopeKind;
  packageKeys: string[];
  displayName: string;
  slug: string;
}

interface ReleasePrConfigLike {
  grouping?: ReleasePrGrouping;
}

export function buildReleasePrScopes(
  ctx: PubmContext,
  plan: VersionPlan,
): ReleasePrScope[] {
  const pendingKeys = packageKeysForPlan(ctx, plan);

  if (plan.mode === "single") {
    return [createScope("single", "single", pendingKeys, "release")];
  }

  if (plan.mode === "fixed") {
    return [createScope("fixed", "fixed", pendingKeys, "release")];
  }

  const grouping = releasePrGrouping(ctx);
  if (grouping === "single") {
    return [createScope("single", "single", pendingKeys, "release")];
  }

  if (grouping === "independent") {
    return pendingKeys.map((key) => createPackageScope(ctx, key));
  }

  return buildAutoIndependentScopes(ctx, pendingKeys);
}

function buildAutoIndependentScopes(
  ctx: PubmContext,
  pendingKeys: string[],
): ReleasePrScope[] {
  const pending = new Set(pendingKeys);
  const scoped = new Set<string>();
  const scopes: ReleasePrScope[] = [];

  for (const group of ctx.config.fixed) {
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

  for (const group of ctx.config.linked) {
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
  return ((ctx.config as { releasePr?: ReleasePrConfigLike }).releasePr
    ?.grouping ?? "auto") as ReleasePrGrouping;
}

function resolveConfiguredGroup(ctx: PubmContext, group: string[]): string[] {
  const keys = new Set<string>();
  for (const ref of group) {
    for (const pkg of ctx.config.packages) {
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
