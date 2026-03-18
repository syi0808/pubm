import type { ResolvedPubmConfig } from "../config/types.js";
import type { PubmContext } from "../context.js";

export function filterConfigPackages(
  ctx: PubmContext,
  publishPaths: Set<string>,
): void {
  const filtered: ResolvedPubmConfig = {
    ...ctx.config,
    packages: ctx.config.packages.filter((p) => publishPaths.has(p.path)),
  };
  ctx.config = Object.freeze(filtered);
}
