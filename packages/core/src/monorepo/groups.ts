import micromatch from "micromatch";
import { maxBump } from "../changeset/bump-utils.js";
import type { BumpType } from "../changeset/parser.js";

/**
 * Resolves glob patterns in groups to actual package names.
 * Exact names are passed through; glob patterns are matched against allPackages.
 */
export function resolveGroups(
  groups: string[][],
  allPackages: string[],
): string[][] {
  return groups.map((group) => {
    const resolved = new Set<string>();
    for (const pattern of group) {
      const matches = micromatch(allPackages, pattern);
      for (const match of matches) {
        resolved.add(match);
      }
    }
    return [...resolved];
  });
}

/**
 * Fixed group: all packages in the group get the maximum bump type,
 * even those without changesets. If no packages in the group have bumps,
 * nothing is changed.
 */
export function applyFixedGroup(
  bumps: Map<string, BumpType>,
  group: string[],
): void {
  let max: BumpType | null = null;

  for (const pkg of group) {
    const bump = bumps.get(pkg);
    if (bump) {
      max = max ? maxBump(max, bump) : bump;
    }
  }

  if (!max) return;

  for (const pkg of group) {
    bumps.set(pkg, max);
  }
}

/**
 * Linked group: only packages that already have bumps get aligned
 * to the maximum bump type. Packages without bumps are not added.
 */
export function applyLinkedGroup(
  bumps: Map<string, BumpType>,
  group: string[],
): void {
  let max: BumpType | null = null;

  for (const pkg of group) {
    const bump = bumps.get(pkg);
    if (bump) {
      max = max ? maxBump(max, bump) : bump;
    }
  }

  if (!max) return;

  for (const pkg of group) {
    if (bumps.has(pkg)) {
      bumps.set(pkg, max);
    }
  }
}
