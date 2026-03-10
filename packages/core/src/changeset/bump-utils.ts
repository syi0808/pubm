import type { BumpType } from "./parser.js";

export const BUMP_ORDER: Record<BumpType, number> = {
  patch: 0,
  minor: 1,
  major: 2,
};

export function maxBump(a: BumpType, b: BumpType): BumpType {
  return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}
