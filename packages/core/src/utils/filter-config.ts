import type { ResolvedPubmConfig } from "../config/types.js";
import type { PubmContext } from "../context.js";
import { packageKey } from "./package-key.js";

export function filterConfigPackages(
  ctx: PubmContext,
  publishKeys: Set<string>,
): void {
  const filtered: ResolvedPubmConfig = {
    ...ctx.config,
    packages: ctx.config.packages.filter((p) => publishKeys.has(packageKey(p))),
  };
  ctx.config = Object.freeze(filtered);
}
