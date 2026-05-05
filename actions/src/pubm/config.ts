import path from "node:path";
import {
  applyVersionSourcePlan,
  createContext,
  loadConfig,
  PluginRunner,
  type PubmContext,
  resolveConfig,
  resolveOptions,
} from "@pubm/core";

export interface LoadPubmContextOptions {
  workingDirectory: string;
  baseBranch: string;
}

export async function loadPubmContext({
  workingDirectory,
  baseBranch,
}: LoadPubmContextOptions): Promise<PubmContext> {
  const cwd = path.resolve(process.cwd(), workingDirectory || ".");
  const loaded = (await loadConfig(cwd)) ?? {};
  const config = await resolveConfig(loaded, cwd);
  const options = resolveOptions({
    branch: baseBranch || config.branch,
    contents: cwd,
    tag: config.tag,
    skipTests: true,
    skipBuild: true,
  });
  const ctx = createContext(config, options, cwd);
  ctx.runtime.promptEnabled = false;
  ctx.runtime.cleanWorkingTree = true;
  ctx.runtime.pluginRunner = new PluginRunner(config.plugins);
  return ctx;
}

export async function loadPubmContextWithVersionPlan(
  options: LoadPubmContextOptions,
): Promise<PubmContext> {
  const ctx = await loadPubmContext(options);
  await applyVersionSourcePlan(ctx);
  return ctx;
}
