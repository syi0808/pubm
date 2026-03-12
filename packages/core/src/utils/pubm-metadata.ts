import cliPackageJson from "../../../pubm/package.json" with { type: "json" };
import type { Engine } from "../types/package-json.js";

const cliEngines = (cliPackageJson.engines ?? {}) as Partial<
  Record<Engine, string>
>;

declare const __PUBM_VERSION__: string;
declare const __PUBM_NODE_ENGINE__: string;
declare const __PUBM_GIT_ENGINE__: string;
declare const __PUBM_NPM_ENGINE__: string;
declare const __PUBM_PNPM_ENGINE__: string;
declare const __PUBM_YARN_ENGINE__: string;

function resolveDefine(injected: string | undefined, fallback: string): string {
  return typeof injected === "string" ? injected : fallback;
}

export const PUBM_VERSION = resolveDefine(
  typeof __PUBM_VERSION__ === "string" ? __PUBM_VERSION__ : undefined,
  cliPackageJson.version,
);

export const PUBM_ENGINES: Record<Engine, string> = {
  node: resolveDefine(
    typeof __PUBM_NODE_ENGINE__ === "string" ? __PUBM_NODE_ENGINE__ : undefined,
    cliEngines.node ?? ">=18",
  ),
  git: resolveDefine(
    typeof __PUBM_GIT_ENGINE__ === "string" ? __PUBM_GIT_ENGINE__ : undefined,
    cliEngines.git ?? ">=2.11.0",
  ),
  npm: resolveDefine(
    typeof __PUBM_NPM_ENGINE__ === "string" ? __PUBM_NPM_ENGINE__ : undefined,
    cliEngines.npm ?? "*",
  ),
  pnpm: resolveDefine(
    typeof __PUBM_PNPM_ENGINE__ === "string" ? __PUBM_PNPM_ENGINE__ : undefined,
    cliEngines.pnpm ?? "*",
  ),
  yarn: resolveDefine(
    typeof __PUBM_YARN_ENGINE__ === "string" ? __PUBM_YARN_ENGINE__ : undefined,
    cliEngines.yarn ?? "*",
  ),
};
